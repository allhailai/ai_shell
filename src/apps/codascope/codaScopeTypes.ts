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
  | "explore_codebase"
  // Epic Design actions (P1)
  | "create_epic"
  | "update_epic_definition"
  | "scope_epic"
  | "deepen_wiki"
  // Epic Design actions (P2a)
  | "create_design_doc"
  | "update_design_doc"
  | "create_version"
  // Epic Design actions (P2b)
  | "insert_content"
  | "replace_content"
  | "expand_content";

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

// ── Epic Design ─────────────────────────────────────────────────────

export type EpicStatus = "defining" | "scoping" | "designing" | "in-review" | "approved" | "archived";

export type EpicHealth = "active" | "hot" | "stale" | "blocked";

export interface EpicDesign {
  id: string;
  projectId: string;
  title: string;
  status: EpicStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  collaborators: string[];
  currentVersion: number;
}

export interface EpicDesignDetail extends EpicDesign {
  definition: string;              // markdown content
  scope: EpicScope | null;         // null until scoped
  designDocs: EpicDesignDoc[];
  versions: EpicVersion[];
  conversationId: string | null;   // dedicated epic conversation
}

/** Computed at read-time, not stored — derived from timestamps and annotation counts */
export interface EpicHealthInfo {
  health: EpicHealth;
  reason: string;                  // e.g., "No edits in 9 days"
  lastActivityAt: string;
  openAnnotationCount: number;
  activeCollaboratorCount: number; // within last 48h
}

export interface EditLock {
  lockedBy: string;
  lockedAt: string;
  lastActivityAt: string;          // auto-expires 5 min after this
  documentId: string;              // 'definition' | design doc ID
}

// ── Epic Scope (P1) ─────────────────────────────────────────────────

/** Wiki page depth level — re-exported from wiki state for convenience. */
export type TopicDepth = "outline" | "developed" | "deep";

export interface EpicScope {
  entries: EpicScopeEntry[];
  lastScopedAt: string | null;
  lastScopedBy: string | null;     // 'agent' | username
}

export interface EpicScopeEntry {
  topicId: string;
  topicTitle: string;
  type: "existing-wiki" | "existing-concept" | "new";
  source: "agent" | "user";       // who added this entry
  included: boolean;
  previousDepth?: TopicDepth;
  targetDepth?: TopicDepth;
  enrichedAt?: string;
  enrichmentRunId?: string;
}

/** Returned by re-scan — user reviews before applying */
export interface ScopeDiff {
  added: EpicScopeEntry[];         // new topics agent wants to add
  removed: string[];               // topicIds agent wants to remove
  changed: Array<{                 // depth target changes
    topicId: string;
    oldTargetDepth: TopicDepth;
    newTargetDepth: TopicDepth;
    reason: string;
  }>;
  unchanged: string[];             // topicIds with no changes
}

export interface EpicDesignDoc {
  id: string;
  epicId: string;
  title: string;
  template?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  wordCount: number;
  blockCount: number;
  annotationCount: number;
  directiveCount: number;
}

export interface EpicVersion {
  version: number;
  createdAt: string;
  createdBy: string;
  label?: string;
  note?: string;
  definitionHash: string;
  designDocHashes: Record<string, string>;
  scopeHash: string;
  status: "draft" | "in-review" | "approved" | "superseded";
}

// ── Design Doc Templates ────────────────────────────────────────────

export interface DesignDocTemplate {
  id: string;
  title: string;
  description: string;
  filename: string;
}

// ── Version Diff ────────────────────────────────────────────────────

export interface DiffLine {
  type: "add" | "remove" | "same";
  content: string;
  lineNumber?: number;
}

export interface FileDiff {
  filename: string;
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
}

export interface VersionDiff {
  from: number;
  to: number;
  files: FileDiff[];
}

// ── Annotations (P2b) ───────────────────────────────────────────────

export type AnnotationStatus = "open" | "resolved" | "wontfix";

export type DirectiveStatus = "pending" | "generating" | "applied" | "rejected";

export type DirectiveType = "insert" | "replace" | "expand";

/** Block-level anchor for annotations and directives */
export interface BlockAnchor {
  blockId: string;            // deterministic ID for the markdown block
  sectionSlug: string;        // parent section heading slug
  anchorText: string;         // quoted text for fuzzy re-anchoring
  lineNumber: number;         // line at time of creation
}

export interface Annotation {
  id: string;
  epicId: string;
  documentId: string;         // 'definition' | design doc ID
  documentVersion: number;
  anchor: BlockAnchor;
  author: string;
  createdAt: string;
  body: string;               // markdown content
  parentId?: string;          // reply threading
  status: AnnotationStatus;
  reactions: Array<{ emoji: string; user: string }>;
}

export interface InsertionDirective {
  id: string;
  epicId: string;
  documentId: string;
  type: DirectiveType;

  // Anchor
  afterLine: number;
  startLine?: number;
  endLine?: number;
  blockId?: string;
  anchorText?: string;

  instruction: string;
  author: string;
  createdAt: string;
  status: DirectiveStatus;
  generatedContent?: string;
  preApplySnapshot?: string;  // document content before apply — enables undo
  appliedAt?: string;
}

/** Computed block info for a parsed markdown document */
export interface BlockInfo {
  blockId: string;
  sectionSlug: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}
