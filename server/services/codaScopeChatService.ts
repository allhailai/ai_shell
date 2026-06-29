/* ── CodaScope: Chat Service ──────────────────────────────────────────
   Persists chat history per project. The actual agent conversation
   flows through /chat/stream SSE via CodaScopeAgentService.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

export class CodaScopeChatService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  // ── Find project directory ────────────────────────────────────────

  private findProjectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw);
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch {
          // Skip
        }
      }
    }
    return null;
  }

  // NOTE: chat() placeholder removed — all chat goes through /chat/stream SSE
  // via CodaScopeAgentService. Only saveMessage() remains for persisting history.

  // ── Save Message (for SSE streaming routes) ─────────────────────

  async saveMessage(projectId: string, role: string, content: string): Promise<void> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return;

    const chatDir = path.join(projectDir, "chat");
    if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
    const historyPath = path.join(chatDir, "history.jsonl");
    const entry = JSON.stringify({ role, content, timestamp: new Date().toISOString() }) + "\n";
    const { appendFileSync } = await import("node:fs");
    appendFileSync(historyPath, entry);
  }
}
