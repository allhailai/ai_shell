/* ── CodaScope: Directive Service ────────────────────────────────────
   Manages insertion directives for epic documents. Directives are
   instructions to insert, replace, or expand content at specific
   locations in a document.

   Extracted from CodaScopeAnnotationService to follow single-responsibility
   principle. The annotation service retains annotation CRUD + block tracking.

   Responsibilities:
   - Directive CRUD (create, list, update, delete)
   - Apply/undo/reject directive content to documents
   - Batch execution with atomic rollback

   Storage layout:
   <epicId>/directives/<documentId>-directives.json
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  InsertionDirective,
  DirectiveType,
  DirectiveStatus,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

/* ── Storage schema ─────────────────────────────────────────────── */

interface DirectivesFile {
  directives: InsertionDirective[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeDirectiveService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ──────────────────────────────────────────────── */

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
        } catch { /* skip corrupted */ }
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

  /* ── File I/O helpers ──────────────────────────────────────────── */

  private readDirectives(projectDir: string, epicId: string, documentId: string): DirectivesFile {
    const p = this.directivesPath(projectDir, epicId, documentId);
    if (!existsSync(p)) return { directives: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { directives: [] };
    }
  }

  private writeDirectives(projectDir: string, epicId: string, documentId: string, data: DirectivesFile): void {
    const dir = this.directivesDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.directivesPath(projectDir, epicId, documentId), JSON.stringify(data, null, 2), "utf-8");
  }

  /* ── Directive CRUD ────────────────────────────────────────────── */

  /** List all directives for a document. */
  async listDirectives(
    projectId: string,
    epicId: string,
    documentId: string,
  ): Promise<InsertionDirective[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readDirectives(projectDir, epicId, documentId).directives;
  }

  /** Create a new directive. */
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

    const id = `dir_${crypto.randomBytes(6).toString("hex")}`;
    const directive: InsertionDirective = {
      id,
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

    const file = this.readDirectives(projectDir, epicId, documentId);
    file.directives.push(directive);
    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /** Update a directive (status, generatedContent, etc). */
  async updateDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
    changes: Partial<InsertionDirective>,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const idx = file.directives.findIndex((d) => d.id === directiveId);
    if (idx < 0) return null;

    const directive = file.directives[idx];
    Object.assign(directive, changes);
    file.directives[idx] = directive;
    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /** Delete a directive. */
  async deleteDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
  ): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const before = file.directives.length;
    file.directives = file.directives.filter((d) => d.id !== directiveId);
    if (file.directives.length === before) return false;

    this.writeDirectives(projectDir, epicId, documentId, file);
    return true;
  }

  /* ── Directive Application ─────────────────────────────────────── */

  /**
   * Apply a directive's generated content to the document.
   * Stores a pre-apply snapshot for undo support.
   * Returns the updated document content.
   */
  async applyDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    getDocContent: () => Promise<string>,
    setDocContent: (content: string) => Promise<void>,
  ): Promise<{ directive: InsertionDirective; newContent: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive || !directive.generatedContent) return null;

    const currentContent = await getDocContent();
    const lines = currentContent.split("\n");
    const generated = directive.generatedContent;

    let newContent: string;

    if (directive.type === "insert") {
      // Insert after the specified line
      const insertAt = Math.min(directive.afterLine, lines.length);
      lines.splice(insertAt, 0, generated);
      newContent = lines.join("\n");
    } else if (directive.type === "replace" && directive.startLine !== undefined && directive.endLine !== undefined) {
      // Replace the line range
      const start = Math.max(0, directive.startLine - 1); // 1-indexed → 0-indexed
      const end = Math.min(lines.length, directive.endLine);
      lines.splice(start, end - start, generated);
      newContent = lines.join("\n");
    } else if (directive.type === "expand" && directive.startLine !== undefined && directive.endLine !== undefined) {
      // Expand: replace the range with expanded content
      const start = Math.max(0, directive.startLine - 1);
      const end = Math.min(lines.length, directive.endLine);
      lines.splice(start, end - start, generated);
      newContent = lines.join("\n");
    } else {
      return null;
    }

    // Store snapshot and update
    directive.preApplySnapshot = currentContent;
    directive.status = "applied";
    directive.appliedAt = new Date().toISOString();

    // Adjust other directives' line numbers for the shift
    const generatedLineCount = generated.split("\n").length;
    let shift: number;
    if (directive.type === "insert") {
      shift = generatedLineCount;
    } else {
      const originalLineCount = (directive.endLine ?? directive.afterLine) - (directive.startLine ?? directive.afterLine) + 1;
      shift = generatedLineCount - originalLineCount;
    }

    if (shift !== 0) {
      const affectAfterLine = directive.type === "insert" ? directive.afterLine : (directive.startLine ?? directive.afterLine);
      for (const other of file.directives) {
        if (other.id === directiveId) continue;
        if (other.status === "applied") continue; // don't adjust already-applied
        if (other.afterLine > affectAfterLine) other.afterLine += shift;
        if (other.startLine !== undefined && other.startLine > affectAfterLine) other.startLine += shift;
        if (other.endLine !== undefined && other.endLine > affectAfterLine) other.endLine += shift;
      }
    }

    this.writeDirectives(projectDir, epicId, documentId, file);
    await setDocContent(newContent);

    return { directive, newContent };
  }

  /**
   * Undo an applied directive by restoring from pre-apply snapshot.
   */
  async undoDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    setDocContent: (content: string) => Promise<void>,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive || directive.status !== "applied" || !directive.preApplySnapshot) return null;

    // Restore the document
    await setDocContent(directive.preApplySnapshot);

    // Reset directive state
    directive.status = "pending";
    directive.preApplySnapshot = undefined;
    directive.appliedAt = undefined;
    // Keep generatedContent so user can re-apply if desired

    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /**
   * Reject a directive — clear generated content, reset to pending.
   */
  async rejectDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive) return null;

    directive.status = "pending";
    directive.generatedContent = undefined;

    this.writeDirectives(projectDir, epicId, documentId, file);
    return directive;
  }

  /**
   * Execute all pending directives with generated content top-to-bottom.
   * Adjusts line numbers as each directive shifts the document.
   * Atomic: either all succeed or all roll back.
   */
  async executeBatchDirectives(
    projectId: string,
    epicId: string,
    documentId: string,
    getDocContent: () => Promise<string>,
    setDocContent: (content: string) => Promise<void>,
  ): Promise<{
    applied: InsertionDirective[];
    newContent: string;
  } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);

    // Filter to pending directives that have generated content, sorted by line position (top-to-bottom)
    const pendingWithContent = file.directives
      .filter((d) => d.status === "pending" && d.generatedContent)
      .sort((a, b) => a.afterLine - b.afterLine);

    if (pendingWithContent.length === 0) return { applied: [], newContent: await getDocContent() };

    // Save the original document for atomic rollback
    const originalContent = await getDocContent();
    let currentContent = originalContent;
    const applied: InsertionDirective[] = [];
    let cumulativeShift = 0;

    try {
      for (const directive of pendingWithContent) {
        const lines = currentContent.split("\n");
        const generated = directive.generatedContent!;
        const generatedLineCount = generated.split("\n").length;

        let newContent: string;
        let shift: number;

        if (directive.type === "insert") {
          const insertAt = Math.min(directive.afterLine + cumulativeShift, lines.length);
          lines.splice(insertAt, 0, generated);
          newContent = lines.join("\n");
          shift = generatedLineCount;
        } else if ((directive.type === "replace" || directive.type === "expand") && directive.startLine !== undefined && directive.endLine !== undefined) {
          const start = Math.max(0, directive.startLine - 1 + cumulativeShift);
          const end = Math.min(lines.length, directive.endLine + cumulativeShift);
          const originalLineCount = end - start;
          lines.splice(start, originalLineCount, generated);
          newContent = lines.join("\n");
          shift = generatedLineCount - originalLineCount;
        } else {
          continue; // Skip malformed directives
        }

        // Store snapshot and mark as applied
        directive.preApplySnapshot = originalContent; // All point to original for clean rollback
        directive.status = "applied";
        directive.appliedAt = new Date().toISOString();

        currentContent = newContent;
        cumulativeShift += shift;
        applied.push(directive);
      }

      // All succeeded — persist everything
      this.writeDirectives(projectDir, epicId, documentId, file);
      await setDocContent(currentContent);

      return { applied, newContent: currentContent };
    } catch (err) {
      // Rollback: restore original content and reset all directive statuses
      await setDocContent(originalContent);
      for (const directive of applied) {
        directive.status = "pending";
        directive.preApplySnapshot = undefined;
        directive.appliedAt = undefined;
      }
      this.writeDirectives(projectDir, epicId, documentId, file);
      throw err;
    }
  }
}
