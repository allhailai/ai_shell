/* ── CodaScope: Note Routes ──────────────────────────────────────────
   REST endpoints for note CRUD, folder management, image upload,
   search, move, annotations, blocks, and versions.

   URL pattern: /api/codascope/notes/:scope/:visibility/...
   Security: userId is derived from the authenticated request principal.
   ──────────────────────────────────────────────────────────────────── */


import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import type { AnnotationStatus, NoteScope, NoteVisibility, NoteEntry, NoteArchiveMeta, StarredNoteRef } from "../../src/apps/codascope/codaScopeTypes.js";
import type { NoteResolveOpts } from "../services/codaScopeNoteService.js";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { parseInlineAnnotationAnchors } from "../services/codaScopeNoteAnnotationAnchorService.js";
import { archiveUpload, removeUploadedArchive } from "./codaScopeArchiveUpload.js";
import { isPathValidationError } from "../services/codaScopePathSafety.js";

const VALID_SCOPES: NoteScope[] = ["codascope", "project", "epic"];
const VALID_VISIBILITIES: NoteVisibility[] = ["shared", "private"];
const VALID_ANNOTATION_STATUSES: AnnotationStatus[] = ["open", "resolved", "wontfix"];
const MAX_AUDIT_RESULTS = 1_000;
const DOCUMENT_UPLOAD_DIR = path.join(os.tmpdir(), "codascope-note-document-uploads");
/** Disk-backed multer storage: streams and hashes uploads without heap buffering. */
const controlledDocumentStorage: multer.StorageEngine = {
  _handleFile: (_req, file, callback) => {
    try {
      if (!existsSync(DOCUMENT_UPLOAD_DIR)) mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });
      const filename = `${randomUUID()}.upload`;
      const destination = path.join(DOCUMENT_UPLOAD_DIR, filename);
      const output = createWriteStream(destination, { flags: "wx" });
      const hash = createHash("sha256");
      let size = 0;
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        try { unlinkSync(destination); } catch { /* best effort cleanup */ }
        callback(error);
      };
      file.stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        hash.update(chunk);
      });
      file.stream.on("error", fail);
      output.on("error", fail);
      output.on("finish", () => {
        if (finished) return;
        finished = true;
        // Hashing happens during the stream; publication re-hashes the staged
        // file as an integrity check before it enters the note bundle.
        hash.digest("hex");
        callback(null, { destination: DOCUMENT_UPLOAD_DIR, filename, path: destination, size });
      });
      file.stream.pipe(output);
    } catch (error) {
      callback(error as Error);
    }
  },
  _removeFile: (_req, file, callback) => {
    try { if (file.path) unlinkSync(file.path); } catch { /* already removed */ }
    callback(null);
  },
};
const documentUpload = multer({
  storage: controlledDocumentStorage,
  // The service repeats this check before publication. Multer's limit keeps
  // over-limit streams off the application heap and out of the note bundle.
  limits: { fileSize: 100 * 1024 * 1024 },
});

function removeDocumentUpload(file: Express.Multer.File | undefined): void {
  if (!file?.path) return;
  try { unlinkSync(file.path); } catch { /* finalizer already consumed it */ }
}

export function registerNoteRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, principal, secretService, upload } = ctx;

  /**
   * Validate :scope and :visibility params and extract resolve opts.
   * SECURITY: userId is derived from the authenticated principal, never from
   * request headers, query parameters, or a request body.
   */
  function parseScopeAndOpts(
    scopeParam: string,
    visibilityParam: string,
    query: Record<string, unknown>,
    req: Parameters<typeof principal>[0],
  ): { scope: NoteScope; visibility: NoteVisibility; opts: NoteResolveOpts } {
    if (!VALID_SCOPES.includes(scopeParam as NoteScope)) {
      throw httpError(`Invalid scope: "${scopeParam}". Must be one of: ${VALID_SCOPES.join(", ")}`, 400, "invalid_scope");
    }
    if (!VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
      throw httpError(`Invalid visibility: "${visibilityParam}". Must be one of: ${VALID_VISIBILITIES.join(", ")}`, 400, "invalid_visibility");
    }
    if (scopeParam === "epic" && visibilityParam === "private") {
      throw httpError("Epic notes are shared with the team.", 400, "invalid_visibility");
    }

    const userId = principal(req).username;

    return {
      scope: scopeParam as NoteScope,
      visibility: visibilityParam as NoteVisibility,
      opts: {
        userId,
        projectId: (query.projectId as string) ?? undefined,
        epicId: (query.epicId as string) ?? undefined,
      },
    };
  }

  /** Extract the wildcard path from req.params (Express 5 `*path` or `0`). */
  function extractPath(req: { params: Record<string, string | string[]> }): string {
    // Express 5 named wildcard: req.params.path
    // Express 4 unnamed: req.params[0]
    const raw = req.params.path ?? req.params[0] ?? "";
    return Array.isArray(raw) ? raw.join("/") : raw;
  }

  /** Strip a known suffix from the wildcard path. */
  function stripSuffix(rawPath: string, suffix: string): string {
    if (rawPath.endsWith(suffix)) {
      return rawPath.slice(0, -suffix.length);
    }
    return rawPath;
  }

  /** Custom highlight colors are optional CodaScope configuration, not a required secret. */
  app.get("/api/codascope/settings/highlight-colors", wrap(async (_req, res) => {
    const value = await secretService.getAppSecret("codascope", "highlight_colors");
    if (!value) {
      res.json({ colors: [] });
      return;
    }

    try {
      const parsed: unknown = JSON.parse(value);
      const colors = Array.isArray(parsed)
        ? parsed.flatMap((color) => (
          color && typeof color === "object"
          && typeof (color as Record<string, unknown>).name === "string"
          && typeof (color as Record<string, unknown>).label === "string"
          && typeof (color as Record<string, unknown>).cssColor === "string"
            ? [{
              name: (color as Record<string, string>).name,
              label: (color as Record<string, string>).label,
              cssColor: (color as Record<string, string>).cssColor,
            }]
            : []
        ))
        : [];
      res.json({ colors });
    } catch {
      res.json({ colors: [] });
    }
  }));



  // ── Export / Import ────────────────────────────────────────────────
  // Placed BEFORE :scope/:visibility so these fixed paths don't collide.

  /** POST /api/codascope/notes/export — start export */
  app.post("/api/codascope/notes/export", wrap(async (req, res) => {
    const { noteExportSvc, noteAuditSvc } = await ensureServices();
    const userId = principal(req).username;

    const {
      scope: scopeParam,
      visibility: visibilityParam,
      projectId,
      epicId,
      notePaths,
      includeVersions,
    } = req.body as {
      scope?: string;
      visibility?: string;
      projectId?: string;
      epicId?: string;
      notePaths?: string[];
      includeVersions?: boolean;
    };

    if (!scopeParam || !VALID_SCOPES.includes(scopeParam as NoteScope)) {
      throw httpError("Valid scope is required.", 400, "invalid_input");
    }
    if (!visibilityParam || !VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
      throw httpError("Valid visibility is required.", 400, "invalid_input");
    }

    const opts: NoteResolveOpts = { userId, projectId, epicId };
    const exportId = await noteExportSvc.generateExport(
      scopeParam as NoteScope,
      visibilityParam as NoteVisibility,
      opts,
      { notePaths, includeVersions },
    );

    res.json({ exportId });
  }));

  /** GET /api/codascope/notes/export/:id — download ZIP */
  app.get("/api/codascope/notes/export/:id", wrap(async (req, res) => {
    const { noteExportSvc } = await ensureServices();
    const exportId = param(req, "id");

    const zipPath = noteExportSvc.getExportFile(exportId, principal(req).username);
    if (!zipPath) {
      throw httpError("Export not found or expired.", 404, "not_found");
    }

    res.download(zipPath, `codascope-notes-export.zip`);
  }));

  /** POST /api/codascope/notes/import/preview — upload ZIP, get preview */
  app.post("/api/codascope/notes/import/preview", archiveUpload.single("file"), wrap(async (req, res) => {
    const { noteImportSvc } = await ensureServices();
    const userId = principal(req).username;

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      throw httpError("ZIP file is required.", 400, "invalid_input");
    }

    try {
      const {
        scope: scopeParam,
        visibility: visibilityParam,
        projectId,
        epicId,
      } = req.body as {
        scope?: string;
        visibility?: string;
        projectId?: string;
        epicId?: string;
      };

      if (!scopeParam || !VALID_SCOPES.includes(scopeParam as NoteScope)) {
        throw httpError("Valid scope is required.", 400, "invalid_input");
      }
      if (!visibilityParam || !VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
        throw httpError("Valid visibility is required.", 400, "invalid_input");
      }

      const opts: NoteResolveOpts = { userId, projectId, epicId };
      const preview = await noteImportSvc.previewImportFile(
        file.path,
        scopeParam as NoteScope,
        visibilityParam as NoteVisibility,
        opts,
      );

      res.json(preview);
    } finally {
      await removeUploadedArchive(file);
    }
  }));

  /** POST /api/codascope/notes/import/execute — execute import */
  app.post("/api/codascope/notes/import/execute", archiveUpload.single("file"), wrap(async (req, res) => {
    const { noteImportSvc } = await ensureServices();
    const userId = principal(req).username;

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      throw httpError("ZIP file is required.", 400, "invalid_input");
    }

    try {
      const {
        scope: scopeParam,
        visibility: visibilityParam,
        projectId,
        epicId,
        collisionStrategy,
      } = req.body as {
        scope?: string;
        visibility?: string;
        projectId?: string;
        epicId?: string;
        collisionStrategy?: string;
      };

      if (!scopeParam || !VALID_SCOPES.includes(scopeParam as NoteScope)) {
        throw httpError("Valid scope is required.", 400, "invalid_input");
      }
      if (!visibilityParam || !VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
        throw httpError("Valid visibility is required.", 400, "invalid_input");
      }

      const validStrategies = ["skip", "rename", "import-as-copy"];
      const strategy = validStrategies.includes(collisionStrategy ?? "")
        ? (collisionStrategy as "skip" | "rename" | "import-as-copy")
        : "skip";

      const opts: NoteResolveOpts = { userId, projectId, epicId };
      const report = await noteImportSvc.executeImportFile(
        file.path,
        scopeParam as NoteScope,
        visibilityParam as NoteVisibility,
        opts,
        strategy,
      );

      res.json(report);
    } finally {
      await removeUploadedArchive(file);
    }
  }));

  // ── Search ──────────────────────────────────────────────────────────
  // Placed BEFORE :scope/:visibility so /api/codascope/notes/search doesn't collide

  app.get("/api/codascope/notes/search", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const q = req.query.q as string;
    if (!q || typeof q !== "string" || !q.trim()) {
      throw httpError("q (search query) is required.", 400, "invalid_input");
    }

    // Scope from query param (defaults to codascope)
    const scopeParam = (req.query.scope as string) ?? "codascope";
    if (!VALID_SCOPES.includes(scopeParam as NoteScope)) {
      throw httpError(`Invalid scope: "${scopeParam}"`, 400, "invalid_scope");
    }

    const userId = principal(req).username;

    const opts: NoteResolveOpts = {
      userId,
      projectId: (req.query.projectId as string) ?? undefined,
      epicId: (req.query.epicId as string) ?? undefined,
    };

    const results = await noteSvc.searchNotes(q.trim(), scopeParam as NoteScope, opts);
    res.json({ results });
  }));

  // ── Backlinks ───────────────────────────────────────────────────────
  // Placed BEFORE :scope/:visibility so /api/codascope/notes/backlinks/:noteId doesn't collide

  app.get("/api/codascope/notes/backlinks/:noteId", wrap(async (req, res) => {
    const { noteLinkIndexSvc } = await ensureServices();
    const noteId = param(req, "noteId");

    const scopeParam = (req.query.scope as string) ?? "codascope";
    if (!VALID_SCOPES.includes(scopeParam as NoteScope)) {
      throw httpError(`Invalid scope: "${scopeParam}"`, 400, "invalid_scope");
    }
    const visibilityParam = (req.query.visibility as string) ?? "shared";
    if (!VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
      throw httpError(`Invalid visibility: "${visibilityParam}"`, 400, "invalid_visibility");
    }

    const userId = principal(req).username;
    const opts: NoteResolveOpts = {
      userId,
      projectId: (req.query.projectId as string) ?? undefined,
      epicId: (req.query.epicId as string) ?? undefined,
    };

    const backlinks = await noteLinkIndexSvc.getBacklinks(
      scopeParam as NoteScope,
      visibilityParam as NoteVisibility,
      opts,
      noteId,
    );
    res.json({ backlinks });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── STARRED / RECENTS / QUICK CAPTURE ROUTES ─────────────────────────
  // Placed BEFORE :scope/:visibility to avoid wildcard collision.
  // ══════════════════════════════════════════════════════════════════════

  // ── List Starred Notes ─────────────────────────────────────────────

  app.get("/api/codascope/notes/starred", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = principal(req).username;
    const items = noteUserPrefsSvc.getStarred(userId);
    res.json({ items });
  }));

  // ── Star a Note ────────────────────────────────────────────────────

  app.put("/api/codascope/notes/starred/:noteId", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const userId = principal(req).username;
    const noteId = param(req, "noteId");

    const { scope, visibility, path: notePath } = req.body as {
      scope?: string;
      visibility?: string;
      path?: string;
    };

    if (!scope || !visibility || !notePath || !VALID_SCOPES.includes(scope as NoteScope) || !VALID_VISIBILITIES.includes(visibility as NoteVisibility)) {
      throw httpError("A valid scope, visibility, and path are required.", 400, "invalid_input");
    }

    const opts: NoteResolveOpts = {
      userId,
      projectId: typeof req.body.projectId === "string" ? req.body.projectId : undefined,
      epicId: typeof req.body.epicId === "string" ? req.body.epicId : undefined,
    };
    const note = await noteSvc.readNote(scope as NoteScope, visibility as NoteVisibility, opts, notePath);
    if (!note || note.frontmatter.id !== noteId) throw httpError("Note not found.", 404, "not_found");

    noteUserPrefsSvc.star(userId, {
      noteId,
      scope: scope as StarredNoteRef["scope"],
      visibility: visibility as StarredNoteRef["visibility"],
      path: notePath,
      title: note.frontmatter.title,
    });

    res.json({ starred: true });
  }));

  // ── Unstar a Note ──────────────────────────────────────────────────

  app.delete("/api/codascope/notes/starred/:noteId", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = principal(req).username;
    const noteId = param(req, "noteId");

    const removed = noteUserPrefsSvc.unstar(userId, noteId);
    if (!removed) throw httpError("Note was not starred.", 404, "not_found");

    res.json({ unstarred: true });
  }));

  // ── List Recent Notes ──────────────────────────────────────────────

  app.get("/api/codascope/notes/recents", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = principal(req).username;
    const items = noteUserPrefsSvc.getRecents(userId);
    res.json({ items });
  }));

  // ── Quick Capture ──────────────────────────────────────────────────

  app.post("/api/codascope/notes/capture", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const userId = principal(req).username;

    const { body: noteBody } = req.body as { body?: string };
    if (!noteBody || typeof noteBody !== "string" || !noteBody.trim()) {
      throw httpError("body is required.", 400, "invalid_input");
    }

    // Generate timestamp-based title
    const now = new Date();
    const title = `Quick Note — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    const safeFilename = `Quick Note ${now.toISOString().replace(/[:.]/g, "-")}.md`;
    const notePath = `_inbox/${safeFilename}`;

    // Build content with frontmatter
    const noteId = randomUUID();
    const fm = [
      "---",
      `id: ${noteId}`,
      `title: ${title}`,
      `tags: ["inbox"]`,
      `created: ${now.toISOString()}`,
      `updated: ${now.toISOString()}`,
      `owner: ${userId}`,
      "---",
      "",
    ].join("\n");

    const content = fm + noteBody.trim() + "\n";

    const result = await noteSvc.createNote("codascope", "private", { userId }, notePath, content);

    // Add to recents (fire-and-forget)
    try {
      noteUserPrefsSvc.addRecent(userId, {
        noteId,
        scope: "codascope",
        visibility: "private",
        path: notePath,
        title,
      });
    } catch { /* best effort */ }

    res.status(201).json({
      path: notePath,
      noteId,
      contentHash: result.contentHash,
    });
  }));

  // ── List Notes ──────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const folder = (req.query.folder as string) ?? undefined;
    const starred = new Set(noteUserPrefsSvc.getStarred(opts.userId ?? "").map((item) => item.noteId));
    const notes: NoteEntry[] = (await noteSvc.listNotes(scope, visibility, opts, folder))
      .map((note) => ({ ...note, starred: note.noteId ? starred.has(note.noteId) || undefined : undefined }))
      .sort((left, right) => {
        if (left.isFolder || right.isFolder) return 0;
        if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
        if (Boolean(left.starred) !== Boolean(right.starred)) return left.starred ? -1 : 1;
        return (right.updated || "").localeCompare(left.updated || "");
      });
    res.json({ notes });
  }));

  // ── List Folders ────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/folders", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const folders = await noteSvc.listFolders(scope, visibility, opts);
    res.json({ folders });
  }));

  // ── Tag Index ───────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/tags", wrap(async (req, res) => {
    const { noteSvc, noteTagSuggestionSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const tags = await noteSvc.buildTagIndex(scope, visibility, opts);
    res.json({ tags: noteTagSuggestionSvc.filter(tags) });
  }));

  // ── Shared Tag Suggestion Management ────────────────────────────────

  app.delete("/api/codascope/notes/tag-suggestions/:tag", wrap(async (req, res) => {
    const { noteTagSuggestionSvc } = await ensureServices();
    const tag = param(req, "tag");
    if (!tag.trim()) throw httpError("Tag is required.", 400, "invalid_input");
    noteTagSuggestionSvc.hide(tag);
    res.json({ hidden: true, tag });
  }));

  app.post("/api/codascope/notes/tag-suggestions/:tag/restore", wrap(async (req, res) => {
    const { noteTagSuggestionSvc } = await ensureServices();
    const tag = param(req, "tag");
    if (!tag.trim()) throw httpError("Tag is required.", 400, "invalid_input");
    noteTagSuggestionSvc.restore(tag);
    res.json({ restored: true, tag });
  }));

  // ── Create Folder ───────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/folders", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const { folderPath } = req.body as { folderPath?: string };
    if (!folderPath || typeof folderPath !== "string" || !folderPath.trim()) {
      throw httpError("folderPath is required.", 400, "invalid_input");
    }
    await noteSvc.createFolder(scope, visibility, opts, folderPath.trim());
    res.status(201).json({ created: true, folderPath: folderPath.trim() });
  }));

  // Folder routes are intentionally registered before generic note paths.
  app.post("/api/codascope/notes/:scope/:visibility/folders/archive", wrap(async (req, res) => {
    const { noteAuditSvc, noteBundleSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const { folderPath, reason } = req.body as { folderPath?: string; reason?: string };
    if (!folderPath || typeof folderPath !== "string") throw httpError("folderPath is required.", 400, "invalid_input");
    const meta = await noteBundleSvc.archiveFolder(scope, visibility, opts, folderPath.trim(), reason);
    if (!meta) throw httpError("Folder not found.", 404, "not_found");
    noteAuditSvc.log({
      event: "folder.archived",
      timestamp: new Date().toISOString(),
      actor: opts.userId ?? "default",
      noteId: meta.noteId,
      scope,
      visibility,
      path: folderPath.trim(),
      metadata: reason ? { reason, kind: "folder" } : { kind: "folder" },
    });
    res.json(meta);
  }));

  app.post("/api/codascope/notes/folders/move", wrap(async (req, res) => {
    const { noteTransferSvc } = await ensureServices();
    const {
      fromScope, fromVisibility, fromFolder, fromOpts,
      toScope, toVisibility, toFolder, toOpts,
    } = req.body as {
      fromScope?: string; fromVisibility?: string; fromFolder?: string; fromOpts?: NoteResolveOpts;
      toScope?: string; toVisibility?: string; toFolder?: string; toOpts?: NoteResolveOpts;
    };
    if (!fromScope || !fromVisibility || !fromFolder || !toScope || !toVisibility || !toFolder) {
      throw httpError("Source and destination folders are required.", 400, "invalid_input");
    }
    if (!VALID_SCOPES.includes(fromScope as NoteScope) || !VALID_SCOPES.includes(toScope as NoteScope)) {
      throw httpError("Invalid scope.", 400, "invalid_scope");
    }
    if (!VALID_VISIBILITIES.includes(fromVisibility as NoteVisibility) || !VALID_VISIBILITIES.includes(toVisibility as NoteVisibility)) {
      throw httpError("Invalid visibility.", 400, "invalid_visibility");
    }
    if (toScope === "epic" && toVisibility === "private") {
      throw httpError("Epic notes are shared with the team.", 400, "invalid_visibility");
    }

    const userId = principal(req).username;
    const result = await noteTransferSvc.moveFolder({
      fromScope: fromScope as NoteScope,
      fromVisibility: fromVisibility as NoteVisibility,
      fromOpts: { ...fromOpts, userId },
      fromFolder,
      toScope: toScope as NoteScope,
      toVisibility: toVisibility as NoteVisibility,
      toOpts: { ...toOpts, userId },
      toFolder,
    });
    if (!result.moved) throw httpError("Folder not found.", 404, "not_found");
    res.json({ moved: true, noteIds: result.noteIds, correlationId: result.correlationId });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // IMPORTANT: Routes with suffixed paths (e.g. /images, /annotations,
  // /versions, /blocks) MUST be registered BEFORE the generic wildcard
  // CRUD routes (`*path`). Express matches in registration order, and
  // the generic `*path` would greedily consume the suffix.
  // ══════════════════════════════════════════════════════════════════════

  // ── Upload Image ────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/images",
    upload.single("image"),
    wrap(async (req, res) => {
      const { noteSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

      // Extract the note path — strip trailing "/images" from the wildcard
      let notePath = extractPath(req);
      notePath = stripSuffix(notePath, "/images");
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

      const file = (req as any).file;
      if (!file) throw httpError("No image file uploaded.", 400, "no_file");

      const result = await noteSvc.uploadImage(
        scope,
        visibility,
        opts,
        notePath,
        file.buffer,
        file.mimetype,
      );

      res.status(201).json(result);
    }),
  );

  // ── Serve Image ─────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/images/:filename", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const filename = param(req, "filename");

    // Extract the note path — strip trailing "/images/<filename>" from the wildcard
    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, `/images/${filename}`);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    let imgPath = noteSvc.getImagePath(scope, visibility, opts, notePath, filename);

    // Fallback: if not found in the note's own assets dir, check the
    // assetDir hint (handles renamed notes where the assets dir name
    // still matches the old note name).
    if (!imgPath && req.query.assetDir) {
      const hintDir = String(req.query.assetDir);
      // Only allow .assets suffixed directories for security
      if (hintDir.endsWith(".assets")) {
        const hintNotePath = hintDir.replace(/\.assets$/, ".md");
        imgPath = noteSvc.getImagePath(scope, visibility, opts, hintNotePath, filename);
      }
    }

    if (!imgPath) throw httpError("Image not found.", 404, "not_found");

    res.sendFile(imgPath);
  }));
  // ══════════════════════════════════════════════════════════════════════
  // ── ANNOTATION ROUTES ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── List Annotations ────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/annotations", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/annotations");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const [annotations, anchors, markerRanges] = await Promise.all([
      noteAnnotationSvc.listAnnotations(scope, visibility, opts, notePath),
      noteAnnotationSvc.getRenderTargets(scope, visibility, opts, notePath),
      noteAnnotationSvc.getMarkerRanges(scope, visibility, opts, notePath),
    ]);
    res.json({ annotations, anchors, markerRanges });
  }));

  // ── Create Annotation ──────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/annotations", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/annotations");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { selectionStart, selectionEnd, selectedText, expectedHash, body, parentId } = req.body as {
      selectionStart?: number;
      selectionEnd?: number;
      selectedText?: string;
      expectedHash?: string;
      body?: string;
      parentId?: string;
    };

    if (!body || typeof body !== "string") {
      throw httpError("body is required.", 400, "invalid_input");
    }

    if (parentId) {
      const annotation = await noteAnnotationSvc.createAnnotation(scope, visibility, opts, notePath, {
        author: principal(req).username,
        body,
        parentId,
      });
      res.status(201).json({ annotation });
      return;
    }

    if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd) || !selectedText || !expectedHash) {
      throw httpError("selected source positions, selectedText, and expectedHash are required.", 400, "invalid_input");
    }
    const outcome = await noteAnnotationSvc.createRangeAnnotation(scope, visibility, opts, notePath, {
      from: selectionStart as number,
      to: selectionEnd as number,
      selectedText,
      expectedHash,
      author: principal(req).username,
      body,
    });
    if ("conflict" in outcome) {
      res.status(409).json({
        error: "conflict",
        message: "Note was modified since you loaded it. Reload and try again.",
        currentHash: outcome.currentHash,
        currentContent: noteSvc.parseFrontmatter(outcome.currentContent).body,
      });
      return;
    }

    const correlationId = randomUUID();
    const saved = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (saved) {
      noteAuditSvc.log({
        event: "note.annotation_created",
        timestamp: new Date().toISOString(),
        actor: principal(req).username,
        noteId: saved.frontmatter.id,
        scope,
        visibility,
        path: notePath,
        correlationId,
        metadata: { annotationId: outcome.annotation.id },
      });
    }
    res.status(201).json({ ...outcome, correlationId });
  }));

  // ── Explicit Reattach (never quote-searches or picks a nearby line) ─

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/annotations/:annotationId/reattach", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const annotationId = param(req, "annotationId");
    const suffix = `/annotations/${annotationId}/reattach`;
    const notePath = stripSuffix(extractPath(req), suffix);
    const { selectionStart, selectionEnd, selectedText, expectedHash } = req.body as {
      selectionStart?: number; selectionEnd?: number; selectedText?: string; expectedHash?: string;
    };
    if (!notePath || !Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd) || !selectedText || !expectedHash) {
      throw httpError("selected source positions, selectedText, and expectedHash are required.", 400, "invalid_input");
    }
    const outcome = await noteAnnotationSvc.reattachRangeAnnotation(scope, visibility, opts, notePath, annotationId, {
      from: selectionStart as number,
      to: selectionEnd as number,
      selectedText,
      expectedHash,
    });
    if (!outcome) throw httpError("Annotation not found.", 404, "not_found");
    if ("conflict" in outcome) {
      throw httpError("Note was modified since you loaded it. Reload and try again.", 409, "conflict");
    }
    const correlationId = randomUUID();
    const saved = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (saved) {
      noteAuditSvc.log({
        event: "note.annotation_reattached",
        timestamp: new Date().toISOString(),
        actor: principal(req).username,
        noteId: saved.frontmatter.id,
        scope,
        visibility,
        path: notePath,
        correlationId,
        metadata: { annotationId },
      });
    }
    res.json({ ...outcome, correlationId });
  }));

  // ── Update Annotation (resolve/reopen/edit) ─────────────────────────

  app.patch("/api/codascope/notes/:scope/:visibility/note/*path/annotations/:annotationId", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const annotationId = param(req, "annotationId");

    let notePath = extractPath(req);
    // Strip /annotations/<id> from wildcard path
    const annSuffix = `/annotations/${annotationId}`;
    notePath = stripSuffix(notePath, annSuffix);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { status, body: annBody, reactions } = req.body as {
      status?: unknown;
      body?: string;
      reactions?: Array<{ emoji: string; user: string }>;
    };

    if (reactions !== undefined) {
      throw httpError(
        "Replacing annotation reactions is not supported. Reaction changes must identify the authenticated actor server-side.",
        400,
        "invalid_input",
      );
    }
    if (status !== undefined && (!VALID_ANNOTATION_STATUSES.includes(status as AnnotationStatus))) {
      throw httpError("status must be open, resolved, or wontfix.", 400, "invalid_input");
    }
    if (annBody !== undefined && (typeof annBody !== "string" || !annBody.trim())) {
      throw httpError("body must be a non-empty string.", 400, "invalid_input");
    }
    if (status === undefined && annBody === undefined) {
      throw httpError("Provide a status or body update.", 400, "invalid_input");
    }

    const existing = (await noteAnnotationSvc.listAnnotations(scope, visibility, opts, notePath))
      .find((annotation) => annotation.id === annotationId && !annotation.archivedAt);
    if (!existing) throw httpError("Annotation not found.", 404, "not_found");
    const actor = principal(req).username;
    if (annBody !== undefined && existing.author !== actor) {
      throw httpError("Only the annotation author may edit its body.", 403, "forbidden");
    }
    if (status !== undefined && !isValidAnnotationStatusTransition(existing.status, status as AnnotationStatus)) {
      throw httpError("This annotation status transition is not allowed.", 400, "invalid_status_transition");
    }

    const updated = await noteAnnotationSvc.updateAnnotation(scope, visibility, opts, notePath, annotationId, {
      status: status as AnnotationStatus | undefined,
      body: annBody,
    });

    if (!updated) throw httpError("Annotation not found.", 404, "not_found");
    res.json(updated);
  }));

  // ── Delete Annotation ───────────────────────────────────────────────

  app.delete("/api/codascope/notes/:scope/:visibility/note/*path/annotations/:annotationId", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const annotationId = param(req, "annotationId");

    let notePath = extractPath(req);
    const annSuffix = `/annotations/${annotationId}`;
    notePath = stripSuffix(notePath, annSuffix);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const expectedHash = typeof req.query.expectedHash === "string" ? req.query.expectedHash : undefined;
    const outcome = await noteAnnotationSvc.archiveAnnotation(
      scope, visibility, opts, notePath, annotationId, principal(req).username, expectedHash,
    );
    if (!outcome) throw httpError("Annotation not found.", 404, "not_found");
    if ("conflict" in outcome) throw httpError("Note was modified since you loaded it. Reload and try again.", 409, "conflict");
    const correlationId = randomUUID();
    const saved = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (saved) {
      noteAuditSvc.log({
        event: "note.annotation_archived",
        timestamp: new Date().toISOString(),
        actor: principal(req).username,
        noteId: saved.frontmatter.id,
        scope,
        visibility,
        path: notePath,
        correlationId,
        metadata: { annotationId },
      });
    }
    res.json({ archived: true, ...outcome, correlationId });
  }));

  // ── Compute Blocks ──────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/blocks", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/blocks");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const noteData = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (!noteData) throw httpError("Note not found.", 404, "not_found");

    const blocks = noteAnnotationSvc.computeBlocks(noteSvc.parseFrontmatter(noteData.content).body);
    res.json({ blocks });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── VERSION HISTORY ROUTES ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── List Versions ───────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/versions", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/versions");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const versions = await noteSvc.listVersions(scope, visibility, opts, notePath);
    res.json({ versions });
  }));

  // ── Get Version ─────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/versions/:version", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const version = param(req, "version");

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, `/versions/${version}`);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const versionData = await noteSvc.getVersion(scope, visibility, opts, notePath, version);
    if (!versionData) throw httpError("Version not found.", 404, "not_found");

    const content = noteSvc.parseFrontmatter(versionData.content).body;
    const markerRanges = parseInlineAnnotationAnchors(content).markers.map((marker) => ({ from: marker.from, to: marker.to }));
    res.json({ ...versionData, content, markerRanges });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── RESTORE ROUTES ───────────────────────────────────────────────────
  // Must be registered BEFORE the generic wildcard CRUD routes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Restore an Archived Note ──────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/archive/restore/:noteId", wrap(async (req, res) => {
    const { noteAuditSvc, noteBundleSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const noteId = param(req, "noteId");

    const result = await noteBundleSvc.restoreNote(scope, visibility, opts, noteId);
    if (!result) throw httpError("Archived note not found.", 404, "not_found");

    // Audit log
    noteAuditSvc.log({
      event: "note.restored",
      timestamp: new Date().toISOString(),
      actor: opts.userId ?? "default",
      noteId,
      scope,
      visibility,
      path: result.restoredPath,
      metadata: { originalPath: result.meta.originalPath },
    });

    res.json({ restored: true, restoredPath: result.restoredPath });
  }));

  // ── List Archived Notes ────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/archive", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    const archived: NoteArchiveMeta[] = await noteSvc.listArchived(scope, visibility, opts);
    res.json({ archived });
  }));

  // ── Query Audit Log (admin only) ───────────────────────────────────

  app.get("/api/codascope/audit/notes", wrap(async (req, res) => {
    const actor = principal(req);
    if (!actor.isAdmin) {
      throw httpError("Administrator access is required to query note audit events.", 403, "forbidden");
    }
    const { noteAuditSvc } = await ensureServices();

    let limit: number | undefined;
    if (req.query.limit !== undefined) {
      const rawLimit = req.query.limit;
      if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
        throw httpError("limit must be a positive integer.", 400, "invalid_input");
      }
      limit = Number(rawLimit);
      if (limit < 1 || limit > MAX_AUDIT_RESULTS) {
        throw httpError(`limit must be between 1 and ${MAX_AUDIT_RESULTS}.`, 400, "invalid_input");
      }
    }

    const filters = {
      noteId: (req.query.noteId as string) ?? undefined,
      event: (req.query.event as string) ?? undefined,
      actor: (req.query.actor as string) ?? undefined,
      from: (req.query.from as string) ?? undefined,
      to: (req.query.to as string) ?? undefined,
      limit,
    };

    const events = noteAuditSvc.query(filters);
    res.json({ events });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── BULK OPERATION ROUTES ─────────────────────────────────────────────
  // Must be registered BEFORE the generic wildcard CRUD routes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Bulk Archive ───────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/bulk/archive", wrap(async (req, res) => {
    const { noteAuditSvc, noteLinkIndexSvc, noteBundleSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    const { noteIds, reason } = req.body as { noteIds?: string[]; reason?: string };
    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      throw httpError("noteIds array is required.", 400, "invalid_input");
    }
    if (noteIds.length > 100) {
      throw httpError("Cannot archive more than 100 notes at once.", 400, "too_many");
    }

    const correlationId = randomUUID();
    const result = await noteBundleSvc.bulkArchive(scope, visibility, opts, noteIds, reason);

    // Audit log each archived note with the same correlationId
    for (const ap of result.archivedPaths) {
      noteAuditSvc.log({
        event: "note.archived",
        timestamp: new Date().toISOString(),
        actor: opts.userId ?? "default",
        noteId: ap.noteId,
        scope,
        visibility,
        path: ap.path,
        correlationId,
        metadata: reason ? { reason, bulk: true } : { bulk: true },
      });

      // Remove from link index (fire-and-forget)
      try { noteLinkIndexSvc.removeNote(scope, visibility, opts, ap.noteId); } catch { /* best effort */ }
    }

    res.json({
      archived: result.archived,
      failed: result.failed,
      correlationId,
    });
  }));

  // ── Bulk Move ──────────────────────────────────────────────────────

  app.post("/api/codascope/notes/bulk/move", wrap(async (req, res) => {
    const { noteSvc, noteTransferSvc } = await ensureServices();

    const {
      noteIds,
      fromScope, fromVisibility, fromOpts,
      toScope, toVisibility, toOpts,
      toFolder,
    } = req.body as {
      noteIds?: string[];
      fromScope?: string;
      fromVisibility?: string;
      fromOpts?: NoteResolveOpts;
      toScope?: string;
      toVisibility?: string;
      toOpts?: NoteResolveOpts;
      toFolder?: string;
    };

    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      throw httpError("noteIds array is required.", 400, "invalid_input");
    }
    if (!fromScope || !fromVisibility || !toScope || !toVisibility || toFolder === undefined) {
      throw httpError("fromScope, fromVisibility, toScope, toVisibility, and toFolder are required.", 400, "invalid_input");
    }
    if (noteIds.length > 100) {
      throw httpError("Cannot move more than 100 notes at once.", 400, "too_many");
    }

    const userId = principal(req).username;
    const correlationId = randomUUID();
    let moved = 0;
    const failed: string[] = [];

    for (const noteId of noteIds) {
      // Find the note by its frontmatter id
      const found = await noteSvc.findNoteById(
        fromScope as NoteScope,
        fromVisibility as NoteVisibility,
        { ...fromOpts, userId },
        noteId,
      );
      if (!found) {
        failed.push(noteId);
        continue;
      }

      const destPath = toFolder ? `${toFolder}/${found.path.split("/").pop()}` : found.path.split("/").pop()!;

      try {
        const result = await noteTransferSvc.moveFile({
          fromScope: fromScope as NoteScope,
          fromVisibility: fromVisibility as NoteVisibility,
          fromOpts: { ...fromOpts, userId },
          fromPath: found.path,
          toScope: toScope as NoteScope,
          toVisibility: toVisibility as NoteVisibility,
          toOpts: { ...toOpts, userId },
          toPath: destPath,
          correlationId,
        });
        if (result.moved) {
          moved++;
        } else {
          failed.push(noteId);
        }
      } catch {
        failed.push(noteId);
      }
    }

    res.json({ moved, failed, correlationId });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── COLLABORATION V2 ROUTES ────────────────────────────────────────
  // Must come BEFORE wildcard CRUD routes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Activity Feed ──────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/activity", wrap(async (req, res) => {
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Strip trailing "/activity" from the path (Express includes it in *path)
    const cleanPath = notePath.replace(/\/activity$/, "");
    if (!cleanPath) throw httpError("Note path is required.", 400, "invalid_input");

    const activity = await noteSvc.getActivity(scope, visibility, opts, cleanPath, noteAuditSvc);
    res.json({ activity });
  }));

  // ── Mark Note as Read ──────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/read", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    if (visibility !== "shared") {
      throw httpError("Reading indicators are available only for shared notes.", 400, "invalid_visibility");
    }
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Strip trailing "/read" from the path
    const cleanPath = notePath.replace(/\/read$/, "");
    if (!cleanPath) throw httpError("Note path is required.", 400, "invalid_input");

    // Get noteId from the file
    const note = await noteSvc.readNote(scope, visibility, opts, cleanPath);
    if (!note) throw httpError("Note not found.", 404, "not_found");

    const userId = opts.userId ?? "default";
    noteUserPrefsSvc.markRead(userId, note.frontmatter.id);

    res.json({ marked: true });
  }));

  // ── Read Status (batch check) ──────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/read-status", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const { visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    if (visibility !== "shared") {
      throw httpError("Reading indicators are available only for shared notes.", 400, "invalid_visibility");
    }

    const { noteIds } = req.body as { noteIds?: string[] };
    if (!noteIds || !Array.isArray(noteIds)) {
      throw httpError("noteIds array is required.", 400, "invalid_input");
    }

    const userId = opts.userId ?? "default";
    const status = noteUserPrefsSvc.getReadStatus(userId, noteIds);
    res.json({ status });
  }));

  // ── Readers for a Note ─────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/readers/:noteId", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    if (visibility !== "shared") {
      throw httpError("Reading indicators are available only for shared notes.", 400, "invalid_visibility");
    }
    const noteId = param(req, "noteId");
    if (!noteId) throw httpError("noteId is required.", 400, "invalid_input");

    // Only expose reader information when the requested shared note is in
    // the caller's current scope. This prevents a note ID from becoming a
    // cross-scope read-tracking lookup key.
    const note = await noteSvc.findNoteById(scope, visibility, opts, noteId);
    if (!note) throw httpError("Note not found.", 404, "not_found");

    const readers = noteUserPrefsSvc.getReadersForNote(noteId);
    res.json({ readers });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── DOCUMENT AND PIN ROUTES ──────────────────────────────────────────
  // These must stay before the generic wildcard CRUD routes. Documents are
  // opaque note-bundle companions, never separately movable resources.
  // ══════════════════════════════════════════════════════════════════════

  const documentFailure = (error: unknown): never => {
    if (isPathValidationError(error)) throw error;
    const message = error instanceof Error ? error.message : "Document operation failed.";
    const missing = /not found|missing/i.test(message);
    throw httpError(message, missing ? 404 : 400, missing ? "not_found" : "document_error");
  };

  const auditDocument = async (
    req: Parameters<typeof principal>[0],
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    event: string,
    documentId: string,
  ): Promise<void> => {
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const note = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return;
    noteAuditSvc.log({
      event,
      timestamp: new Date().toISOString(),
      actor: principal(req).username,
      noteId: note.frontmatter.id,
      scope,
      visibility,
      path: notePath,
      metadata: { documentId },
    });
  };

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/documents", wrap(async (req, res) => {
    const { noteDocumentSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = stripSuffix(extractPath(req), "/documents");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
    try {
      res.json(await noteDocumentSvc.listDocuments(scope, visibility, opts, notePath));
    } catch (error) {
      documentFailure(error);
    }
  }));

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/documents", documentUpload.single("file"), wrap(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    try {
      if (!file) throw httpError("A document file is required.", 400, "no_file");
      const { noteDocumentSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
      const notePath = stripSuffix(extractPath(req), "/documents");
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
      const document = await noteDocumentSvc.createDocument(scope, visibility, opts, notePath, {
        temporaryPath: file.path,
        originalFilename: file.originalname,
        declaredMimeType: file.mimetype,
      });
      await auditDocument(req, scope, visibility, opts, notePath, "note.document_uploaded", document.id);
      res.status(201).json({ document });
    } catch (error) {
      if ((error as { code?: string }).code) throw error;
      documentFailure(error);
    } finally {
      removeDocumentUpload(file);
    }
  }));

  app.patch("/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId", wrap(async (req, res) => {
    const { noteDocumentSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const documentId = param(req, "documentId");
    const notePath = stripSuffix(extractPath(req), `/documents/${documentId}`);
    const { displayName, comment } = req.body as { displayName?: unknown; comment?: unknown };
    if (!notePath || (displayName === undefined && comment === undefined) || (displayName !== undefined && typeof displayName !== "string") || (comment !== undefined && typeof comment !== "string")) {
      throw httpError("A note path and a string displayName and/or comment are required.", 400, "invalid_input");
    }
    try {
      const document = await noteDocumentSvc.updateDocument(scope, visibility, opts, notePath, documentId, { displayName: displayName as string | undefined, comment: comment as string | undefined });
      await auditDocument(req, scope, visibility, opts, notePath, "note.document_updated", document.id);
      res.json({ document });
    } catch (error) {
      documentFailure(error);
    }
  }));

  for (const [operation, archived] of [["archive", true], ["restore", false]] as const) {
    app.post(`/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId/${operation}`, wrap(async (req, res) => {
      const { noteDocumentSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
      const documentId = param(req, "documentId");
      const notePath = stripSuffix(extractPath(req), `/documents/${documentId}/${operation}`);
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
      try {
        const document = await noteDocumentSvc.setArchived(scope, visibility, opts, notePath, documentId, archived);
        await auditDocument(req, scope, visibility, opts, notePath, archived ? "note.document_archived" : "note.document_restored", document.id);
        res.json({ document });
      } catch (error) {
        documentFailure(error);
      }
    }));
  }

  for (const [method, pinned] of [["put", true], ["delete", false]] as const) {
    (app as any)[method]("/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId/pin", wrap(async (req: any, res: any) => {
      const { noteDocumentSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
      const documentId = param(req, "documentId");
      const notePath = stripSuffix(extractPath(req), `/documents/${documentId}/pin`);
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
      try {
        const document = await noteDocumentSvc.setPinned(scope, visibility, opts, notePath, documentId, pinned);
        await auditDocument(req, scope, visibility, opts, notePath, pinned ? "note.document_pinned" : "note.document_unpinned", document.id);
        res.json({ document });
      } catch (error) {
        documentFailure(error);
      }
    }));
  }

  for (const [method, starred] of [["put", true], ["delete", false]] as const) {
    (app as any)[method]("/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId/star", wrap(async (req: any, res: any) => {
      const { noteDocumentSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
      const documentId = param(req, "documentId");
      const notePath = stripSuffix(extractPath(req), `/documents/${documentId}/star`);
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
      try {
        const document = await noteDocumentSvc.setStarred(scope, visibility, opts, notePath, documentId, starred);
        res.json({ document });
      } catch (error) {
        documentFailure(error);
      }
    }));
  }

  app.get("/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId/download", wrap(async (req, res) => {
    const { noteDocumentSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const documentId = param(req, "documentId");
    const notePath = stripSuffix(extractPath(req), `/documents/${documentId}/download`);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
    try {
      const download = await noteDocumentSvc.resolveDownload(scope, visibility, opts, notePath, documentId);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.attachment(download.filename);
      res.sendFile(download.absolutePath);
    } catch (error) {
      documentFailure(error);
    }
  }));

  for (const [method, pinned] of [["put", true], ["delete", false]] as const) {
    (app as any)[method]("/api/codascope/notes/:scope/:visibility/note/*path/pin", wrap(async (req: any, res: any) => {
      const { noteSvc, noteAuditSvc } = await ensureServices();
      const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
      const notePath = stripSuffix(extractPath(req), "/pin");
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");
      const note = await noteSvc.setNotePin(scope, visibility, opts, notePath, pinned);
      if (!note) throw httpError("Note not found.", 404, "not_found");
      noteAuditSvc.log({
        event: pinned ? "note.pinned" : "note.unpinned",
        timestamp: new Date().toISOString(),
        actor: principal(req).username,
        noteId: note.id,
        scope,
        visibility,
        path: notePath,
      });
      res.json({ pinned, note: { pinned: note.pinned, pinnedAt: note.pinnedAt, pinnedBy: note.pinnedBy } });
    }));
  }

  // ── Archive a Note ─────────────────────────────────────────────────
  // This follows the document routes so their `/documents/:id/archive`
  // endpoint wins over the wildcard note archive path.

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/archive", wrap(async (req, res) => {
    const { noteAuditSvc, noteBundleSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/archive");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { reason } = (req.body ?? {}) as { reason?: string };

    const meta = await noteBundleSvc.archiveNote(scope, visibility, opts, notePath, reason);
    if (!meta) throw httpError("Note not found.", 404, "not_found");

    noteAuditSvc.log({
      event: "note.archived",
      timestamp: new Date().toISOString(),
      actor: opts.userId ?? "default",
      noteId: meta.noteId,
      scope,
      visibility,
      path: notePath,
      metadata: reason ? { reason } : undefined,
    });

    res.json(meta);
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── GENERIC NOTE CRUD ROUTES ──────────────────────────────────────────
  // These MUST come LAST because `*path` would greedily match suffixes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Read Note ───────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc, noteUserPrefsSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // The initial read is the only safe place to perform the staged legacy
    // migration: the response then includes any newly inserted markers and
    // their current content hash together.
    await noteAnnotationSvc.reconcileNote(scope, visibility, opts, notePath, true);
    const result = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (!result) throw httpError("Note not found.", 404, "not_found");

    // Fire-and-forget: update recents when a note is read
    const userId = opts.userId ?? "default";
    try {
      noteUserPrefsSvc.addRecent(userId, {
        noteId: result.frontmatter.id,
        scope,
        visibility,
        path: notePath,
        title: result.frontmatter.title,
      });
    } catch { /* best effort — never block the read response */ }

    // Enrich response with lastEditor metadata from index
    let lastEditor: string | undefined;
    let lastEditedAt: string | undefined;
    try {
      const noteFolder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : undefined;
      const notes = await noteSvc.listNotes(scope, visibility, opts, noteFolder);
      const entry = notes.find((n) => n.path === notePath);
      if (entry) {
        lastEditor = entry.lastEditor;
        lastEditedAt = entry.lastEditedAt;
      }
    } catch { /* best effort */ }

    // Frontmatter is storage metadata, not editable document content. Keep it
    // available as a separate read-only object for the UI while returning only
    // the Markdown body to clients.
    res.json({
      ...result,
      content: noteSvc.parseFrontmatter(result.content).body,
      lastEditor,
      lastEditedAt,
    });
  }));

  // ── Create Note ─────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content } = req.body as { content?: string };
    const result = await noteSvc.createNote(scope, visibility, opts, notePath, content);

    // Read back frontmatter to get the note UUID for audit
    try {
      const note = await noteSvc.readNote(scope, visibility, opts, notePath);
      if (note) {
        noteAuditSvc.log({
          event: "note.created",
          timestamp: new Date().toISOString(),
          actor: opts.userId ?? "default",
          noteId: note.frontmatter.id,
          scope,
          visibility,
          path: notePath,
        });
      }
    } catch { /* best effort */ }

    res.status(201).json(result);
  }));

  // ── Update Note ─────────────────────────────────────────────────────

  app.put("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content, expectedHash, title, tags, status } = req.body as {
      content?: string;
      expectedHash?: string;
      title?: string;
      tags?: string[];
      status?: "draft" | "ready";
    };
    if (content === undefined || typeof content !== "string") {
      throw httpError("content is required.", 400, "invalid_input");
    }

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      throw httpError("title must be a non-empty string.", 400, "invalid_input");
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) {
      throw httpError("tags must be an array of strings.", 400, "invalid_input");
    }
    if (status !== undefined && status !== "draft" && status !== "ready") {
      throw httpError("status must be draft or ready.", 400, "invalid_input");
    }

    // The editor supplies only body text plus the small set of user-editable
    // presentation fields. Merge them into the stored metadata here, rather
    // than allowing a client to author IDs, owners, or timestamps in YAML.
    const current = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (!current) throw httpError("Note not found.", 404, "not_found");
    const frontmatter = {
      ...current.frontmatter,
      title: title?.trim() || current.frontmatter.title,
      tags: tags === undefined
        ? current.frontmatter.tags
        : Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))),
    };
    if (visibility === "shared" && status !== undefined) frontmatter.status = status;
    const storedContent = noteSvc.serializeFrontmatter(frontmatter) + content;

    const result = await noteSvc.updateNote(scope, visibility, opts, notePath, storedContent, expectedHash);
    if (!result) throw httpError("Note not found.", 404, "not_found");
    if ("conflict" in result) {
      res.status(409).json({
        error: "conflict",
        message: "Note was modified since you loaded it.",
        currentHash: result.currentHash,
        currentContent: noteSvc.parseFrontmatter(result.currentContent).body,
        currentFrontmatter: noteSvc.parseFrontmatter(result.currentContent).frontmatter,
      });
      return;
    }

    // A normal editor save can remove, duplicate, or damage anchor comments.
    // Reconciliation records that state explicitly; it never guesses a new
    // marker location from quote text or nearby lines.
    await noteAnnotationSvc.reconcileAfterNoteWrite(scope, visibility, opts, notePath);

    // Fire-and-forget: update link index for backlinks
    try {
      const { noteLinkIndexSvc } = await ensureServices();
      const note = await noteSvc.readNote(scope, visibility, opts, notePath);
      if (note) {
        noteLinkIndexSvc.updateLinksForNote(scope, visibility, opts, note.frontmatter.id, content);
      }
    } catch { /* best effort */ }

    // Audit log (best effort — don't read back note for every auto-save,
    // use a lightweight approach: read frontmatter from the content we just saved)
    try {
      const note = await noteSvc.readNote(scope, visibility, opts, notePath);
      if (note) {
        noteAuditSvc.log({
          event: "note.updated",
          timestamp: new Date().toISOString(),
          actor: opts.userId ?? "default",
          noteId: note.frontmatter.id,
          scope,
          visibility,
          path: notePath,
        });
      }
    } catch { /* best effort */ }

    res.json(result);
  }));

  // ── Delete Note ─────────────────────────────────────────────────────

  app.delete("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc, noteAuditSvc, noteBundleSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Check for permanent deletion (admin only)
    const permanent = req.query.permanent === "true";
    if (permanent) {
      if (!principal(req).isAdmin) throw httpError("Permanent deletion requires admin privileges.", 403, "forbidden");
    }

    // Read note before deletion for audit log
    let noteId = "unknown";
    try {
      const note = await noteSvc.readNote(scope, visibility, opts, notePath);
      if (note) noteId = note.frontmatter.id;
    } catch { /* best effort */ }

    const deleted = await noteBundleSvc.deleteNote(scope, visibility, opts, notePath, permanent);
    if (!deleted) throw httpError("Note not found.", 404, "not_found");

    // Audit log
    noteAuditSvc.log({
      event: permanent ? "note.deleted" : "note.archived",
      timestamp: new Date().toISOString(),
      actor: opts.userId ?? "default",
      noteId,
      scope,
      visibility,
      path: notePath,
      metadata: permanent ? { permanent: true } : undefined,
    });

    res.json({ deleted: true });
  }));

  // ── Move Note ───────────────────────────────────────────────────────

  app.post("/api/codascope/notes/move", wrap(async (req, res) => {
    const { noteTransferSvc } = await ensureServices();

    const {
      fromScope, fromVisibility, fromPath, fromOpts,
      toScope, toVisibility, toPath, toOpts,
    } = req.body as {
      fromScope?: string;
      fromVisibility?: string;
      fromPath?: string;
      fromOpts?: NoteResolveOpts;
      toScope?: string;
      toVisibility?: string;
      toPath?: string;
      toOpts?: NoteResolveOpts;
    };

    if (!fromScope || !fromVisibility || !fromPath || !toScope || !toVisibility || !toPath) {
      throw httpError("fromScope, fromVisibility, fromPath, toScope, toVisibility, and toPath are required.", 400, "invalid_input");
    }

    if (!VALID_SCOPES.includes(fromScope as NoteScope) || !VALID_SCOPES.includes(toScope as NoteScope)) {
      throw httpError("Invalid scope.", 400, "invalid_scope");
    }
    if (!VALID_VISIBILITIES.includes(fromVisibility as NoteVisibility) || !VALID_VISIBILITIES.includes(toVisibility as NoteVisibility)) {
      throw httpError("Invalid visibility.", 400, "invalid_visibility");
    }
    if (toScope === "epic" && toVisibility === "private") {
      throw httpError("Epic notes are shared with the team.", 400, "invalid_visibility");
    }

    const userId = principal(req).username;

    const result = await noteTransferSvc.moveFile({
      fromScope: fromScope as NoteScope,
      fromVisibility: fromVisibility as NoteVisibility,
      fromOpts: { ...fromOpts, userId },
      fromPath,
      toScope: toScope as NoteScope,
      toVisibility: toVisibility as NoteVisibility,
      toOpts: { ...toOpts, userId },
      toPath,
    });

    if (!result.moved) throw httpError("Move failed. Source note not found.", 404, "not_found");
    res.json({ moved: true, noteIds: result.noteIds, correlationId: result.correlationId });
  }));
}

function isValidAnnotationStatusTransition(current: AnnotationStatus, next: AnnotationStatus): boolean {
  if (current === next) return true;
  if (current === "open") return next === "resolved" || next === "wontfix";
  return next === "open";
}
