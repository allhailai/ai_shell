/* ── CodaScope: WikiBrowser View ──────────────────────────────────────
   Wiki topic tree + page viewer using the shared MarkdownEditor.
   Build actions use SSE streaming from the agent.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownEditor } from "../../../shared/markdown";
import { ModelPicker } from "../components/ModelPicker";
import { IconWiki, IconRefresh, IconFile, IconHome, IconDownload } from "../components/CodaScopeIcons";
import { connectToSseStream } from "../codaScopeSseClient";

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
    setSelectedModel,
    agentRunning,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  // Derive topicId from URL: /project/:id/wiki/:topicId
  const urlTopicId = segments.length >= 4 && segments[2] === "wiki" ? segments[3] : null;

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [buildLog, setBuildLog] = useState("");
  const [showBuildTopic, setShowBuildTopic] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [buildError, setBuildError] = useState("");
  const [topicDepths, setTopicDepths] = useState<Record<string, string>>({});
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // ── Fetch wiki topics ─────────────────────────────────────────────

  const refreshTopics = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/wiki`);
      if (res.ok) {
        const data = await res.json();
        setWikiTopics(data.topics ?? []);
      }
    } catch {
      // Silently fail
    }
  }, [activeProjectId, setWikiTopics]);

  useEffect(() => {
    void refreshTopics();
  }, [refreshTopics]);

  // ── Fetch wiki state for depth badges ──────────────────────────────

  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/codascope/projects/${activeProjectId}/wiki-state`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.topics) {
          const depths: Record<string, string> = {};
          for (const [topicId, topicState] of Object.entries(data.topics)) {
            depths[topicId] = (topicState as { depth: string }).depth;
          }
          setTopicDepths(depths);
        }
      })
      .catch(() => { /* ignore */ });
  }, [activeProjectId, wikiTopics]);

  // ── Auto-navigate to index topic when none selected ───────────────

  useEffect(() => {
    if (!activeProjectId || urlTopicId) return;
    const hasIndex = wikiTopics.some((t) => t.id === "index");
    if (hasIndex) {
      navigate(`project/${activeProjectId}/wiki/index`);
    }
  }, [activeProjectId, urlTopicId, wikiTopics, navigate]);

  // ── Load topic content when URL topic changes or topics refresh ────

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
  }, [activeProjectId, urlTopicId, wikiTopics, setActiveTopic]);

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

  // ── SSE Agent Run helper ──────────────────────────────────────────

  const runAgentCommand = useCallback(async (
    command: string,
    extra?: Record<string, string>,
  ) => {
    if (agentRunning || !activeProjectId || !selectedModel) return;

    setAgentRunning(true);
    setBuildLog("");
    setBuildError("");
    setAgentStatus(`Running ${command}…`);

    try {
      await new Promise<void>((resolve, reject) => {
        connectToSseStream(
          {
            url: `/api/codascope/projects/${activeProjectId}/runs`,
            method: "POST",
            body: { command, modelId: selectedModel, ...extra },
          },
          {
            onText: (text) => setBuildLog((prev) => prev + text),
            onDone: () => resolve(),
            onError: (error) => reject(new Error(error)),
          },
        );
      });

      // Refresh topics after build
      await refreshTopics();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setBuildLog((prev) => prev + `\n\nError: ${message}`);
    } finally {
      setAgentRunning(false);
      setAgentStatus("");
    }
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus, refreshTopics]);

  // ── Build full wiki action ────────────────────────────────────────

  const handleBuildWiki = useCallback(() => {
    void runAgentCommand("do_build_full_wiki");
  }, [runAgentCommand]);

  // ── Build single topic ────────────────────────────────────────────

  const handleBuildTopic = useCallback(() => {
    if (!topicName.trim()) return;
    void runAgentCommand("do_build_wiki_page", { topicName: topicName.trim() });
    setTopicName("");
    setShowBuildTopic(false);
  }, [runAgentCommand, topicName]);

  // ── Auto-scroll build log ─────────────────────────────────────────

  useEffect(() => {
    if (logEndRef.current && buildLog) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [buildLog]);

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
        <div className="codascope-empty-state-icon"><IconWiki size={32} /></div>
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
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              className="codascope-btn codascope-btn-ghost"
              style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
              onClick={() => setShowBuildTopic(true)}
              disabled={agentRunning}
              title="Build a single wiki page"
              type="button"
            >
              + Page
            </button>
            <button
              className="codascope-btn codascope-btn-ghost"
              style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
              onClick={handleBuildWiki}
              disabled={agentRunning}
              title="Build or rebuild full wiki"
              type="button"
            >
              {agentRunning ? "Building…" : <><IconRefresh size={12} /> Build All</>}
            </button>
          </div>
        </div>

        {/* Model picker for builds */}
        <div style={{ padding: "0 var(--space-3) var(--space-2)" }}>
          <ModelPicker
            value={selectedModel}
            onChange={setSelectedModel}
            compact
          />
        </div>

        {/* Build topic form */}
        {showBuildTopic && (
          <div style={{
            padding: "var(--space-3)",
            borderBottom: "1px solid var(--color-border-primary)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}>
            <input
              className="codascope-form-input"
              type="text"
              placeholder="Topic name (e.g., Authentication)"
              value={topicName}
              onChange={(e) => setTopicName(e.target.value)}
              style={{ fontSize: "var(--text-xs)" }}
              onKeyDown={(e) => e.key === "Enter" && handleBuildTopic()}
              autoFocus
            />
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                className="codascope-btn codascope-btn-primary"
                style={{ fontSize: "var(--text-xs)", padding: "2px 8px", flex: 1 }}
                onClick={handleBuildTopic}
                disabled={!topicName.trim() || agentRunning}
                type="button"
              >
                Build
              </button>
              <button
                className="codascope-btn codascope-btn-ghost"
                style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                onClick={() => { setShowBuildTopic(false); setTopicName(""); }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
                ? "No wiki pages yet. Click Build All to generate."
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
                <span style={{ fontSize: "var(--text-xs)" }}>
                  {topic.id === "index" ? <IconHome size={12} /> : <IconFile size={12} />}
                </span>
                {topic.title}
                {topicDepths[topic.id] && topic.id !== "index" && (
                  <span
                    className={`codascope-wiki-depth-badge codascope-wiki-depth-badge--${topicDepths[topic.id]}`}
                    title={`Depth: ${topicDepths[topic.id]}`}
                  >
                    {topicDepths[topic.id] === "deep" ? "🟢" : topicDepths[topic.id] === "developed" ? "🟡" : "🔵"}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="codascope-wiki-content">
        {/* Error alert */}
        {buildError && (
          <div className="codascope-alert codascope-alert--danger" style={{ margin: "var(--space-4)" }}>
            <span className="codascope-alert-icon">⚠</span>
            <span>{buildError}</span>
            <button
              className="codascope-alert-dismiss"
              onClick={() => setBuildError("")}
              type="button"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Build log panel (shown when agent is running or has output) */}
        {buildLog && (
          <div className="codascope-build-log">
            <div className="codascope-build-log-header">
              <span>
                {agentRunning ? "⟳ Agent Output" : "✓ Build Complete"}
              </span>
              {!agentRunning && (
                <button
                  className="codascope-btn codascope-btn-ghost"
                  style={{ fontSize: "var(--text-xs)", padding: "2px 6px" }}
                  onClick={() => setBuildLog("")}
                  type="button"
                >
                  Dismiss
                </button>
              )}
            </div>
            <pre className="codascope-build-log-content">
              {buildLog}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}

        {activeTopicId && !buildLog ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
              padding: "var(--space-2) var(--space-4)",
              borderBottom: "1px solid var(--color-border-primary)",
              flexShrink: 0,
            }}>
              <a
                className="codascope-btn codascope-btn-ghost"
                style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
                href={`/api/codascope/projects/${activeProjectId}/wiki/${activeTopicId}/download`}
                download
                title="Download as Markdown"
              >
                <IconDownload size={13} /> Download
              </a>
              <button
                className="codascope-btn codascope-btn-secondary"
                style={{ fontSize: "var(--text-xs)" }}
                onClick={handleSave}
                disabled={saving}
                type="button"
              >
                {saving ? "Saving…" : "Save"}
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
        ) : !buildLog ? (
          <div className="codascope-wiki-empty">
            <div className="codascope-wiki-empty-icon"><IconWiki size={32} /></div>
            <div>Select a topic from the sidebar to view or edit it.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
