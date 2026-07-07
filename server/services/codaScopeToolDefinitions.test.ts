/* ── CodaScope: Tool Definitions Tests ───────────────────────────────
   Unit tests for getToolsForPurpose — validates that each agent
   purpose receives the correct combination of read-only, epic, and
   write tool tiers.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import {
  buildReadOnlyTools,
  buildEpicTools,
  buildWriteTools,
  buildArtifactTools,
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
    expect(keys.length).toBeGreaterThanOrEqual(1);
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
});

/* ── getToolsForPurpose ──────────────────────────────────────────── */

describe("getToolsForPurpose", () => {
  const readTools = buildReadOnlyTools(PROJECT_ID, services);
  const epicTools = buildEpicTools(PROJECT_ID, services);
  const writeTools = buildWriteTools(PROJECT_ID, services);
  const artifactTools = buildArtifactTools(PROJECT_ID, services);
  const readCount = Object.keys(readTools).length;
  const epicCount = Object.keys(epicTools).length;
  const writeCount = Object.keys(writeTools).length;
  const artifactCount = Object.keys(artifactTools).length;
  const allCount = readCount + epicCount + writeCount + artifactCount;

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

  it("unknown purpose falls through to ALL tools (same as assistant)", () => {
    const tools = getToolsForPurpose(PROJECT_ID, PROJECTS_ROOT, "unknown-purpose");
    expect(Object.keys(tools).length).toBe(allCount);
  });

  it("tool count sanity check — each tier is meaningful", () => {
    expect(readCount).toBeGreaterThanOrEqual(13);
    expect(epicCount).toBeGreaterThanOrEqual(15);
    expect(writeCount).toBeGreaterThanOrEqual(1);
    expect(artifactCount).toBeGreaterThanOrEqual(3);
    expect(allCount).toBeGreaterThanOrEqual(34);
  });
});
