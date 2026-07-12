/* ── CodaScope: Note Routes ──────────────────────────────────────────
   REST endpoints for note CRUD, folder management, image upload,
   search, move, annotations, blocks, and versions.

   URL pattern: /api/codascope/notes/:scope/:visibility/...
   Security: userId is derived from session, never from query string.
   ──────────────────────────────────────────────────────────────────── */


import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import type { NoteScope, NoteVisibility, NoteEntry } from "../../src/apps/codascope/codaScopeTypes.js";
import type { NoteResolveOpts } from "../services/codaScopeNoteService.js";

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
  // ── GENERIC NOTE CRUD ROUTES ──────────────────────────────────────────
  // These MUST come LAST because `*path` would greedily match suffixes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Read Note ───────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const result = await noteSvc.readNote(scope, visibility, opts, notePath);
    if (!result) throw httpError("Note not found.", 404, "not_found");

    res.json(result);
  }));

  // ── Create Note ─────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content } = req.body as { content?: string };
    const result = await noteSvc.createNote(scope, visibility, opts, notePath, content);
    res.status(201).json(result);
  }));

  // ── Update Note ─────────────────────────────────────────────────────

  app.put("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
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

    res.json(result);
  }));

  // ── Delete Note ─────────────────────────────────────────────────────

  app.delete("/api/codascope/notes/:scope/:visibility/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { scope, visibility, opts } = parseScopeAndOpts(param(req, "scope"), param(req, "visibility"), req.query as Record<string, unknown>, req);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const deleted = await noteSvc.deleteNote(scope, visibility, opts, notePath);
    if (!deleted) throw httpError("Note not found.", 404, "not_found");

    res.json({ deleted: true });
  }));

  // ── Move Note ───────────────────────────────────────────────────────

  app.post("/api/codascope/notes/move", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();

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
    res.json({ moved: true });
  }));
}
