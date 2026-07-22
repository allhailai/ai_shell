import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeAnnotationService } from "./codaScopeAnnotationService.js";
import { CodaScopeArtifactService } from "./codaScopeArtifactService.js";
import { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import { CodaScopeArtifactVersionService } from "./codaScopeArtifactVersionService.js";
import { CodaScopeLockService } from "./codaScopeLockService.js";
import { CodaScopeEpicRenderService } from "./codaScopeEpicRenderService.js";
import { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { CodaScopeChatService } from "./codaScopeChatService.js";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";

const roots: string[] = [];
const hostileIds = [
  "",
  ".",
  "..",
  "../..",
  "a/b",
  "a\\b",
  "/absolute/path",
  "C:\\absolute\\path",
  "nul\0byte",
  "a%2fb",
  "a%252fb",
];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-path-boundary-test-"));
  roots.push(root);
  return root;
}

function writeText(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

function fixture() {
  const root = tempRoot();
  const projectsRoot = path.join(root, "projects");
  const projectDir = path.join(projectsRoot, "primary-project");
  const neighborDir = path.join(projectsRoot, "neighbor-project");
  const epicId = "epic-valid_uuid_123";
  const epicDir = path.join(projectDir, "epics", epicId);
  const archivedEpicDir = path.join(projectDir, "epics", "_archive", "archived-valid_id");

  writeText(path.join(projectsRoot, "projects-root.sentinel"), "projects-root-sentinel");
  writeText(path.join(projectDir, "project.sentinel"), "project-sentinel");
  writeText(path.join(projectDir, "project.json"), JSON.stringify({ id: "project-id", name: "Primary" }));
  writeText(path.join(neighborDir, "neighbor.sentinel"), "neighbor-sentinel");
  writeText(path.join(neighborDir, "project.json"), JSON.stringify({ id: "neighbor-id", name: "Neighbor" }));
  writeText(path.join(epicDir, "epic.json"), JSON.stringify({
    id: epicId,
    projectId: "project-id",
    title: "Legitimate epic",
    status: "defining",
    collaborators: [],
  }));
  writeText(path.join(epicDir, "definition.md"), "legitimate-epic-content");
  writeText(path.join(archivedEpicDir, "epic.json"), JSON.stringify({
    id: "archived-valid_id",
    projectId: "project-id",
    title: "Archived epic",
    status: "archived",
    collaborators: [],
  }));

  return { projectsRoot, projectDir, neighborDir, epicId, epicDir, archivedEpicDir };
}

function expectInvalidInput(promise: Promise<unknown>): Promise<void> {
  return expect(promise).rejects.toMatchObject({ status: 400, code: "invalid_input" }) as Promise<void>;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScope service filesystem boundaries", () => {
  it.each(hostileIds)("rejects destructive epic ID %j without changing any sentinel", async (hostileId) => {
    const f = fixture();
    const service = new CodaScopeEpicService(f.projectsRoot);
    const beforeEntries = readdirSync(f.projectsRoot).sort();

    await expectInvalidInput(service.deleteEpic("project-id", hostileId));
    await expectInvalidInput(service.archiveEpic("project-id", hostileId));
    await expectInvalidInput(service.restoreEpic("project-id", hostileId));
    await expectInvalidInput(service.updateDefinition("project-id", hostileId, "attacker write"));

    expect(readFileSync(path.join(f.projectsRoot, "projects-root.sentinel"), "utf-8")).toBe("projects-root-sentinel");
    expect(readFileSync(path.join(f.projectDir, "project.sentinel"), "utf-8")).toBe("project-sentinel");
    expect(readFileSync(path.join(f.neighborDir, "neighbor.sentinel"), "utf-8")).toBe("neighbor-sentinel");
    expect(readFileSync(path.join(f.epicDir, "definition.md"), "utf-8")).toBe("legitimate-epic-content");
    expect(existsSync(f.archivedEpicDir)).toBe(true);
    expect(readdirSync(f.projectsRoot).sort()).toEqual(beforeEntries);
  });

  it("propagates typed validation errors through adjacent filesystem services", async () => {
    const f = fixture();
    const design = new CodaScopeDesignDocService(f.projectsRoot);
    const annotations = new CodaScopeAnnotationService(f.projectsRoot);
    const artifacts = new CodaScopeArtifactService(f.projectsRoot);
    const knowledge = new CodaScopeEpicKnowledgeService(f.projectsRoot);
    const artifactVersions = new CodaScopeArtifactVersionService(f.projectsRoot);
    const locks = new CodaScopeLockService(f.projectsRoot);
    const renderer = new CodaScopeEpicRenderService(f.projectsRoot);
    const curation = new CodaScopeCurationService(f.projectsRoot);
    const notes = new CodaScopeNoteService(f.projectsRoot);

    await expectInvalidInput(design.getDesignDoc("project-id", f.epicId, "../doc"));
    await expectInvalidInput(annotations.listAnnotations("project-id", f.epicId, "../doc"));
    await expectInvalidInput(artifacts.deleteArtifact("project-id", f.epicId, "../artifact"));
    await expectInvalidInput(knowledge.deleteSource("project-id", f.epicId, "../source"));
    await expectInvalidInput(artifactVersions.revertToVersion("project-id", f.epicId, "artifact", "../version"));
    await expectInvalidInput(locks.getLockStatus("project-id", "../epic"));
    await expectInvalidInput(renderer.getRenderedHtml("project-id", f.epicId, "../doc"));
    await expectInvalidInput(curation.getLog("project-id", f.epicId, "../curation"));
    await expectInvalidInput(notes.restoreNote("codascope", "shared", {}, "../note"));

    expect(readFileSync(path.join(f.projectsRoot, "projects-root.sentinel"), "utf-8")).toBe("projects-root-sentinel");
    expect(readFileSync(path.join(f.projectDir, "project.sentinel"), "utf-8")).toBe("project-sentinel");
    expect(readFileSync(path.join(f.neighborDir, "neighbor.sentinel"), "utf-8")).toBe("neighbor-sentinel");
    expect(readFileSync(path.join(f.epicDir, "definition.md"), "utf-8")).toBe("legitimate-epic-content");
  });

  it("rejects a hostile persisted conversation file before reading or deleting outside storage", async () => {
    const f = fixture();
    const sentinel = path.join(f.projectsRoot, "conversation-sentinel.json");
    writeText(sentinel, "conversation-sentinel");
    writeText(path.join(f.projectDir, "conversations", "conversations.json"), JSON.stringify({
      version: 2,
      conversations: [{
        id: "conv_safe",
        file: "conversations/../../conversation-sentinel.json",
        ownerId: "alice",
        title: "Hostile metadata",
        summary: "",
        modelId: null,
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:00Z",
        messageCount: 0,
      }],
    }));
    const chat = new CodaScopeChatService(f.projectsRoot);

    await expectInvalidInput(chat.readConversation("project-id", "conv_safe", "alice"));
    await expectInvalidInput(chat.deleteConversation("project-id", "conv_safe", "alice"));
    expect(readFileSync(sentinel, "utf-8")).toBe("conversation-sentinel");
  });

  it.each(["550e8400-e29b-41d4-a716-446655440000", "epic-with-hyphen", "epic_with_underscore"])(
    "continues to read legitimate epic ID %s",
    async (epicId) => {
      const f = fixture();
      writeText(path.join(f.projectDir, "epics", epicId, "definition.md"), epicId);
      const service = new CodaScopeEpicService(f.projectsRoot);
      await expect(service.getDefinition("project-id", epicId)).resolves.toBe(epicId);
    },
  );
});
