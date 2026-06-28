/* ── CodaScope: Wiki Service ──────────────────────────────────────────
   Manages wiki pages stored as markdown files in each project's
   wiki/ directory. Handles topic listing, content read/write, and
   index generation.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";

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

    return topics.sort((a, b) => a.title.localeCompare(b.title));
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
