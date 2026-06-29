/* ── CodaScope: Agent Service ─────────────────────────────────────────
   Manages Cursor SDK agent lifecycle for CodaScope.

   Key features:
   - Agent pool: one agent per (projectId, purpose) with idle cleanup
   - Custom tools: progressive wiki/repo discovery (no context dumping)
   - Streaming: emits SDKMessage objects via callback for SSE
   - Model listing: cached Cursor.models.list() results
   ──────────────────────────────────────────────────────────────────── */

import { Agent, Cursor } from "@cursor/sdk";
import type {
  SDKAgent,
  SDKCustomTool,
  SDKMessage,
  RunResult,
  ModelListItem,
} from "@cursor/sdk";
import type { SecretService } from "./secretService.js";
import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface AgentSendOptions {
  projectId: string;
  message: string;
  modelId: string;
  systemPrompt?: string;
  context?: string;
  purpose: "chat" | "assistant" | "wiki-build";
  onMessage: (msg: SDKMessage) => void;
  onDone: (result: RunResult) => void;
  onError: (err: Error) => void;
}

interface PoolEntry {
  agent: SDKAgent;
  projectId: string;
  purpose: string;
  lastUsed: number;
  busy: boolean;
}

/* ── Model Cache ────────────────────────────────────────────────────── */

interface ModelCache {
  models: ModelListItem[];
  fetchedAt: number;
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeAgentService {
  private secretService: SecretService;
  private projectsRoot: string;
  private pool = new Map<string, PoolEntry>();
  private modelCache: ModelCache | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(secretService: SecretService, projectsRoot: string) {
    this.secretService = secretService;
    this.projectsRoot = projectsRoot;

    // Clean up idle agents every 2 minutes
    this.cleanupTimer = setInterval(() => this.cleanIdleAgents(), 2 * 60 * 1000);
  }

  setProjectsRoot(root: string): void {
    this.projectsRoot = root;
  }

  /* ── API Key ──────────────────────────────────────────────────────── */

  private async getApiKey(): Promise<string> {
    const key = await this.secretService.getAppSecret("codascope", "cursor_api_key");
    if (!key) {
      throw new Error("Cursor API key not configured. Set it in CodaScope settings.");
    }
    return key;
  }

  /* ── Models ───────────────────────────────────────────────────────── */

  async listModels(): Promise<ModelListItem[]> {
    if (this.modelCache && Date.now() - this.modelCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return this.modelCache.models;
    }

    const apiKey = await this.getApiKey();
    const models = await Cursor.models.list({ apiKey });
    this.modelCache = { models, fetchedAt: Date.now() };
    return models;
  }

  /**
   * Validate an API key by attempting a lightweight Cursor SDK call.
   * Returns { valid, modelCount, error }.
   */
  async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    modelCount: number;
    error: string | null;
  }> {
    try {
      const models = await Cursor.models.list({ apiKey });
      // If we got here, key works — update cache with the fresh result
      this.modelCache = { models, fetchedAt: Date.now() };
      return { valid: true, modelCount: models.length, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Detect common failure modes
      if (message.includes("MODULE_NOT_FOUND") || message.includes("Cannot find module")) {
        return {
          valid: false,
          modelCount: 0,
          error: "Cursor SDK is not installed. Run `npm install @cursor/sdk` to install it.",
        };
      }
      if (message.includes("401") || message.includes("Unauthorized") || message.includes("invalid")) {
        return {
          valid: false,
          modelCount: 0,
          error: "API key is invalid or unauthorized. Check your key and try again.",
        };
      }
      if (message.includes("403") || message.includes("Forbidden")) {
        return {
          valid: false,
          modelCount: 0,
          error: "API key does not have permission to access Cursor models.",
        };
      }
      return {
        valid: false,
        modelCount: 0,
        error: `Validation failed: ${message}`,
      };
    }
  }

  /* ── Custom Tools (Progressive Discovery) ─────────────────────────── */

  private buildCustomTools(projectId: string): Record<string, SDKCustomTool> {
    const wikiService = new CodaScopeWikiService(this.projectsRoot);
    const projectService = new CodaScopeProjectService(this.projectsRoot);

    return {
      list_wiki_topics: {
        description:
          "List all available wiki topics for this project. Returns topic IDs and titles. " +
          "Use this to discover what documentation exists before reading specific topics.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            const topics = await wikiService.listTopics(projectId);
            if (topics.length === 0) {
              return "No wiki topics exist yet. The wiki has not been built for this project.";
            }
            return JSON.stringify(
              topics.map((t: { id: string; title: string }) => ({
                id: t.id,
                title: t.title,
              })),
              null,
              2,
            );
          } catch {
            return "Failed to list wiki topics.";
          }
        },
      },

      read_wiki_topic: {
        description:
          "Read the full content of a specific wiki topic by its ID. " +
          "Use list_wiki_topics first to discover available topic IDs.",
        inputSchema: {
          type: "object",
          properties: {
            topicId: {
              type: "string",
              description: "The topic ID to read (from list_wiki_topics)",
            },
          },
          required: ["topicId"],
        },
        execute: async (args) => {
          const topicId = args.topicId as string;
          if (!topicId) return "topicId is required.";
          try {
            const content = await wikiService.getTopicContent(projectId, topicId);
            if (content === null) return `Wiki topic "${topicId}" not found.`;
            return content;
          } catch {
            return `Failed to read wiki topic "${topicId}".`;
          }
        },
      },

      search_wiki: {
        description:
          "Search across all wiki topics for a keyword or phrase. " +
          "Returns matching topic IDs with a snippet of the matching content.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query (case-insensitive)",
            },
          },
          required: ["query"],
        },
        execute: async (args) => {
          const query = (args.query as string)?.toLowerCase();
          if (!query) return "query is required.";
          try {
            const topics = await wikiService.listTopics(projectId);
            const matches: Array<{ topicId: string; title: string; snippet: string }> = [];

            for (const topic of topics) {
              const content = await wikiService.getTopicContent(projectId, topic.id);
              if (!content) continue;
              const lowerContent = content.toLowerCase();
              const idx = lowerContent.indexOf(query);
              if (idx >= 0) {
                const start = Math.max(0, idx - 80);
                const end = Math.min(content.length, idx + query.length + 80);
                matches.push({
                  topicId: topic.id,
                  title: topic.title,
                  snippet: "..." + content.slice(start, end).replace(/\n/g, " ") + "...",
                });
              }
            }

            if (matches.length === 0) return `No wiki topics matched "${args.query}".`;
            return JSON.stringify(matches, null, 2);
          } catch {
            return "Failed to search wiki.";
          }
        },
      },

      list_repositories: {
        description:
          "List all configured repositories for this project, including their names and filesystem paths.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            const project = await projectService.getProject(projectId);
            if (!project) return "Project not found.";
            if (!project.repositories || project.repositories.length === 0) {
              return "No repositories configured for this project.";
            }
            return JSON.stringify(
              project.repositories.map((r: { id: string; name: string; path: string }) => ({
                id: r.id,
                name: r.name,
                path: r.path,
              })),
              null,
              2,
            );
          } catch {
            return "Failed to list repositories.";
          }
        },
      },

      list_project_skills: {
        description:
          "List all skills (both framework and user-defined) available for this project.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            // Read framework commands
            const commandsDir = path.resolve(
              import.meta.dirname ?? __dirname,
              "../../src/apps/codascope/commands",
            );
            const commands: string[] = [];
            if (existsSync(commandsDir)) {
              for (const f of readdirSync(commandsDir)) {
                if (f.endsWith(".md")) commands.push(f.replace(/\.md$/, ""));
              }
            }
            return JSON.stringify({ frameworkCommands: commands }, null, 2);
          } catch {
            return "Failed to list skills.";
          }
        },
      },

      read_code_map: {
        description:
          "Read the Code Map for a specific repository. The Code Map is a structured " +
          "document describing the repository's architecture, modules, and key files. " +
          "Use list_repositories to discover available repositories first, then pass " +
          "the repository name here.",
        inputSchema: {
          type: "object",
          properties: {
            repoName: {
              type: "string",
              description: "The repository name (from list_repositories)",
            },
          },
          required: ["repoName"],
        },
        execute: async (args) => {
          const repoName = args.repoName as string;
          if (!repoName) return "repoName is required.";
          try {
            const codeMapService = new CodaScopeCodeMapService(this.projectsRoot);
            const slug = CodaScopeCodeMapService.repoSlug(repoName);
            const content = codeMapService.readCodeMap(projectId, slug);
            if (content === null) {
              return `No Code Map found for "${repoName}" (slug: ${slug}). Run an analysis to build it.`;
            }
            return content;
          } catch {
            return `Failed to read Code Map for "${repoName}".`;
          }
        },
      },

      update_code_map_section: {
        description:
          "Update a specific section of the Code Map by its heading. Use this to " +
          "correct or enrich the Code Map when the user asks you to modify it. " +
          "The section heading must match an existing ## heading in the Code Map. " +
          "The new content replaces everything between that heading and the next heading.",
        inputSchema: {
          type: "object",
          properties: {
            repoName: {
              type: "string",
              description: "The repository name",
            },
            sectionHeading: {
              type: "string",
              description: "The section heading text to update (e.g., 'Key Modules' or 'Architecture')",
            },
            newContent: {
              type: "string",
              description: "The new content for the section (markdown formatted)",
            },
          },
          required: ["repoName", "sectionHeading", "newContent"],
        },
        execute: async (args) => {
          const repoName = args.repoName as string;
          const sectionHeading = args.sectionHeading as string;
          const newContent = args.newContent as string;
          if (!repoName || !sectionHeading || !newContent) {
            return "repoName, sectionHeading, and newContent are all required.";
          }
          try {
            const codeMapService = new CodaScopeCodeMapService(this.projectsRoot);
            const slug = CodaScopeCodeMapService.repoSlug(repoName);
            const updated = codeMapService.updateCodeMapSection(
              projectId, slug, sectionHeading, newContent,
            );
            if (updated) {
              return `Successfully updated section "${sectionHeading}" in the Code Map for "${repoName}".`;
            }
            return `Could not find a section matching "${sectionHeading}" in the Code Map for "${repoName}". ` +
              `Make sure the heading exists. Use read_code_map to view current sections.`;
          } catch {
            return `Failed to update Code Map section.`;
          }
        },
      },
    };
  }

  /* ── Agent Pool ───────────────────────────────────────────────────── */

  private poolKey(projectId: string, purpose: string): string {
    return `${projectId}::${purpose}`;
  }

  private async getOrCreateAgent(
    projectId: string,
    purpose: string,
    modelId: string,
  ): Promise<SDKAgent> {
    const key = this.poolKey(projectId, purpose);
    const existing = this.pool.get(key);

    if (existing && !existing.busy) {
      existing.lastUsed = Date.now();
      return existing.agent;
    }

    // Create new agent
    const apiKey = await this.getApiKey();
    const projectService = new CodaScopeProjectService(this.projectsRoot);
    const project = await projectService.getProject(projectId);

    const repoPaths = project?.repositories?.map(
      (r: { path: string }) => r.path,
    ) ?? [];

    const agent = await Agent.create({
      model: { id: modelId },
      apiKey,
      name: `CodaScope ${purpose} — ${project?.name ?? projectId}`,
      local: {
        cwd: repoPaths.length > 0 ? repoPaths : undefined,
        customTools: this.buildCustomTools(projectId),
      },
    });

    this.pool.set(key, {
      agent,
      projectId,
      purpose,
      lastUsed: Date.now(),
      busy: false,
    });

    return agent;
  }

  private cleanIdleAgents(): void {
    const now = Date.now();
    const IDLE_MS = 10 * 60 * 1000; // 10 minutes

    for (const [key, entry] of this.pool) {
      if (!entry.busy && now - entry.lastUsed > IDLE_MS) {
        try {
          entry.agent.close();
        } catch {
          // ignore close errors
        }
        this.pool.delete(key);
      }
    }
  }

  /* ── Send Message ─────────────────────────────────────────────────── */

  async send(options: AgentSendOptions): Promise<void> {
    const { projectId, message, modelId, systemPrompt, context, purpose, onMessage, onDone, onError } = options;

    const key = this.poolKey(projectId, purpose);

    try {
      const agent = await this.getOrCreateAgent(projectId, purpose, modelId);

      const entry = this.pool.get(key);
      if (entry) entry.busy = true;

      // Build the full message with optional context
      let fullMessage = "";
      if (systemPrompt) {
        fullMessage += systemPrompt + "\n\n";
      }
      if (context) {
        fullMessage += `<current_context>\n${context}\n</current_context>\n\n`;
      }
      fullMessage += message;

      const run = await agent.send(fullMessage, {
        model: { id: modelId },
        onDelta: ({ update }) => {
          // Convert delta updates to a synthetic message for the frontend
          if ("text" in update && update.text) {
            onMessage({
              type: "assistant",
              agent_id: agent.agentId,
              run_id: run.id,
              message: {
                role: "assistant",
                content: [{ type: "text", text: update.text }],
              },
            } as SDKMessage);
          }
        },
      });

      // Wait for completion
      const result = await run.wait();

      if (entry) {
        entry.busy = false;
        entry.lastUsed = Date.now();
      }

      onDone(result);
    } catch (err) {
      const entry = this.pool.get(key);
      if (entry) entry.busy = false;

      // If agent creation failed, remove from pool
      this.pool.delete(key);

      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /* ── Cleanup ──────────────────────────────────────────────────────── */

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [, entry] of this.pool) {
      try {
        entry.agent.close();
      } catch {
        // ignore
      }
    }
    this.pool.clear();
  }
}
