/* ── CodaScope: Wiki State Service ────────────────────────────────────
   Manages wiki-state.json — the persistent record of wiki build state,
   per-topic depth tracking, file dependencies, and Study metadata.

   Key features:
   - Per-topic depth evaluation against the wiki page rubric
   - File dependency extraction from wiki page content
   - Delta detection: maps git-changed files to affected wiki topics
   - Forward-compatible Study schema for Phase 2
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  CodaScopePersistence,
  codaScopePersistence,
} from "./codaScopePersistence.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

/* ── Types ──────────────────────────────────────────────────────────── */

export type TopicDepth = "outline" | "developed" | "deep";

export interface TopicDepthMetrics {
  wordCount: number;
  codeExampleCount: number;
  fileRefCount: number;
  fileRefsWithLineNumbers: number;
  diagramCount: number;
  crossRefCount: number;
  hasEdgeCases: boolean;
  hasPerformanceNotes: boolean;
  hasTestingStrategy: boolean;
  hasHistoricalContext: boolean;
}

export interface TopicState {
  depth: TopicDepth;
  builtAt: string;
  lastDeepenedAt?: string;
  deps: string[];
  metrics: TopicDepthMetrics;
}



export interface WikiState {
  version: number;
  lastBuildAt: string | null;
  lastBuildMode: string | null;
  gitHeads: Record<string, string>;
  topics: Record<string, TopicState>;
  // Deep Run sync point metadata
  lastSyncAt?: string;
  lastSyncGitHeads?: Record<string, string>;
  lastSyncRunId?: string;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeWikiStateService {
  private root: string;

  constructor(
    root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── State file path ──────────────────────────────────────────────── */

  private stateFilePath(projectDir: string): string {
    return path.join(projectDir, "wiki-state.json");
  }

  /* ── Read / Write ─────────────────────────────────────────────────── */

  /** Read wiki-state.json for a project. Returns null if not yet created. */
  getWikiState(projectDir: string): WikiState | null {
    const filePath = this.stateFilePath(projectDir);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Strict workspace-facing state read. Unlike the legacy project-facing
   * reader, malformed authoritative state is never interpreted as absence.
   */
  getWorkspaceWikiState(projectDir: string): Promise<WikiState | null> {
    return this.persistence.readJson(this.stateFilePath(projectDir), {
      context: { storage: "wiki_state" },
      missing: () => null,
      validate: validateWikiState,
    });
  }

  /** Save wiki-state.json for a project. Creates the file if needed. */
  saveWikiState(projectDir: string, state: WikiState): void {
    const filePath = this.stateFilePath(projectDir);
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /** Create a fresh empty WikiState. */
  createEmptyState(): WikiState {
    return {
      version: 1,
      lastBuildAt: null,
      lastBuildMode: null,
      gitHeads: {},
      topics: {},
    };
  }

  /* ── Git Delta Detection ──────────────────────────────────────────── */

  /**
   * Get the list of files changed between two git refs.
   * Returns relative file paths from the repo root.
   */
  getChangedFiles(repoPath: string, fromRef: string, toRef: string): string[] {
    try {
      const result = execSync(`git diff --name-only ${fromRef}..${toRef}`, {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Determine which wiki topics are affected by a set of changed files.
   * Uses a multi-layer matching strategy:
   * 1. Direct dep match — changed file matches a tracked dependency
   * 2. Directory segment match — changed file's directory matches a topic slug
   * 3. Root-level file filter — root-level docs (README.md, AGENTS.md) are
   *    considered metadata changes and don't trigger topic rebuilds
   */
  getAffectedTopics(
    state: WikiState,
    changedFiles: string[],
  ): string[] {
    if (changedFiles.length === 0) return [];

    // Filter out root-level metadata files that don't affect code topics
    const metadataPatterns = /^(\.cursor|\.|node_modules)\//;
    const metadataExtensions = /\.(md|txt|yml|yaml|json|toml|lock|gitignore)$/;
    const sourceFiles = changedFiles.filter((f) => {
      // Root-level non-code files are metadata
      if (!f.includes("/") && metadataExtensions.test(f)) return false;
      // Dot-directories and node_modules are not relevant
      if (metadataPatterns.test(f)) return false;
      return true;
    });

    const affected = new Set<string>();

    for (const [topicId, topicState] of Object.entries(state.topics)) {
      // Layer 1: Direct dependency match
      for (const dep of topicState.deps) {
        const isMatch = sourceFiles.some((file) => {
          if (file === dep) return true;
          if (dep.endsWith("/") && file.startsWith(dep)) return true;
          // File is within the same directory as dep
          const depDir = path.dirname(dep);
          if (depDir !== "." && file.startsWith(depDir + "/")) return true;
          // Basename match (dep might be relative, file might be absolute or vice versa)
          if (path.basename(file) === path.basename(dep)) return true;
          return false;
        });
        if (isMatch) {
          affected.add(topicId);
          break;
        }
      }
      if (affected.has(topicId)) continue;

      // Layer 2: Directory segment match — if a changed file's path
      // contains the topic slug as a directory segment
      const slugParts = topicId.split("-");
      for (const file of sourceFiles) {
        const fileParts = file.toLowerCase().split(/[\/._-]/);
        // Check if all slug parts appear in the file path
        const allPartsMatch = slugParts.every((part) =>
          fileParts.some((fp) => fp === part || fp.includes(part)),
        );
        if (allPartsMatch && slugParts.length >= 2) {
          affected.add(topicId);
          break;
        }
      }
    }

    return [...affected];
  }

  /* ── Dependency Extraction ────────────────────────────────────────── */

  /**
   * Extract file dependencies from wiki page content.
   * Parses:
   * - "Key Files" sections with listed paths
   * - Markdown links to files: [text](path/to/file.ts#L10-L20)
   * - Inline code references: `path/to/file.ts`
   */
  extractDepsFromContent(content: string): string[] {
    const deps = new Set<string>();

    // Match file paths in markdown links: [text](some/path/file.ext) or [text](some/path/file.ext#L10)
    const linkRegex = /\[(?:[^\]]*)\]\(([^)]+\.\w+(?:#[^)]*)?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
      let filePath = match[1];
      // Strip line anchors
      filePath = filePath.replace(/#.*$/, "");
      // Skip URLs
      if (filePath.startsWith("http") || filePath.startsWith("//")) continue;
      // Skip wiki links
      if (filePath.startsWith("[[") || filePath.endsWith("]]")) continue;
      deps.add(filePath);
    }

    // Match file paths in Key Files sections (lines starting with - or * followed by a path)
    const keyFilesRegex = /^[-*]\s+[`"]?([a-zA-Z0-9_/.]+\.\w+)[`"]?/gm;
    while ((match = keyFilesRegex.exec(content)) !== null) {
      const filePath = match[1];
      if (!filePath.startsWith("http")) {
        deps.add(filePath);
      }
    }

    // Match backtick-quoted file paths that look like source files (any path with a slash and extension)
    const backtickRegex = /`((?:[a-zA-Z0-9_][a-zA-Z0-9_./-]+)\/[a-zA-Z0-9_/.]+\.[a-z]{1,6})`/g;
    while ((match = backtickRegex.exec(content)) !== null) {
      // Skip URLs and wiki-internal refs
      if (match[1].startsWith("http")) continue;
      deps.add(match[1]);
    }

    return [...deps];
  }

  /**
   * Extract deps for all wiki topics from their page content.
   * Returns a map of topicId → dep paths.
   */
  async extractDepsFromWikiPages(
    projectDir: string,
    wikiSvc: { getTopicContent: (projectId: string, topicId: string) => Promise<string | null> },
    projectId: string,
    topicIds: string[],
  ): Promise<Record<string, string[]>> {
    const depsMap: Record<string, string[]> = {};

    for (const topicId of topicIds) {
      const content = await wikiSvc.getTopicContent(projectId, topicId);
      if (content) {
        depsMap[topicId] = this.extractDepsFromContent(content);
      } else {
        depsMap[topicId] = [];
      }
    }

    return depsMap;
  }

  /* ── Depth Evaluation ─────────────────────────────────────────────── */

  /**
   * Evaluate the depth metrics for a wiki page's content.
   * Returns metrics that can be used to classify the topic's depth level.
   */
  evaluateTopicMetrics(content: string): TopicDepthMetrics {
    // Word count
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Code examples: count fenced code blocks (``` blocks)
    const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
    const codeExampleCount = codeBlocks.length;

    // File references: any path-like reference
    const fileRefRegex = /(?:`|"|')(?:src|server|lib|app|pkg|internal|cmd)\/[a-zA-Z0-9_/.]+\.\w+(?:`|"|')/g;
    const fileRefs = content.match(fileRefRegex) ?? [];
    const fileRefCount = fileRefs.length;

    // File refs with line numbers
    const lineNumRefRegex = /[a-zA-Z0-9_/.]+\.\w+[#:](L?\d+)/g;
    const lineNumRefs = content.match(lineNumRefRegex) ?? [];
    const fileRefsWithLineNumbers = lineNumRefs.length;

    // Mermaid diagrams
    const mermaidRegex = /```mermaid[\s\S]*?```/g;
    const diagrams = content.match(mermaidRegex) ?? [];
    const diagramCount = diagrams.length;

    // Cross-references: [[wiki links]] or links to other topic pages
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    const crossRefs = content.match(wikiLinkRegex) ?? [];
    const crossRefCount = crossRefs.length;

    // Edge cases section
    const hasEdgeCases = /(?:edge\s+case|error\s+handling|failure\s+mode|corner\s+case)/i.test(content);

    // Performance notes
    const hasPerformanceNotes = /(?:performance|bottleneck|optimization|latency|throughput|caching)/i.test(content);

    // Testing strategy
    const hasTestingStrategy = /(?:test(?:ing)?\s+strategy|unit\s+test|integration\s+test|test\s+coverage)/i.test(content);

    // Historical context
    const hasHistoricalContext = /(?:historical|originally|previously|was\s+changed|decision\s+was|ADR|migration)/i.test(content);

    return {
      wordCount,
      codeExampleCount,
      fileRefCount,
      fileRefsWithLineNumbers,
      diagramCount,
      crossRefCount,
      hasEdgeCases,
      hasPerformanceNotes,
      hasTestingStrategy,
      hasHistoricalContext,
    };
  }

  /**
   * Classify a topic's depth based on its metrics, using the rubric.
   */
  classifyDepth(metrics: TopicDepthMetrics): TopicDepth {
    // Deep: all developed requirements + edge cases, perf, testing, history, 2+ diagrams, 3+ cross-refs
    if (
      metrics.wordCount >= 1500 &&
      metrics.codeExampleCount >= 5 &&
      metrics.diagramCount >= 2 &&
      metrics.crossRefCount >= 3 &&
      metrics.hasEdgeCases &&
      metrics.hasPerformanceNotes &&
      metrics.hasTestingStrategy &&
      metrics.hasHistoricalContext
    ) {
      return "deep";
    }

    // Developed: 2+ code examples, 1+ diagram, 2+ cross-refs, 500+ words, file refs with line numbers
    if (
      metrics.wordCount >= 500 &&
      metrics.codeExampleCount >= 2 &&
      metrics.diagramCount >= 1 &&
      metrics.crossRefCount >= 2 &&
      metrics.fileRefsWithLineNumbers >= 2
    ) {
      return "developed";
    }

    // Default: outline
    return "outline";
  }

  /**
   * Evaluate a topic's content and return both metrics and classified depth.
   */
  evaluateTopicDepth(content: string): { depth: TopicDepth; metrics: TopicDepthMetrics } {
    const metrics = this.evaluateTopicMetrics(content);
    const depth = this.classifyDepth(metrics);
    return { depth, metrics };
  }
}

function validateWikiState(value: unknown): WikiState {
  if (!isRecord(value)
    || value.version !== 1
    || (value.lastBuildAt !== null && !isTimestamp(value.lastBuildAt))
    || (value.lastBuildMode !== null && typeof value.lastBuildMode !== "string")
    || !isStringRecord(value.gitHeads)
    || !isRecord(value.topics)
    || (value.lastSyncAt !== undefined && !isTimestamp(value.lastSyncAt))
    || (value.lastSyncGitHeads !== undefined && !isStringRecord(value.lastSyncGitHeads))
    || (value.lastSyncRunId !== undefined && typeof value.lastSyncRunId !== "string")) {
    throw new Error("invalid wiki state");
  }

  if (typeof value.lastSyncRunId === "string") {
    assertSafePathSegment(value.lastSyncRunId, "wiki sync run ID");
  }

  for (const [topicId, rawTopic] of Object.entries(value.topics)) {
    assertSafePathSegment(topicId, "wiki topic ID");
    if (!isRecord(rawTopic)
      || !new Set(["outline", "developed", "deep"]).has(String(rawTopic.depth))
      || !isTimestamp(rawTopic.builtAt)
      || (rawTopic.lastDeepenedAt !== undefined && !isTimestamp(rawTopic.lastDeepenedAt))
      || !Array.isArray(rawTopic.deps)
      || !rawTopic.deps.every((dependency) => typeof dependency === "string")
      || !isTopicMetrics(rawTopic.metrics)) {
      throw new Error("invalid wiki topic state");
    }
  }

  return value as unknown as WikiState;
}

function isTopicMetrics(value: unknown): value is TopicDepthMetrics {
  if (!isRecord(value)) return false;
  const numericFields = [
    "wordCount",
    "codeExampleCount",
    "fileRefCount",
    "fileRefsWithLineNumbers",
    "diagramCount",
    "crossRefCount",
  ];
  const booleanFields = [
    "hasEdgeCases",
    "hasPerformanceNotes",
    "hasTestingStrategy",
    "hasHistoricalContext",
  ];
  return numericFields.every((field) => (
    typeof value[field] === "number"
    && Number.isFinite(value[field])
    && value[field] >= 0
  )) && booleanFields.every((field) => typeof value[field] === "boolean");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
