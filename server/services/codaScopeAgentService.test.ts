import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeAgentService, getAgentLocalWorkspace } from "./codaScopeAgentService.js";
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
