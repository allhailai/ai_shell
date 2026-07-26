/* ── CodaScope: Workspace Note Mutation Boundary ────────────────────
   The only service through which the workspace assistant may read or mutate
   CodaScope notes. Identity is a stable frontmatter ID resolved freshly
   across only the authenticated actor's private active root and the shared
   active root.
   ──────────────────────────────────────────────────────────────────── */

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  NoteFrontmatter,
  NoteVisibility,
} from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  CodaScopeNoteService,
  NoteConflictResult,
  NoteReadResult,
} from "./codaScopeNoteService.js";
import type { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import type { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import type { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";
import type { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import type { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import {
  assertSafePathSegment,
  resolveContainedRelativePath,
} from "./codaScopePathSafety.js";
import {
  WORKSPACE_NOTE_MAX_BODY,
  WORKSPACE_NOTE_MAX_PATH,
  WORKSPACE_NOTE_MAX_STABLE_ID,
  WORKSPACE_NOTE_MAX_TITLE,
} from "../../src/apps/codascope/workspaceMutationActionValidation.js";

const MAX_NOTE_PATH = WORKSPACE_NOTE_MAX_PATH;
const MAX_NOTE_TITLE = WORKSPACE_NOTE_MAX_TITLE;
const MAX_NOTE_BODY = WORKSPACE_NOTE_MAX_BODY;
const MAX_ARCHIVE_REASON = 500;
const MAX_FRONTMATTER_SCAN_BYTES = 32_768;
const MAX_STORED_NOTE_BYTES = MAX_FRONTMATTER_SCAN_BYTES + (MAX_NOTE_BODY * 4);

export interface WorkspaceNoteDto {
  stableId: string;
  scope: "codascope";
  visibility: NoteVisibility;
  path: string;
  title: string;
  contentHash: string;
}

export interface WorkspaceEditableNoteDto extends WorkspaceNoteDto {
  body: string;
}

export interface WorkspaceNoteCreateInput {
  path: string;
  title: string;
  body: string;
  visibility?: NoteVisibility;
}

export interface WorkspaceCurrentNoteIdentity {
  stableId: string;
  scope: "codascope";
  visibility: NoteVisibility;
  path: string;
  title: string;
  contentHash?: string;
}

export class WorkspaceNoteUnavailableError extends Error {
  readonly code = "not_found";
  readonly status = 404;

  constructor() {
    super("CodaScope note not found.");
    this.name = "WorkspaceNoteUnavailableError";
  }
}

export class WorkspaceNoteConflictError extends Error {
  readonly code = "conflict";
  readonly status = 409;
  readonly currentHash: string;

  constructor(currentHash: string) {
    super("CodaScope note was modified since it was read.");
    this.name = "WorkspaceNoteConflictError";
    this.currentHash = currentHash;
  }
}

export class WorkspaceNoteInvalidInputError extends Error {
  readonly code = "invalid_input";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNoteInvalidInputError";
  }
}

interface ResolvedWorkspaceNote {
  dto: WorkspaceNoteDto;
  body: string;
  content: string;
  frontmatter: NoteFrontmatter;
}

interface ScannedNote {
  visibility: NoteVisibility;
  path: string;
  absolutePath: string;
}

/**
 * Root-bound workspace note façade. It deliberately receives the existing
 * graph collaborators rather than constructing a parallel note stack.
 */
export class CodaScopeWorkspaceNoteService {
  private readonly mutationQueues = new Map<string, Promise<unknown>>();
  private disposed = false;

  constructor(
    private readonly noteSvc: CodaScopeNoteService,
    private readonly bundleSvc: CodaScopeNoteBundleService,
    private readonly transferSvc: CodaScopeNoteTransferService,
    private readonly annotationSvc: CodaScopeNoteAnnotationService,
    private readonly linkIndexSvc: CodaScopeNoteLinkIndexService,
    private readonly userPrefsSvc: CodaScopeNoteUserPrefsService,
    private readonly auditSvc: CodaScopeNoteAuditService,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.mutationQueues.clear();
  }

  async resolveActiveNote(
    actorId: string,
    stableId: string,
  ): Promise<WorkspaceNoteDto | null> {
    this.assertActive();
    const resolved = await this.resolveStrict(actorId, stableId);
    return resolved?.dto ?? null;
  }

  async readForEditing(
    actorId: string,
    stableId: string,
  ): Promise<WorkspaceEditableNoteDto | null> {
    this.assertActive();
    const resolved = await this.resolveStrict(actorId, stableId);
    return resolved ? { ...resolved.dto, body: resolved.body } : null;
  }

  /**
   * Validate metadata-only current-note context against current active state.
   * Every supplied identity field, including an optional content hash, must
   * match current authoritative state. Stale context receives no deictic grant.
   */
  async resolveCurrentContext(
    actorId: string,
    current: WorkspaceCurrentNoteIdentity,
  ): Promise<WorkspaceNoteDto | null> {
    this.assertActive();
    if (current.scope !== "codascope") return null;
    const resolved = await this.resolveStrict(actorId, current.stableId);
    if (!resolved) return null;
    return resolved.dto.visibility === current.visibility
      && resolved.dto.path === normalizeNotePath(current.path)
      && resolved.dto.title === current.title
      && (current.contentHash === undefined
        || resolved.dto.contentHash === current.contentHash)
      ? resolved.dto
      : null;
  }

  /**
   * Resolve an explicit active-note reference from a user turn. Stable IDs and
   * contained relative paths are exact token references. Titles match only
   * quoted/backticked text or explicit "note named/titled" grammar.
   */
  async resolveExactReference(
    actorId: string,
    message: string,
  ): Promise<WorkspaceNoteDto | null> {
    this.assertActive();
    if (!message.trim()) return null;
    const explicitTitles = extractExplicitTitleReferences(message);
    const matches: ScannedNote[] = [];
    let relevantMalformed = false;
    for (const candidate of this.scanEligibleActiveNotes(actorId)) {
      const frontmatter = safeReadFrontmatter(candidate.absolutePath);
      if (frontmatter === null) continue;
      const rawIds = extractRawIdentities(frontmatter);
      const rawIdReferenced = rawIds.some((id) =>
        exactTokenMentioned(message, id));
      const pathReferenced = exactTokenMentioned(message, candidate.path);
      if (rawIds.length !== 1 && rawIdReferenced) {
        relevantMalformed = true;
        continue;
      }
      try {
        const parsed = parseStrictStoredNote(frontmatter);
        const titleReferenced = explicitTitles.has(
          normalizeExplicitTitle(parsed.frontmatter.title),
        );
        if (rawIdReferenced || pathReferenced || titleReferenced) {
          matches.push(candidate);
        }
      } catch {
        if (rawIdReferenced || pathReferenced) relevantMalformed = true;
      }
    }
    const distinct = [...new Map(matches.map((candidate) => [
      `${candidate.visibility}\u0000${candidate.path}`,
      candidate,
    ])).values()];
    if (relevantMalformed || distinct.length !== 1) return null;
    const selected = distinct[0]!;
    if (!isBoundedStoredNote(selected.absolutePath)) return null;
    try {
      return (await this.readAtPath(
        actorId,
        selected.visibility,
        selected.path,
      ))?.dto ?? null;
    } catch {
      return null;
    }
  }

  async createNote(
    actorId: string,
    input: WorkspaceNoteCreateInput,
    authorization: { sharedRequested: boolean },
  ): Promise<WorkspaceNoteDto> {
    this.assertActive();
    const actor = validateActor(actorId);
    const visibility = input.visibility ?? "private";
    if (visibility !== "private" && visibility !== "shared") {
      throw new WorkspaceNoteInvalidInputError("visibility must be private or shared.");
    }
    if (visibility === "shared" && !authorization.sharedRequested) {
      throw new WorkspaceNoteInvalidInputError(
        "Shared note creation was not explicitly requested.",
      );
    }
    const notePath = validateNotePath(input.path);
    const title = validateTitle(input.title);
    const body = validateBody(input.body);

    return this.withMutation(
      `create:${visibility}:${actor}:${notePath}`,
      async () => {
        const existing = await this.readAtPath(actor, visibility, notePath);
        if (existing) {
          throw new WorkspaceNoteInvalidInputError("A note already exists at that path.");
        }

        const now = new Date().toISOString();
        const frontmatter: NoteFrontmatter = {
          id: randomUUID(),
          title,
          tags: [],
          created: now,
          updated: now,
          owner: actor,
          status: visibility === "shared" ? "draft" : undefined,
        };
        const stored = this.noteSvc.serializeFrontmatter(frontmatter) + body;
        let createError: unknown;
        try {
          await this.noteSvc.createNote(
            "codascope",
            visibility,
            { userId: actor },
            notePath,
            stored,
          );
        } catch (error) {
          createError = error;
        }

        // createNote can durably publish before a derived index refresh fails.
        // Readback decides the confirmed outcome so a durable creation is not
        // incorrectly reported as failed.
        const created = await this.readAtPath(actor, visibility, notePath);
        if (!created || created.dto.stableId !== frontmatter.id) {
          if (createError) throw createError;
          throw new Error("CodaScope note creation could not be confirmed.");
        }

        this.linkIndexSvc.updateLinksForNote(
          "codascope",
          visibility,
          { userId: actor },
          created.dto.stableId,
          created.body,
        );
        this.audit("note.created", actor, created.dto);
        return created.dto;
      },
    );
  }

  async replaceBody(
    actorId: string,
    stableId: string,
    body: string,
    expectedHash: string,
  ): Promise<WorkspaceNoteDto> {
    this.assertActive();
    return this.mutateExisting(actorId, stableId, expectedHash, async (
      actor,
      current,
    ) => {
      const nextBody = validateBody(body);
      const stored = this.noteSvc.serializeFrontmatter(current.frontmatter)
        + nextBody;
      await this.writeExisting(
        actor,
        current,
        stored,
        expectedHash,
        (saved) => saved.body === nextBody
          && saved.dto.title === current.dto.title,
      );
      try {
        await this.annotationSvc.reconcileAfterNoteWrite(
          "codascope",
          current.dto.visibility,
          { userId: actor },
          current.dto.path,
        );
      } catch {
        // The body write is already durable and confirmed. Annotation state is
        // derived and will be reconciled on the next normal note read/save.
      }
      const saved = await this.requireResolved(actor, stableId);
      this.linkIndexSvc.updateLinksForNote(
        "codascope",
        saved.dto.visibility,
        { userId: actor },
        saved.dto.stableId,
        saved.body,
      );
      this.audit("note.updated", actor, saved.dto, { operation: "body_edit" });
      return saved.dto;
    });
  }

  async setTitle(
    actorId: string,
    stableId: string,
    title: string,
    expectedHash: string,
  ): Promise<WorkspaceNoteDto> {
    this.assertActive();
    return this.mutateExisting(actorId, stableId, expectedHash, async (
      actor,
      current,
    ) => {
      const nextFrontmatter = {
        ...current.frontmatter,
        title: validateTitle(title),
      };
      const stored = this.noteSvc.serializeFrontmatter(nextFrontmatter)
        + current.body;
      await this.writeExisting(
        actor,
        current,
        stored,
        expectedHash,
        (saved) => saved.dto.title === nextFrontmatter.title
          && saved.body === current.body,
      );
      try {
        await this.annotationSvc.reconcileAfterNoteWrite(
          "codascope",
          current.dto.visibility,
          { userId: actor },
          current.dto.path,
        );
      } catch {
        // See body-edit handling above: never lose a confirmed durable result.
      }
      const saved = await this.requireResolved(actor, stableId);
      this.linkIndexSvc.updateLinksForNote(
        "codascope",
        saved.dto.visibility,
        { userId: actor },
        saved.dto.stableId,
        saved.body,
      );
      this.audit("note.updated", actor, saved.dto, { operation: "title_change" });
      return saved.dto;
    });
  }

  async setVisibility(
    actorId: string,
    stableId: string,
    visibility: NoteVisibility,
    expectedHash: string,
  ): Promise<WorkspaceNoteDto> {
    this.assertActive();
    if (visibility !== "private" && visibility !== "shared") {
      throw new WorkspaceNoteInvalidInputError("visibility must be private or shared.");
    }
    return this.mutateExisting(actorId, stableId, expectedHash, async (
      actor,
      current,
    ) => {
      if (current.dto.visibility === visibility) return current.dto;
      const result = await this.transferSvc.moveFile({
        fromScope: "codascope",
        fromVisibility: current.dto.visibility,
        fromOpts: { userId: actor },
        fromPath: current.dto.path,
        toScope: "codascope",
        toVisibility: visibility,
        toOpts: { userId: actor },
        toPath: current.dto.path,
      });
      if (!result.moved || !result.noteIds.includes(stableId)) {
        throw new WorkspaceNoteUnavailableError();
      }
      const saved = await this.requireResolved(actor, stableId);
      if (saved.dto.visibility !== visibility
        || saved.dto.path !== current.dto.path) {
        throw new Error("CodaScope note transfer could not be confirmed.");
      }
      return saved.dto;
    });
  }

  async archiveNote(
    actorId: string,
    stableId: string,
    expectedHash: string,
    reason?: string,
  ): Promise<WorkspaceNoteDto> {
    this.assertActive();
    const archiveReason = reason === undefined
      ? undefined
      : boundedText(reason, MAX_ARCHIVE_REASON, "reason", true);
    return this.mutateExisting(actorId, stableId, expectedHash, async (
      actor,
      current,
    ) => {
      try {
        await this.bundleSvc.archiveNote(
          "codascope",
          current.dto.visibility,
          { userId: actor },
          current.dto.path,
          archiveReason,
        );
      } catch {
        // Authoritative active/archive readback below decides the outcome.
      }
      if (!await this.confirmArchivedState(actor, current)) {
        throw new WorkspaceNoteUnavailableError();
      }
      try {
        this.linkIndexSvc.removeNote(
          "codascope",
          current.dto.visibility,
          { userId: actor },
          stableId,
        );
      } catch {
        // The recoverable archive is authoritative; indexes are derived.
      }
      try {
        this.audit("note.archived", actor, current.dto, archiveReason
          ? { reason: archiveReason }
          : undefined);
      } catch {
        // Preserve confirmed archive success after derived audit failure.
      }
      return current.dto;
    });
  }

  private async confirmArchivedState(
    actor: string,
    current: ResolvedWorkspaceNote,
  ): Promise<boolean> {
    try {
      if (await this.resolveStrict(actor, current.dto.stableId)) return false;
      const archived = await this.noteSvc.listArchived(
        "codascope",
        current.dto.visibility,
        { userId: actor },
      );
      const matches = archived.filter((meta) =>
        meta.kind !== "folder"
        && meta.noteId === current.dto.stableId
        && meta.originalScope === "codascope"
        && meta.originalVisibility === current.dto.visibility
        && normalizeNotePath(meta.originalPath) === current.dto.path
        && meta.archivedBy === actor);
      return matches.length === 1;
    } catch {
      return false;
    }
  }

  private async mutateExisting<T>(
    actorId: string,
    stableId: string,
    expectedHash: string,
    mutation: (
      actor: string,
      current: ResolvedWorkspaceNote,
    ) => Promise<T>,
  ): Promise<T> {
    const actor = validateActor(actorId);
    const id = validateStableId(stableId);
    const hash = validateExpectedHash(expectedHash);
    return this.withMutation(`note:${id.toLocaleLowerCase()}`, async () => {
      const current = await this.requireResolved(actor, id);
      if (current.dto.contentHash !== hash) {
        throw new WorkspaceNoteConflictError(current.dto.contentHash);
      }
      return mutation(actor, current);
    });
  }

  private async writeExisting(
    actor: string,
    current: ResolvedWorkspaceNote,
    stored: string,
    expectedHash: string,
    confirmsDurableWrite: (saved: ResolvedWorkspaceNote) => boolean,
  ): Promise<void> {
    let result;
    let writeError: unknown;
    try {
      result = await this.noteSvc.updateNote(
        "codascope",
        current.dto.visibility,
        { userId: actor },
        current.dto.path,
        stored,
        expectedHash,
      );
    } catch (error) {
      writeError = error;
    }
    if (writeError) {
      const saved = await this.readAtPath(
        actor,
        current.dto.visibility,
        current.dto.path,
      );
      if (saved
        && saved.dto.stableId === current.dto.stableId
        && confirmsDurableWrite(saved)) {
        return;
      }
      throw writeError;
    }
    if (!result) throw new WorkspaceNoteUnavailableError();
    if (isConflict(result)) {
      throw new WorkspaceNoteConflictError(result.currentHash);
    }
  }

  private async requireResolved(
    actorId: string,
    stableId: string,
  ): Promise<ResolvedWorkspaceNote> {
    const resolved = await this.resolveStrict(actorId, stableId);
    if (!resolved) throw new WorkspaceNoteUnavailableError();
    return resolved;
  }

  private async resolveStrict(
    actorId: string,
    stableId: string,
  ): Promise<ResolvedWorkspaceNote | null> {
    const actor = validateActor(actorId);
    const id = validateStableId(stableId);
    const matches: ResolvedWorkspaceNote[] = [];
    let relevantMalformed = false;

    for (const candidate of this.scanEligibleActiveNotes(actor)) {
      const frontmatter = safeReadFrontmatter(candidate.absolutePath);
      if (frontmatter === null) continue;
      const rawIds = extractRawIdentities(frontmatter);
      const matchingRawIds = rawIds.filter((rawId) =>
        rawId.toLocaleLowerCase() === id.toLocaleLowerCase());
      if (matchingRawIds.length === 0) continue;
      if (rawIds.length !== 1 || matchingRawIds.length !== 1) {
        relevantMalformed = true;
        continue;
      }
      try {
        if (!isBoundedStoredNote(candidate.absolutePath)) {
          relevantMalformed = true;
          continue;
        }
        const parsed = await this.readAtPath(
          actor,
          candidate.visibility,
          candidate.path,
        );
        if (parsed) matches.push(parsed);
      } catch {
        relevantMalformed = true;
      }
    }

    if (relevantMalformed || matches.length > 1) {
      throw new WorkspaceNoteUnavailableError();
    }
    return matches[0] ?? null;
  }

  private async readAtPath(
    actorId: string,
    visibility: NoteVisibility,
    notePath: string,
  ): Promise<ResolvedWorkspaceNote | null> {
    const result = await this.noteSvc.readNote(
      "codascope",
      visibility,
      { userId: actorId },
      notePath,
    );
    if (!result) return null;
    return strictResult(visibility, normalizeNotePath(notePath), result);
  }

  private scanEligibleActiveNotes(actorId: string): ScannedNote[] {
    const roots: Array<{ visibility: NoteVisibility; root: string }> = [];
    for (const visibility of ["private", "shared"] as const) {
      const root = this.noteSvc.resolveNotesDir(
        "codascope",
        visibility,
        { userId: actorId },
      );
      if (root) roots.push({ visibility, root });
    }
    return roots.flatMap(({ visibility, root }) => scanMarkdown(root)
      .map((absolutePath) => ({
        visibility,
        absolutePath,
        path: path.relative(root, absolutePath).split(path.sep).join("/"),
      })));
  }

  private audit(
    event: string,
    actor: string,
    note: WorkspaceNoteDto,
    metadata?: Record<string, unknown>,
  ): void {
    this.auditSvc.log({
      event,
      timestamp: new Date().toISOString(),
      actor,
      noteId: note.stableId,
      scope: "codascope",
      visibility: note.visibility,
      path: note.path,
      metadata,
    });
  }

  private withMutation<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    this.mutationQueues.set(key, settled);
    void settled.finally(() => {
      if (this.mutationQueues.get(key) === settled) {
        this.mutationQueues.delete(key);
      }
    });
    return result;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Workspace note service has been disposed.");
    }
  }
}

function strictResult(
  visibility: NoteVisibility,
  notePath: string,
  result: NoteReadResult,
): ResolvedWorkspaceNote {
  const parsed = parseStrictStoredNote(result.content);
  const canonicalPath = validateStoredNotePath(notePath);
  if (parsed.frontmatter.id !== result.frontmatter.id) {
    throw new WorkspaceNoteUnavailableError();
  }
  return {
    dto: {
      stableId: parsed.frontmatter.id,
      scope: "codascope",
      visibility,
      path: canonicalPath,
      title: parsed.frontmatter.title,
      contentHash: result.contentHash,
    },
    body: parsed.body,
    content: result.content,
    frontmatter: parsed.frontmatter,
  };
}

function parseStrictStoredNote(content: string): {
  frontmatter: NoteFrontmatter;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new WorkspaceNoteUnavailableError();
  const yaml = match[1] ?? "";
  const body = match[2] ?? "";
  if (body.length > MAX_NOTE_BODY) {
    throw new WorkspaceNoteUnavailableError();
  }
  const id = requiredYamlScalar(yaml, "id");
  const title = requiredYamlScalar(yaml, "title");
  const created = requiredYamlScalar(yaml, "created");
  const updated = requiredYamlScalar(yaml, "updated");
  const owner = requiredYamlScalar(yaml, "owner");
  const tagsLine = yaml.match(/^tags:\s*(.*)$/gm) ?? [];
  if (tagsLine.length !== 1 || !/^\s*\[[^\]]*\]\s*$/.test(
    tagsLine[0].replace(/^tags:\s*/, ""),
  )) {
    throw new WorkspaceNoteUnavailableError();
  }
  assertSafePathSegment(id, "workspace note stable ID");
  if (id.length > WORKSPACE_NOTE_MAX_STABLE_ID
    || !title
    || title.length > MAX_NOTE_TITLE
    || /[\r\n\u0000]/.test(title)
    || !owner
    || owner.length > 1_000) {
    throw new WorkspaceNoteUnavailableError();
  }
  if (!validTimestamp(created) || !validTimestamp(updated)) {
    throw new WorkspaceNoteUnavailableError();
  }
  const tags = tagsLine[0].replace(/^tags:\s*\[/, "").replace(/\]\s*$/, "")
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (tags.some((tag) => tag.length > 200)) {
    throw new WorkspaceNoteUnavailableError();
  }
  const statusValue = optionalYamlScalar(yaml, "status");
  if (statusValue !== undefined
    && statusValue !== "draft"
    && statusValue !== "ready") {
    throw new WorkspaceNoteUnavailableError();
  }
  const pinnedValue = optionalYamlScalar(yaml, "pinned");
  if (pinnedValue !== undefined && pinnedValue !== "true") {
    throw new WorkspaceNoteUnavailableError();
  }
  return {
    frontmatter: {
      id,
      title,
      tags,
      created,
      updated,
      owner,
      status: statusValue as "draft" | "ready" | undefined,
      pinned: pinnedValue === "true" || undefined,
      pinnedAt: optionalYamlScalar(yaml, "pinnedAt"),
      pinnedBy: optionalYamlScalar(yaml, "pinnedBy"),
    },
    body,
  };
}

function requiredYamlScalar(yaml: string, key: string): string {
  const values = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "gm")) ?? [];
  if (values.length !== 1) throw new WorkspaceNoteUnavailableError();
  const value = values[0].replace(new RegExp(`^${key}:\\s*`), "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!value) throw new WorkspaceNoteUnavailableError();
  return value;
}

function optionalYamlScalar(yaml: string, key: string): string | undefined {
  const values = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "gm")) ?? [];
  if (values.length > 1) throw new WorkspaceNoteUnavailableError();
  if (values.length === 0) return undefined;
  return values[0]!.replace(new RegExp(`^${key}:\\s*`), "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function scanMarkdown(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("_") && entry.name !== "_inbox") continue;
      if (entry.name.endsWith(".assets") || entry.name.endsWith(".versions")) {
        continue;
      }
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(child);
    }
  };
  try {
    visit(root);
  } catch {
    throw new WorkspaceNoteUnavailableError();
  }
  return result;
}

function validateActor(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000) {
    throw new WorkspaceNoteUnavailableError();
  }
  try {
    return assertSafePathSegment(value, "actor ID");
  } catch {
    throw new WorkspaceNoteUnavailableError();
  }
}

function validateStableId(value: string): string {
  if (typeof value !== "string" || value.length > WORKSPACE_NOTE_MAX_STABLE_ID) {
    throw new WorkspaceNoteUnavailableError();
  }
  try {
    return assertSafePathSegment(value, "workspace note stable ID");
  } catch {
    throw new WorkspaceNoteUnavailableError();
  }
}

function validateExpectedHash(value: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32,128}$/i.test(value)) {
    throw new WorkspaceNoteInvalidInputError("expectedHash is required.");
  }
  return value;
}

function validateNotePath(value: string): string {
  const bounded = boundedText(value, MAX_NOTE_PATH, "path");
  const normalized = normalizeNotePath(bounded);
  if (!normalized.endsWith(".md")) {
    throw new WorkspaceNoteInvalidInputError("path must end with .md.");
  }
  try {
    resolveContainedRelativePath(
      "/workspace-codascope-note-root",
      normalized,
      "workspace note path",
    );
  } catch {
    throw new WorkspaceNoteInvalidInputError("path must be a contained relative note path.");
  }
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";
  if (filename.startsWith("_")
    || filename.startsWith(".")
    || segments.slice(0, -1).some((segment) =>
      segment.startsWith(".")
      || (segment.startsWith("_") && segment !== "_inbox"))) {
    throw new WorkspaceNoteInvalidInputError("path uses a reserved note filename.");
  }
  return normalized;
}

function normalizeNotePath(value: string): string {
  return value.split("\\").join("/");
}

function validateStoredNotePath(value: string): string {
  try {
    const normalized = normalizeNotePath(value);
    const validated = validateNotePath(value);
    if (validated !== normalized) throw new Error("noncanonical note path");
    return validated;
  } catch {
    throw new WorkspaceNoteUnavailableError();
  }
}

function validateTitle(value: string): string {
  const title = boundedText(value, MAX_NOTE_TITLE, "title");
  if (/[\r\n\u0000]/.test(title)) {
    throw new WorkspaceNoteInvalidInputError("title is invalid.");
  }
  return title;
}

function validateBody(value: string): string {
  if (typeof value !== "string" || value.length > MAX_NOTE_BODY) {
    throw new WorkspaceNoteInvalidInputError("body is invalid.");
  }
  return value;
}

function boundedText(
  value: string,
  maximum: number,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new WorkspaceNoteInvalidInputError(`${field} is invalid.`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) {
    throw new WorkspaceNoteInvalidInputError(`${field} is required.`);
  }
  return trimmed;
}

function extractRawIdentities(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n---|$)/);
  if (!match) return [];
  const values = (match[1] ?? "").match(/^id:\s*(.+)$/gm) ?? [];
  return values.map((value) =>
    value.replace(/^id:\s*/, "").trim().replace(/^["']|["']$/g, ""));
}

function safeReadFrontmatter(filePath: string): string | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "r");
    const buffer = Buffer.alloc(MAX_FRONTMATTER_SCAN_BYTES);
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      MAX_FRONTMATTER_SCAN_BYTES,
      0,
    );
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Candidate remains unavailable; no absolute path reaches callers.
      }
    }
  }
}

function isBoundedStoredNote(filePath: string): boolean {
  try {
    return statSync(filePath).size <= MAX_STORED_NOTE_BYTES;
  } catch {
    return false;
  }
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function extractExplicitTitleReferences(message: string): Set<string> {
  const titles = new Set<string>();
  const add = (value: string | undefined): void => {
    const normalized = normalizeExplicitTitle(value ?? "");
    if (normalized) titles.add(normalized);
  };
  for (const match of message.matchAll(
    /`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'/g,
  )) {
    add(match[1] ?? match[2] ?? match[3]);
  }
  for (const match of message.matchAll(
    /\bnote\s+(?:named|titled)\s+([^,;.!?\r\n]+)(?=[,;.!?\r\n]|$)/gi,
  )) {
    add((match[1] ?? "").replace(/^[`"']|[`"']$/g, "").trim());
  }
  return titles;
}

function normalizeExplicitTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function exactTokenMentioned(message: string, reference: string): boolean {
  if (!reference) return false;
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const delimiter = "[\\s\"'`()\\[\\]{},:;.!?]";
  return new RegExp(
    `(?:^|${delimiter})${escaped}(?=$|${delimiter})`,
    "i",
  ).test(message);
}

function isConflict(
  value: object,
): value is NoteConflictResult {
  return "conflict" in value;
}
