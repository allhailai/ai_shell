/* ── CodaScope: Wiki Routes ───────────────────────────────────────────
   Wiki CRUD, wiki state, pending deletions, and code map endpoints.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

export function registerWikiRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param } = ctx;

  // ── Wiki ────────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/wiki", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topics = await wikiSvc.listTopics(id);
    res.json({ topics });
  }));

  app.get("/api/codascope/projects/:id/wiki/:topicId", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const content = await wikiSvc.getTopicContent(id, topicId);
    if (content === null) throw httpError("Topic not found.", 404, "not_found");
    res.json({ content });
  }));

  // Download wiki topic as markdown file
  app.get("/api/codascope/projects/:id/wiki/:topicId/download", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const content = await wikiSvc.getTopicContent(id, topicId);
    if (content === null) throw httpError("Topic not found.", 404, "not_found");
    const filename = `${topicId}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  }));

  app.put("/api/codascope/projects/:id/wiki/:topicId", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const { content } = req.body as { content?: string };
    if (content === undefined) throw httpError("content is required.", 400, "invalid_input");
    await wikiSvc.updateTopicContent(id, topicId, content);
    res.json({ saved: true });
  }));

  app.get("/api/codascope/projects/:id/wiki-state", wrap(async (req, res) => {
    const { projectSvc, wikiStateSvc } = await ensureServices();
    const id = param(req, "id");
    const projectDir = projectSvc.getProjectDir(id);
    if (!projectDir) throw httpError("Project not found.", 404, "not_found");
    const state = wikiStateSvc.getWikiState(projectDir);
    if (!state) {
      res.json({ topics: {} });
      return;
    }
    res.json(state);
  }));

  // ── Wiki Pending Deletions ──────────────────────────────────────

  // List pending deletions
  app.get("/api/codascope/projects/:id/wiki/pending-deletions", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const items = await wikiSvc.listPendingDeletions(id);
    res.json({ items });
  }));

  // Approve a pending deletion
  app.post("/api/codascope/projects/:id/wiki/pending-deletions/:topicId/approve", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const approved = await wikiSvc.approveDeletion(id, topicId);
    if (!approved) throw httpError("No pending deletion found for this topic.", 404, "not_found");
    res.json({ approved: true, topicId });
  }));

  // Reject a pending deletion
  app.post("/api/codascope/projects/:id/wiki/pending-deletions/:topicId/reject", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices();
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const rejected = await wikiSvc.rejectDeletion(id, topicId);
    if (!rejected) throw httpError("No pending deletion found for this topic.", 404, "not_found");
    res.json({ rejected: true, topicId });
  }));

  // ── Code Map ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/code-map", wrap(async (req, res) => {
    const { codeMapSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");

    const statuses = codeMapSvc.getAllCodeMapStatuses(
      id,
      project.repositories ?? [],
    );
    res.json({ statuses });
  }));

  app.get("/api/codascope/projects/:id/code-map/:repoSlug", wrap(async (req, res) => {
    const { codeMapSvc } = await ensureServices();
    const id = param(req, "id");
    const repoSlug = param(req, "repoSlug");
    const content = codeMapSvc.readCodeMap(id, repoSlug);
    if (content === null) throw httpError("Code Map not found.", 404, "not_found");
    const meta = codeMapSvc.getCodeMapMeta(id, repoSlug);
    res.json({ content, meta });
  }));

  app.get("/api/codascope/projects/:id/code-map/inventory/:repoId", wrap(async (req, res) => {
    const { codeMapSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");

    const repo = (project.repositories ?? []).find(
      (r: { id: string }) => r.id === repoId,
    );
    if (!repo) throw httpError("Repository not found.", 404, "not_found");

    const inventory = codeMapSvc.generateFileInventory(repo.name, repo.path);
    const markdown = codeMapSvc.formatInventoryAsMarkdown(inventory);
    res.json({ inventory, markdown });
  }));

}
