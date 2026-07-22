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
} from "./codaScopeAgentService.js";
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
});
