/* ── CodaScope: WikiBrowser View ──────────────────────────────────────
   Wiki topic tree + page viewer using the shared MarkdownEditor.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownEditor } from "../../../shared/markdown";

export function WikiBrowser() {
  const { segments, navigate } = useAppSubRoute("codascope");
  const {
    activeProjectId,
    wikiTopics,
    setWikiTopics,
    activeTopicId,
    activeTopicContent,
    setActiveTopic,
    setActiveTopicContent,
    selectedModel,
    agentRunning,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  // Derive topicId from URL: /project/:id/wiki/:topicId
  const urlTopicId = segments.length >= 4 && segments[2] === "wiki" ? segments[3] : null;

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Fetch wiki topics ─────────────────────────────────────────────

  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/wiki`);
        if (res.ok) {
          const data = await res.json();
          setWikiTopics(data.topics ?? []);
        }
      } catch {
        // Silently fail
      }
    })();
  }, [activeProjectId, setWikiTopics]);

  // ── Load topic content when URL topic changes ─────────────────────

  useEffect(() => {
    if (!activeProjectId || !urlTopicId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/wiki/${urlTopicId}`);
        if (res.ok) {
          const data = await res.json();
          setActiveTopic(urlTopicId, data.content ?? "");
        }
      } catch {
        // Silently fail
      }
    })();
  }, [activeProjectId, urlTopicId, setActiveTopic]);

  /** Navigate to a topic via URL */
  const handleSelectTopic = useCallback((topicId: string) => {
    if (!activeProjectId) return;
    navigate(`project/${activeProjectId}/wiki/${topicId}`);
  }, [activeProjectId, navigate]);

  // ── Save topic content ────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!activeProjectId || !activeTopicId) return;
    setSaving(true);
    try {
      await fetch(`/api/codascope/projects/${activeProjectId}/wiki/${activeTopicId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: activeTopicContent }),
      });
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, activeTopicId, activeTopicContent]);

  // ── Build full wiki action ────────────────────────────────────────

  const handleBuildWiki = useCallback(async () => {
    if (agentRunning || !activeProjectId) return;
    setAgentRunning(true);
    setAgentStatus("Building full wiki…");
    try {
      await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "do_build_full_wiki", model: selectedModel }),
      });
    } catch {
      // Silently fail
    } finally {
      setAgentRunning(false);
      setAgentStatus("");
    }
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus]);

  // ── Filter topics ─────────────────────────────────────────────────

  const filteredTopics = search
    ? wikiTopics.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : wikiTopics;

  // ── Wiki link navigation ──────────────────────────────────────────

  const wikiFiles = wikiTopics.map((t) => ({ path: t.path, label: t.title }));

  const handleOpenFile = useCallback((path: string) => {
    const topic = wikiTopics.find((t) => t.path === path || t.id === path);
    if (topic && activeProjectId) {
      navigate(`project/${activeProjectId}/wiki/${topic.id}`);
    }
  }, [wikiTopics, activeProjectId, navigate]);

  if (!activeProjectId) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon">📖</div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project to browse its wiki.
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-wiki">
      {/* Topic sidebar */}
      <div className="codascope-wiki-sidebar">
        <div className="codascope-wiki-sidebar-header">
          <span className="codascope-wiki-sidebar-title">Topics</span>
          <button
            className="codascope-btn codascope-btn-ghost"
            style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
            onClick={handleBuildWiki}
            disabled={agentRunning}
            title="Build or rebuild wiki"
            type="button"
          >
            {agentRunning ? "Building…" : "🔄 Build"}
          </button>
        </div>
        <input
          className="codascope-wiki-search"
          type="text"
          placeholder="Search topics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filteredTopics.length === 0 ? (
            <div style={{
              padding: "var(--space-4)",
              textAlign: "center",
              color: "var(--color-text-tertiary)",
              fontSize: "var(--text-xs)",
            }}>
              {wikiTopics.length === 0
                ? "No wiki pages yet. Click Build to generate."
                : "No matching topics."}
            </div>
          ) : (
            filteredTopics.map((topic) => (
              <button
                key={topic.id}
                className={`codascope-wiki-topic ${activeTopicId === topic.id ? "codascope-wiki-topic--active" : ""}`}
                onClick={() => handleSelectTopic(topic.id)}
                type="button"
              >
                <span style={{ fontSize: "var(--text-xs)" }}>📄</span>
                {topic.title}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="codascope-wiki-content">
        {activeTopicId ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "var(--space-2) var(--space-4)",
              borderBottom: "1px solid var(--color-border-primary)",
              flexShrink: 0,
            }}>
              <button
                className="codascope-btn codascope-btn-secondary"
                style={{ fontSize: "var(--text-xs)" }}
                onClick={handleSave}
                disabled={saving}
                type="button"
              >
                {saving ? "Saving…" : "💾 Save"}
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <MarkdownEditor
                value={activeTopicContent}
                onChange={setActiveTopicContent}
                editable
                selectedPath={activeTopicId}
                files={wikiFiles}
                onOpenFile={handleOpenFile}
              />
            </div>
          </div>
        ) : (
          <div className="codascope-wiki-empty">
            <div className="codascope-wiki-empty-icon">📖</div>
            <div>Select a topic from the sidebar to view or edit it.</div>
          </div>
        )}
      </div>
    </div>
  );
}
