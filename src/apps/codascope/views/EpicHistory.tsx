/* ── CodaScope: EpicHistory View ─────────────────────────────────────
   The History tab content. Shows:
   - Curation history (collapsible section)
   - Version timeline (vertical list, newest first)
   - Each version: number, label, note, author, timestamp, status badge
   - "Compare" button → diff view between two versions
   - "Create Snapshot" button
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { DiffViewer } from "../components/DiffViewer";
import { IconCurate, IconCheckCircle, IconWarning, IconClock } from "../components/CodaScopeIcons";
import type { EpicDesignDetail, EpicVersion, VersionDiff, CurationLogEntry, CurationResults } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicHistoryProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Status badge styling ────────────────────────────────────────────── */

const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  "in-review": "In Review",
  approved: "Approved",
  superseded: "Superseded",
};

/* ── Curation helpers ────────────────────────────────────────────────── */

const REASON_TYPE_LABELS: Record<string, string> = {
  definition_changed: "Definition updated",
  code_delta_processed: "Code changes",
  research_sources_added: "Research sources",
  human_content_added: "Human upload",
  blocked_download_resolved: "Blocked resolved",
  research_topics_changed: "Topics changed",
  manual: "Manual",
};

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeResults(results?: CurationResults): string {
  if (!results) return "No results recorded";
  const parts: string[] = [];
  const wikiEnriched = results.mainWiki.enriched.length;
  const wikiCreated = results.mainWiki.created.length;
  if (wikiEnriched > 0) parts.push(`${wikiEnriched} wiki page${wikiEnriched !== 1 ? "s" : ""} enriched`);
  if (wikiCreated > 0) parts.push(`${wikiCreated} created`);

  const epicCreated = results.epicWiki.created.length;
  const epicUpdated = results.epicWiki.updated.length;
  if (epicCreated + epicUpdated > 0) parts.push(`${epicCreated + epicUpdated} epic wiki`);

  const scopeChanges = results.scope.added + results.scope.removed;
  if (scopeChanges > 0) parts.push(`${scopeChanges} scope change${scopeChanges !== 1 ? "s" : ""}`);




  return parts.length > 0 ? parts.join(" · ") : "No changes";
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicHistory({ epic, setEpic }: EpicHistoryProps) {
  const { activeProjectId } = useCodaScopeStore();
  const { getParam, setParam } = useAppSubRoute("codascope");

  const [creating, setCreating] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // URL-synced compare state
  const urlFrom = getParam("cmpFrom");
  const urlTo = getParam("cmpTo");
  const [compareMode, setCompareModeRaw] = useState(urlFrom != null || urlTo != null);
  const [compareFrom, setCompareFromRaw] = useState<number | null>(urlFrom ? Number(urlFrom) : null);
  const [compareTo, setCompareToRaw] = useState<number | null>(urlTo ? Number(urlTo) : null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const setCompareMode = useCallback((v: boolean) => {
    setCompareModeRaw(v);
    if (!v) {
      setCompareFromRaw(null);
      setCompareToRaw(null);
      setParam("cmpFrom", null);
      setParam("cmpTo", null);
    }
  }, [setParam]);

  const setCompareFrom = useCallback((v: number | null) => {
    setCompareFromRaw(v);
    setParam("cmpFrom", v != null ? String(v) : null);
  }, [setParam]);

  const setCompareTo = useCallback((v: number | null) => {
    setCompareToRaw(v);
    setParam("cmpTo", v != null ? String(v) : null);
  }, [setParam]);

  // Curation history state
  const [curationLogs, setCurationLogs] = useState<CurationLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [curationExpanded, setCurationExpanded] = useState(false);

  const versions = [...epic.versions].sort((a, b) => b.version - a.version);

  /* ── Fetch curation logs ─────────────────────────────────────────────── */

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setLoadingLogs(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/curation/logs`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setCurationLogs(data.logs ?? []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoadingLogs(false);
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, epic.id]);

  /* ── Create snapshot ───────────────────────────────────────────────── */

  const createSnapshot = useCallback(async () => {
    if (!activeProjectId || creating) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: snapshotLabel.trim() || undefined,
            note: snapshotNote.trim() || undefined,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const newVersion: EpicVersion = data.version;
        // Update existing versions' status to match server-side superseding
        const updatedVersions = epic.versions.map((v) => {
          if ((v.status === "draft" || v.status === "in-review") && v.version !== newVersion.version) {
            return { ...v, status: "superseded" as const };
          }
          return v;
        });
        setEpic({
          ...epic,
          versions: [...updatedVersions, newVersion],
          currentVersion: newVersion.version,
        });
        setShowCreateForm(false);
        setSnapshotLabel("");
        setSnapshotNote("");
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [activeProjectId, epic, setEpic, creating, snapshotLabel, snapshotNote]);

  /* ── Compare versions ──────────────────────────────────────────────── */

  const toggleCompare = useCallback((version: number) => {
    if (compareFrom === null) {
      setCompareFrom(version);
    } else if (compareTo === null && version !== compareFrom) {
      setCompareTo(version);
    } else {
      // Reset
      setCompareFrom(version);
      setCompareTo(null);
    }
  }, [compareFrom, compareTo]);

  const runCompare = useCallback(async () => {
    if (!activeProjectId || compareFrom === null || compareTo === null) return;
    setLoadingDiff(true);
    try {
      const from = Math.min(compareFrom, compareTo);
      const to = Math.max(compareFrom, compareTo);
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/versions/diff?from=${from}&to=${to}`,
      );
      if (res.ok) {
        const data = await res.json();
        setDiff(data.diff);
      }
    } catch { /* ignore */ }
    setLoadingDiff(false);
  }, [activeProjectId, epic.id, compareFrom, compareTo]);

  const closeDiff = useCallback(() => {
    setDiff(null);
    setCompareMode(false);
    setCompareFrom(null);
    setCompareTo(null);
  }, []);

  /* ── Diff view ─────────────────────────────────────────────────────── */

  if (diff) {
    return <DiffViewer diff={diff} onClose={closeDiff} />;
  }

  /* ── Sort curation logs newest first ───────────────────────────────── */

  const sortedLogs = [...curationLogs].sort(
    (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime(),
  );

  /* ── Main view ─────────────────────────────────────────────────────── */

  return (
    <div className="codascope-version-timeline">
      {/* ── Curation History Section ─────────────────────────────────── */}
      <div className="codascope-curation-history">
        <button
          className="codascope-curation-history-header"
          onClick={() => setCurationExpanded(!curationExpanded)}
          type="button"
        >
          <div className="codascope-curation-history-header-left">
            <IconCurate size={14} />
            <span className="codascope-curation-history-title">
              Curation History
            </span>
            {!loadingLogs && (
              <span className="codascope-curation-history-count">
                {curationLogs.length} run{curationLogs.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <span className={`codascope-curation-history-chevron${curationExpanded ? " codascope-curation-history-chevron-open" : ""}`}>
            ▸
          </span>
        </button>

        {curationExpanded && (
          <div className="codascope-curation-history-body">
            {loadingLogs ? (
              <p className="codascope-curation-history-loading">Loading curation logs…</p>
            ) : sortedLogs.length === 0 ? (
              <div className="codascope-curation-history-empty">
                <IconCurate size={20} />
                <p>No curation runs yet</p>
                <span>Curation runs will appear here after they complete.</span>
              </div>
            ) : (
              <div className="codascope-curation-log-list">
                {sortedLogs.map((log) => (
                  <div key={log.curationId} className="codascope-curation-log-card">
                    <div className="codascope-curation-log-card-header">
                      {/* Status icon */}
                      <span className={`codascope-curation-log-status codascope-curation-log-status-${log.status}`}>
                        {log.status === "running" && (
                          <span className="codascope-curation-log-status-spinner">
                            <IconCurate size={13} />
                          </span>
                        )}
                        {log.status === "complete" && <IconCheckCircle size={13} />}
                        {log.status === "error" && <IconWarning size={13} />}
                      </span>

                      {/* Timestamp + duration */}
                      <span className="codascope-curation-log-time">
                        {formatTimestamp(log.triggeredAt)}
                      </span>
                      {log.durationMs != null && (
                        <span className="codascope-curation-log-duration">
                          <IconClock size={11} />
                          {formatDuration(log.durationMs)}
                        </span>
                      )}

                      {/* Model */}
                      <span className="codascope-curation-log-model" title={log.modelId}>
                        {log.modelId.split("/").pop() ?? log.modelId}
                      </span>
                    </div>

                    {/* Resolved reasons */}
                    {log.resolvedReasons.length > 0 && (
                      <div className="codascope-curation-log-reasons">
                        <span className="codascope-curation-log-reasons-label">Triggers:</span>
                        {log.resolvedReasons.map((r, i) => (
                          <span key={`${r.type}-${i}`} className="codascope-curation-log-reason-tag">
                            {REASON_TYPE_LABELS[r.type] ?? r.type}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Results summary */}
                    {log.status === "complete" && (
                      <div className="codascope-curation-log-results">
                        {summarizeResults(log.results)}
                      </div>
                    )}

                    {/* Error */}
                    {log.status === "error" && log.error && (
                      <div className="codascope-curation-log-error">
                        {log.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Version Timeline Section ────────────────────────────────── */}

      {/* Header */}
      <div className="codascope-version-timeline-header">
        <span className="codascope-version-timeline-count">
          {versions.length} version{versions.length !== 1 ? "s" : ""}
        </span>
        <div className="codascope-version-timeline-actions">
          {versions.length >= 2 && (
            <button
              className={`codascope-btn ${compareMode ? "codascope-btn-secondary" : "codascope-btn-ghost"}`}
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareFrom(null);
                setCompareTo(null);
              }}
              type="button"
            >
              {compareMode ? "Cancel Compare" : "📊 Compare"}
            </button>
          )}
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            📸 Create Snapshot
          </button>
        </div>
      </div>

      {/* Compare bar */}
      {compareMode && (
        <div className="codascope-version-compare-bar">
          <span>
            Select two versions to compare.{" "}
            {compareFrom !== null && `From: v${compareFrom}`}
            {compareTo !== null && ` → To: v${compareTo}`}
          </span>
          {compareFrom !== null && compareTo !== null && (
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={runCompare}
              disabled={loadingDiff}
              type="button"
            >
              {loadingDiff ? "Loading…" : "View Diff"}
            </button>
          )}
        </div>
      )}

      {/* Create snapshot form */}
      {showCreateForm && (
        <div className="codascope-version-create-form">
          <h4>Create Version Snapshot</h4>
          <p className="codascope-version-create-hint">
            Captures the current state of the definition, scope, and all design documents.
          </p>
          <input
            className="codascope-input"
            type="text"
            placeholder="Label (optional, e.g. 'Initial Draft')"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
          />
          <textarea
            className="codascope-input codascope-version-create-note"
            placeholder="Note (optional, e.g. 'Added auth middleware design doc')"
            value={snapshotNote}
            onChange={(e) => setSnapshotNote(e.target.value)}
            rows={2}
          />
          <div className="codascope-version-create-actions">
            <button
              className="codascope-btn codascope-btn-ghost"
              onClick={() => { setShowCreateForm(false); setSnapshotLabel(""); setSnapshotNote(""); }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={createSnapshot}
              disabled={creating}
              type="button"
            >
              {creating ? "Creating…" : "Create Snapshot"}
            </button>
          </div>
        </div>
      )}

      {/* Version list */}
      {versions.length === 0 ? (
        <div className="codascope-empty-state">
          <span className="codascope-empty-state-icon">📸</span>
          <h3>No version snapshots yet</h3>
          <p>Create a snapshot to capture the current state of your epic. Snapshots include the definition, scope, and all design documents.</p>
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            📸 Create Snapshot
          </button>
        </div>
      ) : (
        <div className="codascope-version-list">
          {versions.map((version, idx) => (
            <div
              key={version.version}
              className={`codascope-version-card ${
                compareMode && (compareFrom === version.version || compareTo === version.version)
                  ? "codascope-version-card--selected"
                  : ""
              }`}
              onClick={compareMode ? () => toggleCompare(version.version) : undefined}
              style={compareMode ? { cursor: "pointer" } : undefined}
            >
              <div className="codascope-version-card-connector">
                <div className={`codascope-version-card-dot ${idx === 0 ? "codascope-version-card-dot--latest" : ""}`} />
                {idx < versions.length - 1 && <div className="codascope-version-card-line" />}
              </div>
              <div className="codascope-version-card-content">
                <div className="codascope-version-card-header">
                  <span className="codascope-version-card-number">v{version.version}</span>
                  {version.label && (
                    <span className="codascope-version-card-label">{version.label}</span>
                  )}
                  <span className={`codascope-version-status-badge codascope-version-status-badge--${version.status}`}>
                    {VERSION_STATUS_LABELS[version.status] ?? version.status}
                  </span>
                </div>
                {version.note && (
                  <p className="codascope-version-card-note">{version.note}</p>
                )}
                <div className="codascope-version-card-meta">
                  <span>{version.createdBy}</span>
                  <span>·</span>
                  <span>
                    {new Date(version.createdAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
