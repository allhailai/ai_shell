/* ── CodaScope: Tool Definitions Tests ───────────────────────────────
   Unit tests for getToolsForPurpose — validates that each agent
   purpose receives the correct combination of read-only, epic, and
   write tool tiers.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildReadOnlyTools,
  buildEpicTools,
  buildWriteTools,
  buildArtifactTools,
  buildNoteReadTools,
  buildNoteWriteTools,
  getToolsForPurpose,
  type AgentPurpose,
} from "./codaScopeToolDefinitions.js";
import { createToolServices } from "./codaScopeToolServiceFactory.js";

/* ── Dummy values — tools aren't executed, just collected ────────── */

const PROJECT_ID = "test-project";
const PROJECTS_ROOT = "/tmp/nonexistent-projects-root";
const services = createToolServices(PROJECTS_ROOT);

/* ── Tier counts ─────────────────────────────────────────────────── */

describe("tool tier builders", () => {
  it("buildReadOnlyTools returns non-empty tool set", () => {
    const tools = buildReadOnlyTools(PROJECT_ID, services);
    const keys = Object.keys(tools);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    // Verify some known read-only tools are present
    expect(keys).toContain("list_wiki_topics");
    expect(keys).toContain("read_wiki_topic");
    expect(keys).toContain("search_wiki");
    expect(keys).toContain("list_repositories");
    expect(keys).toContain("read_code_map");
    expect(keys).toContain("read_build_status");
    expect(keys).toContain("list_epic_designs");
    expect(keys).toContain("read_epic_definition");
    expect(keys).toContain("read_epic_scope");
    expect(keys).toContain("list_design_docs");
    expect(keys).toContain("read_design_doc");
    expect(keys).toContain("list_annotations");
    expect(keys).toContain("read_annotation_thread");
  });

  it("buildEpicTools returns non-empty tool set", () => {
    const tools = buildEpicTools(PROJECT_ID, services);
    const keys = Object.keys(tools);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    // Verify some known epic tools are present
    expect(keys).toContain("write_wiki_topic");
    expect(keys).toContain("add_scope_entry");
    expect(keys).toContain("create_design_doc");
    expect(keys).toContain("edit_design_doc");
    expect(keys).toContain("edit_design_doc_section");
    expect(keys).toContain("create_annotation");
    expect(keys).toContain("search_web");
  });

  it("buildWriteTools returns non-empty tool set", () => {
    const tools = buildWriteTools(PROJECT_ID, services);
    const keys = Object.keys(tools);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(keys).toContain("write_code_map");
    expect(keys).toContain("write_project_wiki_topic");
    expect(keys).toContain("update_code_map_section");
  });

  it("buildArtifactTools returns non-empty tool set", () => {
    const tools = buildArtifactTools(PROJECT_ID, services);
    const keys = Object.keys(tools);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(keys).toContain("write_artifact_html");
    expect(keys).toContain("read_artifact_html");
    expect(keys).toContain("read_epic_context");
  });

  it("no tool name collisions between tiers", () => {
    const readKeys = new Set(Object.keys(buildReadOnlyTools(PROJECT_ID, services)));
    const epicKeys = new Set(Object.keys(buildEpicTools(PROJECT_ID, services)));
    const writeKeys = new Set(Object.keys(buildWriteTools(PROJECT_ID, services)));
    const artifactKeys = new Set(Object.keys(buildArtifactTools(PROJECT_ID, services)));

    // No overlap between read and epic
    for (const key of epicKeys) {
      expect(readKeys.has(key)).toBe(false);
    }

    // No overlap between read and write
    for (const key of writeKeys) {
      expect(readKeys.has(key)).toBe(false);
    }

    // No overlap between epic and write
    for (const key of writeKeys) {
      expect(epicKeys.has(key)).toBe(false);
    }

    // No overlap between artifact and other tiers
    for (const key of artifactKeys) {
      expect(readKeys.has(key)).toBe(false);
      expect(epicKeys.has(key)).toBe(false);
      expect(writeKeys.has(key)).toBe(false);
    }
  });

  it("all tools have description and execute function", () => {
    const allTools = {
      ...buildReadOnlyTools(PROJECT_ID, services),
      ...buildEpicTools(PROJECT_ID, services),
      ...buildWriteTools(PROJECT_ID, services),
      ...buildArtifactTools(PROJECT_ID, services),
    };
    for (const [name, tool] of Object.entries(allTools)) {
      expect(tool.description, `${name} should have a description`).toBeTruthy();
      expect(typeof tool.execute, `${name} should have an execute function`).toBe("function");
    }
  });

  it("registers the exact design-document creation inputs", async () => {
    const createDesignDoc = vi.fn(async (_projectId, epicId, input) => ({
      id: "doc-created",
      epicId,
      title: input.title,
      wordCount: input.content.split(/\s+/).length,
    }));
    const contractServices = {
      ...services,
      designDoc: { createDesignDoc },
    };
    const tool = buildEpicTools(PROJECT_ID, contractServices as any).create_design_doc;
    const schema = tool.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(schema.properties).sort()).toEqual(["content", "epicId", "title"]);
    expect([...schema.required].sort()).toEqual(["content", "epicId", "title"]);

    await tool.execute({
      epicId: "epic-1",
      title: "Scheduling Design",
      content: "# Scheduling Design\n\nComplete context-grounded content.",
      template: "api-spec",
    }, {} as any);

    expect(createDesignDoc).toHaveBeenCalledWith(PROJECT_ID, "epic-1", {
      title: "Scheduling Design",
      content: "# Scheduling Design\n\nComplete context-grounded content.",
      createdBy: "agent",
    });
  });

  it("does not expose legacy template metadata as an agent capability", async () => {
    const legacyDoc = {
      id: "doc-legacy",
      epicId: "epic-1",
      title: "Imported Design",
      template: "api-spec",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      createdBy: "legacy-import",
      wordCount: 3,
      blockCount: 1,
      annotationCount: 0,
      directiveCount: 0,
    };
    const contractServices = {
      ...services,
      designDoc: {
        listDesignDocs: vi.fn(async () => [legacyDoc]),
        getDesignDoc: vi.fn(async () => ({
          doc: legacyDoc,
          content: "# Imported Design\n\nLegacy content.",
          contentHash: "hash",
        })),
      },
    };
    const tools = buildReadOnlyTools(PROJECT_ID, contractServices as any);

    expect(tools.list_design_docs.description).not.toMatch(/template/i);
    const listed = String(await tools.list_design_docs.execute({ epicId: "epic-1" }, {} as any));
    const read = String(await tools.read_design_doc.execute({ epicId: "epic-1", docId: "doc-legacy" }, {} as any));
    expect(listed).not.toContain("api-spec");
    expect(listed).not.toMatch(/template/i);
    expect(read).not.toContain("api-spec");
    expect(read).not.toMatch(/template/i);
    expect(read).toContain("Legacy content.");
  });

  it("fails agent annotation creation closed without an actor and records actor provenance when present", async () => {
    const createAnnotation = vi.fn(async () => ({ id: "ann-agent" }));
    const actorServices = {
      ...services,
      epic: { ...services.epic, getDefinition: vi.fn(async () => "# Heading\n\nTarget") },
      annotation: {
        ...services.annotation,
        computeBlockIds: vi.fn(() => [{ blockId: "block", sectionSlug: "heading", lineStart: 3, lineEnd: 3, content: "Target" }]),
        createAnnotation,
      },
    };
    const args = { epicId: "epic", documentId: "definition", blockId: "block", body: "Agent review" };

    const unowned = await buildEpicTools(PROJECT_ID, actorServices as any).create_annotation.execute(args, {} as any);
    expect(unowned).toContain("authenticated initiating actor is required");
    expect(createAnnotation).not.toHaveBeenCalled();

    await buildEpicTools(PROJECT_ID, actorServices as any, undefined, "alice").create_annotation.execute(args, {} as any);
    expect(createAnnotation).toHaveBeenCalledWith(
      PROJECT_ID,
      "epic",
      "definition",
      { username: "alice", origin: "agent" },
      expect.objectContaining({ body: "Agent review" }),
    );
  });

  it("creates actor-owned agent annotations through assistant, chat, research, and curation assemblies", async () => {
    const root = path.join(os.tmpdir(), `codascope-annotation-tools-${crypto.randomBytes(6).toString("hex")}`);
    const projectId = "project";
    const epicId = "epic";
    const projectDir = path.join(root, "project-dir");
    const epicDir = path.join(projectDir, "epics", epicId);
    mkdirSync(path.join(epicDir, "annotations"), { recursive: true });
    const now = "2026-01-01T00:00:00.000Z";
    const epic = {
      id: epicId,
      projectId,
      title: "Epic",
      status: "designing",
      createdAt: now,
      updatedAt: now,
      createdBy: "alice",
      collaborators: ["alice"],
      currentVersion: 0,
    };
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: projectId,
      name: "Project",
      description: "",
      repositories: [],
      createdAt: now,
      updatedAt: now,
    }), "utf-8");
    writeFileSync(path.join(projectDir, "epics", "epics.json"), JSON.stringify({ epics: [epic] }), "utf-8");
    writeFileSync(path.join(epicDir, "epic.json"), JSON.stringify({ ...epic, conversationId: null }), "utf-8");
    const definition = "# Heading\n\nTarget paragraph.";
    writeFileSync(path.join(epicDir, "definition.md"), definition, "utf-8");

    try {
      const blockId = createToolServices(root).annotation.computeBlockIds(definition)
        .find((block) => block.content === "Target paragraph.")!.blockId;
      for (const purpose of ["assistant", "chat", "research", "curation"] as const) {
        const tools = getToolsForPurpose(projectId, root, purpose, undefined, "alice");
        const result = await tools.create_annotation.execute({
          epicId,
          documentId: "definition",
          blockId,
          body: `${purpose} annotation`,
        }, {} as any);
        expect(result).toContain("Annotation created");
      }

      const stored = JSON.parse(readFileSync(
        path.join(epicDir, "annotations", "definition-annotations.json"),
        "utf-8",
      ));
      expect(stored.annotations).toHaveLength(4);
      expect(stored.annotations.every((annotation: { author: string; origin: string }) =>
        annotation.author === "alice" && annotation.origin === "agent")).toBe(true);

      for (const purpose of ["assistant", "chat", "research", "curation"] as const) {
        const tools = getToolsForPurpose(projectId, root, purpose);
        await expect(tools.create_annotation.execute({
          epicId,
          documentId: "definition",
          blockId,
          body: "Unowned",
        }, {} as any)).resolves.toContain("authenticated initiating actor is required");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reconciles annotation read tools with current content and returns nested descendants", async () => {
    const base = {
      epicId: "epic",
      documentId: "design",
      documentVersion: 0,
      anchor: { blockId: "block", sectionSlug: "root", anchorText: "Target", lineNumber: 1 },
      author: "alice",
      origin: "user" as const,
      ownership: "owned" as const,
      status: "open" as const,
      reactions: [],
      attachmentState: "attached" as const,
    };
    const annotations = [
      { ...base, id: "root", createdAt: "2026-01-01T00:00:00.000Z", body: "Root" },
      { ...base, id: "reply", parentId: "root", createdAt: "2026-01-01T00:01:00.000Z", body: "Reply" },
      { ...base, id: "grandchild", parentId: "reply", createdAt: "2026-01-01T00:02:00.000Z", body: "Grandchild" },
    ];
    const listAnnotations = vi.fn(async () => annotations);
    const readServices = {
      ...services,
      epic: { ...services.epic, getDefinition: vi.fn(async () => "# Definition") },
      designDoc: {
        ...services.designDoc,
        getDesignDoc: vi.fn(async () => ({ content: "# Design", contentHash: "hash", doc: {} })),
      },
      annotation: { ...services.annotation, listAnnotations },
    };
    const tools = buildReadOnlyTools(PROJECT_ID, readServices as any);

    await tools.list_annotations.execute({ epicId: "epic", documentId: "definition" }, {} as any);
    const threadResult = await tools.read_annotation_thread.execute({
      epicId: "epic",
      documentId: "design",
      annotationId: "root",
    }, {} as any);

    expect(listAnnotations).toHaveBeenNthCalledWith(1, PROJECT_ID, "epic", "definition", "# Definition");
    expect(listAnnotations).toHaveBeenNthCalledWith(2, PROJECT_ID, "epic", "design", "# Design");
    expect(JSON.parse(String(threadResult)).thread.map((annotation: { id: string }) => annotation.id))
      .toEqual(["root", "reply", "grandchild"]);
  });

  it("reports an exact legacy anchor as currently attached instead of legacy_unverified", async () => {
    const root = path.join(os.tmpdir(), `codascope-annotation-read-${crypto.randomBytes(6).toString("hex")}`);
    const projectDir = path.join(root, "project-dir");
    const epicDir = path.join(projectDir, "epics", "epic");
    mkdirSync(path.join(epicDir, "annotations"), { recursive: true });
    const now = "2026-01-01T00:00:00.000Z";
    const epic = {
      id: "epic",
      projectId: "project",
      title: "Epic",
      status: "designing",
      createdAt: now,
      updatedAt: now,
      createdBy: "alice",
      collaborators: ["alice"],
      currentVersion: 0,
    };
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: "project", name: "Project", description: "", repositories: [], createdAt: now, updatedAt: now,
    }), "utf-8");
    writeFileSync(path.join(projectDir, "epics", "epics.json"), JSON.stringify({ epics: [epic] }), "utf-8");
    writeFileSync(path.join(epicDir, "epic.json"), JSON.stringify({ ...epic, conversationId: null }), "utf-8");
    const definition = "# Heading\n\nTarget paragraph.";
    writeFileSync(path.join(epicDir, "definition.md"), definition, "utf-8");
    const annotationService = createToolServices(root).annotation;
    const target = annotationService.computeBlockIds(definition).find((block) => block.content === "Target paragraph.")!;
    writeFileSync(path.join(epicDir, "annotations", "definition-annotations.json"), JSON.stringify({
      annotations: [{
        id: "legacy",
        epicId: "epic",
        documentId: "definition",
        documentVersion: 0,
        anchor: { blockId: target.blockId, sectionSlug: target.sectionSlug, anchorText: target.content, lineNumber: target.lineStart },
        author: "alice",
        createdAt: now,
        body: "Legacy",
        status: "open",
        reactions: [],
      }],
    }), "utf-8");

    try {
      const result = await getToolsForPurpose("project", root, "artifact-build")
        .list_annotations.execute({ epicId: "epic", documentId: "definition" }, {} as any);
      expect(JSON.parse(String(result))[0]).toMatchObject({ id: "legacy", attachmentState: "attached" });
      expect(JSON.parse(readFileSync(
        path.join(epicDir, "annotations", "definition-annotations.json"),
        "utf-8",
      ))).toMatchObject({ version: 2, annotations: [{ attachmentState: "attached" }] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ── getToolsForPurpose ──────────────────────────────────────────── */

describe("getToolsForPurpose", () => {
  const readTools = buildReadOnlyTools(PROJECT_ID, services);
  const epicTools = buildEpicTools(PROJECT_ID, services);
  const writeTools = buildWriteTools(PROJECT_ID, services);
  const artifactTools = buildArtifactTools(PROJECT_ID, services);
  const noteReadTools = buildNoteReadTools(PROJECT_ID, services);
  const noteWriteTools = buildNoteWriteTools(PROJECT_ID, services);
  const readCount = Object.keys(readTools).length + Object.keys(noteReadTools).length;
  const epicCount = Object.keys(epicTools).length;
  const writeCount = Object.keys(writeTools).length;
  const artifactCount = Object.keys(artifactTools).length;
  const allCount = readCount + epicCount + writeCount + artifactCount + Object.keys(noteWriteTools).length;

  it("'assistant' gets ALL tools (read + epic + write + artifact)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "assistant");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(allCount);

    // Verify has read tools
    expect(keys).toContain("list_wiki_topics");
    expect(keys).toContain("read_code_map");

    // Verify has epic tools
    expect(keys).toContain("create_design_doc");
    expect(keys).toContain("edit_design_doc");

    // Verify has write tools
    expect(keys).toContain("update_code_map_section");

    // Verify has artifact tools
    expect(keys).toContain("write_artifact_html");
    expect(keys).toContain("read_epic_context");
  });

  it("'chat' gets ALL tools (read + epic + write + artifact)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "chat");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(allCount);
    expect(keys).toContain("list_wiki_topics");
    expect(keys).toContain("create_design_doc");
    expect(keys).toContain("update_code_map_section");
    expect(keys).toContain("write_artifact_html");
  });

  it("'wiki-build' gets read + write (no epic or artifact tools)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "wiki-build");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(readCount + writeCount);

    // Has read tools
    expect(keys).toContain("list_wiki_topics");
    expect(keys).toContain("read_code_map");

    // Has write tools
    expect(keys).toContain("update_code_map_section");

    // Does NOT have epic tools
    expect(keys).not.toContain("create_design_doc");
    expect(keys).not.toContain("edit_design_doc");
    expect(keys).not.toContain("add_scope_entry");

    // Does NOT have artifact tools
    expect(keys).not.toContain("write_artifact_html");
  });

  it("'curation' gets read + epic (no write or artifact tools)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "curation");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(readCount + epicCount);

    // Has read tools
    expect(keys).toContain("list_wiki_topics");
    expect(keys).toContain("read_code_map");

    // Has epic tools
    expect(keys).toContain("create_design_doc");
    expect(keys).toContain("add_scope_entry");
    expect(keys).toContain("create_annotation");

    // Does NOT have write tools
    expect(keys).not.toContain("update_code_map_section");

    // Does NOT have artifact tools
    expect(keys).not.toContain("write_artifact_html");
  });

  it("'research' gets read + epic (no write or artifact tools)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "research");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(readCount + epicCount);

    // Has read tools
    expect(keys).toContain("list_wiki_topics");

    // Has epic tools
    expect(keys).toContain("search_web");
    expect(keys).toContain("create_design_doc");

    // Does NOT have write tools
    expect(keys).not.toContain("update_code_map_section");

    // Does NOT have artifact tools
    expect(keys).not.toContain("write_artifact_html");
  });

  it("'artifact-build' gets read + artifact (no epic or write tools)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "artifact-build");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(readCount + artifactCount);

    // Has read tools
    expect(keys).toContain("list_wiki_topics");

    // Has artifact tools
    expect(keys).toContain("write_artifact_html");
    expect(keys).toContain("read_artifact_html");
    expect(keys).toContain("read_epic_context");

    // Does NOT have epic tools
    expect(keys).not.toContain("create_design_doc");

    // Does NOT have write tools
    expect(keys).not.toContain("update_code_map_section");
  });

  it("'artifact-section-regen' gets read + artifact (no epic or write tools)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "artifact-section-regen");
    const keys = Object.keys(tools);

    expect(keys.length).toBe(readCount + artifactCount);
    expect(keys).toContain("write_artifact_html");
    expect(keys).toContain("read_epic_context");
    expect(keys).not.toContain("create_design_doc");
  });

  it("rejects an unknown purpose instead of granting the full tool set", () => {
    expect(() => getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "unknown-purpose"))
      .toThrow("Unknown CodaScope agent purpose");
  });

  it("tool count sanity check — each tier is meaningful", () => {
    expect(readCount).toBeGreaterThanOrEqual(15);
    expect(epicCount).toBeGreaterThanOrEqual(15);
    expect(writeCount).toBeGreaterThanOrEqual(3);
    expect(artifactCount).toBeGreaterThanOrEqual(3);
    expect(allCount).toBeGreaterThanOrEqual(34);
  });

  it("wiki-build tools write only to the CodaScope project and scope source reads to configured repositories", async () => {
    const root = path.join(os.tmpdir(), `codascope-tools-${crypto.randomBytes(6).toString("hex")}`);
    const projectDir = path.join(root, "core-project");
    const repoDir = path.join(root, "source-repo");
    const projectId = "project-core";
    mkdirSync(path.join(projectDir, "wiki"), { recursive: true });
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeFileSync(path.join(repoDir, "src", "entry.ts"), "export const answer = 42;\n");
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: projectId,
      name: "Core",
      description: "",
      repositories: [{ id: "repo-core", name: "core", path: repoDir }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));

    try {
      const tools = getToolsForPurpose(projectId, root, "wiki-build");
      await tools.write_code_map.execute({ repoName: "core", content: "# Code Map: Core\n" }, {} as any);
      await tools.write_project_wiki_topic.execute({ topicId: "architecture", content: "# Architecture\n" }, {} as any);
      const invalidWrite = await tools.write_project_wiki_topic.execute({ topicId: "../escape", content: "# Escape\n" }, {} as any);

      expect(readFileSync(path.join(projectDir, "code_map_core.md"), "utf-8")).toContain("Code Map: Core");
      expect(readFileSync(path.join(projectDir, "wiki", "architecture.md"), "utf-8")).toContain("Architecture");
      expect(invalidWrite).toContain("Invalid wiki topic ID");
      expect(existsSync(path.join(projectDir, "escape.md"))).toBe(false);
      expect(await tools.read_source_file.execute({ repoName: "core", relativePath: "src/entry.ts" }, {} as any))
        .toContain("answer = 42");
      expect(await tools.read_source_file.execute({ repoName: "core", relativePath: "../core-project/project.json" }, {} as any))
        .toContain("must remain within the configured repository");
      const listedRepositories = await tools.list_repositories.execute({}, {} as any);
      if (typeof listedRepositories !== "string") throw new Error("Expected repository list text.");
      expect(JSON.parse(listedRepositories)).toEqual([{ id: "repo-core", name: "core" }]);
      expect(listedRepositories).not.toContain(repoDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tool calls cannot bypass service-boundary path validation", async () => {
    const root = path.join(os.tmpdir(), `codascope-hostile-tools-${crypto.randomBytes(6).toString("hex")}`);
    const projectDir = path.join(root, "project");
    const projectId = "project-tools";
    mkdirSync(path.join(projectDir, "epics", "epic-safe"), { recursive: true });
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: projectId,
      name: "Tool Boundary",
      description: "",
      repositories: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    writeFileSync(path.join(root, "root.sentinel"), "root-sentinel");
    writeFileSync(path.join(projectDir, "project.sentinel"), "project-sentinel");

    try {
      const tools = getToolsForPurpose(projectId, root, "assistant");
      const designResult = await tools.create_design_doc.execute({
        epicId: "../..",
        title: "Escaped design",
        content: "attacker content",
      }, {} as any);
      const wikiResult = await tools.write_epic_wiki_page.execute({
        epicId: "epic-safe",
        pageId: "../escape",
        title: "Escaped wiki",
        content: "attacker content",
      }, {} as any);

      expect(designResult).toContain("Invalid epic ID");
      expect(wikiResult).toContain("Invalid wiki page ID");
      expect(readFileSync(path.join(root, "root.sentinel"), "utf-8")).toBe("root-sentinel");
      expect(readFileSync(path.join(projectDir, "project.sentinel"), "utf-8")).toBe("project-sentinel");
      expect(existsSync(path.join(root, "designs"))).toBe(false);
      expect(existsSync(path.join(projectDir, "escape.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
