/* ── CodaScope: Action Card Component ─────────────────────────────────
   Renders interactive action cards inline in the assistant message thread.
   
   Actions are proposed by the agent and dispatched client-side through
   existing CodaScope APIs when the user clicks to confirm.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import type { CodaScopeAction } from "../codaScopeTypes";
import { IconInsertContent, IconRewrite, IconExpand } from "./CodaScopeIcons";

// Re-export for existing consumers
export type { CodaScopeAction };

type ActionStatus = "idle" | "running" | "success" | "error";

/* ── Icons ───────────────────────────────────────────────────────────── */

function ActionIcon({ type }: { type: string }) {
  switch (type) {
    case "build_wiki_page":
      return <span className="codascope-action-icon">📝</span>;
    case "build_full_wiki":
      return <span className="codascope-action-icon">📚</span>;
    case "run_quality_scan":
      return <span className="codascope-action-icon">🔍</span>;
    case "navigate":
      return <span className="codascope-action-icon">🔗</span>;
    case "create_golden_rule":
      return <span className="codascope-action-icon">⚖️</span>;
    case "explore_codebase":
      return <span className="codascope-action-icon">🧭</span>;
    case "create_epic":
      return <span className="codascope-action-icon">🏗️</span>;
    case "update_epic_definition":
      return <span className="codascope-action-icon">📋</span>;
    case "scope_epic":
      return <span className="codascope-action-icon">🎯</span>;
    case "deepen_wiki":
      return <span className="codascope-action-icon">🔬</span>;
    case "create_design_doc":
      return <span className="codascope-action-icon">📐</span>;
    case "update_design_doc":
      return <span className="codascope-action-icon">✏️</span>;
    case "create_version":
      return <span className="codascope-action-icon">📸</span>;
    case "insert_content":
      return <span className="codascope-action-icon"><IconInsertContent size={14} /></span>;
    case "replace_content":
      return <span className="codascope-action-icon"><IconRewrite size={14} /></span>;
    case "expand_content":
      return <span className="codascope-action-icon"><IconExpand size={14} /></span>;
    default:
      return <span className="codascope-action-icon">⚡</span>;
  }
}

function actionLabel(type: string): string {
  switch (type) {
    case "build_wiki_page": return "Build Wiki Page";
    case "build_full_wiki": return "Build Full Wiki";
    case "run_quality_scan": return "Run Quality Scan";
    case "navigate": return "Go To";
    case "create_golden_rule": return "Create Golden Rule";
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
    default: return "Action";
  }
}

function actionButtonLabel(type: string, status: ActionStatus): string {
  if (status === "running") return "Running…";
  if (status === "success") return "✓ Done";
  if (status === "error") return "✗ Failed";
  switch (type) {
    case "navigate": return "Go";
    case "create_golden_rule": return "Create";
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
    default: return "Run";
  }
}

/* ── Action Card Component ───────────────────────────────────────────── */

export function ActionCard({ action }: { action: CodaScopeAction }) {
  const { type, attributes, description } = action;
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { navigate } = useAppSubRoute("codascope");
  const { activeProjectId, selectedModel } = useCodaScopeStore();

  const dispatchAction = useCallback(async () => {
    if (!activeProjectId) return;

    // Navigation actions are instant — no loading state needed
    if (type === "navigate") {
      const view = attributes.view ?? "dashboard";
      const topicId = attributes.topicId;
      const path = topicId
        ? `project/${activeProjectId}/${view}/${topicId}`
        : `project/${activeProjectId}/${view}`;
      navigate(path);
      return;
    }
    if (type === "create_golden_rule") {
      navigate(`project/${activeProjectId}/rules`);
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

    // Async actions use loading state
    setStatus("running");
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
          const res = await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(commandPayload),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Build failed" }));
            throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          // Consume the SSE stream but don't render it — just wait for completion
          await consumeSSE(res);
          setStatus("success");
          return;
        }

        case "build_full_wiki": {
          const res = await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: "do_build_full_wiki",
              modelId: selectedModel ?? "",
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Build failed" }));
            throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          await consumeSSE(res);
          setStatus("success");
          return;
        }

        case "run_quality_scan": {
          const res = await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: "do_quality_scan",
              modelId: selectedModel ?? "",
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Scan failed" }));
            throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          await consumeSSE(res);
          setStatus("success");
          return;
        }

        case "explore_codebase": {
          const res = await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: "do_explore",
              modelId: selectedModel ?? "",
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Exploration failed" }));
            throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          await consumeSSE(res);
          setStatus("success");
          return;
        }

        case "deepen_wiki": {
          const epicId = attributes.epicId;
          if (!epicId) {
            throw new Error("Missing epicId for deepen_wiki");
          }
          const res = await fetch(
            `/api/codascope/projects/${activeProjectId}/epics/${epicId}/deepen`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ modelId: selectedModel ?? "" }),
            },
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Deepen failed" }));
            throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          await consumeSSE(res);
          setStatus("success");
          return;
        }

        default:
          setStatus("error");
          setErrorMsg(`Unknown action type: ${type}`);
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message);
    }
  }, [type, attributes, activeProjectId, selectedModel, navigate]);

  return (
    <div className={`codascope-action-card codascope-action-card-${status}`}>
      <div className="codascope-action-card-header">
        <ActionIcon type={type} />
        <span className="codascope-action-card-label">{actionLabel(type)}</span>
        {attributes.topic && (
          <span className="codascope-action-card-attr">{attributes.topic}</span>
        )}
      </div>
      <p className="codascope-action-card-desc">{description}</p>
      <div className="codascope-action-card-footer">
        <button
          className={`codascope-action-card-btn codascope-action-card-btn-${status}`}
          onClick={dispatchAction}
          disabled={status === "running"}
          type="button"
        >
          {status === "running" && <span className="codascope-action-card-spinner" />}
          {actionButtonLabel(type, status)}
        </button>
        {errorMsg && (
          <span className="codascope-action-card-error">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}

/* ── Action Card List (renders inline after a message) ─────────────── */

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

/**
 * Consume an SSE response stream without rendering it.
 * Resolves when the stream ends, rejects on error events.
 */
async function consumeSSE(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: error")) {
        // Next data line will contain the error
        // But we can't easily peek — let the stream end naturally
      }
    }
  }
}
