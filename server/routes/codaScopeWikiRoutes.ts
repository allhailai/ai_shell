/* ── CodaScope: Wiki Routes ───────────────────────────────────────────
   Wiki CRUD, wiki state, pending deletions, concepts, golden rules,
   quality, and code map endpoints.
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

  // ── Concepts ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/concepts", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices();
    const id = param(req, "id");
    const category = req.query.category as string | undefined;
    const concepts = conceptSvc.listConcepts(id, category);
    res.json({ concepts, count: concepts.length });
  }));

  app.post("/api/codascope/projects/:id/concepts", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices();
    const id = param(req, "id");
    const { name, description, category, relatedFiles } = req.body as {
      name?: string; description?: string; category?: string; relatedFiles?: string[];
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    const concept = conceptSvc.createConcept(id, {
      name: name.trim(),
      description: description?.trim() ?? "",
      category: category ?? "other",
      relatedFiles: relatedFiles ?? [],
    });
    res.status(201).json({ concept });
  }));

  app.put("/api/codascope/projects/:id/concepts/:conceptId", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices();
    const id = param(req, "id");
    const conceptId = param(req, "conceptId");
    const { name, description, category, relatedConcepts, relatedFiles, wikiTopicId } = req.body;
    const concept = conceptSvc.updateConcept(id, conceptId, {
      name, description, category, relatedConcepts, relatedFiles, wikiTopicId,
    });
    if (!concept) throw httpError("Concept not found.", 404, "not_found");
    res.json({ concept });
  }));

  app.delete("/api/codascope/projects/:id/concepts/:conceptId", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices();
    const id = param(req, "id");
    const conceptId = param(req, "conceptId");
    const deleted = conceptSvc.deleteConcept(id, conceptId);
    if (!deleted) throw httpError("Concept not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Golden Rules ──────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/golden-rules", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices();
    const id = param(req, "id");
    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    const enabledStr = req.query.enabled as string | undefined;
    const enabled = enabledStr !== undefined ? enabledStr === "true" : undefined;
    const rules = goldenRuleSvc.listRules(id, { category, severity, enabled });
    const activeCount = goldenRuleSvc.getActiveRuleCount(id);
    res.json({ rules, activeCount, totalCount: rules.length });
  }));

  app.post("/api/codascope/projects/:id/golden-rules", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices();
    const id = param(req, "id");
    const { name, description, category, severity, appliesTo, codePatterns } = req.body as {
      name?: string; description?: string; category?: string;
      severity?: string; appliesTo?: string[]; codePatterns?: string[];
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    if (!category) throw httpError("category is required.", 400, "invalid_input");
    if (!severity) throw httpError("severity is required.", 400, "invalid_input");

    const rule = goldenRuleSvc.createRule(id, {
      name: name.trim(),
      description: description?.trim() ?? "",
      category: category as any,
      severity: severity as any,
      appliesTo: appliesTo as any,
      codePatterns: codePatterns ?? [],
    });
    res.status(201).json({ rule });
  }));

  app.put("/api/codascope/projects/:id/golden-rules/:ruleId", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices();
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const { name, description, category, severity, appliesTo, codePatterns } = req.body;
    const rule = goldenRuleSvc.updateRule(id, ruleId, {
      name, description, category, severity, appliesTo, codePatterns,
    });
    if (!rule) throw httpError("Rule not found.", 404, "not_found");
    res.json({ rule });
  }));

  app.delete("/api/codascope/projects/:id/golden-rules/:ruleId", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices();
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const deleted = goldenRuleSvc.deleteRule(id, ruleId);
    if (!deleted) throw httpError("Rule not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  app.patch("/api/codascope/projects/:id/golden-rules/:ruleId/toggle", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices();
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const rule = goldenRuleSvc.toggleRule(id, ruleId);
    if (!rule) throw httpError("Rule not found.", 404, "not_found");
    res.json({ rule });
  }));

  // ── Quality ───────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/quality/latest", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices();
    const id = param(req, "id");
    const summary = qualitySvc.getLatestSummary(id);
    res.json({ report: summary });
  }));

  app.get("/api/codascope/projects/:id/quality/scans", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices();
    const id = param(req, "id");
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const scans = qualitySvc.listScans(id, limit);
    res.json({ scans });
  }));

  app.get("/api/codascope/projects/:id/quality/scans/:scanId", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices();
    const id = param(req, "id");
    const scanId = param(req, "scanId");
    const report = qualitySvc.getScanReport(id, scanId);
    if (!report) throw httpError("Scan not found.", 404, "not_found");
    res.json({ report });
  }));

  app.get("/api/codascope/projects/:id/quality/scans/:scanId/categories/:category", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices();
    const id = param(req, "id");
    const scanId = param(req, "scanId");
    const category = param(req, "category");
    const categoryData = qualitySvc.getCategoryIssues(id, scanId, category);
    if (!categoryData) throw httpError("Category not found.", 404, "not_found");
    res.json({ category: categoryData });
  }));

  app.get("/api/codascope/projects/:id/quality/trends", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices();
    const id = param(req, "id");
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const trends = qualitySvc.getTrends(id, limit);
    res.json({ trends });
  }));
}
