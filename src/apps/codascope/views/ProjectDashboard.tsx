/* ── CodaScope: ProjectDashboard View ────────────────────────────────
   Overview dashboard for a selected project with stat cards,
   repository status panel, unified Analyze panel with toggles,
   build state persistence, pipeline progress tracking, and model picker.

   Build state features:
   - Button disables and shows progress during analysis
   - Checks server build status on mount (survives refresh)
   - Reconnects to SSE stream on refresh to resume live output
   - Shows build history with auto-generated summaries
   - Deep Run button with confirmation modal and gold accent styling
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { ModelPicker } from "../components/ModelPicker";
import {
  IconCodeMap,
  IconWiki,
  IconFolder,
  IconSearch,
  IconPackage,
  IconChat,
  IconGitPull,
  IconCheck,
  IconClose,
  IconClock,
  IconBolt,
  IconHelp,
  IconRefresh,
  IconWarning,
  IconArchive,
} from "../components/CodaScopeIcons";
import { useDashboardBuildState } from "../hooks/useDashboardBuildState";
import type { PipelineStepStatus, WikiState } from "../codaScopeTypes";

/** Format a relative timestamp (e.g., "2m 15s ago") */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

/* ── Step Icon helpers ───────────────────────────────────────────────── */

function stepIcon(status: PipelineStepStatus): ReactNode {
  switch (status) {
    case "running": return <IconRefresh size={13} />;
    case "complete": return <IconCheck size={13} />;
    case "skipped": return "—";
    case "error": return <IconClose size={13} />;
    default: return "○";
  }
}

/* ── Repo status types ───────────────────────────────────────────────── */

interface RepoStatus {
  status: "current" | "behind" | "ahead" | "diverged" | "unknown";
  behind: number;
  ahead: number;
  branch: string | null;
  error?: string;
}

interface RepositoryRecoveryPreview {
  repository: { id: string; name: string };
  changes: Array<{
    path: string;
    originalPath?: string;
    indexStatus: string;
    worktreeStatus: string;
  }>;
  fingerprint: string;
}

/* ── Deep Run modal state (for slash command integration) ────────────── */

let _deepRunModalOpener: (() => void) | null = null;

/** Open the Deep Run confirmation modal from outside (e.g., slash command dispatch) */
export function openDeepRunModal(): void {
  _deepRunModalOpener?.();
}

/* ── Component ───────────────────────────────────────────────────────── */

export function ProjectDashboard() {
  const { navigate } = useAppSubRoute("codascope");
  const {
    projects,
    activeProjectId,
    selectedModel,
    setSelectedModel,
    agentRunning,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  const project = projects.find((p) => p.id === activeProjectId);

  // ── Extracted build state hook ─────────────────────────────────────
  const build = useDashboardBuildState(
    activeProjectId,
    setAgentRunning,
    setAgentStatus,
    agentRunning,
    selectedModel,
  );

  // ── Repo status state ─────────────────────────────────────────────
  const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoStatus>>({});
  const [checkingRepoId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [pullingRepoId, setPullingRepoId] = useState<string | null>(null);
  const [pullResult, setPullResult] = useState<{
    repoId: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [recoveryRepoId, setRecoveryRepoId] = useState<string | null>(null);
  const [recoveryPreview, setRecoveryPreview] = useState<RepositoryRecoveryPreview | null>(null);
  const [recoveryConfirmText, setRecoveryConfirmText] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryResult, setRecoveryResult] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryStashing, setRecoveryStashing] = useState(false);

  // ── Deep Run modal state ──────────────────────────────────────────
  const [showDeepRunModal, setShowDeepRunModal] = useState(false);
  const [deepRunConfirmText, setDeepRunConfirmText] = useState("");

  // ── Sync point state ──────────────────────────────────────────────
  const [wikiState, setWikiState] = useState<WikiState | null>(null);

  // Register the modal opener for slash command dispatch
  useEffect(() => {
    _deepRunModalOpener = () => setShowDeepRunModal(true);
    return () => { _deepRunModalOpener = null; };
  }, []);

  // ── Fetch wiki state for sync badge ───────────────────────────────
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/wiki-state`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setWikiState(data.state ?? data);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, build.buildLogs.length]);

  // ── Check all repos on mount ──────────────────────────────────────
  useEffect(() => {
    if (!activeProjectId || !project?.repositories.length) return;
    setCheckingAll(true);
    let cancelled = false;

    (async () => {
      for (const repo of project.repositories) {
        if (cancelled) break;
        try {
          const res = await fetch(
            `/api/codascope/projects/${activeProjectId}/repositories/${repo.id}/status`
          );
          const data = await res.json() as RepoStatus;
          if (!cancelled) {
            setRepoStatuses((prev) => ({ ...prev, [repo.id]: data }));
          }
        } catch {
          if (!cancelled) {
            setRepoStatuses((prev) => ({
              ...prev,
              [repo.id]: { status: "unknown", behind: 0, ahead: 0, branch: null, error: "Network error." },
            }));
          }
        }
      }
      if (!cancelled) setCheckingAll(false);
    })();

    return () => { cancelled = true; };
  }, [activeProjectId, project?.repositories.length]);

  // ── Git pull handler ──────────────────────────────────────────────
  const handleGitPull = useCallback(async (repoId: string) => {
    if (!activeProjectId || pullingRepoId) return;
    setPullingRepoId(repoId);
    setPullResult(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/repositories/${repoId}/pull`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success) {
        setPullResult({ repoId, success: true, message: data.output || "Already up to date." });
        // Refresh project to pick up any branch changes
        const projRes = await fetch(`/api/codascope/projects/${activeProjectId}`);
        if (projRes.ok) {
          const projData = await projRes.json();
          useCodaScopeStore.getState().setProjects(
            projects.map((p) => (p.id === activeProjectId ? projData.project : p))
          );
        }
        // Update status to current after successful pull
        setRepoStatuses((prev) => ({
          ...prev,
          [repoId]: { status: "current", behind: 0, ahead: 0, branch: data.branch ?? prev[repoId]?.branch ?? null },
        }));
      } else {
        setPullResult({ repoId, success: false, message: data.error || "Pull failed." });
      }
    } catch (err) {
      setPullResult({
        repoId,
        success: false,
        message: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setPullingRepoId(null);
      setTimeout(() => setPullResult(null), 5000);
    }
  }, [activeProjectId, pullingRepoId, projects]);

  const closeRecovery = useCallback(() => {
    setRecoveryRepoId(null);
    setRecoveryPreview(null);
    setRecoveryConfirmText("");
    setRecoveryError("");
    setRecoveryResult("");
    setRecoveryLoading(false);
    setRecoveryStashing(false);
  }, []);

  const openGeneratedWikiRecovery = useCallback(async (repoId: string) => {
    if (!activeProjectId) return;
    setRecoveryRepoId(repoId);
    setRecoveryPreview(null);
    setRecoveryConfirmText("");
    setRecoveryError("");
    setRecoveryResult("");
    setRecoveryLoading(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/repositories/${repoId}/recovery/generated-wiki`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not inspect generated wiki files.");
      setRecoveryPreview(data as RepositoryRecoveryPreview);
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : "Could not inspect generated wiki files.");
    } finally {
      setRecoveryLoading(false);
    }
  }, [activeProjectId]);

  const stashGeneratedWikiFiles = useCallback(async () => {
    if (!activeProjectId || !recoveryRepoId || !recoveryPreview || recoveryStashing) return;
    setRecoveryStashing(true);
    setRecoveryError("");
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/repositories/${recoveryRepoId}/recovery/generated-wiki/stash`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: recoveryConfirmText,
            fingerprint: recoveryPreview.fingerprint,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not stash generated wiki files.");
      setRecoveryResult(`Stashed ${data.changes.length} generated file${data.changes.length === 1 ? "" : "s"} as ${data.stashRef}. You can pull this repository now.`);
      setRecoveryPreview((current) => current ? { ...current, changes: [] } : current);
      setRecoveryConfirmText("");
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : "Could not stash generated wiki files.");
    } finally {
      setRecoveryStashing(false);
    }
  }, [activeProjectId, recoveryConfirmText, recoveryPreview, recoveryRepoId, recoveryStashing]);

  // ── Analyze toggle state ──────────────────────────────────────────
  const [wikiEnabled, setWikiEnabled] = useState(true);
  const [wikiMode, setWikiMode] = useState<"auto" | "full">("auto");
  const [scope, setScope] = useState("full");

  // ── Unified Analyze action ────────────────────────────────────────

  const handleAnalyze = useCallback(() => {
    build.startBuildStream({
      target: {
        url: `/api/codascope/projects/${activeProjectId}/analyze`,
        method: "POST",
        body: {
          modelId: selectedModel,
          wiki: wikiEnabled ? wikiMode : false,
          scope,
        },
      },
      command: "analyze",
      showPipeline: true,
    });
  }, [activeProjectId, selectedModel, wikiEnabled, wikiMode, scope, build]);

  // ── Deep Run action ───────────────────────────────────────────────

  const handleStartDeepRun = useCallback(() => {
    if (!activeProjectId || !selectedModel) return;
    setShowDeepRunModal(false);
    setDeepRunConfirmText("");
    build.startBuildStream({
      target: {
        url: `/api/codascope/projects/${activeProjectId}/deep-run`,
        method: "POST",
        body: { modelId: selectedModel },
      },
      command: "deep-run",
      showPipeline: true,
    });
  }, [activeProjectId, selectedModel, build]);

  // ── Quick action (for individual commands like do_explore) ────────

  const handleQuickAction = useCallback((command: string) => {
    build.startBuildStream({
      target: {
        url: `/api/codascope/projects/${activeProjectId}/runs`,
        method: "POST",
        body: { command, modelId: selectedModel },
      },
      command,
      showPipeline: false,
    });
  }, [activeProjectId, selectedModel, build]);

  if (!project) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon"><IconFolder size={32} /></div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project from the left navigation to view its dashboard.
        </div>
      </div>
    );
  }

  /* ── Button labels ─────────────────────────────────────────────── */

  const isDeepRunning = build.isDeepRunning;
  const isRegularAnalyzing = build.isAnalyzing && !isDeepRunning;

  const analyzeButtonLabel = isRegularAnalyzing
    ? `Analyzing… (${build.elapsed})`
    : isDeepRunning
      ? "Deep Run in progress…"
      : "Run";

  const deepRunButtonLabel = isDeepRunning
    ? `Deep Run in progress… (${build.elapsed})`
    : "Deep Run";

  /* ── Sync badge computation ────────────────────────────────────── */

  const syncBadge = (() => {
    if (!wikiState?.lastSyncAt) return null;
    const heads = wikiState.lastSyncGitHeads ?? {};
    const firstHead = Object.values(heads)[0];
    const shortHash = firstHead ? firstHead.slice(0, 7) : null;
    const branch = project.repositories[0]?.branch ?? "main";
    const ago = timeAgo(wikiState.lastSyncAt);
    return { branch, shortHash, ago };
  })();

  /* ── Repo status badge helper ────────────────────────────────── */

  const hasAnyBehind = project.repositories.some((r) => repoStatuses[r.id]?.status === "behind");

  /* ── Topic count for modal estimate ────────────────────────────── */

  const topicCount = wikiState?.topics ? Object.keys(wikiState.topics).length : null;

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">{project.name}</div>
          <div className="codascope-page-subtitle">{project.description}</div>
        </div>

        {/* Model picker — fetches from Cursor SDK */}
        <ModelPicker value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {/* Sync point badge */}
      {syncBadge && (
        <div className="codascope-sync-badge">
          <span className="codascope-sync-badge-icon"><IconBolt size={14} /></span>
          Wiki synced to {syncBadge.branch}@{syncBadge.shortHash ?? "???"}
          <span className="codascope-sync-badge-time"> — {syncBadge.ago}</span>
        </div>
      )}

      {/* Stat cards */}
      <div className="codascope-dashboard-grid">
        <div className="codascope-stat-card">
          <div className="codascope-stat-card-icon"><IconPackage size={20} /></div>
          <div className="codascope-stat-card-value">{project.repositories.length}</div>
          <div className="codascope-stat-card-label">Repositories</div>
        </div>
        <div className="codascope-stat-card codascope-stat-card--clickable" onClick={() => navigate(`project/${activeProjectId}/wiki`)}>
          <div className="codascope-stat-card-icon"><IconWiki size={20} /></div>
          <div className="codascope-stat-card-value">{project.wikiPageCount ?? 0}</div>
          <div className="codascope-stat-card-label">Wiki Pages</div>
        </div>
      </div>

      {/* ── Repositories Panel ───────────────────────────────────────── */}
      {project.repositories.length > 0 && (
        <div className="codascope-repo-panel" id="repo-panel">
          <div className="codascope-repo-panel-header">
            <div className="codascope-repo-panel-title">
              <IconPackage size={14} />
              Repositories
            </div>
            <button
              className="codascope-btn codascope-btn-sm codascope-btn-ghost"
              onClick={() => {
                setCheckingAll(true);
                setRepoStatuses({});
                (async () => {
                  for (const repo of project.repositories) {
                    try {
                      const res = await fetch(
                        `/api/codascope/projects/${activeProjectId}/repositories/${repo.id}/status`
                      );
                      const data = await res.json() as RepoStatus;
                      setRepoStatuses((prev) => ({ ...prev, [repo.id]: data }));
                    } catch { /* ignore */ }
                  }
                  setCheckingAll(false);
                })();
              }}
              disabled={checkingAll || !!pullingRepoId}
              title="Refresh remote status"
              type="button"
            >
              <IconRefresh size={12} className={checkingAll ? "codascope-spin" : ""} />
              {checkingAll ? "Checking…" : "Check Remote"}
            </button>
          </div>

          <div className="codascope-repo-list">
            {project.repositories.map((repo) => {
              const st = repoStatuses[repo.id];
              const isChecking = checkingRepoId === repo.id || (!st && checkingAll);
              const isPulling = pullingRepoId === repo.id;
              const result = pullResult?.repoId === repo.id ? pullResult : null;

              return (
                <div key={repo.id} className="codascope-repo-row">
                  {/* Name */}
                  <div className="codascope-repo-row-name" title={repo.path}>
                    {repo.name}
                  </div>

                  {/* Branch */}
                  <div className="codascope-repo-row-branch">
                    {repo.branch ?? "—"}
                  </div>

                  {/* Status badge */}
                  <div className="codascope-repo-row-status">
                    {isChecking ? (
                      <span className="codascope-repo-badge codascope-repo-badge-checking">
                        <IconRefresh size={11} className="codascope-spin" /> Checking…
                      </span>
                    ) : isPulling ? (
                      <span className="codascope-repo-badge codascope-repo-badge-pulling">
                        <IconGitPull size={11} className="codascope-spin" /> Pulling…
                      </span>
                    ) : result?.success ? (
                      <span className="codascope-repo-badge codascope-repo-badge-current">
                        <IconCheck size={11} /> Pulled
                      </span>
                    ) : result && !result.success ? (
                      <span className="codascope-repo-badge codascope-repo-badge-error" title={result.message}>
                        <IconWarning size={11} /> Failed
                      </span>
                    ) : st?.status === "current" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-current">
                        <IconCheck size={11} /> Up to date
                      </span>
                    ) : st?.status === "behind" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-behind">
                        <IconGitPull size={11} /> {st.behind} commit{st.behind !== 1 ? "s" : ""} behind
                      </span>
                    ) : st?.status === "ahead" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-ahead">
                        {st.ahead} ahead
                      </span>
                    ) : st?.status === "diverged" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-diverged">
                        <IconWarning size={11} /> {st.behind}↓ {st.ahead}↑
                      </span>
                    ) : st?.error ? (
                      <span className="codascope-repo-badge codascope-repo-badge-unknown" title={st.error}>
                        {st.error}
                      </span>
                    ) : (
                      <span className="codascope-repo-badge codascope-repo-badge-unknown">
                        —
                      </span>
                    )}
                  </div>

                  {/* Pull button — only show when behind */}
                  <div className="codascope-repo-row-action">
                    {st?.status === "behind" && !isPulling && !result?.success && (
                      <button
                        className="codascope-btn codascope-btn-sm codascope-repo-pull-action"
                        onClick={() => handleGitPull(repo.id)}
                        disabled={!!pullingRepoId || agentRunning}
                        title={`Pull ${st.behind} commit${st.behind !== 1 ? "s" : ""} from remote`}
                        type="button"
                      >
                        <IconGitPull size={12} /> Pull
                      </button>
                    )}
                    <button
                      className="codascope-btn codascope-btn-sm codascope-btn-ghost codascope-repo-recovery-action"
                      onClick={() => openGeneratedWikiRecovery(repo.id)}
                      disabled={!!pullingRepoId || agentRunning}
                      title="Review and stash legacy CodaScope-generated wiki files"
                      type="button"
                    >
                      <IconArchive size={12} /> Recovery
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hint if repos are behind */}
          {hasAnyBehind && (
            <div className="codascope-repo-panel-hint">
              Pull remote changes before analyzing to ensure your wiki reflects the latest code.
            </div>
          )}
        </div>
      )}

      {recoveryRepoId && (
        <div className="codascope-modal-overlay" role="presentation" onMouseDown={closeRecovery}>
          <div
            className="codascope-modal codascope-generated-wiki-recovery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generated-wiki-recovery-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="codascope-modal-header">
              <div className="codascope-modal-title" id="generated-wiki-recovery-title">
                <IconArchive size={16} /> Recover Generated Wiki Files
              </div>
              <button className="codascope-modal-close" onClick={closeRecovery} aria-label="Close recovery dialog" type="button">
                <IconClose size={16} />
              </button>
            </div>
            <div className="codascope-modal-body">
              <p>
                This is a manual recovery action for legacy builds that wrote documentation into a source repository.
                It only stashes dirty <code>wiki/**</code> and root <code>code_map_*.md</code> files; all other repository changes stay in place.
              </p>

              {recoveryLoading && <div className="codascope-recovery-status">Inspecting configured repository…</div>}
              {recoveryError && <div className="codascope-alert codascope-alert--danger">{recoveryError}</div>}
              {recoveryResult && <div className="codascope-alert codascope-alert--success">{recoveryResult}</div>}

              {recoveryPreview && !recoveryResult && (
                recoveryPreview.changes.length > 0 ? (
                  <>
                    <div className="codascope-recovery-file-summary">
                      Found {recoveryPreview.changes.length} generated file{recoveryPreview.changes.length === 1 ? "" : "s"} in <strong>{recoveryPreview.repository.name}</strong>.
                    </div>
                    <ul className="codascope-recovery-file-list">
                      {recoveryPreview.changes.map((change) => (
                        <li key={`${change.indexStatus}${change.worktreeStatus}:${change.path}`}>
                          <code>{change.path}</code>
                          <span>{`${change.indexStatus}${change.worktreeStatus}`.trim() || "modified"}</span>
                        </li>
                      ))}
                    </ul>
                    <label className="codascope-form-label">
                      Type <code>STASH GENERATED FILES</code> to continue
                      <input
                        className="codascope-form-input"
                        value={recoveryConfirmText}
                        onChange={(event) => setRecoveryConfirmText(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  </>
                ) : (
                  <div className="codascope-recovery-status">No legacy generated wiki files are dirty in this repository.</div>
                )
              )}
            </div>
            <div className="codascope-modal-footer">
              <button className="codascope-btn codascope-btn-ghost" onClick={closeRecovery} type="button">
                Close
              </button>
              {recoveryPreview && recoveryPreview.changes.length > 0 && !recoveryResult && (
                <button
                  className="codascope-btn codascope-btn-danger"
                  onClick={stashGeneratedWikiFiles}
                  disabled={recoveryConfirmText !== "STASH GENERATED FILES" || recoveryStashing}
                  type="button"
                >
                  <IconArchive size={13} /> {recoveryStashing ? "Stashing…" : "Stash Generated Files"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Unified Analyze Panel ──────────────────────────────────── */}
      <div className={`codascope-analyze-panel ${build.isAnalyzing ? "codascope-analyze-panel--running" : ""}`} id="analyze-panel">
        <div className="codascope-analyze-header">
          <div className="codascope-analyze-title">
            <span className="codascope-analyze-title-icon"><IconSearch size={16} /></span>
            Analyze Codebase
          </div>
          <div className="codascope-analyze-header-actions">
            {/* Deep Run button */}
            <button
              className={`codascope-deep-run-btn ${isDeepRunning ? "codascope-deep-run-btn--running" : ""}`}
              onClick={() => {
                setDeepRunConfirmText("");
                setShowDeepRunModal(true);
              }}
              disabled={agentRunning || !selectedModel}
              title={agentRunning ? (isDeepRunning ? "Deep Run in progress" : "Build in progress") : "Full code-to-wiki deep sync"}
              type="button"
              id="deep-run-btn"
            >
              <IconBolt size={14} /> {deepRunButtonLabel}
            </button>

            {/* Regular Run / Stop button */}
            {agentRunning ? (
              <button
                className="codascope-analyze-run-btn codascope-analyze-run-btn--stop"
                onClick={build.cancelBuild}
                type="button"
                id="analyze-stop-btn"
              >
                <IconClose size={14} /> Stop
              </button>
            ) : (
              <button
                className={`codascope-analyze-run-btn ${isRegularAnalyzing ? "codascope-analyze-run-btn--running" : ""}`}
                onClick={handleAnalyze}
                disabled={!selectedModel || agentRunning}
                type="button"
                id="analyze-run-btn"
              >
                <IconSearch size={14} /> {analyzeButtonLabel}
              </button>
            )}
          </div>
        </div>

        <div className="codascope-analyze-body">
          {/* Code Map — always on */}
          <div className="codascope-analyze-toggles">
            <div className="codascope-analyze-toggle-row">
              <div className="codascope-analyze-toggle-label">
                <span className="codascope-analyze-toggle-icon"><IconCodeMap size={16} /></span>
                <span className="codascope-analyze-toggle-text">
                  Code Map
                  <span className="codascope-analyze-toggle-sub">always</span>
                </span>
              </div>
              <div className="codascope-analyze-toggle-right">
                <span className="codascope-analyze-toggle-fixed">auto-skips if fresh</span>
              </div>
            </div>

            {/* Wiki toggle */}
            <div className="codascope-analyze-toggle-row">
              <div className="codascope-analyze-toggle-label">
                <span className="codascope-analyze-toggle-icon"><IconWiki size={16} /></span>
                <span className="codascope-analyze-toggle-text">Wiki</span>
              </div>
              <div className="codascope-analyze-toggle-right">
                {wikiEnabled && (
                  <select
                    className="codascope-analyze-mode-select"
                    value={wikiMode}
                    onChange={(e) => setWikiMode(e.target.value as "auto" | "full")}
                    disabled={agentRunning}
                    id="wiki-mode-select"
                  >
                    <option value="auto">Auto</option>
                    <option value="full">Full Rebuild</option>
                  </select>
                )}
                <label className="codascope-rule-toggle codascope-analyze-toggle">
                  <input
                    type="checkbox"
                    checked={wikiEnabled}
                    onChange={(e) => setWikiEnabled(e.target.checked)}
                    disabled={agentRunning}
                  />
                  <span className="codascope-rule-toggle-track" />
                </label>
              </div>
            </div>


          </div>

          {/* Scope selector */}
          <div className="codascope-analyze-scope-row">
            <span className="codascope-analyze-scope-label">Scope</span>
            <select
              className="codascope-analyze-scope-select"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={agentRunning}
              id="analyze-scope-select"
            >
              <option value="full">Full Repository</option>
              <option value="backend">Backend Only</option>
              <option value="frontend">Frontend Only</option>
              <option value="security">Security Focus</option>
            </select>
          </div>
        </div>

        {/* Footer with Code Map freshness info */}
        <div className="codascope-analyze-footer">
          <div className="codascope-analyze-footer-info">
            <span className="codascope-analyze-footer-info-icon"><IconHelp size={13} /></span>
            <span>Code Map auto-rebuilds when repository HEAD changes</span>
          </div>
        </div>
      </div>

      {/* ── Pipeline Progress ────────────────────────────────────────── */}
      {build.showPipeline && build.pipelineSteps.length > 0 && (
        <div
          className={`codascope-pipeline-progress ${isDeepRunning ? "codascope-pipeline-progress--deep-run" : ""}`}
          id="pipeline-progress"
        >
          <div className="codascope-pipeline-header">
            <div className="codascope-pipeline-title">
              {build.isAnalyzing
                ? isDeepRunning ? <IconBolt size={14} /> : <IconRefresh size={14} />
                : <IconCheck size={14} />}{" "}
              {isDeepRunning ? "Deep Run Pipeline" : "Analysis Pipeline"}
            </div>
            {build.isAnalyzing && (
              <span className="codascope-pipeline-elapsed">{build.elapsed}</span>
            )}
            {!build.isAnalyzing && (
              <button
                className="codascope-btn codascope-btn-ghost codascope-pipeline-dismiss-btn"
                onClick={build.clearPipeline}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <div className="codascope-pipeline-steps">
            {build.pipelineSteps.map((step) => (
              <div
                key={step.id}
                className={`codascope-pipeline-step codascope-pipeline-step--${step.status}`}
              >
                <div className="codascope-pipeline-step-icon">
                  {stepIcon(step.status as PipelineStepStatus)}
                </div>
                <div className="codascope-pipeline-step-label">{step.label}</div>
                {step.detail && (
                  <div className="codascope-pipeline-step-detail">{step.detail}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Links ──────────────────────────────────────────────── */}
      <div className="codascope-quick-links">
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/chat`)}
          type="button"
        >
          <IconChat size={14} /> Chat with Code
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/wiki`)}
          type="button"
        >
          <IconWiki size={14} /> Browse Wiki
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => handleQuickAction("do_explore")}
          disabled={agentRunning || !selectedModel}
          type="button"
        >
          <IconSearch size={14} /> Explore Only
        </button>
      </div>

      {/* Build status banner */}
      {build.buildSummary && !agentRunning && (
        <div className="codascope-alert codascope-alert--success codascope-dashboard-alert">
          <span className="codascope-alert-icon"><IconCheck size={14} /></span>
          <span>{build.buildSummary}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => build.setBuildSummary(null)}
            type="button"
            aria-label="Dismiss"
          >
            <IconClose size={12} />
          </button>
        </div>
      )}

      {/* Error alert */}
      {build.runError && !agentRunning && (
        <div className="codascope-alert codascope-alert--danger codascope-dashboard-alert">
          <span className="codascope-alert-icon"><IconWarning size={14} /></span>
          <span>{build.runError}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => build.setRunError("")}
            type="button"
            aria-label="Dismiss error"
          >
            <IconClose size={12} />
          </button>
        </div>
      )}

      {/* Run output log */}
      {(build.runOutput || agentRunning) && (
        <div className="codascope-build-log codascope-dashboard-build-log">
          <div className="codascope-build-log-header">
            <span>
              {agentRunning
                ? <>{isDeepRunning ? <IconBolt size={13} /> : <IconRefresh size={13} />} Agent Output — {build.elapsed}</>
                : <><IconCheck size={13} /> Complete</>}
            </span>
            {!agentRunning && (
              <button
                className="codascope-btn codascope-btn-ghost codascope-pipeline-dismiss-btn"
                onClick={build.clearRunOutput}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <pre className="codascope-build-log-content">
            {build.runOutput || (agentRunning ? "Connecting to build stream…\n" : "")}
            <div ref={build.logEndRef} />
          </pre>
        </div>
      )}

      {/* Build History */}
      {build.buildLogs.length > 0 && (
        <>
          <div className="codascope-page-header codascope-dashboard-section-header">
            <div className="codascope-page-title codascope-dashboard-section-title">
              Build History
            </div>
          </div>
          <div className="codascope-dashboard-build-history">
            {build.buildLogs.map((log, i) => {
              const isDeepRunLog = log.buildType === "deep-run";
              const rowClasses = [
                "codascope-dashboard-build-history-row",
                i < build.buildLogs.length - 1 ? "" : "codascope-dashboard-build-history-row--last",
                isDeepRunLog ? "codascope-dashboard-build-history-row--deep-run" : "",
              ].filter(Boolean).join(" ");

              return (
                <div key={log.runId} className={rowClasses}>
                  <div className="codascope-dashboard-build-history-left">
                    <span className={`codascope-dashboard-build-history-status ${
                      isDeepRunLog
                        ? "codascope-dashboard-build-history-status--deep-run"
                        : `codascope-dashboard-build-history-status--${log.status}`
                    }`}>
                      {isDeepRunLog
                        ? <IconBolt size={13} />
                        : log.status === "complete" ? <IconCheck size={13} /> : log.status === "error" ? <IconClose size={13} /> : "●"}
                    </span>
                    <span>
                      {isDeepRunLog && <IconBolt size={13} />}{" "}
                      {log.summary ?? log.command}
                    </span>
                  </div>
                  <span className="codascope-dashboard-build-history-time">
                    {log.startedAt ? timeAgo(log.startedAt) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Deep Run Confirmation Modal ────────────────────────────── */}
      {showDeepRunModal && (
        <div
          className="codascope-modal-overlay"
          onClick={() => {
            setShowDeepRunModal(false);
            setDeepRunConfirmText("");
          }}
        >
          <div
            className="codascope-modal codascope-deep-run-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="codascope-modal-header">
              <div className="codascope-modal-title">
                <IconBolt size={16} /> Start Deep Run?
              </div>
              <button
                className="codascope-modal-close"
                onClick={() => {
                  setShowDeepRunModal(false);
                  setDeepRunConfirmText("");
                }}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="codascope-modal-body">
              <div className="codascope-deep-run-confirm-body-text">
                <p>
                  This will rebuild your entire wiki at maximum depth.
                  Every topic will be individually analyzed with full source code reading.
                </p>
              </div>
              <div className="codascope-deep-run-confirm-details">
                <span>
                  <IconClock size={13} /> Estimated: ~2–5 minutes per topic{topicCount != null ? ` (${topicCount} topics)` : ""}
                </span>
                <span><IconBolt size={13} /> Heavy token usage per topic</span>
              </div>
              <label
                className="codascope-form-label"
                htmlFor="deep-run-confirm-input"
              >
                Type <strong>YES</strong> to confirm
              </label>
              <input
                className="codascope-form-input codascope-deep-run-confirm-input"
                id="deep-run-confirm-input"
                type="text"
                autoFocus
                placeholder="YES"
                value={deepRunConfirmText}
                onChange={(e) => setDeepRunConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && deepRunConfirmText === "YES") {
                    handleStartDeepRun();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="codascope-modal-footer">
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={() => {
                  setShowDeepRunModal(false);
                  setDeepRunConfirmText("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-deep-run-start-btn"
                disabled={deepRunConfirmText !== "YES"}
                onClick={handleStartDeepRun}
                type="button"
                id="deep-run-confirm-btn"
              >
                <IconBolt size={14} /> Start Deep Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
