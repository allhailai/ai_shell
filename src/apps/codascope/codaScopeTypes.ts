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
  epicCount?: number;
  archived?: boolean;
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

export type AssistantScope =
  | { kind: "workspace" }
  | { kind: "project"; projectId: string };

export type AssistantScopeKind = AssistantScope["kind"];

export interface WorkspaceCurrentNoteMetadata {
  stableId: string;
  scope: "codascope";
  path: string;
  title: string;
  visibility: "private" | "shared";
  contentHash?: string;
}

export interface WorkspaceCurrentView {
  view: string;
  identity?: string | null;
  label?: string | null;
}

export interface WorkspaceMessageContext {
  assistantScope: { kind: "workspace" };
  currentNote?: WorkspaceCurrentNoteMetadata | null;
  explicitlyReferencedProjectIds: string[];
  currentView: WorkspaceCurrentView;
  retrievedSources?: WorkspaceRetrievedSourceReference[];
}

export type WorkspaceRetrievedSourceReference =
  | {
      kind: "project_wiki";
      retrieval: "direct" | "search";
      projectId: string;
      projectName: string;
      topicId: string;
      topicTitle: string;
      topicUpdatedAt: string;
      lastWikiBuildAt: string | null;
    }
  | {
      kind: "code_map";
      retrieval: "direct";
      projectId: string;
      projectName: string;
      codeMapId: string;
      generatedAt: string | null;
      lastWikiBuildAt: string | null;
    };

export interface MessageContext {
  view: string;
  topicId?: string | null;
  topicTitle?: string | null;
  filePath?: string | null;
  projectName?: string;
  projectId?: string;
  recentViews?: Array<{ view: string; label: string }>;
  epicId?: string | null;
  epicTitle?: string | null;
  epicTab?: string | null;
  /** Note context (when viewing a note) */
  noteScope?: NoteScope | null;
  noteVisibility?: NoteVisibility | null;
  notePath?: string | null;
}

export type MessageStatus = "complete" | "streaming" | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  updatedAt: string | null;
  modelId: string | null;
  status: MessageStatus;
  context: MessageContext | WorkspaceMessageContext | null;
  metadata: Record<string, unknown>;
}

export interface AssistantChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  images?: Array<{ url: string; filename: string }>;
}

export interface Conversation {
  id: string;
  scope: AssistantScope;
  /** Server-derived custody; clients must never supply or change it. */
  ownerId?: string;
  projectId?: string;
  title: string;
  messages: ConversationMessage[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  defaultModelId: string | null;
  epicId?: string;
}

export interface ConversationSummary {
  id: string;
  scope: AssistantScope;
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
  | "navigate"
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
  | "expand_content"
  // Knowledge & Research
  | "trigger_research";

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
  buildType?: "analyze" | "deep-run";
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
  buildType?: string;
  syncGitHeads?: Record<string, string>;
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


// ── Epic Design ─────────────────────────────────────────────────────

export type EpicStatus = "defining" | "curating" | "designing" | "in-review" | "approved" | "archived";

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
  artifacts?: ArtifactSpec[];      // visual HTML artifacts
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

/** Topic enrichment depth — tracks how well a topic is documented.
 *  Extended for curation tracking: none → stub → outline → developed → comprehensive */
export type TopicDepth = "none" | "stub" | "outline" | "developed" | "comprehensive";

export interface EpicScope {
  entries: EpicScopeEntry[];
  lastScopedAt: string | null;
  lastScopedBy: string | null;     // 'agent' | username
}

export interface EpicScopeEntry {
  topicId: string;
  topicTitle: string;
  type: "existing-wiki" | "new";
  source: "agent" | "user";       // who added this entry
  included: boolean;
  previousDepth?: TopicDepth;
  targetDepth?: TopicDepth;
  currentDepth?: TopicDepth;       // actual depth after curation enrichment
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
  /** Legacy/imported compatibility metadata; not a supported creation input. */
  template?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  wordCount: number;
  blockCount: number;
  annotationCount: number;
  directiveCount: number;
  archivedAt?: string;
  pinnedAt?: string;
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

export type AnnotationOrigin = "user" | "agent";

export type EpicAnnotationDetachmentReason =
  | "legacy_unverified"
  | "block_missing_exact_text"
  | "block_missing_ambiguous_text"
  | "block_missing_no_match";

export type DirectiveStatus = "pending" | "generating" | "applied" | "rejected";

export type DirectiveType = "insert" | "replace" | "expand";

/** Block-level anchor for annotations and directives */
export interface BlockAnchor {
  blockId: string;            // deterministic ID for the markdown block
  sectionSlug: string;        // parent section heading slug
  anchorText: string;         // quoted text for fuzzy re-anchoring
  lineNumber: number;         // line at time of creation
}

/**
 * Durable note-annotation anchor stored in the per-note annotation sidecar.
 * The marker ID is the only annotation data persisted in Markdown; quote and
 * context are retained solely for recovery and audit, never for implicit
 * client-side placement.
 */
export type AnnotationAttachmentState = "attached" | "needs_review" | "orphaned";

export interface InlineAnnotationAnchor {
  kind: "range";
  markerId: string;
  quote: string;
  prefix: string;
  suffix: string;
  createdAtContentHash: string;
  attachmentState: AnnotationAttachmentState;
  lastVerifiedAt?: string;
  lastDetachedAt?: string;
  detachedReason?: "marker_removed" | "malformed_markers" | "duplicate_marker" | "external_edit";
}

export interface Annotation {
  id: string;
  epicId: string;
  documentId: string;         // 'definition' | design doc ID
  documentVersion: number;
  anchor: BlockAnchor;
  author: string;
  /** Trusted provenance. Ownership always remains the initiating username. */
  origin: AnnotationOrigin;
  /** Legacy literal-agent records stay unowned rather than guessing a person. */
  ownership: "owned" | "legacy_unowned";
  createdAt: string;
  body: string;               // markdown content
  parentId?: string;          // reply threading
  status: AnnotationStatus;
  reactions: Array<{ emoji: string; user: string }>;
  attachmentState: AnnotationAttachmentState;
  detachedReason?: EpicAnnotationDetachmentReason;
  detachedAt?: string;
  reattachedAt?: string;
  /** A deleted record is a visible tombstone retained only when descendants exist. */
  deletedAt?: string;
  deletedBy?: string;
}

/** Return every descendant in deterministic parent-before-child thread order. */
export function collectAnnotationDescendants(
  annotations: Annotation[],
  rootId: string,
): Annotation[] {
  const children = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (!annotation.parentId) continue;
    const siblings = children.get(annotation.parentId) ?? [];
    siblings.push(annotation);
    children.set(annotation.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  const descendants: Annotation[] = [];
  const visited = new Set<string>([rootId]);
  const visit = (parentId: string): void => {
    for (const child of children.get(parentId) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return descendants;
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
  /** Full SHA-256 of the exact content produced by this apply. */
  appliedContentHash?: string;
  /**
   * Exact peer positions changed by this apply. Undo verifies the adjusted
   * positions before restoring them so later directive edits are never lost.
   */
  linePositionAdjustments?: DirectiveLinePositionAdjustment[];
  appliedAt?: string;
}

export interface DirectiveLinePosition {
  afterLine: number;
  startLine?: number;
  endLine?: number;
}

export interface DirectiveLinePositionAdjustment {
  directiveId: string;
  before: DirectiveLinePosition;
  after: DirectiveLinePosition;
}

/** Computed block info for a parsed markdown document */
export interface BlockInfo {
  blockId: string;
  sectionSlug: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

// ── Knowledge Directory ─────────────────────────────────────────────

export interface EpicKnowledgeSource {
  id: string;                     // hash-based ID
  epicId: string;
  type: "machine" | "human";      // how it was acquired
  origin: "download" | "upload" | "human-resolved";  // more specific
  url?: string;                   // for downloaded content
  filename: string;               // original filename
  contentType: string;            // MIME type
  title: string;                  // human-readable title
  status: "pending" | "processing" | "ready" | "error";
  addedAt: string;
  processedAt?: string;
  sizeBytesOriginal: number;
  sizeBytesMarkdown?: number;
  topicAssociations: string[];    // scope topic IDs this source relates to
}

export interface EpicKnowledgeManifest {
  sources: EpicKnowledgeSource[];
  lastUpdatedAt: string;
}

export interface BlockedDownload {
  id: string;
  url: string;
  reason: string;                 // "robots.txt", "paywall", "timeout", etc.
  attemptedAt: string;
  status: "blocked" | "dismissed" | "resolved";
  dismissedAt?: string;
  resolvedAt?: string;
  resolvedSourceId?: string;      // links to the source that resolved it
}

export interface BlockedDownloadList {
  items: BlockedDownload[];
}

export interface EpicWikiPage {
  id: string;                     // slug
  title: string;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  sourceRefs: string[];           // source IDs that contributed to this page
}

export interface ResearchPlan {
  queries: ResearchQuery[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchQuery {
  topic: string;
  query: string;
  urls: ResearchUrl[];
}

export interface ResearchUrl {
  url: string;
  type: "corporate" | "government" | "trade_press" | "academic" | "news" | "documentation";
  relevance: string;
  status: "pending" | "downloaded" | "blocked" | "error";
}

// ── Research Query Log ──────────────────────────────────────────────

export interface ResearchQueryLogEntry {
  id: string;                    // unique ID
  parentId?: string;             // if this is a "go deeper" follow-up, links to the original query
  topics: string[];              // the topics the user requested
  createdAt: string;             // ISO timestamp
  status: "completed" | "error" | "cancelled";
  sourcesDownloaded: number;     // how many sources were downloaded
  wikiPagesCreated: number;      // how many wiki pages were created
}

export interface ResearchQueryLog {
  entries: ResearchQueryLogEntry[];
}

// ── Curation ────────────────────────────────────────────────────────

export type CurationReasonType =
  | "definition_changed"
  | "code_delta_processed"
  | "research_sources_added"
  | "human_content_added"
  | "blocked_download_resolved"
  | "research_topics_changed"
  | "manual";

export interface CurationReason {
  type: CurationReasonType;
  at: string;
  detail: string;
}

export interface CurationReasons {
  reasons: CurationReason[];
}

export interface CurationLogEntry {
  curationId: string;
  epicId: string;
  triggeredAt: string;
  completedAt?: string;
  status: "running" | "complete" | "error";
  resolvedReasons: CurationReason[];
  results?: CurationResults;
  modelId: string;
  durationMs?: number;
  error?: string;
}

export interface CurationResults {
  mainWiki: {
    enriched: Array<{ topicId: string; previousDepth: string; newDepth: string }>;
    created: Array<{ topicId: string; depth: string }>;
  };
  epicWiki: {
    created: string[];
    updated: string[];
  };
  scope: { added: number; removed: number };
}

// ── Wiki Deletion Confirmation ──────────────────────────────────────

export interface PendingWikiDeletion {
  topicId: string;
  requestedBy: "agent" | "user";
  requestedAt: string;
  reason: string;
  epicId?: string;
  curationId?: string;
  status: "pending" | "approved" | "rejected";
}

// ── Visual Artifacts ────────────────────────────────────────────────

export interface ArtifactSpec {
  id: string;
  epicId?: string;           // null for project-level artifacts
  title: string;
  lastBuilt: string | null;
  status: "draft" | "building" | "built";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  pinnedAt?: string;
  archivedAt?: string;
}

export interface ArtifactSection {
  id: string;
  title: string;
  hidden?: boolean;
}

export interface ArtifactSectionsResponse {
  sections: ArtifactSection[];
  regeneratedSections: string[];
  regenerationCount: number;
  contractVersion: number | null;
  hiddenSectionIds: string[];
}

export interface ArtifactElementContext {
  elementTag: string;
  elementId?: string;
  cssPath?: string;
  elementText?: string;
  elementHTML?: string;
}

export interface ArtifactAnnotation {
  id: string;
  sectionId: string;
  sectionTitle: string;
  instruction: string;
  elementContext?: ArtifactElementContext | null;
  status: "pending" | "applied" | "failed" | "inactive";
  previouslyApplied?: boolean;
  type?: "modify" | "add_section";
  afterSectionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactBuildVersion {
  version: number;
  timestamp: string;
  dirName: string;
  sizeBytes: number;
  isCurrent?: boolean;
}

export interface ArtifactBuildProgress {
  artifactId: string;
  status: "idle" | "building" | "regenerating" | "complete" | "error";
  progress?: string;
  startedAt?: string;
  error?: string;
}

// ── API Response Types ──────────────────────────────────────────────

/** Response shape for `GET /api/codascope/projects/:id/wiki-state` */
export interface WikiState {
  topics: Record<string, {
    depth: TopicDepth;
    updatedAt?: string;
  }>;
  // Deep Run sync point metadata
  lastSyncAt?: string;
  lastSyncGitHeads?: Record<string, string>;
  lastSyncRunId?: string;
}

/** Response shape for `GET /api/codascope/projects/:id/epics/:epicId/brief` */
export interface EpicBriefResponse {
  brief: string;
}

// ── Notes ────────────────────────────────────────────────────────────

export type NoteScope = "codascope" | "project" | "epic";
export type NoteVisibility = "shared" | "private";
export type NoteState = "active" | "archived";

export interface NoteFrontmatter {
  id: string;           // Stable UUID
  title: string;
  tags: string[];
  created: string;
  updated: string;
  owner: string;        // User ID who created the note
  status?: "draft" | "ready";  // Shared notes only; private notes ignore this
  /** Shared, server-owned priority metadata. Never written from client saves. */
  pinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
}

export interface NoteEntry {
  path: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  wordCount: number;
  isFolder?: boolean;
  childCount?: number;
  noteId?: string;             // Frontmatter UUID (for read tracking)
  lastEditor?: string;         // Username of last editor
  lastEditedAt?: string;       // ISO timestamp of last edit
  status?: "draft" | "ready";  // Shared notes only
  pinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  /** Current user's private preference, supplied by the authenticated list route. */
  starred?: boolean;
}

export interface NoteFolderEntry {
  name: string;
  path: string;
  noteCount: number;
  subfolders: NoteFolderEntry[];
}

/**
 * A note annotation — the frontend-facing type.
 * Mirrors the server's NoteAnnotation (codaScopeNoteAnnotationService.ts)
 * but defined here to avoid cross-boundary imports that trigger node:fs errors.
 */
export interface NoteAnnotation extends Omit<Annotation,
  | "epicId"
  | "documentId"
  | "documentVersion"
  | "anchor"
  | "origin"
  | "ownership"
  | "attachmentState"
  | "detachedReason"
  | "detachedAt"
  | "reattachedAt"
  | "deletedAt"
  | "deletedBy"
> {
  noteScope: NoteScope;
  noteVisibility: NoteVisibility;
  notePath: string;
  /** Inline anchors are authoritative. Block anchors remain readable only for migration/audit. */
  anchor: InlineAnnotationAnchor | BlockAnchor;
  legacyAnchor?: BlockAnchor;
  archivedAt?: string;
  archivedBy?: string;
}

/** Tag index entry returned by the tag browser endpoint. */
export interface NoteTagIndexEntry {
  tag: string;
  count: number;
}

/** Link index stored on disk (_link-index/notes-links.json). */
export interface NoteLinkIndex {
  generatedAt: string;
  /** Map of targetNoteId → array of sourceNoteIds that link to it */
  links: Record<string, string[]>;
}

/** Backlink entry returned to the frontend. */
export interface NoteBacklink {
  noteId: string;
  title: string;
  path: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  isArchived?: boolean;
}

/** Bulk archive request body. */
export interface BulkArchiveRequest {
  noteIds: string[];
  reason?: string;
}

/** Bulk archive response. */
export interface BulkArchiveResponse {
  archived: number;
  failed: string[];
  correlationId: string;
}

/** Bulk move request body. */
export interface BulkMoveRequest {
  noteIds: string[];
  fromScope: NoteScope;
  fromVisibility: NoteVisibility;
  fromOpts: { userId?: string; projectId?: string; epicId?: string };
  toScope: NoteScope;
  toVisibility: NoteVisibility;
  toOpts: { userId?: string; projectId?: string; epicId?: string };
  toFolder: string;
}

/** Metadata stored in _archive-meta.json inside each archive envelope */
export interface NoteArchiveMeta {
  noteId: string;
  /** A folder archive preserves a whole nested tree in one envelope. */
  kind?: "note" | "folder";
  archivedAt: string;
  archivedBy: string;
  originalPath: string;
  originalScope: NoteScope;
  originalVisibility: NoteVisibility;
  reason?: string;
  title: string;
}

/** Audit event for note operations (append-only JSONL) */
export interface NoteAuditEvent {
  event: string;
  timestamp: string;
  actor: string;
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/** Filters for querying audit events */
export interface NoteAuditQueryFilters {
  noteId?: string;
  event?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// ── Starred & Recents ──────────────────────────────────────────────

/** A starred note reference (stored per-user). */
export interface StarredNoteRef {
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  title: string;
  starredAt: string;
}

/** One opaque file owned by a note. The stored path is immutable and bundle-relative. */
export interface NoteDocument {
  id: string;
  storedPath: string;
  originalFilename: string;
  displayName: string;
  declaredMimeType: string | null;
  detectedMimeType: string | null;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  comment: string;
  commentUpdatedAt?: string;
  commentUpdatedBy?: string;
  pinnedAt?: string;
  pinnedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  /** Per-response, current-user preference; never persisted in index.json. */
  starred?: boolean;
}

/** Current-user reference stored outside the shared note bundle. */
export interface StarredNoteDocumentRef {
  documentId: string;
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  displayName: string;
  starredAt: string;
}

export interface NoteDocumentListResponse {
  active: NoteDocument[];
  archived: NoteDocument[];
  totalBytes: number;
  maxBytes: number;
}

/** A recent note reference (stored per-user). */
export interface RecentNoteRef {
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  title: string;
  viewedAt: string;
}

/** Request body for quick capture. */
export interface QuickCaptureRequest {
  body: string;
}

/** Response from quick capture. */
export interface QuickCaptureResponse {
  path: string;
  noteId: string;
  contentHash: string;
}

// ── Note Activity ──────────────────────────────────────────────────

export interface NoteActivityEntry {
  type: "edit" | "created" | "moved" | "archived" | "restored" | "visibility_changed";
  timestamp: string;
  actor: string;
  details: string;  // human-readable: "Added 45 words", "Moved from shared to private"
}

// ── Note Read Status ───────────────────────────────────────────────

export interface NoteReadStatus {
  noteId: string;
  readAt: string | null;
}

export interface NoteReaderInfo {
  userId: string;
  readAt: string;
}
