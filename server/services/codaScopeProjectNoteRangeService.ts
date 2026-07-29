import type {
  NoteResolveOpts,
  NoteReadResult,
  CodaScopeNoteService,
} from "./codaScopeNoteService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import type { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import type { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import {
  replaceExactNoteRange,
} from "./codaScopeNoteAnnotationAnchorService.js";
import {
  isCanonicalNotePath,
} from "../../src/apps/codascope/workspaceMutationActionValidation.js";
import {
  normalizeCanonicalProjectNoteRangeTarget,
  PROJECT_NOTE_RANGE_MAX_BODY,
  type CanonicalProjectNoteRangeTarget,
} from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";

export interface ProjectNoteRangeCurrentContext {
  view: string;
  projectId?: string;
  epicId?: string | null;
  noteScope?: string | null;
  noteVisibility?: string | null;
  notePath?: string | null;
}

export interface ProjectNoteRangeMutationResult {
  stableId: string;
  scope: "project" | "epic";
  visibility: "private" | "shared";
  projectId: string;
  epicId?: string;
  path: string;
  title: string;
  contentHash: string;
}

export class ProjectNoteRangeInvalidError extends Error {
  readonly code = "invalid_input";
  readonly status = 400;

  constructor(message = "The selected project note range is invalid or stale.") {
    super(message);
    this.name = "ProjectNoteRangeInvalidError";
  }
}

export class ProjectNoteRangeConflictError extends Error {
  readonly code = "conflict";
  readonly status = 409;
  readonly currentHash: string;

  constructor(currentHash: string) {
    super("The selected project note changed before the replacement was applied.");
    this.name = "ProjectNoteRangeConflictError";
    this.currentHash = currentHash;
  }
}

export class ProjectNoteRangeUnavailableError extends Error {
  readonly code = "not_found";
  readonly status = 404;

  constructor() {
    super("The selected project note is unavailable.");
    this.name = "ProjectNoteRangeUnavailableError";
  }
}

interface VerifiedTarget {
  target: CanonicalProjectNoteRangeTarget;
  note: NoteReadResult;
  body: string;
  opts: NoteResolveOpts;
}

/**
 * Root-composed authority and mutation boundary for project-assistant exact
 * range edits. It deliberately does not serve workspace/root CodaScope notes.
 */
export class CodaScopeProjectNoteRangeService {
  constructor(
    private readonly projectSvc: CodaScopeProjectService,
    private readonly epicSvc: CodaScopeEpicService,
    private readonly noteSvc: CodaScopeNoteService,
    private readonly annotationSvc: CodaScopeNoteAnnotationService,
    private readonly linkIndexSvc: CodaScopeNoteLinkIndexService,
    private readonly auditSvc: CodaScopeNoteAuditService,
  ) {}

  async canonicalizeTarget(options: {
    actorId: string;
    routeProjectId: string;
    currentContext?: ProjectNoteRangeCurrentContext | null;
    target: unknown;
  }): Promise<CanonicalProjectNoteRangeTarget> {
    const actorId = requireNonempty(options.actorId);
    const routeProjectId = requireNonempty(options.routeProjectId);
    const target = normalizeCanonicalProjectNoteRangeTarget(options.target);
    const context = options.currentContext;
    if (!target
      || !context
      || context.view !== "notes"
      || context.projectId !== routeProjectId
      || target.projectId !== routeProjectId
      || (context.noteScope !== "project" && context.noteScope !== "epic")
      || context.noteScope !== target.scope
      || context.noteVisibility !== target.visibility
      || canonicalRouteNotePath(context.notePath) !== target.path) {
      throw new ProjectNoteRangeInvalidError();
    }
    if (target.scope === "epic") {
      if (context.epicId !== target.epicId) {
        throw new ProjectNoteRangeInvalidError();
      }
    } else if (context.epicId !== undefined && context.epicId !== null) {
      throw new ProjectNoteRangeInvalidError();
    }

    const verified = await this.resolveVerified(actorId, target);
    return verified.target;
  }

  /** Re-resolve and verify one server-owned target immediately before use. */
  async revalidateTarget(
    actorId: string,
    value: unknown,
  ): Promise<CanonicalProjectNoteRangeTarget> {
    const target = normalizeCanonicalProjectNoteRangeTarget(value);
    if (!target) throw new ProjectNoteRangeInvalidError();
    return (await this.resolveVerified(requireNonempty(actorId), target)).target;
  }

  async replaceExactRange(
    actorId: string,
    value: unknown,
    replacementMarkdown: string,
  ): Promise<ProjectNoteRangeMutationResult> {
    if (typeof replacementMarkdown !== "string"
      || replacementMarkdown.length > PROJECT_NOTE_RANGE_MAX_BODY) {
      throw new ProjectNoteRangeInvalidError("replacementMarkdown is invalid.");
    }
    const target = normalizeCanonicalProjectNoteRangeTarget(value);
    if (!target) throw new ProjectNoteRangeInvalidError();
    const actor = requireNonempty(actorId);
    const verified = await this.resolveVerified(actor, target);

    let nextBody: string;
    try {
      nextBody = replaceExactNoteRange(verified.body, {
        from: target.selectionStart,
        to: target.selectionEnd,
        selectedText: target.selectedText,
        replacementMarkdown,
      });
    } catch (error) {
      throw new ProjectNoteRangeInvalidError(
        error instanceof Error ? error.message : undefined,
      );
    }
    if (nextBody.length > PROJECT_NOTE_RANGE_MAX_BODY) {
      throw new ProjectNoteRangeInvalidError("The resulting note body is too large.");
    }

    const stored = this.noteSvc.serializeFrontmatter(
      verified.note.frontmatter,
    ) + nextBody;
    const result = await this.noteSvc.updateNote(
      target.scope,
      target.visibility,
      verified.opts,
      target.path,
      stored,
      target.expectedHash,
    );
    if (!result) throw new ProjectNoteRangeUnavailableError();
    if ("conflict" in result) {
      throw new ProjectNoteRangeConflictError(result.currentHash);
    }

    await this.annotationSvc.reconcileAfterNoteWrite(
      target.scope,
      target.visibility,
      verified.opts,
      target.path,
    );
    const saved = await this.noteSvc.readNote(
      target.scope,
      target.visibility,
      verified.opts,
      target.path,
    );
    if (!saved
      || saved.frontmatter.id !== target.stableId
      || saved.frontmatter.title !== target.title
      || this.noteSvc.parseFrontmatter(saved.content).body !== nextBody) {
      throw new ProjectNoteRangeUnavailableError();
    }

    this.linkIndexSvc.updateLinksForNote(
      target.scope,
      target.visibility,
      verified.opts,
      target.stableId,
      nextBody,
    );
    this.auditSvc.log({
      event: "note.updated",
      timestamp: new Date().toISOString(),
      actor,
      noteId: target.stableId,
      scope: target.scope,
      visibility: target.visibility,
      path: target.path,
    });

    return {
      stableId: target.stableId,
      scope: target.scope,
      visibility: target.visibility,
      projectId: target.projectId,
      ...(target.scope === "epic" ? { epicId: target.epicId } : {}),
      path: target.path,
      title: target.title,
      contentHash: saved.contentHash,
    };
  }

  private async resolveVerified(
    actorId: string,
    target: CanonicalProjectNoteRangeTarget,
  ): Promise<VerifiedTarget> {
    const project = await this.projectSvc.getProject(target.projectId);
    if (!project || project.id !== target.projectId) {
      throw new ProjectNoteRangeInvalidError();
    }
    if (target.scope === "epic") {
      const epic = await this.epicSvc.getEpic(target.projectId, target.epicId);
      if (!epic || epic.id !== target.epicId) {
        throw new ProjectNoteRangeInvalidError();
      }
    }

    const opts: NoteResolveOpts = {
      userId: actorId,
      projectId: target.projectId,
      ...(target.scope === "epic" ? { epicId: target.epicId } : {}),
    };
    const note = await this.noteSvc.readNote(
      target.scope,
      target.visibility,
      opts,
      target.path,
    );
    if (!note) throw new ProjectNoteRangeInvalidError();
    const { body } = this.noteSvc.parseFrontmatter(note.content);
    if (body.length > PROJECT_NOTE_RANGE_MAX_BODY
      || note.frontmatter.id !== target.stableId
      || note.frontmatter.title !== target.title
      || note.contentHash !== target.expectedHash
      || target.selectionEnd > body.length
      || !isUnicodeCodePointBoundary(body, target.selectionStart)
      || !isUnicodeCodePointBoundary(body, target.selectionEnd)
      || body.slice(target.selectionStart, target.selectionEnd)
        !== target.selectedText
      || lineAtOffset(body, target.selectionStart) !== target.startLine
      || lineAtOffset(body, target.selectionEnd) !== target.endLine) {
      throw new ProjectNoteRangeInvalidError();
    }

    return {
      target: Object.freeze({
        kind: "note-range",
        stableId: note.frontmatter.id,
        scope: target.scope,
        visibility: target.visibility,
        projectId: project.id,
        ...(target.scope === "epic" ? { epicId: target.epicId } : {}),
        path: target.path,
        title: note.frontmatter.title,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        selectedText: target.selectedText,
        startLine: target.startLine,
        endLine: target.endLine,
        expectedHash: note.contentHash,
      }) as CanonicalProjectNoteRangeTarget,
      note,
      body,
      opts,
    };
  }
}

export function canonicalRouteNotePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const canonical = value.endsWith(".md") ? value : `${value}.md`;
  return isCanonicalNotePath(canonical) ? canonical : null;
}

function requireNonempty(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectNoteRangeInvalidError();
  }
  return value.trim();
}

function lineAtOffset(body: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (body.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function isUnicodeCodePointBoundary(body: string, offset: number): boolean {
  if (offset <= 0 || offset >= body.length) return true;
  const preceding = body.charCodeAt(offset - 1);
  const following = body.charCodeAt(offset);
  return !(preceding >= 0xD800
    && preceding <= 0xDBFF
    && following >= 0xDC00
    && following <= 0xDFFF);
}
