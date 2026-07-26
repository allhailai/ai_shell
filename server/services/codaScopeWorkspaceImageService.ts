/* ── CodaScope: Workspace Conversation Images ───────────────────────
   Actor-owned image custody beneath the dedicated workspace conversation
   store. Project image paths and services are never consulted.
   ──────────────────────────────────────────────────────────────────── */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CodaScopeWorkspaceConversationService } from "./codaScopeWorkspaceConversationService.js";
import {
  assertSafePathSegment,
  assertStrictDescendant,
} from "./codaScopePathSafety.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export class CodaScopeWorkspaceImageService {
  constructor(
    private readonly conversationService: CodaScopeWorkspaceConversationService,
  ) {}

  async uploadImage(
    actorId: string,
    conversationId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ path: string; filename: string }> {
    assertSafePathSegment(conversationId, "conversation ID");
    if (!await this.conversationService.readConversation(actorId, conversationId)) {
      throw new Error("Conversation not found");
    }
    const extension = ACCEPTED_TYPES[mimeType];
    if (!extension) throw new Error(`Unsupported image type: ${mimeType}`);
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large. Max size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    }

    const imagesDir = this.imagesDirectory(actorId, conversationId);
    await fs.mkdir(imagesDir, { recursive: true });
    const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);
    const filename = `${Date.now()}_${hash}${extension}`;
    const filePath = assertStrictDescendant(
      imagesDir,
      path.join(imagesDir, filename),
      "workspace conversation image",
    );
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    return {
      path: `${conversationId}/images/${filename}`,
      filename,
    };
  }

  async getImagePath(
    actorId: string,
    conversationId: string,
    filename: string,
  ): Promise<string | null> {
    assertSafePathSegment(conversationId, "conversation ID");
    const safeFilename = assertSafePathSegment(filename, "image filename");
    if (!await this.conversationService.readConversation(actorId, conversationId)) {
      return null;
    }
    const imagesDir = this.imagesDirectory(actorId, conversationId);
    const filePath = assertStrictDescendant(
      imagesDir,
      path.join(imagesDir, safeFilename),
      "workspace conversation image",
    );
    return existsSync(filePath) ? filePath : null;
  }

  private imagesDirectory(actorId: string, conversationId: string): string {
    const assetsDir = this.conversationService.getConversationAssetsDirectory(
      actorId,
      conversationId,
    );
    return assertStrictDescendant(
      assetsDir,
      path.join(assetsDir, "images"),
      "workspace conversation images directory",
    );
  }
}
