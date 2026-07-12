/* ── CodaScope: Note Routes ──────────────────────────────────────────
   REST endpoints for note CRUD, folder management, image upload,
   search, move, annotations, blocks, and versions.

   URL pattern: /api/codascope/notes/:scope/:visibility/...
   Security: userId is derived from session, never from query string.
   ──────────────────────────────────────────────────────────────────── */


import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import type { NoteScope, NoteVisibility, NoteEntry, NoteArchiveMeta, StarredNoteRef } from "../../src/apps/codascope/codaScopeTypes.js";
import type { NoteResolveOpts } from "../services/codaScopeNoteService.js";
import { randomUUID } from "node:crypto";
import multer from "multer";

const VALID_SCOPES: NoteScope[] = ["codascope", "project", "epic"];
const VALID_VISIBILITIES: NoteVisibility[] = ["shared", "private"];

export function registerNoteRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, upload } = ctx;

  /**
   * Validate :scope and :visibility params and extract resolve opts.
   * SECURITY: userId is derived from the session, never from the query string.
   */
  function parseScopeAndOpts(
    scopeParam: string,
    visibilityParam: string,
    query: Record<string, unknown>,
    req: any,
  ): { scope: NoteScope; visibility: NoteVisibility; opts: NoteResolveOpts } {
    if (!VALID_SCOPES.includes(scopeParam as NoteScope)) {
      throw httpError(`Invalid scope: "${scopeParam}". Must be one of: ${VALID_SCOPES.join(", ")}`, 400, "invalid_scope");
    }
    if (!VALID_VISIBILITIES.includes(visibilityParam as NoteVisibility)) {
      throw httpError(`Invalid visibility: "${visibilityParam}". Must be one of: ${VALID_VISIBILITIES.join(", ")}`, 400, "invalid_visibility");
    }

    // SECURITY: userId from session, never from query string
    const userId = req.session?.user?.username ?? req.headers["x-auth-user"] ?? "default";

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



  // ── Export / Import ────────────────────────────────────────────────
  // Placed BEFORE :scope/:visibility so these fixed paths don't collide.

  // Larger multer instance for import (500 MB)
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

  /** POST /api/codascope/notes/export — start export */
  app.post("/api/codascope/notes/export", wrap(async (req, res) => {
    const { noteExportSvc, noteAuditSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

    const {
      scope: scopeParam,
      visibility: visibilityParam,
      projectId,
      epicId,
      notePaths,
      includeVersions,
      includeAnnotations,
    } = req.body as {
      scope?: string;
      visibility?: string;
      projectId?: string;
      epicId?: string;
      notePaths?: string[];
      includeVersions?: boolean;
      includeAnnotations?: boolean;
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
      { notePaths, includeVersions, includeAnnotations },
    );

    res.json({ exportId });
  }));

  /** GET /api/codascope/notes/export/:id — download ZIP */
  app.get("/api/codascope/notes/export/:id", wrap(async (req, res) => {
    const { noteExportSvc } = await ensureServices();
    const exportId = param(req, "id");

    const zipPath = noteExportSvc.getExportFile(exportId);
    if (!zipPath) {
      throw httpError("Export not found or expired.", 404, "not_found");
    }

    res.download(zipPath, `codascope-notes-export.zip`);
  }));

  /** POST /api/codascope/notes/import/preview — upload ZIP, get preview */
  app.post("/api/codascope/notes/import/preview", importUpload.single("file"), wrap(async (req, res) => {
    const { noteImportSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

    const file = (req as any).file as { buffer: Buffer } | undefined;
    if (!file) {
      throw httpError("ZIP file is required.", 400, "invalid_input");
    }

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
    const preview = await noteImportSvc.previewImport(
      file.buffer,
      scopeParam as NoteScope,
      visibilityParam as NoteVisibility,
      opts,
    );

    res.json(preview);
  }));

  /** POST /api/codascope/notes/import/execute — execute import */
  app.post("/api/codascope/notes/import/execute", importUpload.single("file"), wrap(async (req, res) => {
    const { noteImportSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

    const file = (req as any).file as { buffer: Buffer } | undefined;
    if (!file) {
      throw httpError("ZIP file is required.", 400, "invalid_input");
    }

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
    const report = await noteImportSvc.executeImport(
      file.buffer,
      scopeParam as NoteScope,
      visibilityParam as NoteVisibility,
      opts,
      strategy,
    );

    res.json(report);
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

    // SECURITY: userId from session, never from query string
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

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

    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
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
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
    const items = noteUserPrefsSvc.getStarred(userId);
    res.json({ items });
  }));

  // ── Star a Note ────────────────────────────────────────────────────

  app.put("/api/codascope/notes/starred/:noteId", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
    const noteId = param(req, "noteId");

    const { scope, visibility, path: notePath, title } = req.body as {
      scope?: string;
      visibility?: string;
      path?: string;
      title?: string;
    };

    if (!scope || !visibility || !notePath || !title) {
      throw httpError("scope, visibility, path, and title are required.", 400, "invalid_input");
    }

    noteUserPrefsSvc.star(userId, {
      noteId,
      scope: scope as StarredNoteRef["scope"],
      visibility: visibility as StarredNoteRef["visibility"],
      path: notePath,
      title,
    });

    res.json({ starred: true });
  }));

  // ── Unstar a Note ──────────────────────────────────────────────────

  app.delete("/api/codascope/notes/starred/:noteId", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
    const noteId = param(req, "noteId");

    const removed = noteUserPrefsSvc.unstar(userId, noteId);
    if (!removed) throw httpError("Note was not starred.", 404, "not_found");

    res.json({ unstarred: true });
  }));

  // ── List Recent Notes ──────────────────────────────────────────────

  app.get("/api/codascope/notes/recents", wrap(async (req, res) => {
    const { noteUserPrefsSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
    const items = noteUserPrefsSvc.getRecents(userId);
    res.json({ items });
  }));

  // ── Quick Capture ──────────────────────────────────────────────────

  app.post("/api/codascope/notes/capture", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

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
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const folder = (req.query.folder as string) ?? undefined;
    const notes: NoteEntry[] = await noteSvc.listNotes(scope, visibility, opts, folder);
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
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const tags = await noteSvc.buildTagIndex(scope, visibility, opts);
    res.json({ tags });
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
    const { noteSvc, noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/annotations");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Optionally read current content for re-anchoring
    let content: string | undefined;
    const noteData = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (noteData) content = noteData.content;

    const annotations = await noteAnnotationSvc.listAnnotations(scope, visibility, opts, notePath, content);
    res.json({ annotations });
  }));

  // ── Create Annotation ──────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/annotations", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/annotations");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { anchor, author, body, parentId } = req.body as {
      anchor?: any;
      author?: string;
      body?: string;
      parentId?: string;
    };

    if (!anchor || !author || !body) {
      throw httpError("anchor, author, and body are required.", 400, "invalid_input");
    }

    const annotation = await noteAnnotationSvc.createAnnotation(scope, visibility, opts, notePath, {
      anchor,
      author: author ?? "user",
      body,
      parentId,
    });

    res.status(201).json(annotation);
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
      status?: any;
      body?: string;
      reactions?: Array<{ emoji: string; user: string }>;
    };

    const updated = await noteAnnotationSvc.updateAnnotation(scope, visibility, opts, notePath, annotationId, {
      status,
      body: annBody,
      reactions,
    });

    if (!updated) throw httpError("Annotation not found.", 404, "not_found");
    res.json(updated);
  }));

  // ── Delete Annotation ───────────────────────────────────────────────

  app.delete("/api/codascope/notes/:scope/:visibility/note/*path/annotations/:annotationId", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const annotationId = param(req, "annotationId");

    let notePath = extractPath(req);
    const annSuffix = `/annotations/${annotationId}`;
    notePath = stripSuffix(notePath, annSuffix);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const deleted = await noteAnnotationSvc.deleteAnnotation(scope, visibility, opts, notePath, annotationId);
    if (!deleted) throw httpError("Annotation not found.", 404, "not_found");

    res.json({ deleted: true });
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

    const blocks = noteAnnotationSvc.computeBlocks(noteData.content);
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

    res.json(versionData);
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── ARCHIVE / RESTORE ROUTES ─────────────────────────────────────────
  // Must be registered BEFORE the generic wildcard CRUD routes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Archive a Note ─────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path/archive", wrap(async (req, res) => {
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/archive");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { reason } = req.body as { reason?: string };

    const meta = await noteSvc.archiveNote(scope, visibility, opts, notePath, reason);
    if (!meta) throw httpError("Note not found.", 404, "not_found");

    // Audit log
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

  // ── Restore an Archived Note ──────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/archive/restore/:noteId", wrap(async (req, res) => {
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const noteId = param(req, "noteId");

    const result = await noteSvc.restoreNote(scope, visibility, opts, noteId);
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
    const { noteAuditSvc } = await ensureServices();

    const filters = {
      noteId: (req.query.noteId as string) ?? undefined,
      event: (req.query.event as string) ?? undefined,
      actor: (req.query.actor as string) ?? undefined,
      from: (req.query.from as string) ?? undefined,
      to: (req.query.to as string) ?? undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
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
    const { noteSvc, noteAuditSvc, noteLinkIndexSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);

    const { noteIds, reason } = req.body as { noteIds?: string[]; reason?: string };
    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      throw httpError("noteIds array is required.", 400, "invalid_input");
    }
    if (noteIds.length > 100) {
      throw httpError("Cannot archive more than 100 notes at once.", 400, "too_many");
    }

    const correlationId = randomUUID();
    const result = await noteSvc.bulkArchive(scope, visibility, opts, noteIds, reason);

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
    const { noteSvc, noteAuditSvc } = await ensureServices();

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

    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";
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
        const ok = await noteSvc.moveNote({
          fromScope: fromScope as NoteScope,
          fromVisibility: fromVisibility as NoteVisibility,
          fromOpts: { ...fromOpts, userId },
          fromPath: found.path,
          toScope: toScope as NoteScope,
          toVisibility: toVisibility as NoteVisibility,
          toOpts: { ...toOpts, userId },
          toPath: destPath,
        });
        if (ok) {
          moved++;
          try {
            noteAuditSvc.log({
              event: "note.moved",
              timestamp: new Date().toISOString(),
              actor: userId,
              noteId,
              scope: toScope as NoteScope,
              visibility: toVisibility as NoteVisibility,
              path: destPath,
              correlationId,
              metadata: { fromScope, fromVisibility, fromPath: found.path, bulk: true },
            });
            if (fromVisibility !== toVisibility) {
              noteAuditSvc.log({
                event: "note.visibility_changed",
                timestamp: new Date().toISOString(),
                actor: userId,
                noteId,
                scope: toScope as NoteScope,
                visibility: toVisibility as NoteVisibility,
                path: destPath,
                correlationId,
                metadata: { fromVisibility, toVisibility, fromScope, toScope, bulk: true },
              });
            }
          } catch { /* best effort */ }
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
  // ── GENERIC NOTE CRUD ROUTES ──────────────────────────────────────────
  // These MUST come LAST because `*path` would greedily match suffixes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Read Note ───────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc, noteUserPrefsSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

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
      const filename = notePath.split("/").pop() ?? notePath;
      const notes = await noteSvc.listNotes(scope, visibility, opts, noteFolder);
      const entry = notes.find((n) => n.path === filename);
      if (entry) {
        lastEditor = entry.lastEditor;
        lastEditedAt = entry.lastEditedAt;
      }
    } catch { /* best effort */ }

    res.json({ ...result, lastEditor, lastEditedAt });
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
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content, expectedHash } = req.body as { content?: string; expectedHash?: string };
    if (content === undefined || typeof content !== "string") {
      throw httpError("content is required.", 400, "invalid_input");
    }

    const result = await noteSvc.updateNote(scope, visibility, opts, notePath, content, expectedHash);
    if (!result) throw httpError("Note not found.", 404, "not_found");
    if ("conflict" in result) {
      res.status(409).json({
        error: "conflict",
        message: "Note was modified since you loaded it.",
        currentHash: result.currentHash,
        currentContent: result.currentContent,
      });
      return;
    }

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
    const { noteSvc, noteAuditSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Check for permanent deletion (admin only)
    const permanent = req.query.permanent === "true";
    if (permanent) {
      const isAdmin = (req as any).session?.user?.isAdmin === true;
      if (!isAdmin) throw httpError("Permanent deletion requires admin privileges.", 403, "forbidden");
    }

    // Read note before deletion for audit log
    let noteId = "unknown";
    try {
      const note = await noteSvc.readNote(scope, visibility, opts, notePath);
      if (note) noteId = note.frontmatter.id;
    } catch { /* best effort */ }

    const deleted = await noteSvc.deleteNote(scope, visibility, opts, notePath, permanent);
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
    const { noteSvc, noteAuditSvc } = await ensureServices();

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

    // SECURITY: inject userId from session into opts
    const userId = (req as any).session?.user?.username ?? (req as any).headers["x-auth-user"] ?? "default";

    const moved = await noteSvc.moveNote({
      fromScope: fromScope as NoteScope,
      fromVisibility: fromVisibility as NoteVisibility,
      fromOpts: { ...fromOpts, userId },
      fromPath,
      toScope: toScope as NoteScope,
      toVisibility: toVisibility as NoteVisibility,
      toOpts: { ...toOpts, userId },
      toPath,
    });

    if (!moved) throw httpError("Move failed. Source note not found.", 404, "not_found");

    // Audit log (best effort — read the note at the destination)
    try {
      const note = await noteSvc.readNote(
        toScope as NoteScope,
        toVisibility as NoteVisibility,
        { ...toOpts, userId },
        toPath!,
      );
      if (note) {
        noteAuditSvc.log({
          event: "note.moved",
          timestamp: new Date().toISOString(),
          actor: userId,
          noteId: note.frontmatter.id,
          scope: toScope as NoteScope,
          visibility: toVisibility as NoteVisibility,
          path: toPath!,
          metadata: {
            fromScope, fromVisibility, fromPath,
            toScope, toVisibility, toPath,
          },
        });
        if (fromVisibility !== toVisibility) {
          noteAuditSvc.log({
            event: "note.visibility_changed",
            timestamp: new Date().toISOString(),
            actor: userId,
            noteId: note.frontmatter.id,
            scope: toScope as NoteScope,
            visibility: toVisibility as NoteVisibility,
            path: toPath!,
            metadata: { fromVisibility, toVisibility, fromScope, toScope },
          });
        }
      }
    } catch { /* best effort */ }

    res.json({ moved: true });
  }));
}
