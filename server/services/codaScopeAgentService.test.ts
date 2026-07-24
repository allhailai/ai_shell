import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CodaScopeAgentService,
  createAgentWithSandboxFallback,
  getAgentLocalWorkspace,
  isLocalSandboxUnsupportedError,
  startRunWithSandboxFallback,
} from "./codaScopeAgentService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteDocumentService } from "./codaScopeNoteDocumentService.js";
import { getToolsForPurpose } from "./codaScopeToolDefinitions.js";

function tmpDir(): string {
  const root = path.join(os.tmpdir(), `agent-actor-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("CodaScopeAgentService actor isolation", () => {
  it("sandboxes wiki builds in the CodaScope project instead of a source repository", () => {
    expect(getAgentLocalWorkspace("wiki-build", "/data/projects/core", ["/repos/core"])).toEqual({
      cwd: "/data/projects/core",
      sandboxOptions: { enabled: true },
    });
    expect(getAgentLocalWorkspace("chat", "/data/projects/core", ["/repos/core"])).toEqual({
      cwd: ["/repos/core"],
    });
    expect(() => getAgentLocalWorkspace("wiki-build", null, ["/repos/core"]))
      .toThrow("CodaScope project directory not found for wiki build.");
  });

  it("recognizes only the SDK's unsupported-sandbox error for wiki fallback", () => {
    expect(isLocalSandboxUnsupportedError(new Error(
      "Local SDK sandboxing was requested, but sandboxing is not supported in this environment. Disable local.sandboxOptions.enabled.",
    ))).toBe(true);
    expect(isLocalSandboxUnsupportedError(new Error("sandbox denied by policy"))).toBe(false);
  });

  it("retries wiki-build creation with sandboxing explicitly disabled only on an unsupported host", async () => {
    const workspace = getAgentLocalWorkspace("wiki-build", "/data/projects/core", ["/repos/core"]);
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
    const workspace = getAgentLocalWorkspace("wiki-build", "/data/projects/core", ["/repos/core"]);
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
      expect((service as any).poolKey("project", "assistant", "alice"))
        .not.toBe((service as any).poolKey("project", "assistant", "bob"));

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
        const tools = (service as any).getToolsForPurpose(
          "project",
          purpose,
          undefined,
          "alice",
        );
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
          projectId: "project",
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
});
