import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeWorkspaceConversationService } from "./codaScopeWorkspaceConversationService.js";
import { CodaScopeWorkspaceImageService } from "./codaScopeWorkspaceImageService.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace image custody", () => {
  it("stores images only under the actor-owned workspace conversation", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "workspace-images-"));
    roots.push(root);
    const conversations = new CodaScopeWorkspaceConversationService(root);
    const images = new CodaScopeWorkspaceImageService(conversations);
    const conversation = await conversations.createConversation("alice");
    const uploaded = await images.uploadImage(
      "alice",
      conversation.id,
      Buffer.from("image"),
      "image/png",
    );
    const imagePath = await images.getImagePath(
      "alice",
      conversation.id,
      uploaded.filename,
    );

    expect(imagePath).not.toBeNull();
    expect(existsSync(imagePath!)).toBe(true);
    expect(imagePath).toContain(
      path.join("_workspace", "conversations"),
    );
    expect(imagePath).not.toContain(`${path.sep}alice${path.sep}`);
    expect(await images.getImagePath(
      "bob",
      conversation.id,
      uploaded.filename,
    )).toBeNull();
    await expect(images.uploadImage(
      "bob",
      conversation.id,
      Buffer.from("image"),
      "image/png",
    )).rejects.toThrow("Conversation not found");
  });

  it("reuses project-chat type, size, and filename safety limits", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "workspace-images-"));
    roots.push(root);
    const conversations = new CodaScopeWorkspaceConversationService(root);
    const images = new CodaScopeWorkspaceImageService(conversations);
    const conversation = await conversations.createConversation("alice");

    await expect(images.uploadImage(
      "alice",
      conversation.id,
      Buffer.from("image"),
      "image/svg+xml",
    )).rejects.toThrow("Unsupported image type");
    await expect(images.uploadImage(
      "alice",
      conversation.id,
      Buffer.alloc(5 * 1024 * 1024 + 1),
      "image/png",
    )).rejects.toThrow("Image too large");
    await expect(images.getImagePath(
      "alice",
      conversation.id,
      "../secret.png",
    )).rejects.toMatchObject({
      code: "invalid_input",
      status: 400,
    });
  });
});
