import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CodaScopeAgentService,
  assertAgentPurposeScope,
  createAgentWithSandboxFallback,
  getAgentName,
  getAgentLocalWorkspace,
  isLocalSandboxUnsupportedError,
  startRunWithSandboxFallback,
} from "./codaScopeAgentService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteDocumentService } from "./codaScopeNoteDocumentService.js";
import {
  getToolsForPurpose,
  ToolResultCollectorHolder,
} from "./codaScopeToolDefinitions.js";
import {
  EMPTY_WORKSPACE_TURN_READ_GRANT,
  WorkspaceTurnReadGrantHolder,
} from "./codaScopeWorkspaceReadGrant.js";
import { getWorkspaceTools } from "./codaScopeWorkspaceToolDefinitions.js";
import { WorkspaceTurnNoteGrantHolder } from "./codaScopeWorkspaceNoteGrant.js";
import { WorkspaceProvenanceCollectorHolder } from "./codaScopeWorkspaceProvenance.js";
import { WorkspaceMutationActionCollectorHolder } from "./codaScopeWorkspaceMutationActions.js";

function tmpDir(): string {
  const root = path.join(os.tmpdir(), `agent-actor-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("CodaScopeAgentService actor isolation", () => {
  it("sandboxes wiki builds in the CodaScope project instead of a source repository", () => {
    expect(getAgentLocalWorkspace({
      scope: { kind: "project", projectId: "core" },
      purpose: "wiki-build",
      projectDir: "/data/projects/core",
      repoPaths: ["/repos/core"],
    })).toEqual({
      cwd: "/data/projects/core",
      sandboxOptions: { enabled: true },
    });
    expect(getAgentLocalWorkspace({
      scope: { kind: "project", projectId: "core" },
      purpose: "chat",
      projectDir: "/data/projects/core",
      repoPaths: ["/repos/core"],
    })).toEqual({
      cwd: ["/repos/core"],
    });
    expect(() => getAgentLocalWorkspace({
      scope: { kind: "project", projectId: "core" },
      purpose: "wiki-build",
      projectDir: null,
      repoPaths: ["/repos/core"],
    }))
      .toThrow("CodaScope project directory not found for wiki build.");
    expect(getAgentLocalWorkspace({
      scope: { kind: "workspace" },
      purpose: "workspace-assistant",
      projectDir: "/data/projects/core",
      repoPaths: ["/repos/core"],
    })).toEqual({});
    expect(getAgentName({
      scope: { kind: "workspace" },
      purpose: "workspace-assistant",
      projectName: "/private/repository",
    })).toBe("CodaScope Workspace Assistant");
  });

  it("recognizes only the SDK's unsupported-sandbox error for wiki fallback", () => {
    expect(isLocalSandboxUnsupportedError(new Error(
      "Local SDK sandboxing was requested, but sandboxing is not supported in this environment. Disable local.sandboxOptions.enabled.",
    ))).toBe(true);
    expect(isLocalSandboxUnsupportedError(new Error("sandbox denied by policy"))).toBe(false);
  });

  it("retries wiki-build creation with sandboxing explicitly disabled only on an unsupported host", async () => {
    const workspace = getAgentLocalWorkspace({
      scope: { kind: "project", projectId: "core" },
      purpose: "wiki-build",
      projectDir: "/data/projects/core",
      repoPaths: ["/repos/core"],
    });
    const created = { id: "agent" };
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("Local SDK sandboxing was requested, but sandboxing is not supported in this environment."))
      .mockResolvedValueOnce(created);

    await expect(createAgentWithSandboxFallback("wiki-build", workspace, create)).resolves.toBe(created);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toEqual({
      cwd: "/data/projects/core",
      sandboxOptions: { enabled: true },
    });
    expect(create.mock.calls[1][0]).toEqual({
      cwd: "/data/projects/core",
      sandboxOptions: { enabled: false },
    });
  });

  it("does not disable sandboxing for unrelated creation errors or purposes", async () => {
    const workspace = getAgentLocalWorkspace({
      scope: { kind: "project", projectId: "core" },
      purpose: "wiki-build",
      projectDir: "/data/projects/core",
      repoPaths: ["/repos/core"],
    });
    const genericFailure = vi.fn().mockRejectedValue(new Error("network unavailable"));
    await expect(createAgentWithSandboxFallback("wiki-build", workspace, genericFailure)).rejects.toThrow("network unavailable");
    expect(genericFailure).toHaveBeenCalledTimes(1);

    const nonWikiFailure = vi.fn().mockRejectedValue(new Error(
      "Local SDK sandboxing was requested, but sandboxing is not supported in this environment.",
    ));
    await expect(createAgentWithSandboxFallback("chat", workspace, nonWikiFailure)).rejects.toThrow("sandboxing is not supported");
    expect(nonWikiFailure).toHaveBeenCalledTimes(1);
  });

  it("retries wiki-build run start with a fresh no-sandbox agent", async () => {
    const sandboxedAgent = { id: "sandboxed" };
    const fallbackAgent = { id: "fallback" };
    const start = vi.fn()
      .mockRejectedValueOnce(new Error(
        "Local SDK sandboxing was requested, but sandboxing is not supported in this environment.",
      ))
      .mockResolvedValueOnce("run");
    const createFallbackAgent = vi.fn().mockResolvedValue(fallbackAgent);

    await expect(startRunWithSandboxFallback(
      "wiki-build",
      sandboxedAgent,
      start,
      createFallbackAgent,
    )).resolves.toEqual({ agent: fallbackAgent, run: "run" });

    expect(start.mock.calls.map(([agent]) => agent)).toEqual([sandboxedAgent, fallbackAgent]);
    expect(createFallbackAgent).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-wiki or unrelated run-start failures", async () => {
    const agent = { id: "agent" };
    const fallback = vi.fn().mockResolvedValue({ id: "fallback" });
    const sandboxFailure = vi.fn().mockRejectedValue(new Error(
      "Local SDK sandboxing was requested, but sandboxing is not supported in this environment.",
    ));
    await expect(startRunWithSandboxFallback("chat", agent, sandboxFailure, fallback))
      .rejects.toThrow("sandboxing is not supported");
    expect(fallback).not.toHaveBeenCalled();

    const genericFailure = vi.fn().mockRejectedValue(new Error("network unavailable"));
    await expect(startRunWithSandboxFallback("wiki-build", agent, genericFailure, fallback))
      .rejects.toThrow("network unavailable");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses separate pool boundaries and actor-scoped note-document closures", async () => {
    const root = tmpDir();
    try {
      const service = new CodaScopeAgentService({} as any, root);
      expect((service as any).poolKey(
        { kind: "project", projectId: "project" },
        "assistant",
        "alice",
      )).not.toBe((service as any).poolKey(
        { kind: "project", projectId: "project" },
        "assistant",
        "bob",
      ));

      const noteSvc = new CodaScopeNoteService(root);
      const prefs = new CodaScopeNoteUserPrefsService(root);
      const documents = new CodaScopeNoteDocumentService(noteSvc, prefs);
      await noteSvc.createNote("codascope", "private", { userId: "alice" }, "private.md", "# Private");
      const upload = path.join(root, "secret.txt");
      writeFileSync(upload, "private bytes");
      await documents.createDocument("codascope", "private", { userId: "alice" }, "private.md", {
        temporaryPath: upload,
        originalFilename: "secret.txt",
        declaredMimeType: "text/plain",
      });

      const aliceTools = getToolsForPurpose("project", root, "assistant", undefined, "alice");
      const bobTools = getToolsForPurpose("project", root, "assistant", undefined, "bob");
      const args = { scope: "codascope", visibility: "private", path: "private.md" };
      await expect(aliceTools.list_note_documents.execute(args, {} as any)).resolves.toContain("secret.txt");
      await expect(bobTools.list_note_documents.execute(args, {} as any)).resolves.not.toContain("secret.txt");
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps workspace, project, purpose, and actor identities collision-safe", async () => {
    const root = tmpDir();
    try {
      const service = new CodaScopeAgentService({} as any, root);
      const workspaceAlice = (service as any).poolKey(
        { kind: "workspace" },
        "workspace-assistant",
        "alice",
      );
      const workspaceBob = (service as any).poolKey(
        { kind: "workspace" },
        "workspace-assistant",
        "bob",
      );
      const projectAlice = (service as any).poolKey(
        { kind: "project", projectId: "workspace" },
        "assistant",
        "alice",
      );
      expect(new Set([workspaceAlice, workspaceBob, projectAlice]).size).toBe(3);
      expect(() => assertAgentPurposeScope(
        { kind: "workspace" },
        "assistant",
      )).toThrow("Invalid CodaScope purpose/scope combination");
      expect(() => assertAgentPurposeScope(
        { kind: "project", projectId: "project" },
        "workspace-assistant",
      )).toThrow("Invalid CodaScope purpose/scope combination");
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates workspace cancellation by actor and from project runs", async () => {
    const root = tmpDir();
    try {
      const service = new CodaScopeAgentService({} as any, root);
      const workspaceAlice = (service as any).activeChatKey(
        { kind: "workspace" },
        "alice",
      );
      const workspaceBob = (service as any).activeChatKey(
        { kind: "workspace" },
        "bob",
      );
      const projectAlice = (service as any).activeChatKey(
        { kind: "project", projectId: "project" },
        "alice",
      );
      const aliceController = new AbortController();
      const bobController = new AbortController();
      const projectController = new AbortController();
      (service as any).activeChatControllers.set(workspaceAlice, aliceController);
      (service as any).activeChatControllers.set(workspaceBob, bobController);
      (service as any).activeChatControllers.set(projectAlice, projectController);

      expect(service.cancelAgent({
        scope: { kind: "workspace" },
        actorId: "alice",
      })).toBe(true);
      expect(aliceController.signal.aborted).toBe(true);
      expect(bobController.signal.aborted).toBe(false);
      expect(projectController.signal.aborted).toBe(false);
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("assembles every epic-mutation purpose with the authenticated initiating actor", async () => {
    const root = tmpDir();
    const projectDir = path.join(root, "project-dir");
    mkdirSync(path.join(projectDir, "epics", "epic"), { recursive: true });
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: "project",
      name: "Project",
      repositories: [],
    }));

    try {
      const service = new CodaScopeAgentService({} as any, root);
      for (const purpose of ["assistant", "chat", "research", "curation"] as const) {
        const tools = (service as any).getToolsForPurpose({
          scope: { kind: "project", projectId: "project" },
          purpose,
          collectorHolder: undefined,
          actorId: "alice",
        });
        await tools.create_design_doc.execute({
          epicId: "epic",
          title: `${purpose} design`,
          content: "Authenticated content",
        }, {} as any);
      }

      const docs = await new CodaScopeDesignDocService(root)
        .listDesignDocs("project", "epic");
      expect(docs).toHaveLength(4);
      expect(docs.every((doc) => doc.createdBy === "alice")).toBe(true);
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails every epic-mutation agent purpose before agent creation when the actor is absent", async () => {
    const root = tmpDir();
    try {
      const service = new CodaScopeAgentService({} as any, root);
      const createAgent = vi.spyOn(service as any, "getOrCreateAgent");
      for (const purpose of ["assistant", "chat", "research", "curation"] as const) {
        const onError = vi.fn();
        await service.send({
          scope: { kind: "project", projectId: "project" },
          message: "Run",
          modelId: "model",
          purpose,
          onMessage: vi.fn(),
          onDone: vi.fn(),
          onError,
        });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          message: expect.stringContaining("authenticated initiating actor"),
        }));
      }
      expect(createAgent).not.toHaveBeenCalled();
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails workspace actor and invalid scope/purpose pairs before agent creation", async () => {
    const root = tmpDir();
    try {
      const service = new CodaScopeAgentService({} as any, root, {
        activeResolver: {} as any,
        catalog: {} as any,
        epic: {} as any,
        designDoc: {} as any,
        epicKnowledge: {} as any,
      });
      const createAgent = vi.spyOn(service as any, "getOrCreateAgent");
      const missingActorError = vi.fn();
      await service.send({
        scope: { kind: "workspace" },
        purpose: "workspace-assistant",
        actorId: "",
        message: "Run",
        modelId: "model",
        onMessage: vi.fn(),
        onDone: vi.fn(),
        onError: missingActorError,
      });
      expect(missingActorError).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("authenticated initiating actor"),
      }));

      const invalidPairError = vi.fn();
      await service.send({
        scope: { kind: "workspace" },
        purpose: "assistant",
        actorId: "alice",
        message: "Run",
        modelId: "model",
        onMessage: vi.fn(),
        onDone: vi.fn(),
        onError: invalidPairError,
      } as any);
      expect(invalidPairError).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("Invalid CodaScope purpose/scope combination"),
      }));
      expect(createAgent).not.toHaveBeenCalled();
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces and clears a pooled workspace grant for every run", async () => {
    const root = tmpDir();
    try {
      const activeProject = {
        projectId: "project",
        name: "Project",
        description: "",
        repositories: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        projectDir: path.join(root, "project"),
      };
      const epic = {
        id: "epic",
        projectId: "project",
        title: "Epic",
        status: "designing",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "alice",
        collaborators: ["alice"],
        currentVersion: 0,
      };
      const workspaceServices = {
        activeResolver: {
          resolveActiveProject: vi.fn(async () => activeProject),
          resolveActiveEpic: vi.fn(async () => ({ project: activeProject, epic })),
          resolveActiveDesign: vi.fn(async () => null),
        },
        catalog: {
          sanitizeProjectText: vi.fn(async (
            _projectId: string,
            content: string,
          ) => ({
            content,
            charCount: content.length,
            truncated: false,
          })),
        },
        epic: {
          listEpics: vi.fn(async () => [epic]),
        },
        designDoc: {},
        epicKnowledge: {},
      };
      const service = new CodaScopeAgentService(
        {} as any,
        root,
        workspaceServices as any,
      );
      const holder = new WorkspaceTurnReadGrantHolder();
      const workspaceTools = getWorkspaceTools(workspaceServices as any, holder);
      const observedResults: string[] = [];
      const fakeRun = () => ({
        id: crypto.randomUUID(),
        cancel: vi.fn(async () => undefined),
        wait: vi.fn(async () => ({ status: "completed" })),
      });
      const fakeAgent = {
        agentId: "workspace-agent",
        close: vi.fn(),
        send: vi.fn(async () => {
          observedResults.push(String(await workspaceTools.list_active_epics.execute({
            projectId: "project",
          }, {} as any)));
          return fakeRun();
        }),
      };
      const key = (service as any).poolKey(
        { kind: "workspace" },
        "workspace-assistant",
        "alice",
      );
      (service as any).pool.set(key, {
        agent: fakeAgent,
        scope: { kind: "workspace" },
        purpose: "workspace-assistant",
        actorId: "alice",
        lastUsed: Date.now(),
        busy: false,
        collectorHolder: { current: { drain: () => [] } },
        workspaceGrantHolder: holder,
      });
      (service as any).allAgents.add(fakeAgent);

      const send = (workspaceReadGrant?: any) => service.send({
        scope: { kind: "workspace" },
        purpose: "workspace-assistant",
        actorId: "alice",
        workspaceReadGrant,
        message: "Run",
        modelId: "model",
        onMessage: vi.fn(),
        onDone: vi.fn(),
        onError: (error) => { throw error; },
      });
      await send({
        epicDiscoveryProjectIds: ["project"],
        epicResources: [],
      });
      expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_READ_GRANT);
      await send();
      expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_READ_GRANT);

      expect(observedResults[0]).toContain("\"id\":\"epic\"");
      expect(observedResults[1]).toContain("not authorized");
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns trusted workspace mutation actions when a later SDK failure occurs", async () => {
    const root = tmpDir();
    try {
      const mutationHolder = new WorkspaceMutationActionCollectorHolder();
      const fakeAgent = {
        agentId: "workspace-agent",
        close: vi.fn(),
        send: vi.fn(async () => {
          mutationHolder.reserve()?.commitNoteCreated({
            stableId: "note-1",
            scope: "codascope",
            visibility: "private",
            path: "one.md",
            title: "One",
            contentHash: "a".repeat(32),
          });
          return {
            id: "run",
            cancel: vi.fn(async () => undefined),
            wait: vi.fn(async () => {
              throw new Error("later SDK failure");
            }),
          };
        }),
      };
      const service = new CodaScopeAgentService(
        { getAppSecret: vi.fn(async () => "key") } as any,
        root,
        {
          activeResolver: {},
          catalog: {},
          epic: {},
          designDoc: {},
          epicKnowledge: {},
          workspaceNote: { resolveActiveNote: vi.fn() },
        } as any,
      );
      const key = (service as any).poolKey(
        { kind: "workspace" },
        "workspace-assistant",
        "alice",
      );
      (service as any).pool.set(key, {
        agent: fakeAgent,
        scope: { kind: "workspace" },
        purpose: "workspace-assistant",
        actorId: "alice",
        lastUsed: Date.now(),
        busy: false,
        collectorHolder: new ToolResultCollectorHolder(),
        workspaceGrantHolder: new WorkspaceTurnReadGrantHolder(),
        workspaceNoteGrantHolder: new WorkspaceTurnNoteGrantHolder(),
        workspaceProvenanceHolder: new WorkspaceProvenanceCollectorHolder(),
        workspaceMutationActionHolder: mutationHolder,
      });
      (service as any).allAgents.add(fakeAgent);
      const onError = vi.fn();

      await service.send({
        scope: { kind: "workspace" },
        purpose: "workspace-assistant",
        actorId: "alice",
        workspaceNoteGrant: {
          create: { maxSuccesses: 1, visibility: "private" },
          readStableIds: [],
          editBodyStableIds: [],
          editTitleStableIds: [],
          visibilityChanges: [],
          archiveStableIds: [],
        },
        message: "Create a note.",
        modelId: "model",
        onMessage: vi.fn(),
        onDone: vi.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Workspace assistant run failed." }),
        [expect.objectContaining({
          type: "note_created",
          attributes: expect.objectContaining({ stableId: "note-1" }),
        })],
      );
      await service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
