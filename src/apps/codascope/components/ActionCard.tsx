/* ── CodaScope: Action Card Component ─────────────────────────────────
   Renders interactive action cards inline in the assistant message thread.
   
   Pending operations are dispatched client-side. Tool-confirmed mutations
   render as completed cards so the user can see what was actually changed.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import type { CodaScopeAction } from "../codaScopeTypes";
import {
  IconArtifact,
  IconBook,
  IconCheck,
  IconClipboard,
  IconCodeMap,
  IconEpic,
  IconExpand,
  IconFile,
  IconInsertContent,
  IconLaunch,
  IconPlan,
  IconRewrite,
  IconRefresh,
  IconSearch,
  IconWarning,
} from "./CodaScopeIcons";
import { startSseStream } from "../codaScopeSseClient";
import { useBuildState } from "../hooks/useBuildState";
import { useCommandBus } from "../../../shell/hooks";

// Re-export for existing consumers
export type { CodaScopeAction };

type ActionStatus = "idle" | "running" | "success" | "error";

/* ── Icons ───────────────────────────────────────────────────────────── */

function ActionIcon({ type }: { type: string }) {
  const icon = (content: ReactNode) => <span className="codascope-action-icon">{content}</span>;
  switch (type) {
    case "build_wiki_page":
      return icon(<IconBook size={14} />);
    case "build_full_wiki":
      return icon(<IconBook size={14} />);
    case "navigate":
      return icon(<IconLaunch size={14} />);
    case "explore_codebase":
      return icon(<IconSearch size={14} />);
    case "create_epic":
      return icon(<IconEpic size={14} />);
    case "update_epic_definition":
      return icon(<IconClipboard size={14} />);
    case "scope_epic":
      return icon(<IconPlan size={14} />);
    case "deepen_wiki":
      return icon(<IconSearch size={14} />);
    case "create_design_doc":
      return icon(<IconFile size={14} />);
    case "update_design_doc":
      return icon(<IconFile size={14} />);
    case "create_version":
      return icon(<IconClipboard size={14} />);
    case "insert_content":
      return icon(<IconInsertContent size={14} />);
    case "replace_content":
      return icon(<IconRewrite size={14} />);
    case "expand_content":
      return icon(<IconExpand size={14} />);
    case "trigger_research":
      return icon(<IconSearch size={14} />);
    case "artifact_built":
      return icon(<IconArtifact size={14} />);
    case "operation_completed":
      return icon(<IconCheck size={14} />);
    default:
      return icon(<IconCodeMap size={14} />);
  }
}

function actionLabel(type: string): string {
  switch (type) {
    case "build_wiki_page": return "Build Wiki Page";
    case "build_full_wiki": return "Build Full Wiki";
    case "navigate": return "Go To";
    case "explore_codebase": return "Explore Codebase";
    case "create_epic": return "Create Epic";
    case "update_epic_definition": return "Update Definition";
    case "scope_epic": return "Scope Epic";
    case "deepen_wiki": return "Deepen Wiki";
    case "create_design_doc": return "Create Design Doc";
    case "update_design_doc": return "Update Design Doc";
    case "create_version": return "Create Version";
    case "insert_content": return "Insert Content";
    case "replace_content": return "Rewrite Content";
    case "expand_content": return "Expand Content";
    case "trigger_research": return "Research";
    case "artifact_built": return "Artifact Built";
    case "operation_completed": return "Completed";
    default: return "Action";
  }
}

function actionButtonLabel(type: string, status: ActionStatus): string {
  if (status === "running") return "Running…";
  if (status === "success") return "Done";
  if (status === "error") return "Failed";
  switch (type) {
    case "navigate": return "Go";
    case "create_epic": return "Create";
    case "update_epic_definition": return "Save";
    case "scope_epic": return "Scope";
    case "deepen_wiki": return "Deepen";
    case "create_design_doc": return "Create";
    case "update_design_doc": return "Open";
    case "create_version": return "Snapshot";
    case "insert_content": return "Insert";
    case "replace_content": return "Rewrite";
    case "expand_content": return "Expand";
    case "trigger_research": return "Start Research";
    case "artifact_built": return "View";
    default: return "Run";
  }
}

/* ── Action Card Component ───────────────────────────────────────────── */

/**
 * Map action types to their build scope key (for server-tracked builds).
 * Returns null for actions that don't use BuildStateService.
 */
function getBuildScope(type: string, attributes: Record<string, string>): string | null {
  const epicId = attributes.epicId;
  switch (type) {
    case "trigger_research":
      return epicId ? `research::${epicId}` : null;
    case "deepen_wiki":
      return epicId ? `epic-deepen::${epicId}` : null;
    // Project-level builds (wiki, explore) use unscoped project-level tracking
    case "build_wiki_page":
    case "build_full_wiki":
    case "explore_codebase":
      return null; // These use the default project-level build key (no scope)
    default:
      return null;
  }
}

/**
 * Returns true for action types that run async pipelines (not instant navigation).
 */
function isAsyncAction(type: string): boolean {
  return [
    "build_wiki_page", "build_full_wiki",
    "explore_codebase", "deepen_wiki", "trigger_research",
  ].includes(type);
}

export function ActionCard({ action }: { action: CodaScopeAction }) {
  const { type, attributes, description } = action;
  const [localStatus, setLocalStatus] = useState<ActionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const { navigate } = useAppSubRoute("codascope");
  const { activeProjectId, selectedModel } = useCodaScopeStore();
  const commandBus = useCommandBus();
  const isCompletedOperation = COMPLETED_ACTION_TYPES.has(type);
  const canNavigateCompletedOperation = [
    "artifact_built", "design_doc_created", "design_doc_edited",
  ].includes(type);

  // Determine if this action has a server-tracked build scope
  const buildScope = getBuildScope(type, attributes);
  const tracked = buildScope !== null && isAsyncAction(type);

  // Hydrate build state from server for tracked actions
  const hydrated = useBuildState({
    projectId: activeProjectId,
    scope: buildScope ?? "",
    enabled: tracked,
  });

  // ── Research completion check via query log ──────────────────────
  // When build state returns "idle" (no build log for this scope),
  // check the research query log for a completed entry whose topics
  // match THIS card's specific topics. This avoids false positives
  // when multiple research cards exist for the same epic.
  const [researchLogDone, setResearchLogDone] = useState(false);
  const researchCheckRef = useRef(false);

  useEffect(() => {
    if (type !== "trigger_research") return;
    if (!activeProjectId || !attributes.epicId) return;
    // Only check once, and only if build state didn't find a log
    if (researchCheckRef.current || hydrated.status !== "idle") return;
    researchCheckRef.current = true;

    // Parse the card's topics to build keyword set for matching
    const cardTopics = (attributes.topics ?? "")
      .split(",")
      .map((t: string) => t.trim().toLowerCase())
      .filter(Boolean);
    if (cardTopics.length === 0) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${attributes.epicId}/knowledge/research-log`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const entries = data.entries ?? [];

        // Check if any completed entry's topics overlap with this card's topics.
        // Use direct substring containment — a match means one topic string
        // contains the other (e.g., card="Elation EMR scheduling templates"
        // matches log="Elation EMR scheduling templates and availability API").
        const hasMatch = entries.some((entry: { topics?: string[]; status?: string }) => {
          if (entry.status !== "completed") return false;
          const logTopics = (entry.topics ?? []).map((t: string) => t.toLowerCase());
          return cardTopics.some((ct: string) =>
            logTopics.some((lt: string) => lt.includes(ct) || ct.includes(lt)),
          );
        });

        if (hasMatch) {
          setResearchLogDone(true);
        }
      } catch {
        // Silently ignore — stay idle
      }
    })();
  }, [type, activeProjectId, attributes.epicId, attributes.topics, hydrated.status]);

  // Merge hydrated state with local state.
  // Local state takes priority while the user is actively dispatching.
  // Once idle, the hydrated state takes over.
  // Research log fallback: if build state is idle but a matching log entry exists, treat as success.
  const baseStatus: ActionStatus = isCompletedOperation
    ? "success"
    : localStatus !== "idle" ? localStatus : hydrated.status;
  const effectiveStatus: ActionStatus =
    baseStatus === "idle" && researchLogDone ? "success" : baseStatus;
  const effectiveProgress = localStatus === "running" ? progressMsg : hydrated.progressMsg;
  const effectiveError = localStatus === "error" ? errorMsg : hydrated.error;

  const handleRebuild = useCallback(() => {
    hydrated.rebuild();
    setLocalStatus("idle");
    setResearchLogDone(false);
    setErrorMsg(null);
    setProgressMsg(null);
  }, [hydrated.rebuild]);

  const dispatchAction = useCallback(async () => {
    if (!activeProjectId) return;

    // Navigation actions are instant — no loading state needed
    if (type === "navigate") {
      const view = attributes.view ?? "dashboard";
      const topicId = attributes.topicId;
      const epicId = attributes.epicId;
      let path: string;
      if (epicId) {
        // Epic-scoped navigation (e.g. design tab within an epic)
        path = topicId
          ? `project/${activeProjectId}/epic/${epicId}/${view}/${topicId}`
          : `project/${activeProjectId}/epic/${epicId}/${view}`;
      } else {
        path = topicId
          ? `project/${activeProjectId}/${view}/${topicId}`
          : `project/${activeProjectId}/${view}`;
      }
      navigate(path);
      return;
    }


    // Epic actions — navigate to epic views
    if (type === "create_epic") {
      navigate(`project/${activeProjectId}/epics`);
      return;
    }
    if (type === "update_epic_definition") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/define`);
      }
      return;
    }
    if (type === "scope_epic") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/scope`);
      }
      return;
    }
    if (type === "create_design_doc") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/design`);
      } else {
        navigate(`project/${activeProjectId}/epics`);
      }
      return;
    }
    if (type === "update_design_doc") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/design`);
      }
      return;
    }
    if (type === "create_version") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/history`);
      }
      return;
    }

    // P2b content actions — navigate to the design tab where inline directives are used
    if (type === "insert_content" || type === "replace_content" || type === "expand_content") {
      const epicId = attributes.epicId;
      if (epicId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/design`);
      }
      return;
    }

    // Artifact notification — navigate to the artifact preview
    if (type === "artifact_built") {
      const epicId = attributes.epicId;
      const artifactId = attributes.artifactId;
      if (epicId && artifactId) {
        navigate(`project/${activeProjectId}/epic/${epicId}/design/artifact:${artifactId}`);
      }
      return;
    }

    // Async actions use loading state
    setLocalStatus("running");
    setErrorMsg(null);

    try {
      switch (type) {

        case "build_wiki_page": {
          const commandPayload: Record<string, string> = {
            command: "do_build_wiki_page",
            modelId: selectedModel ?? "",
          };
          if (attributes.topic) {
            commandPayload.topicName = attributes.topic;
          }
          await awaitSseStream({
            url: `/api/codascope/projects/${activeProjectId}/runs`,
            method: "POST",
            body: commandPayload,
          });
          setLocalStatus("success");
          return;
        }

        case "build_full_wiki": {
          await awaitSseStream({
            url: `/api/codascope/projects/${activeProjectId}/runs`,
            method: "POST",
            body: { command: "do_build_full_wiki", modelId: selectedModel ?? "" },
          });
          setLocalStatus("success");
          return;
        }


        case "explore_codebase": {
          await awaitSseStream({
            url: `/api/codascope/projects/${activeProjectId}/runs`,
            method: "POST",
            body: { command: "do_explore", modelId: selectedModel ?? "" },
          });
          setLocalStatus("success");
          return;
        }

        case "deepen_wiki": {
          const epicId = attributes.epicId;
          if (!epicId) {
            throw new Error("Missing epicId for deepen_wiki");
          }
          await awaitSseStream({
            url: `/api/codascope/projects/${activeProjectId}/epics/${epicId}/deepen`,
            method: "POST",
            body: { modelId: selectedModel ?? "" },
          });
          setLocalStatus("success");
          return;
        }

        case "trigger_research": {
          const epicId = attributes.epicId;
          if (!epicId) {
            throw new Error("Missing epicId for trigger_research");
          }
          // Parse topics — the agent may pass them as comma-separated in a single attr
          const topicsRaw = attributes.topics ?? "";
          const topics = topicsRaw
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean);
          if (topics.length === 0) {
            throw new Error("No research topics specified");
          }
          await runResearchStream(
            `/api/codascope/projects/${activeProjectId}/epics/${epicId}/knowledge/research`,
            { modelId: selectedModel ?? "", topics },
            setProgressMsg,
          );
          setLocalStatus("success");
          setProgressMsg(null);
          commandBus.emit("codascope:knowledge-changed", { epicId: attributes.epicId });
          return;
        }

        default:
          setLocalStatus("error");
          setErrorMsg(`Unknown action type: ${type}`);
      }
    } catch (err) {
      setLocalStatus("error");
      setErrorMsg((err as Error).message);
    }
  }, [type, attributes, activeProjectId, selectedModel, navigate]);

  const isTerminal = effectiveStatus === "success" || effectiveStatus === "error";

  return (
    <div className={`codascope-action-card codascope-action-card-${effectiveStatus}`}>
      <div className="codascope-action-card-header">
        <ActionIcon type={type} />
        <span className="codascope-action-card-label">{actionLabel(type)}</span>
        {attributes.topic && (
          <span className="codascope-action-card-attr">{attributes.topic}</span>
        )}
        {/* Status badge — prominent success/error indicator */}
        {effectiveStatus === "success" && (
          <span className="codascope-action-card-badge codascope-action-card-badge-success"><IconCheck size={12} /> Completed</span>
        )}
        {effectiveStatus === "error" && (
          <span className="codascope-action-card-badge codascope-action-card-badge-error"><IconWarning size={12} /> Failed</span>
        )}
      </div>
      <p className="codascope-action-card-desc">{description}</p>
      {/* Progress indicator for running pipelines */}
      {effectiveStatus === "running" && effectiveProgress && (
        <div className="codascope-action-card-progress">
          <div className="codascope-action-card-progress-bar">
            <div className="codascope-action-card-progress-fill" />
          </div>
          <span className="codascope-action-card-progress-text">{effectiveProgress}</span>
        </div>
      )}
      {/* Summary line for completed/failed builds */}
      {isTerminal && hydrated.summary && (
        <p className="codascope-action-card-summary">{hydrated.summary}</p>
      )}
      {(!isCompletedOperation || canNavigateCompletedOperation) && <div className="codascope-action-card-footer">
        {/* Primary action button (or secondary rebuild/retry for completed cards) */}
        <button
          className={`codascope-action-card-btn codascope-action-card-btn-${effectiveStatus}${isTerminal && tracked ? " codascope-action-card-btn-ghost" : ""}`}
          onClick={isTerminal && tracked ? handleRebuild : dispatchAction}
          disabled={effectiveStatus === "running"}
          type="button"
        >
          {effectiveStatus === "running" && <span className="codascope-action-card-spinner" />}
          {isCompletedOperation && canNavigateCompletedOperation
            ? "View"
            : isTerminal && tracked
            ? <><IconRefresh size={13} /> {effectiveStatus === "success" ? "Rebuild" : "Retry"}</>
            : actionButtonLabel(type, effectiveStatus)}
        </button>
        {effectiveError && (
          <span className="codascope-action-card-error">{effectiveError}</span>
        )}
      </div>}
    </div>
  );
}

/* ── Action Card List (renders inline after a message) ─────────────── */

/** Action types that represent already-completed operations. */
const COMPLETED_ACTION_TYPES = new Set([
  "design_doc_edited",
  "design_doc_created",
  "artifact_built",
  "operation_completed",
]);

export function ActionCardList({ actions }: { actions: CodaScopeAction[] }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="codascope-action-cards">
      {actions.map((action, i) => (
        <ActionCard key={`${action.type}-${i}`} action={action} />
      ))}
    </div>
  );
}

/* ── SSE Consumer Helper ─────────────────────────────────────────────── */

import type { SseStreamTarget } from "../codaScopeSseClient";

/**
 * Consume an SSE stream without rendering it.
 * Resolves when the stream ends (onDone), rejects on error (onError).
 * Uses the shared connectToSseStream client.
 */
export function awaitSseStream(target: SseStreamTarget): Promise<void> {
  return startSseStream(target).completion.then((terminal) => {
    if (terminal.type === "error") throw new Error(terminal.error);
    if (terminal.type === "cancelled") throw new Error("Operation was cancelled.");
  });
}

/* ── Research SSE Consumer ───────────────────────────────────────────── */

/**
 * Run the research pipeline via SSE, reporting live progress.
 *
 * Custom research events are progress only. The promise settles exclusively
 * from the shared transport's standard done/error/cancelled terminal event.
 */
export function runResearchStream(
  url: string,
  body: Record<string, unknown>,
  onProgress: (msg: string | null) => void,
): Promise<void> {
  const { completion } = startSseStream({ url, method: "POST", body }, {
      onEvent: ({ event, data }) => {
        if (event === "done" || event === "error" || event === "cancelled") return;
        try {
          const parsed = JSON.parse(data);
          switch (event) {
            case "research-started":
              onProgress("Starting research pipeline…");
              break;
            case "research-step": {
              const step = parsed.step as string;
              if (step === "generate-plan") {
                onProgress("Phase 1/3 — Generating research plan…");
              } else if (step === "execute-downloads") {
                onProgress("Phase 2/3 — Downloading sources…");
              } else if (step === "process-sources") {
                onProgress("Phase 3/3 — Processing into wiki pages…");
              } else {
                onProgress(`Running: ${step}`);
              }
              break;
            }
            case "research-plan-generated": {
              const qc = parsed.queryCount ?? 0;
              const uc = parsed.urlCount ?? 0;
              onProgress(`Plan ready — ${qc} queries, ${uc} URLs to fetch`);
              break;
            }
            case "research-download-complete": {
              const s = parsed.succeeded ?? 0;
              const b = parsed.blocked ?? 0;
              const f = parsed.failed ?? 0;
              onProgress(`Downloads done — ${s} fetched, ${b} blocked, ${f} failed`);
              break;
            }
            case "research-complete":
              onProgress("Finalizing research results…");
              break;
            case "research-error":
              onProgress("Research pipeline failed…");
              break;
            case "research-cancelled":
              onProgress("Research pipeline was cancelled…");
              break;
            case "research-download-progress": {
              const cur = parsed.current ?? 0;
              const tot = parsed.total ?? 0;
              onProgress(`Phase 2/3 — Downloading ${cur}/${tot}`);
              break;
            }
            case "research-processing": {
              const prog = parsed.progress ?? "";
              const title = parsed.sourceTitle ?? "";
              const shortTitle = title.length > 50 ? title.slice(0, 47) + "…" : title;
              onProgress(`Phase 3/3 — Source ${prog}: ${shortTitle}`);
              break;
            }
            case "research-synthesis-batch": {
              const idx = parsed.batchIndex ?? 0;
              const cnt = parsed.batchCount ?? 0;
              const label = parsed.topicLabel ?? "";
              onProgress(`Phase 3/3 — Synthesizing batch ${idx + 1}/${cnt}${label ? ` (${label})` : ""}…`);
              break;
            }
            case "research-page-written": {
              const pi = parsed.pageIndex ?? 0;
              const pc = parsed.pageCount ?? 0;
              const ptitle = parsed.title ?? "";
              onProgress(`Phase 3/3 — Created: ${ptitle} (${pi + 1}/${pc})`);
              break;
            }
            default:
              // Ignore other events (e.g. message)
              break;
          }
        } catch {
          // Malformed non-terminal progress cannot decide stream success.
        }
      },
  });
  return completion.then((terminal) => {
    if (terminal.type === "error") throw new Error(terminal.error);
    if (terminal.type === "cancelled") throw new Error("Research pipeline was cancelled.");
    onProgress(null);
  });
}
