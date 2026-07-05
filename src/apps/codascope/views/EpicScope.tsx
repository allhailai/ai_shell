/* ── CodaScope: EpicScope View ──────────────────────────────────────
   The Scope tab content. Shows:
   - Scope entries grouped by type (Wiki Pages, Concepts, New Topics)
   - Include/exclude checkboxes with depth indicators
   - "Add Topic" button with picker modal
   - "Re-scan" button → triggers agent scoping, shows ScopeDiff review modal
   - "Deepen All" button → starts enrichment pipeline
   - Real-time progress via SSE
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { connectToSseStream } from "../codaScopeSseClient";
import { useBuildState } from "../hooks/useBuildState";
import type {
  EpicDesignDetail,
  EpicScope as EpicScopeType,
  EpicScopeEntry,
  ScopeDiff,
  WikiTopic,
} from "../codaScopeTypes";
import { DepthBadge, TypeBadge, SourceBadge, EnrichmentStatus } from "../components/ScopeBadges";
import { ScopeDiffModal } from "../components/ScopeDiffModal";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicScopeProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicScope({ epic, setEpic }: EpicScopeProps) {
  const { activeProjectId, selectedModel } = useCodaScopeStore();
  const [scope, setScope] = useState<EpicScopeType>(
    epic.scope ?? { entries: [], lastScopedAt: null, lastScopedBy: null },
  );
  const [loading, _setLoading] = useState(false);

  // Local deepen state for when the user actively triggers a deepen
  const [localDeepening, setLocalDeepening] = useState(false);
  const [localDeepenProgress, setLocalDeepenProgress] = useState<string>("");

  // Hydrate deepen pipeline state from server (survives refresh)
  const deepenBuild = useBuildState({
    projectId: activeProjectId,
    scope: `epic-deepen::${epic.id}`,
    enabled: true,
  });

  // Effective deepen state: local dispatch takes priority while active
  const deepening = localDeepening || deepenBuild.status === "running";
  const deepenProgress = localDeepening ? localDeepenProgress : (deepenBuild.progressMsg ?? "");
  const deepenDone = !localDeepening && deepenBuild.status === "success";
  const deepenFailed = !localDeepening && deepenBuild.status === "error";

  // Topic picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wikiTopics, setWikiTopics] = useState<WikiTopic[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);

  // Diff review modal
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [scopeDiff, setScopeDiff] = useState<ScopeDiff | null>(null);
  const [diffAccepted, setDiffAccepted] = useState<{
    added: Set<string>;
    removed: Set<string>;
    changed: Set<string>;
  }>({ added: new Set(), removed: new Set(), changed: new Set() });

  // Sync scope from epic when it changes
  useEffect(() => {
    if (epic.scope) setScope(epic.scope);
  }, [epic.scope]);

  /* ── Fetch scope from server ───────────────────────────────────────── */

  const refreshScope = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/scope`,
      );
      if (res.ok) {
        const data = await res.json();
        const newScope = data.scope as EpicScopeType;
        setScope(newScope);
        setEpic({ ...epic, scope: newScope });
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epic, setEpic]);

  /* ── Toggle include/exclude ────────────────────────────────────────── */

  const toggleInclude = useCallback(async (topicId: string) => {
    if (!activeProjectId) return;
    const entry = scope.entries.find((e) => e.topicId === topicId);
    if (!entry) return;

    const newIncluded = !entry.included;

    // Optimistic update
    setScope((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        e.topicId === topicId ? { ...e, included: newIncluded } : e,
      ),
    }));

    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/scope/${topicId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ included: newIncluded }),
        },
      );
    } catch { /* revert on error — for now just ignore */ }
  }, [activeProjectId, epic.id, scope.entries]);

  /* ── Remove entry ──────────────────────────────────────────────────── */

  const removeEntry = useCallback(async (topicId: string) => {
    if (!activeProjectId) return;

    setScope((prev) => ({
      ...prev,
      entries: prev.entries.filter((e) => e.topicId !== topicId),
    }));

    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/scope/${topicId}`,
        { method: "DELETE" },
      );
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id]);

  /* ── Open topic picker ─────────────────────────────────────────────── */

  const openPicker = useCallback(async () => {
    if (!activeProjectId) return;
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerSearch("");
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/wiki`);
      if (res.ok) {
        const data = await res.json();
        setWikiTopics(data.topics ?? []);
      }
    } catch { /* ignore */ }
    setPickerLoading(false);
  }, [activeProjectId]);

  /* ── Add from picker ───────────────────────────────────────────────── */

  const addFromPicker = useCallback(async (id: string, title: string) => {
    if (!activeProjectId) return;

    const newEntry: EpicScopeEntry = {
      topicId: id,
      topicTitle: title,
      type: "existing-wiki",
      source: "user",
      included: true,
      targetDepth: "developed",
    };

    // Optimistic add
    setScope((prev) => {
      if (prev.entries.some((e) => e.topicId === id)) return prev;
      return { ...prev, entries: [...prev.entries, newEntry] };
    });

    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/scope/add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry: newEntry }),
        },
      );
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id]);

  /* ── Deepen All ────────────────────────────────────────────────────── */

  const handleDeepen = useCallback(async () => {
    if (!activeProjectId || !selectedModel) return;

    // Reset hydrated state so local dispatch takes over
    deepenBuild.rebuild();
    setLocalDeepening(true);
    setLocalDeepenProgress("Starting enrichment…");

    connectToSseStream(
      {
        url: `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/deepen`,
        method: "POST",
        body: { modelId: selectedModel },
      },
      {
        onText: () => { /* ignore streaming text for deepen */ },
        onPipelineStep: (step) => {
          if (step.topic) {
            setLocalDeepenProgress(
              `${step.status === "running" ? "Enriching" : step.status}: ${step.topic}${step.progress ? ` (${step.progress})` : ""}`,
            );
          }

          // Update scope entry status in real-time
          if (step.status === "complete" && step.topic) {
            setScope((prev) => ({
              ...prev,
              entries: prev.entries.map((e) =>
                e.topicTitle === step.topic
                  ? { ...e, enrichedAt: new Date().toISOString(), enrichmentRunId: step.step }
                  : e,
              ),
            }));
          }
        },
        onDone: () => {
          setLocalDeepenProgress("Enrichment complete!");
          setLocalDeepening(false);
          refreshScope();
        },
        onError: (err) => {
          setLocalDeepenProgress(`Error: ${err}`);
          setLocalDeepening(false);
        },
      },
    );
  }, [activeProjectId, epic.id, selectedModel, refreshScope, deepenBuild.rebuild]);

  /* ── Apply scope diff ──────────────────────────────────────────────── */

  const applyDiff = useCallback(async () => {
    if (!activeProjectId || !scopeDiff) return;

    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/scope/apply-diff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accepted: {
              addedTopicIds: Array.from(diffAccepted.added),
              removedTopicIds: Array.from(diffAccepted.removed),
              changedTopicIds: Array.from(diffAccepted.changed),
            },
            fullDiff: scopeDiff,
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        setScope(data.scope);
        setEpic({ ...epic, scope: data.scope });
      }
    } catch { /* ignore */ }

    setDiffModalOpen(false);
    setScopeDiff(null);
  }, [activeProjectId, epic, scopeDiff, diffAccepted, setEpic]);

  /* ── Toggle diff item acceptance ───────────────────────────────────── */

  const toggleDiffItem = useCallback((category: "added" | "removed" | "changed", id: string) => {
    setDiffAccepted((prev) => {
      const next = { ...prev, [category]: new Set(prev[category]) };
      if (next[category].has(id)) {
        next[category].delete(id);
      } else {
        next[category].add(id);
      }
      return next;
    });
  }, []);

  /* ── Group entries by type ─────────────────────────────────────────── */

  const wikiEntries = scope.entries.filter((e) => e.type === "existing-wiki");
  const newEntries = scope.entries.filter((e) => e.type === "new");
  const includedCount = scope.entries.filter((e) => e.included).length;
  const enrichedCount = scope.entries.filter((e) => e.enrichedAt).length;

  /* ── Empty state ───────────────────────────────────────────────────── */

  if (scope.entries.length === 0 && !loading) {
    return (
      <div className="codascope-scope-empty">
        <div className="codascope-empty-state">
          <div className="codascope-scope-empty-icon">
            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3l2 1" />
            </svg>
          </div>
          <h3>No scope yet</h3>
          <p>Scope identifies which wiki pages, concepts, and topics are relevant to this epic. The agent can analyze your definition to suggest a scope, or you can add topics manually.</p>
          <div className="codascope-scope-empty-actions">
            <button
              className="codascope-btn codascope-btn-secondary"
              onClick={() => openPicker("wiki")}
              type="button"
            >
              Add from Wiki
            </button>
            <button
              className="codascope-btn codascope-btn-secondary"
              onClick={() => openPicker("concept")}
              type="button"
            >
              Add from Concepts
            </button>
            <span className="codascope-scope-empty-hint">
              or ask the agent to <strong>"scope this epic"</strong> in the chat panel →
            </span>
          </div>
        </div>

        {/* Modals must render even in empty state */}
        {pickerOpen && (
          <TopicPickerModal
            type={pickerType}
            wikiTopics={wikiTopics}
            concepts={concepts}
            search={pickerSearch}
            onSearchChange={setPickerSearch}
            loading={pickerLoading}
            existingTopicIds={new Set(scope.entries.map((e) => e.topicId))}
            onAdd={addFromPicker}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    );
  }

  /* ── Main render ───────────────────────────────────────────────────── */

  return (
    <div className="codascope-scope-view">
      {/* Toolbar */}
      <div className="codascope-scope-toolbar">
        <div className="codascope-scope-toolbar-left">
          <span className="codascope-scope-summary">
            {includedCount} topic{includedCount !== 1 ? "s" : ""} included
            {enrichedCount > 0 && <> · {enrichedCount} enriched</>}
          </span>
          {scope.lastScopedAt && (
            <span className="codascope-scope-last-scoped">
              Last scoped: {new Date(scope.lastScopedAt).toLocaleDateString()}
              {scope.lastScopedBy && ` by ${scope.lastScopedBy}`}
            </span>
          )}
        </div>
        <div className="codascope-scope-toolbar-right">
          <button
            className="codascope-btn codascope-btn-secondary"
            onClick={() => openPicker("wiki")}
            type="button"
          >
            + Wiki
          </button>
          <button
            className="codascope-btn codascope-btn-secondary"
            onClick={() => openPicker("wiki")}
            type="button"
          >
            + Wiki Page
          </button>
          {deepenDone ? (
            <button
              className="codascope-btn codascope-btn-secondary"
              onClick={() => { deepenBuild.rebuild(); }}
              type="button"
              title={deepenBuild.summary ?? undefined}
            >
              ✓ Deepened · Rebuild
            </button>
          ) : deepenFailed ? (
            <button
              className="codascope-btn codascope-btn-secondary codascope-btn-error"
              onClick={() => { deepenBuild.rebuild(); }}
              type="button"
              title={deepenBuild.error ?? undefined}
            >
              ✗ Failed · Retry
            </button>
          ) : (
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={handleDeepen}
              disabled={deepening || includedCount === 0 || !selectedModel}
              title={!selectedModel ? "Select a model first" : undefined}
              type="button"
            >
              {deepening ? "Deepening…" : "Deepen All"}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {deepening && (
        <div className="codascope-scope-progress">
          <div className="codascope-scope-progress-bar">
            <div className="codascope-scope-progress-fill" />
          </div>
          <span className="codascope-scope-progress-text">{deepenProgress}</span>
        </div>
      )}

      {/* Entry sections */}
      {wikiEntries.length > 0 && (
        <ScopeSection
          title="Wiki Pages"
          entries={wikiEntries}
          onToggle={toggleInclude}
          onRemove={removeEntry}
        />
      )}
      {newEntries.length > 0 && (
        <ScopeSection
          title="New Topics"
          entries={newEntries}
          onToggle={toggleInclude}
          onRemove={removeEntry}
        />
      )}

      {/* Topic Picker Modal */}
      {pickerOpen && (
        <TopicPickerModal
          wikiTopics={wikiTopics}
          search={pickerSearch}
          onSearchChange={setPickerSearch}
          loading={pickerLoading}
          existingTopicIds={new Set(scope.entries.map((e) => e.topicId))}
          onAdd={addFromPicker}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Scope Diff Review Modal */}
      {diffModalOpen && scopeDiff && (
        <ScopeDiffModal
          diff={scopeDiff}
          accepted={diffAccepted}
          onToggle={toggleDiffItem}
          onApply={applyDiff}
          onDismiss={() => { setDiffModalOpen(false); setScopeDiff(null); }}
        />
      )}
    </div>
  );
}

/* ── Scope Section ───────────────────────────────────────────────────── */

function ScopeSection({
  title,
  entries,
  onToggle,
  onRemove,
}: {
  title: string;
  entries: EpicScopeEntry[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="codascope-scope-section">
      <h3 className="codascope-scope-section-title">{title} ({entries.length})</h3>
      <div className="codascope-scope-list">
        {entries.map((entry) => (
          <div
            key={entry.topicId}
            className={`codascope-scope-entry ${entry.included ? "" : "codascope-scope-entry--excluded"}`}
          >
            <label className="codascope-scope-entry-checkbox">
              <input
                type="checkbox"
                checked={entry.included}
                onChange={() => onToggle(entry.topicId)}
              />
            </label>
            <div className="codascope-scope-entry-info">
              <div className="codascope-scope-entry-title-row">
                <span className="codascope-scope-entry-title">{entry.topicTitle}</span>
                <TypeBadge type={entry.type} />
                <SourceBadge source={entry.source} />
              </div>
              <div className="codascope-scope-entry-meta">
                {entry.previousDepth && (
                  <>
                    <DepthBadge depth={entry.previousDepth} />
                    <span className="codascope-scope-depth-arrow">→</span>
                  </>
                )}
                {entry.targetDepth && <DepthBadge depth={entry.targetDepth} />}
                <EnrichmentStatus entry={entry} />
              </div>
            </div>
            <button
              className="codascope-scope-entry-remove"
              onClick={() => onRemove(entry.topicId)}
              title="Remove from scope"
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Topic Picker Modal ──────────────────────────────────────────────── */

function TopicPickerModal({
  type,
  wikiTopics,
  concepts,
  search,
  onSearchChange,
  loading,
  existingTopicIds,
  onAdd,
  onClose,
}: {
  wikiTopics: WikiTopic[];
  search: string;
  onSearchChange: (s: string) => void;
  loading: boolean;
  existingTopicIds: Set<string>;
  onAdd: (id: string, title: string) => void;
  onClose: () => void;
}) {
  const searchLower = search.toLowerCase();

  const filteredWiki = wikiTopics.filter(
    (t) => t.title.toLowerCase().includes(searchLower) && !existingTopicIds.has(t.id),
  );

  return (
    <div className="codascope-modal-overlay" onClick={onClose}>
      <div className="codascope-scope-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="codascope-scope-picker-header">
          <h3>Add Wiki Page to Scope</h3>
          <button className="codascope-modal-close" onClick={onClose} type="button">×</button>
        </div>

        <div className="codascope-scope-picker-search">
          <input
            type="text"
            placeholder="Search wiki pages…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            autoFocus
          />
        </div>

        <div className="codascope-scope-picker-list">
          {loading && <div className="codascope-scope-picker-loading">Loading…</div>}

          {filteredWiki.map((topic) => (
            <button
              key={topic.id}
              className="codascope-scope-picker-item"
              onClick={() => {
                onAdd(topic.id, topic.title);
              }}
              type="button"
            >
              <span className="codascope-scope-picker-item-title">{topic.title}</span>
              <span className="codascope-scope-picker-item-add">+ Add</span>
            </button>
          ))}

          {!loading && filteredWiki.length === 0 && (
            <div className="codascope-scope-picker-empty">No matching wiki pages found</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ScopeDiffModal extracted to ../components/ScopeDiffModal.tsx */
