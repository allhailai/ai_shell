/* ── CodaScope: EpicList View ────────────────────────────────────────
   Lists all epics for the current project with status badges,
   health indicators, and a "New Epic" button.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconEpic } from "../components/CodaScopeIcons";
import { ConfirmDialog } from "../../../shared/confirm-dialog/ConfirmDialog";
import type { EpicDesign, EpicStatus, EpicHealth, EpicHealthInfo } from "../codaScopeTypes";

/* ── Helpers ─────────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<EpicStatus, { label: string; className: string }> = {
  defining:    { label: "Defining",   className: "codascope-epic-status-badge--defining" },
  scoping:     { label: "Scoping",    className: "codascope-epic-status-badge--scoping" },
  designing:   { label: "Designing",  className: "codascope-epic-status-badge--designing" },
  "in-review": { label: "In Review",  className: "codascope-epic-status-badge--in-review" },
  approved:    { label: "Approved",   className: "codascope-epic-status-badge--approved" },
  archived:    { label: "Archived",   className: "codascope-epic-status-badge--archived" },
};

const HEALTH_INDICATORS: Record<EpicHealth, { emoji: string; label: string }> = {
  active:  { emoji: "🟢", label: "Active" },
  hot:     { emoji: "⚡", label: "Hot" },
  stale:   { emoji: "🟡", label: "Stale" },
  blocked: { emoji: "🔴", label: "Blocked" },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

type EpicWithHealth = EpicDesign & { health: EpicHealthInfo };

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicList() {
  const { navigate } = useAppSubRoute("codascope");
  const { activeProjectId, epics, setEpics } = useCodaScopeStore();
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<EpicStatus | "all">("all");
  const [healthFilter, setHealthFilter] = useState<EpicHealth | "all">("all");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedEpics, setArchivedEpics] = useState<EpicDesign[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  // Fetch epics
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setEpics(data.epics ?? []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, setEpics]);

  // Filter logic
  const filteredEpics = (epics as EpicWithHealth[]).filter((epic) => {
    if (statusFilter !== "all" && epic.status !== statusFilter) return false;
    if (healthFilter !== "all" && epic.health?.health !== healthFilter) return false;
    return true;
  });

  const handleCreate = useCallback(async () => {
    if (!activeProjectId || !newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (res.ok) {
        const { epic } = await res.json();
        setEpics([...epics, { ...epic, health: { health: "active", reason: "Just created", lastActivityAt: epic.createdAt, openAnnotationCount: 0, activeCollaboratorCount: 1 } }]);
        setNewTitle("");
        setShowNewForm(false);
        // Navigate to the new epic
        navigate(`project/${activeProjectId}/epic/${epic.id}/define`);
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [activeProjectId, newTitle, epics, setEpics, navigate]);

  const handleArchiveClick = useCallback((epicId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingArchiveId(epicId);
  }, []);

  const handleArchiveConfirm = useCallback(async () => {
    if (!activeProjectId || !pendingArchiveId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${pendingArchiveId}/archive`, {
        method: "POST",
      });
      if (res.ok) {
        setEpics(epics.filter((ep) => ep.id !== pendingArchiveId));
      }
    } catch { /* ignore */ }
    setPendingArchiveId(null);
  }, [activeProjectId, pendingArchiveId, epics, setEpics]);

  // Fetch archived epics when toggled
  useEffect(() => {
    if (!showArchived || !activeProjectId) return;
    let cancelled = false;
    setLoadingArchived(true);
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics-archived`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setArchivedEpics(data.epics ?? []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoadingArchived(false);
    })();
    return () => { cancelled = true; };
  }, [showArchived, activeProjectId]);

  const handleRestore = useCallback(async (epicId: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}/restore`, {
        method: "POST",
      });
      if (res.ok) {
        const { epic } = await res.json();
        setEpics([...epics, epic]);
        setArchivedEpics(archivedEpics.filter((ep) => ep.id !== epicId));
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epics, archivedEpics, setEpics]);

  if (!activeProjectId) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <p>Select a project to view epics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-page">
      {/* Header */}
      <div className="codascope-page-header">
        <div>
          <h1 className="codascope-page-title">Epic Designs</h1>
          <p className="codascope-page-subtitle">
            Collaborative engineering design documents
          </p>
        </div>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={() => setShowNewForm(true)}
          type="button"
        >
          <IconEpic size={14} /> New Epic
        </button>
      </div>

      {/* New Epic Form */}
      {showNewForm && (
        <div className="codascope-epic-new-form">
          <input
            className="codascope-input"
            type="text"
            placeholder="Epic title — e.g., 'Auth Service Redesign'"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <div className="codascope-epic-new-form-actions">
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              type="button"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              className="codascope-btn codascope-btn-ghost"
              onClick={() => { setShowNewForm(false); setNewTitle(""); }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="codascope-epic-filters">
        <select
          className="codascope-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EpicStatus | "all")}
        >
          <option value="all">All Statuses</option>
          <option value="defining">Defining</option>
          <option value="scoping">Scoping</option>
          <option value="designing">Designing</option>
          <option value="in-review">In Review</option>
          <option value="approved">Approved</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="codascope-select"
          value={healthFilter}
          onChange={(e) => setHealthFilter(e.target.value as EpicHealth | "all")}
        >
          <option value="all">All Health</option>
          <option value="active">🟢 Active</option>
          <option value="hot">⚡ Hot</option>
          <option value="stale">🟡 Stale</option>
          <option value="blocked">🔴 Blocked</option>
        </select>
      </div>

      {/* Epic Grid */}
      {loading ? (
        <div className="codascope-empty-state">
          <p>Loading epics…</p>
        </div>
      ) : filteredEpics.length === 0 ? (
        <div className="codascope-empty-state">
          <IconEpic size={32} />
          <p style={{ marginTop: "var(--space-3)" }}>
            {epics.length === 0
              ? "No epics yet. Create one to start designing."
              : "No epics match the current filters."}
          </p>
        </div>
      ) : (
        <div className="codascope-epic-list">
          {filteredEpics.map((epic) => {
            const healthInfo = (epic as EpicWithHealth).health;
            const status = STATUS_LABELS[epic.status];
            const health = healthInfo ? HEALTH_INDICATORS[healthInfo.health] : null;

            return (
              <div
                key={epic.id}
                className="codascope-epic-card"
                onClick={() => navigate(`project/${activeProjectId}/epic/${epic.id}/define`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`project/${activeProjectId}/epic/${epic.id}/define`); } }}
                role="button"
                tabIndex={0}
              >
                <div className="codascope-epic-card-header">
                  <span className={`codascope-epic-status-badge ${status.className}`}>
                    {status.label}
                  </span>
                  {health && (
                    <span
                      className="codascope-epic-health-badge"
                      title={healthInfo?.reason ?? ""}
                    >
                      {health.emoji}
                    </span>
                  )}
                </div>
                <h3 className="codascope-epic-card-title">{epic.title}</h3>
                <div className="codascope-epic-card-footer">
                  <div className="codascope-epic-card-meta">
                    <span>v{epic.currentVersion}</span>
                    <span>·</span>
                    <span>{timeAgo(epic.updatedAt)}</span>
                    {epic.collaborators.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{epic.collaborators.length} collaborator{epic.collaborators.length !== 1 ? "s" : ""}</span>
                      </>
                    )}
                  </div>
                  <button
                    className="codascope-epic-card-action"
                    onClick={(e) => handleArchiveClick(epic.id, e)}
                    type="button"
                  >
                    Archive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Archived Epics Section */}
      <div className="codascope-epic-archive-section">
        <button
          className="codascope-epic-archive-toggle"
          onClick={() => setShowArchived(!showArchived)}
          type="button"
        >
          <span className="codascope-epic-archive-toggle-icon">{showArchived ? "▾" : "▸"}</span>
          Archived Epics
          {archivedEpics.length > 0 && showArchived && (
            <span className="codascope-epic-archive-count">{archivedEpics.length}</span>
          )}
        </button>

        {showArchived && (
          <div className="codascope-epic-archive-list">
            {loadingArchived ? (
              <p className="codascope-text-muted" style={{ padding: "var(--space-3)" }}>Loading…</p>
            ) : archivedEpics.length === 0 ? (
              <p className="codascope-text-muted" style={{ padding: "var(--space-3)" }}>No archived epics</p>
            ) : (
              archivedEpics.map((epic) => (
                <div key={epic.id} className="codascope-epic-archive-item">
                  <div className="codascope-epic-archive-item-info">
                    <span className="codascope-epic-archive-item-title">{epic.title}</span>
                    <span className="codascope-epic-card-meta">{timeAgo(epic.updatedAt)}</span>
                  </div>
                  <button
                    className="codascope-epic-card-action codascope-epic-card-action--restore"
                    onClick={() => handleRestore(epic.id)}
                    type="button"
                  >
                    Unarchive
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        open={pendingArchiveId !== null}
        title="Archive this epic?"
        message="The epic and all its data will be moved to the archive. You can restore it anytime."
        confirmLabel="Archive"
        cancelLabel="Cancel"
        onConfirm={handleArchiveConfirm}
        onCancel={() => setPendingArchiveId(null)}
      />
    </div>
  );
}
