/* ── CodaScope: Note Routes ──────────────────────────────────────────
   REST endpoints for note CRUD, folder management, image upload,
   search, and move operations.
   ──────────────────────────────────────────────────────────────────── */

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

  // ── Upload Image ────────────────────────────────────────────────────

  app.post("/api/codascope/notes/:level/note/*path/images",
    upload.single("image"),
    wrap(async (req, res) => {
      const { noteSvc } = await ensureServices();
      const { level, opts } = parseLevelAndOpts(param(req, "level"), req.query as Record<string, unknown>);

      // Extract the note path — strip trailing "/images" from the wildcard
      let notePath = extractPath(req);
      if (notePath.endsWith("/images")) {
        notePath = notePath.slice(0, -"/images".length);
      }
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
    const imagesSuffix = `/images/${filename}`;
    if (notePath.endsWith(imagesSuffix)) {
      notePath = notePath.slice(0, -imagesSuffix.length);
    }
    if (!notePath) throw httpError("Note path is required.", 400, "invalid_input");

    const imgPath = noteSvc.getImagePath(level, opts, notePath, filename);
    if (!imgPath) throw httpError("Image not found.", 404, "not_found");

    res.sendFile(imgPath);
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

  // ── Search ──────────────────────────────────────────────────────────

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
}
