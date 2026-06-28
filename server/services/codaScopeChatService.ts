/* ── CodaScope: Chat Service ──────────────────────────────────────────
   Manages codebase Q&A chat. Stores chat history per project and
   assembles context from wiki pages for the agent.

   Phase 1: Returns a placeholder response. Agent integration
   (Cursor SDK) will be connected in the agent service.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

interface ChatResponse {
  response: string;
  context: string[];
}

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

  // ── Chat ──────────────────────────────────────────────────────────

  async chat(projectId: string, message: string, _model?: string): Promise<ChatResponse> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) {
      return { response: "Project not found.", context: [] };
    }

    // Gather wiki context
    const wikiDir = path.join(projectDir, "wiki");
    const wikiPages: string[] = [];
    if (existsSync(wikiDir)) {
      const files = readdirSync(wikiDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        wikiPages.push(file.replace(/\.md$/, ""));
      }
    }

    // Save message to chat history
    const chatDir = path.join(projectDir, "chat");
    if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
    const historyPath = path.join(chatDir, "history.jsonl");
    const entry = JSON.stringify({ role: "user", content: message, timestamp: new Date().toISOString() }) + "\n";
    const { appendFileSync } = await import("node:fs");
    appendFileSync(historyPath, entry);

    // TODO: Integrate with Cursor SDK agent via CodaScopeAgentService
    // For now, return a placeholder that acknowledges the question
    const response = `I received your question: "${message}"\n\n` +
      `**This is a placeholder response.** Agent integration with the Cursor SDK is pending.\n\n` +
      (wikiPages.length > 0
        ? `I would consult these wiki pages for context:\n${wikiPages.map((p) => `- ${p}`).join("\n")}`
        : "No wiki pages available yet. Build the wiki first for richer answers.");

    // Save response to history
    const responseEntry = JSON.stringify({ role: "agent", content: response, timestamp: new Date().toISOString() }) + "\n";
    appendFileSync(historyPath, responseEntry);

    return {
      response,
      context: wikiPages.slice(0, 5),
    };
  }
}
