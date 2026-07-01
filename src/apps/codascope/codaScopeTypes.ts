/* ── CodaScope: Shared API Types ──────────────────────────────────────
   Canonical type definitions for the CodaScope API contract.
   Shared between server routes and client components.

   These types describe the shapes that flow over the wire (HTTP JSON and
   SSE payloads). Internal service types (e.g., file paths, queue state)
   remain private to their respective modules.

   Import convention:
     import type { WikiTopic, BuildState } from "../codaScopeTypes.js";
   ──────────────────────────────────────────────────────────────────── */

// ── Projects ────────────────────────────────────────────────────────

export interface CodaScopeRepo {
  id: string;
  name: string;
  path: string;
  branch?: string;
}

export interface CodaScopeProject {
  id: string;
  name: string;
  description: string;
  repositories: CodaScopeRepo[];
  createdAt: string;
  updatedAt: string;
  wikiPageCount?: number;
  qualityScore?: number;
  conceptCount?: number;
}

// ── Wiki ────────────────────────────────────────────────────────────

export interface WikiTopic {
  id: string;
  title: string;
  path: string;
  type?: string;
  updatedAt?: string;
}

// ── Chat / Conversations ────────────────────────────────────────────

export interface MessageContext {
  view: string;
  topicId?: string | null;
  topicTitle?: string | null;
  filePath?: string | null;
  projectName?: string;
  projectId?: string;
  recentViews?: Array<{ view: string; label: string }>;
}

export type MessageStatus = "complete" | "streaming" | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  updatedAt?: string | null;
  modelId?: string | null;
  status?: MessageStatus;
  context?: MessageContext | null;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ── Agent Actions ───────────────────────────────────────────────────

/**
 * A structured action tag extracted from agent response text.
 * Rendered as interactive ActionCards in the chat UI.
 */
export interface CodaScopeAction {
  type: string;
  attributes: Record<string, string>;
  description: string;
}

/** Valid action types the agent can suggest */
export type CodaScopeActionType =
  | "build_wiki_page"
  | "build_full_wiki"
  | "run_quality_scan"
  | "navigate"
  | "create_golden_rule"
  | "explore_codebase";

// ── Build State ─────────────────────────────────────────────────────

export type BuildStatus = "idle" | "building" | "complete" | "error";

export interface TokenUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export type PipelineStepStatus = "pending" | "running" | "complete" | "skipped" | "error" | "building" | "enriched";

export interface PipelineStepRecord {
  id: string;
  label: string;
  status: string;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: TokenUsageRecord;
  updatedAt?: string;
}

export interface BuildState {
  runId: string;
  status: BuildStatus;
  command: string;
  modelId: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  pipelineSteps?: PipelineStepRecord[];
}

export interface BuildLogEntry {
  runId: string;
  command: string;
  modelId?: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  pageCount?: number | null;
  durationMs: number | null;
}

// ── Skills ──────────────────────────────────────────────────────────

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  tier: "framework" | "project";
  lockType: "read" | "write";
}

// ── Quality ─────────────────────────────────────────────────────────

export interface QualityIssue {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info";
  category: string;
  file?: string;
  line?: number;
  description: string;
}

export interface QualitySummary {
  score: number;
  issueCount: number;
  timestamp: string;
  categories: Record<string, { score: number; issues: number }>;
}

// ── Concepts ────────────────────────────────────────────────────────

export interface Concept {
  name: string;
  category: string;
  description?: string;
}

// ── Golden Rules ────────────────────────────────────────────────────

export interface GoldenRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
}
