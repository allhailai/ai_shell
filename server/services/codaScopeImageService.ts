/* ── CodaScope: Image Service ────────────────────────────────────────
   Simple image storage for chat conversations.
   Images are stored in the conversation directory.

   Responsibilities:
   - Upload and store conversation images
   - Resolve image paths for serving
   - Prune images when conversations are deleted
   ──────────────────────────────────────────────────────────────────── */

import fs from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── Constants ───────────────────────────────────────────────────── */

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/* ── Service ─────────────────────────────────────────────────────── */

export class CodaScopeImageService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ─────────────────────────────────────────────── */

  private findProjectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const data = JSON.parse(readFileSync(projectPath, "utf-8"));
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch {
          /* skip corrupted */
        }
      }
    }
    return null;
  }

  private imagesDir(projectDir: string, conversationId: string): string {
    return path.join(projectDir, "conversations", conversationId, "images");
  }

  /* ── Upload ────────────────────────────────────────────────────── */

  /**
   * Store an uploaded image and return its relative path.
   * @returns Relative path from project dir: `conversations/<convId>/images/<file>`
   */
  async uploadImage(
    projectId: string,
    conversationId: string,
    buffer: Buffer,
    mimeType: string,
    _originalName?: string,
  ): Promise<{ path: string; filename: string }> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    // Validate type
    const ext = ACCEPTED_TYPES[mimeType];
    if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);

    // Validate size
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large. Max size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    }

    // Create images directory
    const imgDir = this.imagesDir(projectDir, conversationId);
    if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });

    // Generate filename: <timestamp>_<hash>.<ext>
    const timestamp = Date.now();
    const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
    const filename = `${timestamp}_${hash}${ext}`;
    const filePath = path.join(imgDir, filename);

    await fs.writeFile(filePath, buffer);

    const relativePath = `conversations/${conversationId}/images/${filename}`;
    return { path: relativePath, filename };
  }

  /* ── Resolve path ──────────────────────────────────────────────── */

  /**
   * Get the absolute path for a conversation image.
   */
  getImagePath(
    projectId: string,
    conversationId: string,
    filename: string,
  ): string | null {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    const filePath = path.join(this.imagesDir(projectDir, conversationId), filename);
    if (!existsSync(filePath)) return null;
    return filePath;
  }

  /* ── Prune ─────────────────────────────────────────────────────── */

  /**
   * Delete all images for a conversation.
   * Called when a conversation is deleted to prevent orphaned images.
   */
  async pruneConversationImages(
    projectId: string,
    conversationId: string,
  ): Promise<void> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return;

    const imgDir = this.imagesDir(projectDir, conversationId);
    if (!existsSync(imgDir)) return;

    try {
      await fs.rm(imgDir, { recursive: true, force: true });
    } catch {
      // Best effort — log but don't throw
      console.warn(`[CodaScopeImageService] Failed to prune images for conversation ${conversationId}`);
    }
  }
}
