import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express, Request } from "express";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthMiddleware } from "../middleware/auth.js";
import type { SecretService } from "../services/secretService.js";
import { codaScopePersistence } from "../services/codaScopePersistence.js";
import {
  changeProjectsRoot,
  createRouteContext,
  principal,
  shutdownCodaScopeServices,
  type HttpErrorFn,
} from "./codaScopeServiceContext.js";

const httpError: HttpErrorFn = (message, status, code) =>
  Object.assign(new Error(message), { status, code });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await shutdownCodaScopeServices();
  vi.useRealTimers();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CodaScope route principal", () => {
  it("derives the actor solely from authenticated middleware state", () => {
    const req = {
      user: {
        username: "alice",
        is_admin: false,
        is_system: false,
        firstname: "",
        lastname: "",
        created_at: "",
        updated_at: "",
      },
      headers: { "x-auth-user": "mallory" },
    } as unknown as Request;

    expect(principal(req, httpError)).toEqual({ username: "alice", isAdmin: false });
  });

  it("rejects requests that did not pass through authentication middleware", () => {
    expect(() => principal({} as Request, httpError)).toThrow("Authentication required.");
  });

  it("preserves an administrator-authorized setup path in standalone mode", async () => {
    const dataDir = tempRoot();
    const middleware = createAuthMiddleware({
      authService: {} as never,
      mode: "standalone",
      osUsername: "local-user",
      dataDir,
    });
    const req = { get: () => undefined } as unknown as Request;
    await new Promise<void>((resolve) => middleware.requireAuth(req, {} as never, (() => resolve()) as never));
    expect(principal(req, httpError)).toEqual({ username: "local-user", isAdmin: true });
  });
});

describe("CodaScope root-bound service lifecycle", () => {
  it("cancels old runs, closes pooled agents, and leaves one fresh graph across repeated root changes", async () => {
    vi.useFakeTimers();
    const rootA = path.join(tempRoot(), "root-a");
    const rootB = path.join(tempRoot(), "root-b");
    const rootC = path.join(tempRoot(), "root-c");
    const secrets = mutableSecretService(rootA);
    const context = createRouteContext({} as Express, {
      secretService: secrets.service,
      authService: { getUser: vi.fn() },
      authMiddleware: {},
      httpError,
      repoRoot: "/opt/aishell-install",
    });

    const servicesA = await context.ensureServices();
    expect((servicesA.chatSvc as any).persistence).toBe(codaScopePersistence);
    expect((servicesA.workspaceConversationSvc as any).persistence)
      .toBe(codaScopePersistence);
    const workspaceConversationA =
      await servicesA.workspaceConversationSvc.createConversation("alice");
    expect(servicesA.workspaceConversationSvc.getRoot()).toBe(rootA);
    const close = vi.fn();
    const closeWorkspace = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const cancelWorkspace = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const waitWorkspace = vi.fn(async () => undefined);
    const fakeAgent = { close };
    const fakeWorkspaceAgent = { close: closeWorkspace };
    const fakeRun = { cancel, wait };
    const fakeWorkspaceRun = {
      cancel: cancelWorkspace,
      wait: waitWorkspace,
    };
    const controller = new AbortController();
    const workspaceController = new AbortController();
    (servicesA.agentSvc as any).pool.set("project:project::assistant::alice", {
      agent: fakeAgent,
      scope: { kind: "project", projectId: "project" },
      purpose: "assistant",
      actorId: "alice",
      lastUsed: Date.now(),
      busy: true,
      collectorHolder: {},
    });
    (servicesA.agentSvc as any).pool.set("workspace::workspace-assistant::alice", {
      agent: fakeWorkspaceAgent,
      scope: { kind: "workspace" },
      purpose: "workspace-assistant",
      actorId: "alice",
      lastUsed: Date.now(),
      busy: true,
      collectorHolder: {},
      workspaceGrantHolder: {},
    });
    (servicesA.agentSvc as any).allAgents.add(fakeAgent);
    (servicesA.agentSvc as any).allAgents.add(fakeWorkspaceAgent);
    (servicesA.agentSvc as any).activeRuns.set("project:project::alice", new Set([fakeRun]));
    (servicesA.agentSvc as any).activeRuns.set("workspace::alice", new Set([fakeWorkspaceRun]));
    (servicesA.agentSvc as any).activeChatControllers.set("project:project::alice", controller);
    (servicesA.agentSvc as any).activeChatControllers.set("workspace::alice", workspaceController);
    (servicesA.buildSvc as any).activeBuilds.set("project", { status: "building" });
    expect(vi.getTimerCount()).toBe(1);
    const projectA = await servicesA.projectSvc.createProject("Root A Project", "old graph");
    await servicesA.wikiSvc.updateTopicContent(projectA.id, "root-a", "# Root A\n\nOld root only.");
    expect((await servicesA.workspaceCatalogSvc.listActiveProjects()).map((project) => project.projectId))
      .toEqual([projectA.id]);

    const servicesB = await changeProjectsRoot(secrets.service, rootB, httpError, "/opt/aishell-install");
    expect(close).toHaveBeenCalledOnce();
    expect(closeWorkspace).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancelWorkspace).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
    expect(waitWorkspace).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
    expect(workspaceController.signal.aborted).toBe(true);
    await expect(servicesA.workspaceConversationSvc.listConversations("alice"))
      .rejects.toThrow("disposed");
    expect((servicesA.agentSvc as any).cleanupTimer).toBeNull();
    expect((servicesA.buildSvc as any).cancelledKeys.has("project")).toBe(true);
    expect(servicesB.activeEntityResolver).not.toBe(servicesA.activeEntityResolver);
    expect(servicesB.workspaceCatalogSvc).not.toBe(servicesA.workspaceCatalogSvc);
    expect(servicesB.workspaceConversationSvc)
      .not.toBe(servicesA.workspaceConversationSvc);
    expect(servicesB.workspaceImageSvc).not.toBe(servicesA.workspaceImageSvc);
    expect(servicesB.workspaceIntentSvc).not.toBe(servicesA.workspaceIntentSvc);
    expect(servicesB.workspaceConversationSvc.getRoot()).toBe(rootB);
    expect(await servicesB.workspaceConversationSvc.readConversation(
      "alice",
      workspaceConversationA.id,
    )).toBeNull();
    expect((servicesB.agentSvc as any).workspaceTools).toMatchObject({
      activeResolver: servicesB.activeEntityResolver,
      catalog: servicesB.workspaceCatalogSvc,
      epic: servicesB.epicSvc,
      designDoc: servicesB.designDocSvc,
      epicKnowledge: servicesB.epicKnowledgeSvc,
    });
    expect(servicesB.projectSvc.getRoot()).toBe(rootB);
    expect((servicesB.agentSvc as any).projectsRoot).toBe(rootB);
    expect(await context.ensureServices()).toBe(servicesB);
    expect(vi.getTimerCount()).toBe(1);
    const projectB = await servicesB.projectSvc.createProject("Root B Project", "fresh graph");
    await servicesB.wikiSvc.updateTopicContent(projectB.id, "root-b", "# Root B Only");
    expect((await servicesB.workspaceCatalogSvc.listActiveProjects()).map((project) => project.projectId))
      .toEqual([projectB.id]);
    const rootBTools = (servicesB.agentSvc as any).getToolsForPurpose({
      scope: { kind: "project", projectId: projectB.id },
      purpose: "assistant",
      collectorHolder: {},
      actorId: "alice",
    });
    await expect(rootBTools.list_wiki_topics.execute({}, {})).resolves.toContain("Root B Only");

    const servicesC = await changeProjectsRoot(secrets.service, rootC, httpError, "/opt/aishell-install");
    expect((servicesB.agentSvc as any).cleanupTimer).toBeNull();
    expect(servicesC.projectSvc.getRoot()).toBe(rootC);
    expect(servicesC.workspaceConversationSvc.getRoot()).toBe(rootC);
    expect(servicesC.workspaceConversationSvc)
      .not.toBe(servicesB.workspaceConversationSvc);
    expect(await servicesC.workspaceCatalogSvc.listActiveProjects()).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps the old live graph when candidate configuration persistence fails", async () => {
    vi.useFakeTimers();
    const rootA = path.join(tempRoot(), "stable-root");
    const rootB = path.join(tempRoot(), "failed-root");
    const secrets = mutableSecretService(rootA);
    const context = createRouteContext({} as Express, {
      secretService: secrets.service,
      authService: { getUser: vi.fn() },
      authMiddleware: {},
      httpError,
      repoRoot: "/opt/aishell-install",
    });
    const stable = await context.ensureServices();
    secrets.failNextSet();

    await expect(changeProjectsRoot(secrets.service, rootB, httpError, "/opt/aishell-install"))
      .rejects.toThrow("secret persistence failed");
    expect(secrets.getValue()).toBe(rootA);
    expect(await context.ensureServices()).toBe(stable);
    expect(stable.projectSvc.getRoot()).toBe(rootA);
    expect((stable.agentSvc as any).cleanupTimer).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });
});

function mutableSecretService(initialValue: string | null) {
  let value = initialValue;
  let shouldFail = false;
  const service = {
    getAppSecret: vi.fn(async (_appId: string, key: string) => key === "codascope_projects_root" ? value : null),
    setAppSecret: vi.fn(async (_appId: string, key: string, next: string) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("secret persistence failed");
      }
      if (key === "codascope_projects_root") value = next;
    }),
  } as unknown as SecretService;
  return {
    service,
    getValue: () => value,
    failNextSet: () => { shouldFail = true; },
  };
}

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-service-context-test-"));
  temporaryRoots.push(root);
  return root;
}
