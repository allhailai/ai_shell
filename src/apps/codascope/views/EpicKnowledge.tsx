/* ── CodaScope: EpicKnowledge Sub-Views ─────────────────────────────
   Focused sub-views for the Knowledge section, split from the original
   monolithic EpicKnowledge component. Each view renders in the main
   content area when its corresponding sidebar item is active.

   - EpicKnowledgeWikiView  → single wiki page viewer
   - EpicKnowledgeSourcesView → source detail viewer (inline, not modal)
   - EpicKnowledgeBlockedView → blocked downloads with resolution
   - EpicKnowledgeOverview → empty-state / workflow guide
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { useShellStore } from "../../../shell/store";
import { MarkdownViewer } from "../../../shared/markdown";
import { SourceUpload } from "../components/SourceUpload";
import { BlockedDownloadItem } from "../components/BlockedDownloadItem";
import {
  IconKnowledge,
  IconFile,
  IconClock,
  IconBlocked,
  IconWarning,
  IconUpload,
  IconHelp,
  IconArrowRight,
  IconCheck,
  IconChat,
  IconDownload,
  IconExternalLink,
} from "../components/CodaScopeIcons";
import type {
  EpicDesignDetail,
  EpicKnowledgeSource,
  EpicWikiPage,
  BlockedDownload,
} from "../codaScopeTypes";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural ?? singular + "s"}`;
}

/* ══════════════════════════════════════════════════════════════════════
   Wiki Page Viewer
   ══════════════════════════════════════════════════════════════════════ */

interface EpicKnowledgeWikiViewProps {
  epic: EpicDesignDetail;
  pageId: string | null; // null = overview/empty state
  wikiPages: EpicWikiPage[];
  sources: EpicKnowledgeSource[];
}

export function EpicKnowledgeWikiView({
  epic,
  pageId,
  wikiPages,
  sources,
}: EpicKnowledgeWikiViewProps) {
  const { activeProjectId } = useCodaScopeStore();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeProjectId || !pageId) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/knowledge/wiki/${pageId}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setContent(data.content ?? "");
        }
      } catch {
        /* silent */
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, epic.id, pageId]);

  // No page selected → show overview
  if (!pageId) {
    return (
      <EpicKnowledgeOverview epic={epic} wikiPages={wikiPages} sources={sources} />
    );
  }

  const page = wikiPages.find((p) => p.id === pageId);

  return (
    <div className="codascope-page" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "1px solid var(--color-border-primary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
          <IconFile size={16} />
          <h2
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--color-text-primary)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {page?.title ?? pageId}
          </h2>
          {page && (
            <span
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-tertiary)",
              }}
            >
              {pluralize(page.wordCount, "word")} · {pluralize(page.sourceRefs.length, "source")}
            </span>
          )}
        </div>
        <a
          className="codascope-btn codascope-btn-ghost"
          style={{
            fontSize: "var(--text-xs)",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            textDecoration: "none",
          }}
          href={`/api/codascope/projects/${activeProjectId}/epics/${epic.id}/knowledge/wiki/${pageId}/download`}
          download
          title="Download as Markdown"
        >
          <IconDownload size={13} /> Download
        </a>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--space-4)" }}>
        {loading && (
          <div className="codascope-knowledge-loading">Loading…</div>
        )}
        {!loading && content !== null && <MarkdownViewer content={content} />}
        {!loading && content === null && (
          <div className="codascope-knowledge-empty">
            <p>Page content not found.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Source Detail Viewer (inline, not modal)
   ══════════════════════════════════════════════════════════════════════ */

interface EpicKnowledgeSourcesViewProps {
  epic: EpicDesignDetail;
  sourceId: string | null; // null = overview/upload zone
  sources: EpicKnowledgeSource[];
  onSourceUploaded: (source: EpicKnowledgeSource) => void;
}

export function EpicKnowledgeSourcesView({
  epic,
  sourceId,
  sources,
  onSourceUploaded,
}: EpicKnowledgeSourcesViewProps) {
  const { activeProjectId } = useCodaScopeStore();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = sources.find((s) => s.id === sourceId);

  useEffect(() => {
    if (!activeProjectId || !sourceId || !source) {
      setMarkdown(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/knowledge/sources/${sourceId}/content`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setMarkdown(data.markdown ?? null);
        } else {
          setError("Extracted content not available.");
        }
      } catch {
        if (!cancelled) setError("Failed to load content.");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, epic.id, sourceId, source]);

  // No source selected → show upload zone + overview
  if (!sourceId) {
    const readyCount = sources.filter((s) => s.status === "ready").length;
    const pendingCount = sources.filter(
      (s) => s.status === "pending" || s.status === "processing",
    ).length;

    return (
      <div className="codascope-page" style={{ padding: "var(--space-4)" }}>
        <div className="codascope-knowledge-section-header" style={{ marginBottom: "var(--space-3)" }}>
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

        {activeProjectId && (
          <SourceUpload
            projectId={activeProjectId}
            epicId={epic.id}
            onUploaded={onSourceUploaded}
          />
        )}

        {sources.length === 0 && (
          <div className="codascope-knowledge-empty" style={{ marginTop: "var(--space-4)" }}>
            <IconUpload size={24} />
            <p>No research sources yet.</p>
            <span className="codascope-knowledge-empty-hint">
              Upload content above or ask the chat assistant to research and download sources.
            </span>
          </div>
        )}

        {sources.length > 0 && (
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-text-secondary)",
              marginTop: "var(--space-3)",
            }}
          >
            Select a source from the sidebar to view its extracted content.
          </p>
        )}
      </div>
    );
  }

  // Source selected → show inline detail
  return (
    <div className="codascope-page" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "1px solid var(--color-border-primary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0, flex: 1 }}>
          <IconFile size={16} />
          <h2
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--color-text-primary)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {source?.title ?? sourceId}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
          {source?.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="codascope-btn codascope-btn-ghost"
              style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
            >
              <IconExternalLink size={12} /> Source
            </a>
          )}
          <a
            href={`/api/codascope/projects/${activeProjectId}/epics/${epic.id}/knowledge/sources/${sourceId}/content`}
            download={`${sourceId}-content.md`}
            className="codascope-btn codascope-btn-ghost"
            style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
          >
            <IconDownload size={13} /> Download
          </a>
        </div>
      </div>

      {/* Source metadata */}
      {source && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            padding: "var(--space-2) var(--space-4)",
            fontSize: "var(--text-2xs)",
            color: "var(--color-text-tertiary)",
            borderBottom: "1px solid var(--color-border-primary)",
            flexShrink: 0,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span>{source.contentType}</span>
          <span>{formatBytes(source.sizeBytesOriginal)}</span>
          <span>Added {formatDate(source.addedAt)}</span>
          <span
            className={`codascope-knowledge-source-type codascope-knowledge-source-type-${source.type}`}
          >
            {source.type === "machine" ? "Machine" : "Human"}
          </span>
          <span
            className={`codascope-knowledge-source-status codascope-knowledge-source-status-${source.status}`}
          >
            {source.status}
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--space-4)" }}>
        {loading && <div className="codascope-knowledge-loading">Loading content…</div>}
        {error && <div className="codascope-knowledge-empty"><p>{error}</p></div>}
        {!loading && !error && markdown && <MarkdownViewer content={markdown} />}
        {!loading && !error && !markdown && sourceId && (
          <div className="codascope-knowledge-empty">
            <p>No extracted markdown content available for this source.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Blocked Downloads View
   ══════════════════════════════════════════════════════════════════════ */

interface EpicKnowledgeBlockedViewProps {
  epic: EpicDesignDetail;
  blockedItems: BlockedDownload[];
  errorSources: EpicKnowledgeSource[];
  onBlockedDismissed: (blockId: string) => void;
  onBlockedResolved: (blockId: string) => void;
}

export function EpicKnowledgeBlockedView({
  epic,
  blockedItems,
  errorSources,
  onBlockedDismissed,
  onBlockedResolved,
}: EpicKnowledgeBlockedViewProps) {
  const { activeProjectId } = useCodaScopeStore();
  const totalFailed = errorSources.length + blockedItems.length;

  if (!activeProjectId) return null;

  return (
    <div className="codascope-page" style={{ padding: "var(--space-4)" }}>
      <div className="codascope-knowledge-section-header" style={{ marginBottom: "var(--space-3)" }}>
        <IconWarning size={18} />
        <h2 className="codascope-knowledge-section-title">Failed Sources</h2>
        <span className="codascope-knowledge-section-count">{totalFailed}</span>
      </div>

      {totalFailed === 0 && (
        <div className="codascope-knowledge-empty">
          <p>No failed sources. All clear!</p>
        </div>
      )}

      {/* Error sources */}
      {errorSources.length > 0 && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <h3 style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)" as never,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            color: "var(--color-text-tertiary)",
            marginBottom: "var(--space-2)",
          }}>
            Error Sources ({errorSources.length})
          </h3>
          {errorSources.map((source) => (
            <div
              key={source.id}
              className="codascope-knowledge-source-card"
              style={{ marginBottom: "var(--space-2)" }}
            >
              <div className="codascope-knowledge-source-card-header">
                <span className="codascope-knowledge-source-card-title">{source.title}</span>
                <div className="codascope-knowledge-source-card-meta">
                  <span className={`codascope-knowledge-source-type codascope-knowledge-source-type-${source.type}`}>
                    {source.type === "machine" ? "Machine" : "Human"}
                  </span>
                  <span className="codascope-knowledge-source-status codascope-knowledge-source-status-error">
                    Error
                  </span>
                </div>
              </div>
              {source.url && (
                <div style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}>
                  {source.url}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Blocked downloads */}
      {blockedItems.length > 0 && (
        <div>
          <h3 style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)" as never,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            color: "var(--color-text-tertiary)",
            marginBottom: "var(--space-2)",
          }}>
            Blocked Downloads ({blockedItems.length})
          </h3>
          {blockedItems.map((item) => (
            <BlockedDownloadItem
              key={item.id}
              projectId={activeProjectId}
              epicId={epic.id}
              item={item}
              onDismissed={onBlockedDismissed}
              onResolved={onBlockedResolved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Knowledge Overview (empty state / workflow guide)
   ══════════════════════════════════════════════════════════════════════ */

interface EpicKnowledgeOverviewProps {
  epic: EpicDesignDetail;
  wikiPages: EpicWikiPage[];
  sources: EpicKnowledgeSource[];
}

interface GuideStepData {
  number: number;
  title: string;
  description: string;
  complete: boolean;
  hint: string;
}

function EpicKnowledgeOverview({ epic, wikiPages, sources }: EpicKnowledgeOverviewProps) {
  const [guideExpanded, setGuideExpanded] = useState(true);

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
      description:
        "Ask the chat assistant to research your topics. It searches the web and downloads sources.",
      complete: hasSources && sources.some((s) => s.type === "machine"),
      hint: 'Try: "Research best practices for [your topic]"',
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
      hint: 'Use the Curate button or ask: "Process sources into wiki pages"',
    },
  ];

  const completedCount = guideSteps.filter((s) => s.complete).length;

  return (
    <div className="codascope-page" style={{ padding: "var(--space-4)" }}>
      <div className={`codascope-knowledge-guide ${guideExpanded ? "codascope-knowledge-guide-expanded" : ""}`}>
        <button
          className="codascope-knowledge-guide-header"
          onClick={() => setGuideExpanded((prev) => !prev)}
          type="button"
        >
          <div className="codascope-knowledge-guide-header-left">
            <IconHelp size={16} />
            <span className="codascope-knowledge-guide-title">
              How to Build Knowledge
            </span>
            <span className="codascope-knowledge-guide-progress">
              {completedCount}/{guideSteps.length} steps
            </span>
          </div>
          <span className="codascope-knowledge-guide-chevron">
            {guideExpanded ? "▾" : "▸"}
          </span>
        </button>

        {guideExpanded && (
          <div className="codascope-knowledge-guide-body">
            <p className="codascope-knowledge-guide-intro">
              The <strong>chat assistant</strong> drives your research workflow. Ask it to search
              the web, download content, and synthesize findings into wiki pages.
            </p>

            <div className="codascope-knowledge-guide-steps">
              {guideSteps.map((step) => (
                <div
                  key={step.number}
                  className={`codascope-knowledge-guide-step ${
                    step.complete ? "codascope-knowledge-guide-step-complete" : ""
                  }`}
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
              onClick={() => useShellStore.getState().openRightPanel("assistant")}
              type="button"
            >
              <IconChat size={14} />
              <span>Use the chat assistant in the right panel to get started</span>
              <IconArrowRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          marginTop: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-secondary)",
            minWidth: "120px",
          }}
        >
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-1)" }}>
            Wiki Pages
          </div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--color-text-primary)" }}>
            {wikiPages.length}
          </div>
        </div>
        <div
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-secondary)",
            minWidth: "120px",
          }}
        >
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-1)" }}>
            Sources
          </div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--color-text-primary)" }}>
            {sources.length}
          </div>
        </div>
      </div>
    </div>
  );
}
