/* ── CodaScope: Note Routes ──────────────────────────────────────────
   REST endpoints for note CRUD, folder management, image upload,
   search, move, annotations, blocks, versions, and templates.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import type { NoteLevel, NoteEntry } from "../../src/apps/codascope/codaScopeTypes.js";
import type { NoteResolveOpts } from "../services/codaScopeNoteService.js";

const VALID_LEVELS: NoteLevel[] = ["personal", "public", "project", "epic"];

export function registerNoteRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, upload } = ctx;

  /** Validate :level param and extract resolve opts from query. */
  function parseLevelAndOpts(
    levelParam: string,
    query: Record<string, unknown>,
  ): { level: NoteLevel; opts: NoteResolveOpts } {
    if (!VALID_LEVELS.includes(levelParam as NoteLevel)) {
      throw httpError(`Invalid note level: "${levelParam}". Must be one of: ${VALID_LEVELS.join(", ")}`, 400, "invalid_level");
    }
    const level = levelParam as NoteLevel;
    const opts: NoteResolveOpts = {
      username: (query.username as string) ?? undefined,
      projectId: (query.projectId as string) ?? undefined,
      epicId: (query.epicId as string) ?? undefined,
    };
    return { level, opts };
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

  // ── Templates ──────────────────────────────────────────────────────
  // Placed BEFORE the :level routes so /api/codascope/notes/templates
  // doesn't get interpreted as level="templates"

  app.get("/api/codascope/notes/templates", wrap(async (_req, res) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const templatesDir = path.join(__dirname, "..", "data", "note-templates");
    const templates: Array<{ id: string; title: string; content: string }> = [];

    if (existsSync(templatesDir)) {
      try {
        const files = readdirSync(templatesDir).filter((f) => f.endsWith(".md")).sort();
        for (const file of files) {
          const content = readFileSync(path.join(templatesDir, file), "utf-8");
          // Extract title from frontmatter
          const titleMatch = content.match(/^title:\s*(.+)$/m);
          const title = titleMatch ? titleMatch[1].trim() : file.replace(".md", "");
          templates.push({
            id: file.replace(".md", ""),
            title,
            content,
          });
        }
      } catch { /* ignore */ }
    }

    res.json({ templates });
  }));

  // ── Search ──────────────────────────────────────────────────────────
  // Placed BEFORE :level so /api/codascope/notes/search doesn't collide

  app.get("/api/codascope/notes/search", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const q = req.query.q as string;
    if (!q || typeof q !== "string" || !q.trim()) {
      throw httpError("q (search query) is required.", 400, "invalid_input");
    }

    const opts: NoteResolveOpts = {
      username: (req.query.username as string) ?? undefined,
      projectId: (req.query.projectId as string) ?? undefined,
      epicId: (req.query.epicId as string) ?? undefined,
    };

    const results = await noteSvc.searchNotes(q.trim(), opts);
    res.json({ results });
  }));

  // ── List Notes ──────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const folder = (req.query.folder as string) ?? undefined;
    const notes: NoteEntry[] = await noteSvc.listNotes(level, opts, folder);
    res.json({ notes });
  }));

  // ── List Folders ────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/folders", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const folders = await noteSvc.listFolders(level, opts);
    res.json({ folders });
  }));

  // ── Create Folder ───────────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/folders", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const { folderPath } = req.body as { folderPath?: string };
    if (!folderPath || typeof folderPath !== "string" || !folderPath.trim()) {
      throw httpError("folderPath is required.", 400, "invalid_input");
    }
    await noteSvc.createFolder(level, opts, folderPath.trim());
    res.status(201).json({ created: true, folderPath: folderPath.trim() });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // IMPORTANT: Routes with suffixed paths (e.g. /images, /annotations,
  // /versions, /blocks) MUST be registered BEFORE the generic wildcard
  // CRUD routes (`*path`). Express matches in registration order, and
  // the generic `*path` would greedily consume the suffix.
  // ══════════════════════════════════════════════════════════════════════

  // ── Upload Image ────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/note/*path/images",
    upload.single("image"),
    wrap(async (req, res) => {
      const { noteSvc } = await ensureServices();
      const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

      // Extract the note path — strip trailing "/images" from the wildcard
      let notePath = extractPath(req);
      notePath = stripSuffix(notePath, "/images");
      if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

      const file = (req as any).file;
      if (!file) throw httpError("No image file uploaded.", 400, "no_file");

      const result = await noteSvc.uploadImage(
        level,
        opts,
        notePath,
        file.buffer,
        file.mimetype,
      );

      res.status(201).json(result);
    }),
  );

  // ── Serve Image ─────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path/images/:filename", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const filename = param(req, "filename");

    // Extract the note path — strip trailing "/images/<filename>" from the wildcard
    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, `/images/${filename}`);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    let imgPath = noteSvc.getImagePath(level, opts, notePath, filename);

    // Fallback: if not found in the note's own assets dir, check the
    // assetDir hint (handles renamed notes where the assets dir name
    // still matches the old note name).
    if (!imgPath && req.query.assetDir) {
      const hintDir = String(req.query.assetDir);
      // Only allow .assets suffixed directories for security
      if (hintDir.endsWith(".assets")) {
        const hintNotePath = hintDir.replace(/\.assets$/, ".md");
        imgPath = noteSvc.getImagePath(level, opts, hintNotePath, filename);
      }
    }

    if (!imgPath) throw httpError("Image not found.", 404, "not_found");

    res.sendFile(imgPath);
  }));
  // ══════════════════════════════════════════════════════════════════════
  // ── ANNOTATION ROUTES ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── List Annotations ────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path/annotations", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/annotations");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    // Optionally read current content for re-anchoring
    let content: string | undefined;
    const noteData = await noteSvc.readNote(level, opts, notePath);
    if (noteData) content = noteData.content;

    const annotations = await noteAnnotationSvc.listAnnotations(level, opts, notePath, content);
    res.json({ annotations });
  }));

  // ── Create Annotation ──────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/note/*path/annotations", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

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

    const annotation = await noteAnnotationSvc.createAnnotation(level, opts, notePath, {
      anchor,
      author: author ?? "user",
      body,
      parentId,
    });

    res.status(201).json(annotation);
  }));

  // ── Update Annotation (resolve/reopen/edit) ─────────────────────────

  app.patch("/api/codascope/notes/:level/note/*path/annotations/:annotationId", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
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

    const updated = await noteAnnotationSvc.updateAnnotation(level, opts, notePath, annotationId, {
      status,
      body: annBody,
      reactions,
    });

    if (!updated) throw httpError("Annotation not found.", 404, "not_found");
    res.json(updated);
  }));

  // ── Delete Annotation ───────────────────────────────────────────────

  app.delete("/api/codascope/notes/:level/note/*path/annotations/:annotationId", wrap(async (req, res) => {
    const { noteAnnotationSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const annotationId = param(req, "annotationId");

    let notePath = extractPath(req);
    const annSuffix = `/annotations/${annotationId}`;
    notePath = stripSuffix(notePath, annSuffix);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const deleted = await noteAnnotationSvc.deleteAnnotation(level, opts, notePath, annotationId);
    if (!deleted) throw httpError("Annotation not found.", 404, "not_found");

    res.json({ deleted: true });
  }));

  // ── Compute Blocks ──────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path/blocks", wrap(async (req, res) => {
    const { noteSvc, noteAnnotationSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/blocks");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const noteData = await noteSvc.readNote(level, opts, notePath);
    if (!noteData) throw httpError("Note not found.", 404, "not_found");

    const blocks = noteAnnotationSvc.computeBlocks(noteData.content);
    res.json({ blocks });
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── VERSION HISTORY ROUTES ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── List Versions ───────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path/versions", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, "/versions");
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const versions = await noteSvc.listVersions(level, opts, notePath);
    res.json({ versions });
  }));

  // ── Get Version ─────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path/versions/:version", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const version = param(req, "version");

    let notePath = extractPath(req);
    notePath = stripSuffix(notePath, `/versions/${version}`);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const versionData = await noteSvc.getVersion(level, opts, notePath, version);
    if (!versionData) throw httpError("Version not found.", 404, "not_found");

    res.json(versionData);
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ── GENERIC NOTE CRUD ROUTES ──────────────────────────────────────────
  // These MUST come LAST because `*path` would greedily match suffixes.
  // ══════════════════════════════════════════════════════════════════════

  // ── Read Note ───────────────────────────────────────────────────────

  app.get("/api/codascope/notes/:level/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const result = await noteSvc.readNote(level, opts, notePath);
    if (!result) throw httpError("Note not found.", 404, "not_found");

    res.json(result);
  }));

  // ── Create Note ─────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content } = req.body as { content?: string };
    const result = await noteSvc.createNote(level, opts, notePath, content);
    res.status(201).json(result);
  }));

  // ── Update Note ─────────────────────────────────────────────────────

  app.put("/api/codascope/notes/:level/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const { content, expectedHash } = req.body as { content?: string; expectedHash?: string };
    if (content === undefined || typeof content !== "string") {
      throw httpError("content is required.", 400, "invalid_input");
    }

    const result = await noteSvc.updateNote(level, opts, notePath, content, expectedHash);
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

  app.delete("/api/codascope/notes/:level/note/*path", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);
    const notePath = extractPath(req);
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const deleted = await noteSvc.deleteNote(level, opts, notePath);
    if (!deleted) throw httpError("Note not found.", 404, "not_found");

    res.json({ deleted: true });
  }));

  // ── Move Note ───────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/move", wrap(async (req, res) => {
    const { noteSvc } = await ensureServices();
    const fromLevelParam = param(req, "level");
    const { fromPath, toLevel, toPath, fromOpts, toOpts } = req.body as {
      fromPath?: string;
      toLevel?: string;
      toPath?: string;
      fromOpts?: NoteResolveOpts;
      toOpts?: NoteResolveOpts;
    };

    if (!fromPath || !toLevel || !toPath) {
      throw httpError("fromPath, toLevel, and toPath are required.", 400, "invalid_input");
    }

    if (!VALID_LEVELS.includes(fromLevelParam as NoteLevel) || !VALID_LEVELS.includes(toLevel as NoteLevel)) {
      throw httpError("Invalid level.", 400, "invalid_level");
    }

    const moved = await noteSvc.moveNote({
      fromLevel: fromLevelParam as NoteLevel,
      fromOpts: fromOpts ?? {},
      fromPath,
      toLevel: toLevel as NoteLevel,
      toOpts: toOpts ?? {},
      toPath,
    });

    if (!moved) throw httpError("Move failed. Source note not found.", 404, "not_found");
    res.json({ moved: true });
  }));
}
