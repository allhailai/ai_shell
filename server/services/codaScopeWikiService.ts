/* ── CodaScope: Wiki Service ──────────────────────────────────────────
   Manages wiki pages stored as markdown files in each project's
   wiki/ directory. Handles topic listing, content read/write,
   index generation, and pending deletion confirmation flow.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { PendingWikiDeletion } from "../../src/apps/codascope/codaScopeTypes.js";

interface WikiTopic {
  id: string;
  title: string;
  path: string;
  type?: string;
  updatedAt?: string;
}

export class CodaScopeWikiService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  // ── Get wiki directory for a project ──────────────────────────────

  private getWikiDir(projectId: string): string | null {
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw);
          if (data.id === projectId) return path.join(this.root, entry.name, "wiki");
        } catch {
          // Skip
        }
      }
    }
    return null;
  }

  // ── List topics ───────────────────────────────────────────────────

  async listTopics(projectId: string): Promise<WikiTopic[]> {
    const wikiDir = this.getWikiDir(projectId);
    if (!wikiDir || !existsSync(wikiDir)) return [];

    const files = readdirSync(wikiDir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
    const topics: WikiTopic[] = [];

    for (const file of files) {
      const filePath = path.join(wikiDir, file);
      const stat = statSync(filePath);
      const id = file.replace(/\.md$/, "");
      const title = this.extractTitle(filePath) || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      topics.push({
        id,
        title,
        path: file,
        updatedAt: stat.mtime.toISOString(),
      });
    }

    // Pin "index" topic to top, then sort rest alphabetically
    return topics.sort((a, b) => {
      if (a.id === "index") return -1;
      if (b.id === "index") return 1;
      return a.title.localeCompare(b.title);
    });
  }

  // ── Get topic content ─────────────────────────────────────────────

  async getTopicContent(projectId: string, topicId: string): Promise<string | null> {
    const wikiDir = this.getWikiDir(projectId);
    if (!wikiDir) return null;

    const filePath = path.join(wikiDir, `${topicId}.md`);
    if (!existsSync(filePath)) return null;

    return readFileSync(filePath, "utf-8");
  }

  // ── Update topic content ──────────────────────────────────────────

  async updateTopicContent(projectId: string, topicId: string, content: string): Promise<void> {
    const wikiDir = this.getWikiDir(projectId);
    if (!wikiDir) return;

    if (!existsSync(wikiDir)) mkdirSync(wikiDir, { recursive: true });

    const filePath = path.join(wikiDir, `${topicId}.md`);
    writeFileSync(filePath, content, "utf-8");
  }

  // ── Delete topic ──────────────────────────────────────────────────

  async deleteTopic(projectId: string, topicId: string): Promise<void> {
    const wikiDir = this.getWikiDir(projectId);
    if (!wikiDir) return;

    const filePath = path.join(wikiDir, `${topicId}.md`);
    if (existsSync(filePath)) {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(filePath);
    }
  }

  // ── Pending Wiki Deletions ────────────────────────────────────────

  private pendingDeletionsPath(projectId: string): string | null {
    const wikiDir = this.getWikiDir(projectId);
    if (!wikiDir) return null;
    return path.join(wikiDir, "pending-deletions.json");
  }

  private readPendingDeletions(projectId: string): PendingWikiDeletion[] {
    const p = this.pendingDeletionsPath(projectId);
    if (!p || !existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return [];
    }
  }

  private writePendingDeletions(projectId: string, items: PendingWikiDeletion[]): void {
    const p = this.pendingDeletionsPath(projectId);
    if (!p) return;
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(items, null, 2), "utf-8");
  }

  /** Add a pending deletion request (does NOT delete the page). */
  async addPendingDeletion(
    projectId: string,
    deletion: Omit<PendingWikiDeletion, "status">,
  ): Promise<PendingWikiDeletion> {
    const items = this.readPendingDeletions(projectId);

    // If there's already a pending deletion for this topic, update it
    const existing = items.find((d) => d.topicId === deletion.topicId && d.status === "pending");
    if (existing) {
      existing.reason = deletion.reason;
      existing.requestedAt = deletion.requestedAt;
      existing.requestedBy = deletion.requestedBy;
      existing.epicId = deletion.epicId;
      existing.curationId = deletion.curationId;
      this.writePendingDeletions(projectId, items);
      return existing;
    }

    const record: PendingWikiDeletion = { ...deletion, status: "pending" };
    items.push(record);
    this.writePendingDeletions(projectId, items);
    return record;
  }

  /** List all pending deletions. */
  async listPendingDeletions(projectId: string): Promise<PendingWikiDeletion[]> {
    return this.readPendingDeletions(projectId).filter((d) => d.status === "pending");
  }

  /** Approve a pending deletion — actually deletes the page. */
  async approveDeletion(projectId: string, topicId: string): Promise<boolean> {
    const items = this.readPendingDeletions(projectId);
    const item = items.find((d) => d.topicId === topicId && d.status === "pending");
    if (!item) return false;

    // Delete the actual page
    await this.deleteTopic(projectId, topicId);

    // Mark as approved
    item.status = "approved";
    this.writePendingDeletions(projectId, items);
    return true;
  }

  /** Reject a pending deletion — page stays, record removed. */
  async rejectDeletion(projectId: string, topicId: string): Promise<boolean> {
    const items = this.readPendingDeletions(projectId);
    const item = items.find((d) => d.topicId === topicId && d.status === "pending");
    if (!item) return false;

    item.status = "rejected";
    this.writePendingDeletions(projectId, items);
    return true;
  }

  // ── Extract title from markdown content ───────────────────────────

  private extractTitle(filePath: string): string | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const match = content.match(/^#\s+(.+)$/m);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }
}
