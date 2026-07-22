import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeImageService } from "./codaScopeImageService.js";
import type { CodaScopeChatService } from "./codaScopeChatService.js";

function tmpRoot(): string {
  return path.join(os.tmpdir(), `chat-image-${crypto.randomBytes(6).toString("hex")}`);
}

function scaffoldProject(root: string): void {
  const projectDir = path.join(root, "project-proj");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({ id: "proj" }), "utf-8");
}

describe("CodaScopeImageService conversation custody", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("requires the conversation owner for image upload and reads", async () => {
    const root = tmpRoot();
    roots.push(root);
    scaffoldProject(root);
    const readConversation = vi.fn(async (_projectId: string, _conversationId: string, actorId: string) =>
      actorId === "alice" ? { id: "conv_owner" } : null,
    );
    const service = new CodaScopeImageService(root, { readConversation } as unknown as CodaScopeChatService);

    const uploaded = await service.uploadImage("proj", "conv_owner", "alice", Buffer.from("image bytes"), "image/png");
    expect(existsSync(await service.getImagePath("proj", "conv_owner", uploaded.filename, "alice") ?? "")).toBe(true);
    expect(await service.getImagePath("proj", "conv_owner", uploaded.filename, "bob")).toBeNull();
    await expect(service.uploadImage("proj", "conv_owner", "bob", Buffer.from("image bytes"), "image/png"))
      .rejects.toThrow("Conversation not found");
    await expect(service.getImagePath("proj", "conv_owner", "../project.json", "alice"))
      .rejects.toMatchObject({ status: 400, code: "invalid_input", message: "Invalid image filename." });
  });
});
