/* ── CodaScope: Directive Service ────────────────────────────────────
   Owns directive CRUD plus the bounded document/sidecar transaction for
   apply, undo, and batch mutations.

   Storage layout:
   <epicId>/directives/<documentId>-directives.json

   Concurrency guarantee:
   The shared mutation coordinator is intentionally process-local. Design
   mutations acquire design index/content -> document versions -> directive
   sidecar. Definition mutations acquire project epic storage -> directive
   sidecar. CRUD acquires only the directive sidecar key and must never enter a
   document mutation while holding it.
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  DirectiveLinePosition,
  DirectiveLinePositionAdjustment,
  DirectiveStatus,
  DirectiveType,
  InsertionDirective,
} from "../../src/apps/codascope/codaScopeTypes.js";
import {
  CodaScopeDesignDocService,
  type CompanionPublication,
  type DesignDocCompanionMutation,
} from "./codaScopeDesignDocService.js";
import {
  CodaScopeEpicService,
  type DefinitionCompanionMutation,
} from "./codaScopeEpicService.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";

interface DirectivesFile {
  directives: InsertionDirective[];
}

type DirectiveOperation = "execute" | "apply" | "reject" | "delete" | "update" | "undo";

const DIRECTIVE_TRANSITION_POLICY: Record<DirectiveOperation, readonly DirectiveStatus[]> = {
  execute: ["pending", "generating", "rejected"],
  apply: ["pending"],
  reject: ["pending", "generating"],
  delete: ["pending", "generating", "rejected"],
  update: ["pending", "generating", "rejected"],
  undo: ["applied"],
};

const CONTROLLED_DIRECTIVE_FIELDS = new Set<keyof InsertionDirective>([
  "id",
  "epicId",
  "documentId",
  "author",
  "createdAt",
  "status",
  "preApplySnapshot",
  "appliedContentHash",
  "linePositionAdjustments",
  "appliedAt",
]);

export class CodaScopeDirectiveError extends Error {
  readonly status: number;
  readonly code: "conflict";

  constructor(message: string) {
    super(message);
    this.name = "CodaScopeDirectiveError";
    this.status = 409;
    this.code = "conflict";
  }
}

export function isDirectiveServiceError(error: unknown): error is CodaScopeDirectiveError {
  return error instanceof CodaScopeDirectiveError;
}

export class CodaScopeDirectiveService {
  constructor(
    private root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
    private readonly designDocService: CodaScopeDesignDocService =
      new CodaScopeDesignDocService(root, persistence),
    private readonly epicService: CodaScopeEpicService =
      new CodaScopeEpicService(root, persistence),
  ) {}

  setRoot(root: string): void {
    this.root = root;
    this.designDocService.setRoot(root);
    this.epicService.setRoot(root);
  }

  private projectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const data = JSON.parse(readFileSync(projectPath, "utf-8"));
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch { /* project discovery skips unrelated corrupt entries */ }
      }
    }
    return null;
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", assertSafePathSegment(epicId, "epic ID"));
  }

  private directivesDir(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "directives");
  }

  private directivesPath(projectDir: string, epicId: string, documentId: string): string {
    const safeDocumentId = assertSafePathSegment(documentId, "document ID");
    return path.join(this.directivesDir(projectDir, epicId), `${safeDocumentId}-directives.json`);
  }

  private directiveMutationKey(projectDir: string, epicId: string, documentId: string): string {
    return this.persistence.canonicalKey(
      "epic-directives",
      this.directivesPath(projectDir, epicId, documentId),
    );
  }

  private readDirectives(
    projectDir: string,
    epicId: string,
    documentId: string,
  ): Promise<DirectivesFile> {
    return this.persistence.readJson(
      this.directivesPath(projectDir, epicId, documentId),
      {
        context: { storage: "epic_directives", epicId, documentId },
        missing: () => ({ directives: [] }),
        validate: (value) => validateDirectivesFile(value, epicId, documentId),
      },
    );
  }

  private writeDirectives(
    projectDir: string,
    epicId: string,
    documentId: string,
    data: DirectivesFile,
  ): Promise<void> {
    validateDirectivesFile(data, epicId, documentId);
    return this.persistence.writeJson(
      this.directivesPath(projectDir, epicId, documentId),
      data,
      { storage: "epic_directives", epicId, documentId },
    );
  }

  private previousSidecarBytes(
    projectDir: string,
    epicId: string,
    documentId: string,
  ): Buffer | null {
    const filePath = this.directivesPath(projectDir, epicId, documentId);
    try {
      return existsSync(filePath) ? readFileSync(filePath) : null;
    } catch {
      throw new CodaScopePersistenceError({
        storage: "epic_directives",
        epicId,
        documentId,
      });
    }
  }

  private publishDirectives<T>(
    projectDir: string,
    epicId: string,
    documentId: string,
    data: DirectivesFile,
    previousBytes: Buffer | null,
    value: T,
  ): () => Promise<CompanionPublication<T>> {
    const filePath = this.directivesPath(projectDir, epicId, documentId);
    return async () => {
      await this.writeDirectives(projectDir, epicId, documentId, data);
      return {
        value,
        rollback: async () => {
          try {
            if (previousBytes) {
              await this.persistence.writeFile(
                filePath,
                previousBytes,
                { storage: "epic_directives", epicId, documentId },
              );
            } else {
              await rm(filePath, { force: true });
            }
          } catch {
            throw new CodaScopePersistenceError({
              storage: "epic_directives",
              epicId,
              documentId,
              recovery: "operator_required",
            });
          }
        },
      };
    };
  }

  private withDirectiveMutation<T>(
    projectDir: string,
    epicId: string,
    documentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.persistence.withMutation(
      this.directiveMutationKey(projectDir, epicId, documentId),
      operation,
    );
  }

  async listDirectives(
    projectId: string,
    epicId: string,
    documentId: string,
  ): Promise<InsertionDirective[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return (await this.readDirectives(projectDir, epicId, documentId)).directives;
  }

  async createDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    data: {
      type: DirectiveType;
      afterLine: number;
      startLine?: number;
      endLine?: number;
      blockId?: string;
      anchorText?: string;
      instruction: string;
      author: string;
    },
  ): Promise<InsertionDirective> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    return this.withDirectiveMutation(projectDir, epicId, documentId, async () => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const directive: InsertionDirective = {
        id: `dir_${crypto.randomBytes(6).toString("hex")}`,
        epicId,
        documentId,
        type: data.type,
        afterLine: data.afterLine,
        startLine: data.startLine,
        endLine: data.endLine,
        blockId: data.blockId,
        anchorText: data.anchorText,
        instruction: data.instruction,
        author: data.author,
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      validateDirective(directive, epicId, documentId);
      file.directives.push(directive);
      await this.writeDirectives(projectDir, epicId, documentId, file);
      return directive;
    });
  }

  async updateDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
    changes: Partial<InsertionDirective>,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDirectiveMutation(projectDir, epicId, documentId, async () => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const idx = file.directives.findIndex((directive) => directive.id === directiveId);
      if (idx < 0) return null;
      assertDirectiveTransition(file.directives[idx], "update");
      assertUncontrolledDirectivePatch(changes);
      const directive = { ...file.directives[idx], ...changes };
      validateDirective(directive, epicId, documentId);
      file.directives[idx] = directive;
      await this.writeDirectives(projectDir, epicId, documentId, file);
      return directive;
    });
  }

  async executeDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    generatedContent: string,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDirectiveMutation(projectDir, epicId, documentId, async () => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const directive = file.directives.find((candidate) => candidate.id === directiveId);
      if (!directive) return null;
      assertDirectiveTransition(directive, "execute");
      if (!hasGeneratedContent(generatedContent)) throw transitionConflict();
      directive.generatedContent = generatedContent;
      directive.status = "pending";
      clearApplyMetadata(directive);
      await this.writeDirectives(projectDir, epicId, documentId, file);
      return directive;
    });
  }

  async deleteDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
  ): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.withDirectiveMutation(projectDir, epicId, documentId, async () => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const idx = file.directives.findIndex((directive) => directive.id === directiveId);
      if (idx < 0) return false;
      assertDirectiveTransition(file.directives[idx], "delete");
      file.directives.splice(idx, 1);
      await this.writeDirectives(projectDir, epicId, documentId, file);
      return true;
    });
  }

  async rejectDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDirectiveMutation(projectDir, epicId, documentId, async () => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const directive = file.directives.find((candidate) => candidate.id === directiveId);
      if (!directive) return null;
      assertDirectiveTransition(directive, "reject");
      directive.status = "rejected";
      directive.generatedContent = undefined;
      clearApplyMetadata(directive);
      await this.writeDirectives(projectDir, epicId, documentId, file);
      return directive;
    });
  }

  async applyDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    author: string,
  ): Promise<{ directive: InsertionDirective; newContent: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    const sidecarKey = this.directiveMutationKey(projectDir, epicId, documentId);
    const prepare = async (
      currentContent: string,
    ): Promise<DesignDocCompanionMutation<{ directive: InsertionDirective; newContent: string }>> => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const directive = file.directives.find((candidate) => candidate.id === directiveId);
      if (!directive) return { kind: "noop", value: null as never };
      assertDirectiveTransition(directive, "apply");
      const previousBytes = this.previousSidecarBytes(projectDir, epicId, documentId);
      const newContent = applyOneDirective(file, directive, currentContent);
      return {
        kind: "commit",
        content: newContent,
        publish: this.publishDirectives(
          projectDir,
          epicId,
          documentId,
          file,
          previousBytes,
          { directive, newContent },
        ),
      };
    };

    if (documentId === "definition") {
      const result = await this.epicService.mutateDefinitionWithCompanion(
        projectId,
        epicId,
        sidecarKey,
        prepare as (
          currentContent: string,
        ) => Promise<DefinitionCompanionMutation<{ directive: InsertionDirective; newContent: string }>>,
      );
      return normalizeMutationResult(result?.companion ?? null);
    }
    const result = await this.designDocService.mutateDesignDocWithVersionAndCompanion(
      projectId,
      epicId,
      documentId,
      sidecarKey,
      { author, summary: `Apply directive ${directiveId}` },
      prepare,
    );
    return normalizeMutationResult(result?.companion ?? null);
  }

  async undoDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    author: string,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    const sidecarKey = this.directiveMutationKey(projectDir, epicId, documentId);
    const prepare = async (
      currentContent: string,
    ): Promise<DesignDocCompanionMutation<InsertionDirective | null>> => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const directive = file.directives.find((candidate) => candidate.id === directiveId);
      if (!directive) return { kind: "noop", value: null };
      assertDirectiveTransition(directive, "undo");
      if (directive.preApplySnapshot === undefined) {
        throw unsafeUndo("This directive has no verified predecessor and cannot be undone safely.");
      }
      if (!directive.appliedContentHash) {
        throw unsafeUndo("This legacy directive has no verifiable applied-content marker and cannot be undone safely.");
      }
      if (contentHash(currentContent) !== directive.appliedContentHash) {
        throw unsafeUndo("Document content changed after this directive was applied.");
      }
      verifyAndRestorePeerPositions(file, directive);
      const previousBytes = this.previousSidecarBytes(projectDir, epicId, documentId);
      const restoredContent = directive.preApplySnapshot;
      directive.status = "pending";
      clearApplyMetadata(directive);
      return {
        kind: "commit",
        content: restoredContent,
        publish: this.publishDirectives(
          projectDir,
          epicId,
          documentId,
          file,
          previousBytes,
          directive,
        ),
      };
    };

    if (documentId === "definition") {
      const result = await this.epicService.mutateDefinitionWithCompanion(
        projectId,
        epicId,
        sidecarKey,
        prepare as (
          currentContent: string,
        ) => Promise<DefinitionCompanionMutation<InsertionDirective | null>>,
      );
      return result?.companion ?? null;
    }
    const result = await this.designDocService.mutateDesignDocWithVersionAndCompanion(
      projectId,
      epicId,
      documentId,
      sidecarKey,
      { author, summary: `Undo directive ${directiveId}` },
      prepare,
    );
    return result?.companion ?? null;
  }

  async executeBatchDirectives(
    projectId: string,
    epicId: string,
    documentId: string,
    author: string,
  ): Promise<{ applied: InsertionDirective[]; newContent: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    const sidecarKey = this.directiveMutationKey(projectDir, epicId, documentId);
    const prepare = async (
      currentContent: string,
    ): Promise<DesignDocCompanionMutation<{ applied: InsertionDirective[]; newContent: string }>> => {
      const file = await this.readDirectives(projectDir, epicId, documentId);
      const pending = file.directives
        .filter((directive) => directive.status === "pending" && hasGeneratedContent(directive.generatedContent))
        .sort((left, right) => left.afterLine - right.afterLine || left.id.localeCompare(right.id));
      if (pending.length === 0) {
        return { kind: "noop", value: { applied: [], newContent: currentContent } };
      }
      const previousBytes = this.previousSidecarBytes(projectDir, epicId, documentId);
      let nextContent = currentContent;
      const applied: InsertionDirective[] = [];
      for (const directive of pending) {
        nextContent = applyOneDirective(file, directive, nextContent);
        applied.push(directive);
      }
      return {
        kind: "commit",
        content: nextContent,
        publish: this.publishDirectives(
          projectDir,
          epicId,
          documentId,
          file,
          previousBytes,
          { applied, newContent: nextContent },
        ),
      };
    };

    if (documentId === "definition") {
      const result = await this.epicService.mutateDefinitionWithCompanion(
        projectId,
        epicId,
        sidecarKey,
        prepare as (
          currentContent: string,
        ) => Promise<DefinitionCompanionMutation<{ applied: InsertionDirective[]; newContent: string }>>,
      );
      return result?.companion ?? null;
    }
    const result = await this.designDocService.mutateDesignDocWithVersionAndCompanion(
      projectId,
      epicId,
      documentId,
      sidecarKey,
      { author, summary: "Apply directive batch" },
      prepare,
    );
    return result?.companion ?? null;
  }
}

function normalizeMutationResult(
  value: { directive: InsertionDirective; newContent: string } | null,
): { directive: InsertionDirective; newContent: string } | null {
  return value?.directive ? value : null;
}

function assertDirectiveTransition(
  directive: InsertionDirective,
  operation: DirectiveOperation,
): void {
  if (!DIRECTIVE_TRANSITION_POLICY[operation].includes(directive.status)) {
    throw transitionConflict();
  }
  if (operation === "apply" && !hasGeneratedContent(directive.generatedContent)) {
    throw transitionConflict();
  }
  if (operation === "reject"
    && directive.status === "pending"
    && !hasGeneratedContent(directive.generatedContent)) {
    throw transitionConflict();
  }
}

function assertUncontrolledDirectivePatch(changes: Partial<InsertionDirective>): void {
  if (Object.keys(changes).some((field) => (
    CONTROLLED_DIRECTIVE_FIELDS.has(field as keyof InsertionDirective)
  ))) {
    throw transitionConflict();
  }
}

function hasGeneratedContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function transitionConflict(): CodaScopeDirectiveError {
  return new CodaScopeDirectiveError("Directive state does not allow this operation.");
}

function applyOneDirective(
  file: DirectivesFile,
  directive: InsertionDirective,
  currentContent: string,
): string {
  const generated = directive.generatedContent;
  if (!generated) throw new CodaScopePersistenceCorruptError({
    storage: "epic_directives",
    epicId: directive.epicId,
    documentId: directive.documentId,
  });
  const lines = currentContent.split("\n");
  let newContent: string;
  let shift: number;
  let affectAfterLine: number;

  if (directive.type === "insert") {
    const insertAt = Math.min(directive.afterLine, lines.length);
    lines.splice(insertAt, 0, generated);
    newContent = lines.join("\n");
    shift = generated.split("\n").length;
    affectAfterLine = directive.afterLine;
  } else {
    const startLine = directive.startLine;
    const endLine = directive.endLine;
    if (startLine === undefined || endLine === undefined) {
      throw new CodaScopePersistenceCorruptError({
        storage: "epic_directives",
        epicId: directive.epicId,
        documentId: directive.documentId,
      });
    }
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    const originalLineCount = end - start;
    lines.splice(start, originalLineCount, generated);
    newContent = lines.join("\n");
    shift = generated.split("\n").length - originalLineCount;
    affectAfterLine = startLine;
  }

  const adjustments = adjustPeerPositions(file, directive.id, affectAfterLine, shift);
  directive.preApplySnapshot = currentContent;
  directive.appliedContentHash = contentHash(newContent);
  directive.linePositionAdjustments = adjustments.length > 0 ? adjustments : undefined;
  directive.status = "applied";
  directive.appliedAt = new Date().toISOString();
  return newContent;
}

function adjustPeerPositions(
  file: DirectivesFile,
  directiveId: string,
  affectAfterLine: number,
  shift: number,
): DirectiveLinePositionAdjustment[] {
  if (shift === 0) return [];
  const adjustments: DirectiveLinePositionAdjustment[] = [];
  for (const peer of file.directives) {
    if (peer.id === directiveId || peer.status === "applied") continue;
    const before = linePosition(peer);
    if (peer.afterLine > affectAfterLine) peer.afterLine += shift;
    if (peer.startLine !== undefined && peer.startLine > affectAfterLine) peer.startLine += shift;
    if (peer.endLine !== undefined && peer.endLine > affectAfterLine) peer.endLine += shift;
    const after = linePosition(peer);
    if (!sameLinePosition(before, after)) {
      adjustments.push({ directiveId: peer.id, before, after });
    }
  }
  return adjustments;
}

function verifyAndRestorePeerPositions(
  file: DirectivesFile,
  directive: InsertionDirective,
): void {
  for (const adjustment of directive.linePositionAdjustments ?? []) {
    const peer = file.directives.find((candidate) => candidate.id === adjustment.directiveId);
    if (!peer || !sameLinePosition(linePosition(peer), adjustment.after)) {
      throw unsafeUndo("Directive positions changed after this directive was applied.");
    }
  }
  for (const adjustment of directive.linePositionAdjustments ?? []) {
    const peer = file.directives.find((candidate) => candidate.id === adjustment.directiveId)!;
    peer.afterLine = adjustment.before.afterLine;
    peer.startLine = adjustment.before.startLine;
    peer.endLine = adjustment.before.endLine;
  }
}

function linePosition(directive: InsertionDirective): DirectiveLinePosition {
  return {
    afterLine: directive.afterLine,
    startLine: directive.startLine,
    endLine: directive.endLine,
  };
}

function sameLinePosition(
  left: DirectiveLinePosition,
  right: DirectiveLinePosition,
): boolean {
  return left.afterLine === right.afterLine
    && left.startLine === right.startLine
    && left.endLine === right.endLine;
}

function clearApplyMetadata(directive: InsertionDirective): void {
  directive.preApplySnapshot = undefined;
  directive.appliedContentHash = undefined;
  directive.linePositionAdjustments = undefined;
  directive.appliedAt = undefined;
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function unsafeUndo(message: string): CodaScopeDirectiveError {
  return new CodaScopeDirectiveError(`${message} Reload the document before retrying.`);
}

function validateDirectivesFile(
  value: unknown,
  epicId: string,
  documentId: string,
): DirectivesFile {
  if (!isRecord(value) || !Array.isArray(value.directives)) {
    throw new Error("invalid directives file");
  }
  const ids = new Set<string>();
  for (const directive of value.directives) {
    validateDirective(directive, epicId, documentId);
    if (ids.has(directive.id)) throw new Error("duplicate directive ID");
    ids.add(directive.id);
  }
  return value as unknown as DirectivesFile;
}

function validateDirective(
  value: unknown,
  epicId: string,
  documentId: string,
): asserts value is InsertionDirective {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || value.epicId !== epicId
    || value.documentId !== documentId
    || !isDirectiveType(value.type)
    || !isNonNegativeInteger(value.afterLine)
    || (value.startLine !== undefined && !isPositiveInteger(value.startLine))
    || (value.endLine !== undefined && !isPositiveInteger(value.endLine))
    || (value.startLine !== undefined && value.endLine !== undefined && value.endLine < value.startLine)
    || (value.blockId !== undefined && typeof value.blockId !== "string")
    || (value.anchorText !== undefined && typeof value.anchorText !== "string")
    || typeof value.instruction !== "string"
    || typeof value.author !== "string"
    || typeof value.createdAt !== "string"
    || !isDirectiveStatus(value.status)
    || (value.generatedContent !== undefined && typeof value.generatedContent !== "string")
    || (value.preApplySnapshot !== undefined && typeof value.preApplySnapshot !== "string")
    || (value.appliedContentHash !== undefined
      && (typeof value.appliedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.appliedContentHash)))
    || (value.appliedAt !== undefined && typeof value.appliedAt !== "string")
    || !validateLineAdjustments(value.linePositionAdjustments)) {
    throw new Error("invalid directive record");
  }
  if ((value.type === "replace" || value.type === "expand")
    && (value.startLine === undefined || value.endLine === undefined)) {
    throw new Error("invalid directive range");
  }
  assertSafePathSegment(value.id, "directive ID");
}

function validateLineAdjustments(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const adjustment of value) {
    if (!isRecord(adjustment)
      || typeof adjustment.directiveId !== "string"
      || ids.has(adjustment.directiveId)
      || !isLinePosition(adjustment.before)
      || !isLinePosition(adjustment.after)) {
      return false;
    }
    assertSafePathSegment(adjustment.directiveId, "directive ID");
    ids.add(adjustment.directiveId);
  }
  return true;
}

function isLinePosition(value: unknown): value is DirectiveLinePosition {
  return isRecord(value)
    && isNonNegativeInteger(value.afterLine)
    && (value.startLine === undefined || isPositiveInteger(value.startLine))
    && (value.endLine === undefined || isPositiveInteger(value.endLine))
    && !(value.startLine !== undefined
      && value.endLine !== undefined
      && value.endLine < value.startLine);
}

function isDirectiveType(value: unknown): value is DirectiveType {
  return value === "insert" || value === "replace" || value === "expand";
}

function isDirectiveStatus(value: unknown): value is DirectiveStatus {
  return value === "pending"
    || value === "generating"
    || value === "applied"
    || value === "rejected";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
