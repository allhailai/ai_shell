/* ── CodaScope: EpicHistory View ─────────────────────────────────────
   The History tab content. Shows:
   - Version timeline (vertical list, newest first)
   - Each version: number, label, note, author, timestamp, status badge
   - "Compare" button → diff view between two versions
   - "Create Snapshot" button
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { DiffViewer } from "../components/DiffViewer";
import type { EpicDesignDetail, EpicVersion, VersionDiff } from "../codaScopeTypes";

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

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicHistory({ epic, setEpic }: EpicHistoryProps) {
  const { activeProjectId } = useCodaScopeStore();

  const [creating, setCreating] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const versions = [...epic.versions].sort((a, b) => b.version - a.version);

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

  /* ── Main view ─────────────────────────────────────────────────────── */

  return (
    <div className="codascope-version-timeline">
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
