/* ── CodaScope: EpicKnowledge View ───────────────────────────────────
   The Knowledge tab content. Shows three sections:
   1. Epic Wiki Pages   — research synthesis wiki pages
   2. Research Sources   — downloaded + uploaded content with upload
   3. Blocked Downloads  — failed downloads with resolution flow

   Also includes a Knowledge Workflow Guide banner that explains
   how to build knowledge (via chat-driven research → upload → curate).

   Depends on Phases 2 + 5 backend (knowledge service, content
   extraction, research pipeline).
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { useShellStore } from "../../../shell/store";
import { MarkdownViewer } from "../../../shared/markdown";
import { SourceUpload } from "../components/SourceUpload";
import { SourceViewer } from "../components/SourceViewer";
import { BlockedDownloadItem } from "../components/BlockedDownloadItem";
import {
  IconKnowledge,
  IconFile,
  IconEye,
  IconClock,
  IconBlocked,
  IconUpload,
  IconHelp,
  IconArrowRight,
  IconCheck,
  IconChat,
} from "../components/CodaScopeIcons";
import type {
  EpicDesignDetail,
  EpicKnowledgeSource,
  EpicWikiPage,
  BlockedDownload,
} from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicKnowledgeProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural ?? singular + "s"}`;
}

/* ── Source status badge ─────────────────────────────────────────────── */

function SourceStatusBadge({ status }: { status: EpicKnowledgeSource["status"] }) {
  return (
    <span className={`codascope-knowledge-source-status codascope-knowledge-source-status-${status}`}>
      {status}
    </span>
  );
}

function SourceTypeBadge({ type }: { type: EpicKnowledgeSource["type"] }) {
  return (
    <span className={`codascope-knowledge-source-type codascope-knowledge-source-type-${type}`}>
      {type === "machine" ? "Machine" : "Human"}
    </span>
  );
}

/* ── Workflow Guide ──────────────────────────────────────────────────── */

interface GuideStepData {
  number: number;
  title: string;
  description: string;
  complete: boolean;
  hint: string;
}

function KnowledgeWorkflowGuide({
  steps,
  expanded,
  onToggle,
  onOpenChat,
}: {
  steps: GuideStepData[];
  expanded: boolean;
  onToggle: () => void;
  onOpenChat: () => void;
}) {
  const completedCount = steps.filter((s) => s.complete).length;

  return (
    <div className={`codascope-knowledge-guide ${expanded ? "codascope-knowledge-guide-expanded" : ""}`}>
      <button
        className="codascope-knowledge-guide-header"
        onClick={onToggle}
        type="button"
      >
        <div className="codascope-knowledge-guide-header-left">
          <IconHelp size={16} />
          <span className="codascope-knowledge-guide-title">
            How to Build Knowledge
          </span>
          <span className="codascope-knowledge-guide-progress">
            {completedCount}/{steps.length} steps
          </span>
        </div>
        <span className="codascope-knowledge-guide-chevron">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="codascope-knowledge-guide-body">
          <p className="codascope-knowledge-guide-intro">
            The <strong>chat assistant</strong> drives your research workflow.
            Ask it to search the web, download content, and synthesize findings into wiki pages.
          </p>

          <div className="codascope-knowledge-guide-steps">
            {steps.map((step) => (
              <div
                key={step.number}
                className={`codascope-knowledge-guide-step ${step.complete ? "codascope-knowledge-guide-step-complete" : ""}`}
              >
                <div className="codascope-knowledge-guide-step-indicator">
                  {step.complete ? (
                    <span className="codascope-knowledge-guide-step-check">
                      <IconCheck size={12} />
                    </span>
                  ) : (
                    <span className="codascope-knowledge-guide-step-number">
                      {step.number}
                    </span>
                  )}
                </div>
                <div className="codascope-knowledge-guide-step-content">
                  <span className="codascope-knowledge-guide-step-title">{step.title}</span>
                  <span className="codascope-knowledge-guide-step-desc">{step.description}</span>
                  {!step.complete && (
                    <span className="codascope-knowledge-guide-step-hint">{step.hint}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            className="codascope-knowledge-guide-cta"
            onClick={onOpenChat}
            type="button"
          >
            <IconChat size={14} />
            <span>Use the chat assistant in the right panel to get started</span>
            <IconArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicKnowledge({ epic }: EpicKnowledgeProps) {
  const { activeProjectId } = useCodaScopeStore();

  // ── State ────────────────────────────────────────────────────────────
  const [wikiPages, setWikiPages] = useState<EpicWikiPage[]>([]);
  const [sources, setSources] = useState<EpicKnowledgeSource[]>([]);
  const [blockedItems, setBlockedItems] = useState<BlockedDownload[]>([]);
  const [dismissedItems, setDismissedItems] = useState<BlockedDownload[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);

  const [loadingWiki, setLoadingWiki] = useState(true);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingBlocked, setLoadingBlocked] = useState(true);

  // Wiki page viewer
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);
  const [expandedPageContent, setExpandedPageContent] = useState<string | null>(null);
  const [loadingPageContent, setLoadingPageContent] = useState(false);

  // Source viewer modal
  const [viewingSource, setViewingSource] = useState<EpicKnowledgeSource | null>(null);

  // Guide state — auto-expand when empty, user can toggle
  const [guideExpanded, setGuideExpanded] = useState<boolean | null>(null); // null = not yet decided

  const pid = activeProjectId;

  // ── Data fetching ────────────────────────────────────────────────────

  const fetchWikiPages = useCallback(async () => {
    if (!pid) return;
    setLoadingWiki(true);
    try {
      const res = await fetch(`/api/codascope/projects/${pid}/epics/${epic.id}/knowledge/wiki`);
      if (res.ok) {
        const data = await res.json();
        setWikiPages(data.pages ?? []);
      }
    } catch { /* silent */ }
    setLoadingWiki(false);
  }, [pid, epic.id]);

  const fetchSources = useCallback(async () => {
    if (!pid) return;
    setLoadingSources(true);
    try {
      const res = await fetch(`/api/codascope/projects/${pid}/epics/${epic.id}/knowledge/sources`);
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources ?? []);
      }
    } catch { /* silent */ }
    setLoadingSources(false);
  }, [pid, epic.id]);

  const fetchBlocked = useCallback(async () => {
    if (!pid) return;
    setLoadingBlocked(true);
    try {
      // Fetch active blocked items
      const res = await fetch(`/api/codascope/projects/${pid}/epics/${epic.id}/knowledge/blocked`);
      if (res.ok) {
        const data = await res.json();
        setBlockedItems((data.items ?? []).filter((i: BlockedDownload) => i.status === "blocked"));
      }

      // Fetch dismissed items separately
      const resDismissed = await fetch(
        `/api/codascope/projects/${pid}/epics/${epic.id}/knowledge/blocked?includeDismissed=true`,
      );
      if (resDismissed.ok) {
        const dataDismissed = await resDismissed.json();
        setDismissedItems(
          (dataDismissed.items ?? [])
            .filter((i: BlockedDownload) => i.status === "dismissed")
            .sort((a: BlockedDownload, b: BlockedDownload) =>
              (b.dismissedAt ?? "").localeCompare(a.dismissedAt ?? ""),
            ),
        );
      }
    } catch { /* silent */ }
    setLoadingBlocked(false);
  }, [pid, epic.id]);

  useEffect(() => {
    void fetchWikiPages();
    void fetchSources();
    void fetchBlocked();
  }, [fetchWikiPages, fetchSources, fetchBlocked]);

  // ── Auto-expand guide when there's no content ────────────────────────
  useEffect(() => {
    if (guideExpanded !== null) return; // user already toggled
    if (loadingWiki || loadingSources) return; // still loading
    // Auto-expand if there are no wiki pages and no sources
    setGuideExpanded(wikiPages.length === 0 && sources.length === 0);
  }, [guideExpanded, loadingWiki, loadingSources, wikiPages.length, sources.length]);

  // ── Guide steps computation ──────────────────────────────────────────
  const hasDefinition = epic.definition.trim().length > 0;
  const hasScope = epic.scope !== null && epic.scope.entries.length > 0;
  const hasSources = sources.length > 0;
  const hasWikiPages = wikiPages.length > 0;

  const guideSteps: GuideStepData[] = [
    {
      number: 1,
      title: "Define & Scope",
      description: "Set up the epic definition and scope topics as the foundation for research.",
      complete: hasDefinition && hasScope,
      hint: hasDefinition
        ? "Go to the Scope tab to identify relevant topics."
        : "Go to the Define tab to describe what this epic is about.",
    },
    {
      number: 2,
      title: "Research",
      description: "Ask the chat assistant to research your topics. It searches the web and downloads sources.",
      complete: hasSources && sources.some((s) => s.type === "machine"),
      hint: "Try: \"Research best practices for [your topic]\"",
    },
    {
      number: 3,
      title: "Upload Sources",
      description: "Manually upload PDFs, articles, or docs. Paste URLs into chat to download pages.",
      complete: hasSources,
      hint: "Use the drop zone below or drag files onto this page.",
    },
    {
      number: 4,
      title: "Curate & Synthesize",
      description: "Run curation to synthesize all sources into organized wiki pages for this epic.",
      complete: hasWikiPages,
      hint: "Use the Curate button or ask: \"Process sources into wiki pages\"",
    },
  ];

  // ── Wiki page expand/collapse ────────────────────────────────────────

  const handleTogglePage = useCallback(async (pageId: string) => {
    if (expandedPageId === pageId) {
      setExpandedPageId(null);
      setExpandedPageContent(null);
      return;
    }

    setExpandedPageId(pageId);
    setLoadingPageContent(true);
    setExpandedPageContent(null);

    if (!pid) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${pid}/epics/${epic.id}/knowledge/wiki/${pageId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setExpandedPageContent(data.content ?? "");
      }
    } catch { /* silent */ }
    setLoadingPageContent(false);
  }, [pid, epic.id, expandedPageId]);

  // ── Upload callback ──────────────────────────────────────────────────

  const handleSourceUploaded = useCallback((source: EpicKnowledgeSource) => {
    setSources((prev) => [source, ...prev]);
  }, []);

  // ── Blocked item callbacks ───────────────────────────────────────────

  const handleBlockedDismissed = useCallback((blockId: string) => {
    setBlockedItems((prev) => prev.filter((i) => i.id !== blockId));
    void fetchBlocked(); // Refresh to get updated dismissed list
  }, [fetchBlocked]);

  const handleBlockedResolved = useCallback((blockId: string) => {
    setBlockedItems((prev) => prev.filter((i) => i.id !== blockId));
    void fetchSources(); // Refresh sources to pick up the new resolved source
  }, [fetchSources]);

  // ── Source summary ───────────────────────────────────────────────────

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const pendingCount = sources.filter((s) => s.status === "pending" || s.status === "processing").length;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="codascope-knowledge-container">

      {/* ── Workflow Guide Banner ─────────────────────────────────────── */}
      <KnowledgeWorkflowGuide
        steps={guideSteps}
        expanded={guideExpanded ?? false}
        onToggle={() => setGuideExpanded((prev) => !(prev ?? false))}
        onOpenChat={() => useShellStore.getState().openRightPanel("assistant")}
      />

      {/* ── Section 1: Epic Wiki Pages ──────────────────────────────── */}
      <section className="codascope-knowledge-section">
        <div className="codascope-knowledge-section-header">
          <IconKnowledge size={18} />
          <h2 className="codascope-knowledge-section-title">Epic Wiki Pages</h2>
          <span className="codascope-knowledge-section-count">{wikiPages.length}</span>
        </div>

        {loadingWiki && (
          <div className="codascope-knowledge-loading">Loading wiki pages…</div>
        )}

        {!loadingWiki && wikiPages.length === 0 && (
          <div className="codascope-knowledge-empty">
            <IconKnowledge size={24} />
            <p>No research wiki pages yet.</p>
            <span className="codascope-knowledge-empty-hint">
              Ask the chat assistant to research topics and curate findings into wiki pages.
            </span>
          </div>
        )}

        {!loadingWiki && wikiPages.length > 0 && (
          <div className="codascope-knowledge-wiki-list">
            {wikiPages.map((page) => (
              <div key={page.id} className="codascope-knowledge-wiki-entry">
                <button
                  className={`codascope-knowledge-wiki-row ${expandedPageId === page.id ? "codascope-knowledge-wiki-row-expanded" : ""}`}
                  onClick={() => handleTogglePage(page.id)}
                  type="button"
                >
                  <span className="codascope-knowledge-wiki-title">{page.title}</span>
                  <span className="codascope-knowledge-wiki-meta">
                    {pluralize(page.wordCount, "word")}
                    <span className="codascope-knowledge-wiki-sep">·</span>
                    {pluralize(page.sourceRefs.length, "source")}
                    <span className="codascope-knowledge-wiki-sep">·</span>
                    <IconClock size={12} />
                    {formatDate(page.updatedAt)}
                  </span>
                  <span className="codascope-knowledge-wiki-chevron">
                    {expandedPageId === page.id ? "▾" : "▸"}
                  </span>
                </button>

                {expandedPageId === page.id && (
                  <div className="codascope-knowledge-wiki-content">
                    {loadingPageContent && (
                      <div className="codascope-knowledge-loading">Loading…</div>
                    )}
                    {!loadingPageContent && expandedPageContent !== null && (
                      <MarkdownViewer content={expandedPageContent} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Research Sources ─────────────────────────────── */}
      <section className="codascope-knowledge-section">
        <div className="codascope-knowledge-section-header">
          <IconFile size={18} />
          <h2 className="codascope-knowledge-section-title">Research Sources</h2>
          {sources.length > 0 && (
            <span className="codascope-knowledge-section-summary">
              {pluralize(sources.length, "source")}
              <span className="codascope-knowledge-wiki-sep">·</span>
              {readyCount} processed
              {pendingCount > 0 && (
                <>
                  <span className="codascope-knowledge-wiki-sep">·</span>
                  {pendingCount} pending
                </>
              )}
            </span>
          )}
        </div>

        {/* Upload zone */}
        {pid && (
          <SourceUpload
            projectId={pid}
            epicId={epic.id}
            onUploaded={handleSourceUploaded}
          />
        )}

        {loadingSources && (
          <div className="codascope-knowledge-loading">Loading sources…</div>
        )}

        {!loadingSources && sources.length === 0 && (
          <div className="codascope-knowledge-empty">
            <IconUpload size={24} />
            <p>No research sources yet.</p>
            <span className="codascope-knowledge-empty-hint">
              Upload content above or ask the chat assistant to research and download sources.
            </span>
          </div>
        )}

        {!loadingSources && sources.length > 0 && (
          <div className="codascope-knowledge-source-grid">
            {sources.map((source) => (
              <div key={source.id} className="codascope-knowledge-source-card">
                <div className="codascope-knowledge-source-card-header">
                  <span className="codascope-knowledge-source-card-title">{source.title}</span>
                  <div className="codascope-knowledge-source-card-badges">
                    <SourceTypeBadge type={source.type} />
                    <SourceStatusBadge status={source.status} />
                  </div>
                </div>
                <div className="codascope-knowledge-source-card-meta">
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="codascope-knowledge-source-card-url"
                      title={source.url}
                    >
                      {source.url.length > 50
                        ? `${source.url.slice(0, 50)}…`
                        : source.url}
                    </a>
                  ) : (
                    <span className="codascope-knowledge-source-card-filename">
                      {source.filename}
                    </span>
                  )}
                </div>
                {source.topicAssociations.length > 0 && (
                  <div className="codascope-knowledge-source-card-topics">
                    {source.topicAssociations.map((t) => (
                      <span key={t} className="codascope-knowledge-source-topic-tag">{t}</span>
                    ))}
                  </div>
                )}
                <div className="codascope-knowledge-source-card-footer">
                  <span className="codascope-knowledge-source-card-date">
                    <IconClock size={12} />
                    {formatDate(source.addedAt)}
                  </span>
                  {source.status === "ready" && (
                    <button
                      className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                      onClick={() => setViewingSource(source)}
                      type="button"
                    >
                      <IconEye size={14} />
                      View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Blocked Downloads ────────────────────────────── */}
      {(blockedItems.length > 0 || dismissedItems.length > 0) && pid && (
        <section className="codascope-knowledge-section">
          <div className="codascope-knowledge-section-header">
            <IconBlocked size={18} />
            <h2 className="codascope-knowledge-section-title">Blocked Downloads</h2>
            <span className="codascope-knowledge-section-count">{blockedItems.length}</span>
          </div>

          {loadingBlocked && (
            <div className="codascope-knowledge-loading">Loading blocked downloads…</div>
          )}

          {!loadingBlocked && blockedItems.length === 0 && dismissedItems.length > 0 && (
            <div className="codascope-knowledge-empty">
              <p>All blocked downloads have been dismissed or resolved.</p>
            </div>
          )}

          {!loadingBlocked && blockedItems.map((item) => (
            <BlockedDownloadItem
              key={item.id}
              projectId={pid}
              epicId={epic.id}
              item={item}
              onDismissed={handleBlockedDismissed}
              onResolved={handleBlockedResolved}
            />
          ))}

          {/* Dismissed items toggle */}
          {dismissedItems.length > 0 && (
            <div className="codascope-knowledge-dismissed-toggle">
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                onClick={() => setShowDismissed((prev) => !prev)}
                type="button"
              >
                {showDismissed
                  ? "Hide dismissed"
                  : `Show ${pluralize(dismissedItems.length, "dismissed item")}`}
              </button>
            </div>
          )}

          {showDismissed && dismissedItems.length > 0 && (
            <div className="codascope-knowledge-dismissed-list">
              {dismissedItems.map((item) => (
                <div key={item.id} className="codascope-blocked-item codascope-blocked-item-dismissed">
                  <div className="codascope-blocked-item-header">
                    <IconBlocked size={16} />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="codascope-blocked-item-url"
                      title={item.url}
                    >
                      {item.url.length > 60 ? `${item.url.slice(0, 60)}…` : item.url}
                    </a>
                  </div>
                  <div className="codascope-blocked-item-details">
                    <span className="codascope-blocked-item-reason">{item.reason}</span>
                    <span className="codascope-blocked-item-time">
                      Dismissed {item.dismissedAt ? formatDate(item.dismissedAt) : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Source Viewer Modal ──────────────────────────────────────── */}
      {viewingSource && pid && (
        <SourceViewer
          projectId={pid}
          epicId={epic.id}
          source={viewingSource}
          onClose={() => setViewingSource(null)}
        />
      )}
    </div>
  );
}
