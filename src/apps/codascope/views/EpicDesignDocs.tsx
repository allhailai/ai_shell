/* ── CodaScope: EpicDesignDocs View ──────────────────────────────────
   The Design tab content. Shows:
   - List of design documents with title, creator metadata, word count
   - "New Design" button → opens chat panel
   - Empty state points to chat for design doc creation
   - Click doc → opens DocumentEditor in-page
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { DocumentEditor } from "../components/DocumentEditor";
import { IconFile, IconDelete, IconLaunch, IconPaintbrush, IconUndo, IconDownload } from "../components/CodaScopeIcons";
import { useShellStore } from "../../../shell/store";
import { useCommandBus } from "../../../shell/hooks";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import type { EpicDesignDetail, EpicDesignDoc } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicDesignDocsProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDesignDocs({ epic, setEpic }: EpicDesignDocsProps) {
  const { activeProjectId } = useCodaScopeStore();
  const { getParam, setParam } = useAppSubRoute("codascope");

  const [activeDoc, setActiveDoc] = useState<{ doc: EpicDesignDoc; content: string; contentHash?: string } | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Phase 3: Rendering state
  const [rendering, setRendering] = useState<string | null>(null);
  const [renderedDocId, setRenderedDocId] = useState<string | null>(null);
  const [renderedHtmlUrl, setRenderedHtmlUrl] = useState<string | null>(null);

  // Auto-open chat panel when Design tab mounts with zero docs
  const activeDocs = epic.designDocs.filter((d) => !d.archivedAt);
  useEffect(() => {
    if (activeDocs.length === 0) {
      useShellStore.getState().openRightPanel("assistant");
    }
    // Also refresh the doc list on mount to catch docs created while on other tabs
    if (activeProjectId) {
      void (async () => {
        try {
          const res = await fetch(
            `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
          );
          if (res.ok) {
            const data = await res.json();
            const freshDocs = data.docs ?? [];
            // Only update if the count changed (avoid unnecessary re-renders)
            if (freshDocs.length !== epic.designDocs.length) {
              setEpic({ ...epic, designDocs: freshDocs });
            }
          }
        } catch { /* best-effort */ }
      })();
    }
  }, []); // Only on mount

  // Deep-link: auto-open doc from URL query param on mount
  const docParam = getParam("doc");
  useEffect(() => {
    if (!docParam || !activeProjectId || activeDoc) return;
    // Only auto-open if we don't already have a doc open
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docParam}`,
        );
        if (res.ok) {
          const data = await res.json();
          setActiveDoc({ doc: data.doc, content: data.content, contentHash: data.contentHash });
        }
      } catch { /* ignore — doc may have been deleted */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docParam, activeProjectId, epic.id]); // Only re-run when the doc param changes

  // Listen for agent-created design docs — auto-open them
  const commandBus = useCommandBus();
  useEffect(() => {
    if (!commandBus || !activeProjectId) return;
    const unsub = commandBus.on("codascope:design-doc-created", async (data: { epicId: string; docId: string }) => {
      if (data.epicId !== epic.id) return;
      try {
        // Fetch the newly created doc and open it
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${data.docId}`,
        );
        if (res.ok) {
          const result = await res.json();
          setActiveDoc({ doc: result.doc, content: result.content, contentHash: result.contentHash });
          setParam("doc", data.docId);
          // Refresh the epic doc list
          const listRes = await fetch(
            `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
          );
          if (listRes.ok) {
            const listData = await listRes.json();
            setEpic({ ...epic, designDocs: listData.docs ?? [] });
          }
        }
      } catch { /* best-effort */ }
    });
    return () => { unsub(); };
  }, [commandBus, activeProjectId, epic, setEpic]);

  /* ── Handlers ──────────────────────────────────────────────────────── */

  const openChatPanel = useCallback(() => {
    useShellStore.getState().openRightPanel("assistant");
  }, []);

  const openDoc = useCallback(async (doc: EpicDesignDoc) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${doc.id}`,
      );
      if (res.ok) {
        const data = await res.json();
        setActiveDoc({ doc: data.doc, content: data.content, contentHash: data.contentHash });
        setParam("doc", doc.id);
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id, setParam]);

  const archiveDoc = useCallback(async (docId: string) => {
    if (!activeProjectId) return;
    setArchiving(docId);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}/archive`,
        { method: "PATCH" },
      );
      if (res.ok) {
        setEpic({
          ...epic,
          designDocs: epic.designDocs.map((d) =>
            d.id === docId ? { ...d, archivedAt: new Date().toISOString() } : d,
          ),
        });
      }
    } catch { /* ignore */ }
    setArchiving(null);
  }, [activeProjectId, epic, setEpic]);

  const unarchiveDoc = useCallback(async (docId: string) => {
    if (!activeProjectId) return;
    setArchiving(docId);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}/unarchive`,
        { method: "PATCH" },
      );
      if (res.ok) {
        setEpic({
          ...epic,
          designDocs: epic.designDocs.map((d) => {
            if (d.id !== docId) return d;
            const { archivedAt: _, ...rest } = d;
            return rest;
          }),
        });
      }
    } catch { /* ignore */ }
    setArchiving(null);
  }, [activeProjectId, epic, setEpic]);

  const handleContentChange = useCallback((newContent: string, newContentHash?: string) => {
    if (!activeDoc) return;
    const wordCount = newContent.trim() ? newContent.trim().split(/\s+/).length : 0;
    const updatedDoc = { ...activeDoc.doc, wordCount, updatedAt: new Date().toISOString() };
    setActiveDoc({ doc: updatedDoc, content: newContent, contentHash: newContentHash ?? activeDoc.contentHash });
    setEpic({
      ...epic,
      designDocs: epic.designDocs.map((d) => d.id === updatedDoc.id ? updatedDoc : d),
    });
  }, [activeDoc, epic, setEpic]);

  // Phase 3: Render as HTML
  const renderAsHtml = useCallback(async (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeProjectId || rendering) return;
    setRendering(docId);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}/render`,
        { method: "POST" },
      );
      if (res.ok) {
        // Set the URL for the rendered preview
        setRenderedDocId(docId);
        setRenderedHtmlUrl(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}/rendered`,
        );
      }
    } catch { /* ignore */ }
    setRendering(null);
  }, [activeProjectId, epic.id, rendering]);

  /* ── Rendered HTML preview ─────────────────────────────────────────── */

  if (renderedDocId && renderedHtmlUrl) {
    const renderedDoc = epic.designDocs.find((d) => d.id === renderedDocId);
    return (
      <div className="codascope-rendered-preview">
        <div className="codascope-rendered-preview-header">
          <h3>{renderedDoc?.title ?? "Rendered Document"}</h3>
          <div className="codascope-rendered-preview-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={() => window.open(renderedHtmlUrl, "_blank")}
              type="button"
            >
              Open in New Tab
            </button>
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={() => { setRenderedDocId(null); setRenderedHtmlUrl(null); }}
              type="button"
            >
              ✕ Close Preview
            </button>
          </div>
        </div>
        <iframe
          className="codascope-rendered-preview-iframe"
          src={renderedHtmlUrl}
          title="Rendered Design Document"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    );
  }

  /* ── Active document editor view ───────────────────────────────────── */

  if (activeDoc) {
    return (
      <DocumentEditor
        epicId={epic.id}
        doc={activeDoc.doc}
        content={activeDoc.content}
        contentHash={activeDoc.contentHash}
        onContentChange={handleContentChange}
        onClose={() => { setActiveDoc(null); setParam("doc", null); }}
      />
    );
  }

  /* ── Design doc list ───────────────────────────────────────────────── */

  const archivedDocs = epic.designDocs.filter((d) => !!d.archivedAt);

  /** Render creator metadata line */
  const renderCreatedBy = (doc: EpicDesignDoc) => {
    const creator = doc.createdBy;
    if (creator === "agent") {
      return <span className="codascope-design-doc-card-creator">Created by agent</span>;
    }
    if (creator) {
      return <span className="codascope-design-doc-card-creator">Created by {creator}</span>;
    }
    return null;
  };

  return (
    <div className="codascope-design-doc-list">
      <div className="codascope-design-doc-list-header">
        <span className="codascope-design-doc-list-count">
          {activeDocs.length} document{activeDocs.length !== 1 ? "s" : ""}
        </span>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={openChatPanel}
          type="button"
        >
          + New Design
        </button>
      </div>

      {activeDocs.length === 0 ? (
        <div className="codascope-empty-state">
          <span className="codascope-empty-state-icon"><IconPaintbrush size={32} /></span>
          <h3>No design documents yet</h3>
          <p>Use the chat assistant to create your first design document. Describe what you need and the agent will draft it for you.</p>
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={openChatPanel}
            type="button"
          >
            Open Chat to Start Designing
          </button>
        </div>
      ) : (
        <div className="codascope-design-doc-grid">
          {activeDocs.map((doc) => (
            <div key={doc.id} className="codascope-design-doc-card" onClick={() => openDoc(doc)}>
              <div className="codascope-design-doc-card-header">
                <span className="codascope-design-doc-card-icon">
                  <IconFile size={24} />
                </span>
                <h4 className="codascope-design-doc-card-title">{doc.title}</h4>
              </div>
              <div className="codascope-design-doc-card-meta">
                {renderCreatedBy(doc)}
                <span>{doc.wordCount.toLocaleString()} words</span>
                <span>
                  {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                    month: "short", day: "numeric",
                  })}
                </span>
              </div>
              <div className="codascope-design-doc-card-actions">
                <a
                  className="codascope-epic-card-action"
                  href={`/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${doc.id}/download`}
                  download
                  title="Download as Markdown"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDownload size={14} />
                </a>
                <button
                  className="codascope-epic-card-action codascope-render-btn"
                  onClick={(e) => renderAsHtml(doc.id, e)}
                  disabled={rendering === doc.id}
                  title="Render as HTML"
                  type="button"
                >
                  {rendering === doc.id ? "…" : <IconLaunch size={14} />}
                </button>
                <button
                  className="codascope-epic-card-action"
                  onClick={(e) => { e.stopPropagation(); archiveDoc(doc.id); }}
                  disabled={archiving === doc.id}
                  title="Archive document"
                  type="button"
                >
                  {archiving === doc.id ? "…" : <IconDelete size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {archivedDocs.length > 0 && (
        <div className="codascope-design-doc-archived">
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={() => setShowArchived(!showArchived)}
            type="button"
          >
            {showArchived ? "▾" : "▸"} {archivedDocs.length} archived
          </button>
          {showArchived && (
            <div className="codascope-design-doc-archived-list">
              {archivedDocs.map((doc) => (
                <div key={doc.id} className="codascope-design-doc-archived-item">
                  <span className="codascope-design-doc-archived-icon">
                    <IconFile size={18} />
                  </span>
                  <span className="codascope-design-doc-archived-title">{doc.title}</span>
                  <span className="codascope-design-doc-archived-meta">
                    {doc.wordCount.toLocaleString()} words
                  </span>
                  <button
                    className="codascope-epic-card-action codascope-epic-card-action--restore"
                    onClick={() => unarchiveDoc(doc.id)}
                    disabled={archiving === doc.id}
                    title="Restore document"
                    type="button"
                  >
                    {archiving === doc.id ? "…" : <IconUndo size={14} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
