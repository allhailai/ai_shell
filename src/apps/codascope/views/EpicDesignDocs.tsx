/* ── CodaScope: EpicDesignDocs View ──────────────────────────────────
   The Design tab content. Renders:
   - Empty state when no doc selected (with chat CTA)
   - DocumentEditor when a doc is selected via URL
   - HTML rendered preview when triggered

   Design docs are listed in the EpicSidebar, not in this component.
   URL scheme: /epic/:epicId/design/:docId
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { DocumentEditor } from "../components/DocumentEditor";
import { ArtifactViewer } from "../components/artifact-viewer/ArtifactViewer";
import { IconPaintbrush, IconChat, IconArtifact, IconInsert } from "../components/CodaScopeIcons";
import { useShellStore } from "../../../shell/store";
import { useCommandBus } from "../../../shell/hooks";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import type { EpicDesignDetail, EpicDesignDoc, EpicWikiPage, ArtifactSpec } from "../codaScopeTypes";
import * as artifactApi from "../components/artifact-viewer/artifactApi";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicDesignDocsProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
  docId: string | null;
  wikiPages?: EpicWikiPage[];
  artifacts?: ArtifactSpec[];
  onArtifactsChange?: (artifacts: ArtifactSpec[]) => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDesignDocs({ epic, setEpic, docId, wikiPages, artifacts, onArtifactsChange }: EpicDesignDocsProps) {
  const { activeProjectId } = useCodaScopeStore();
  const { navigate } = useAppSubRoute("codascope");

  // Detect if this is an artifact URL (docId starts with "artifact:")
  const isArtifactView = docId?.startsWith("artifact:") ?? false;
  const artifactId = isArtifactView ? docId!.slice("artifact:".length) : null;

  const [docData, setDocData] = useState<{ doc: EpicDesignDoc; content: string; contentHash?: string } | null>(null);
  const [loading, setLoading] = useState(false);


  const [renderedHtmlUrl, setRenderedHtmlUrl] = useState<string | null>(null);

  // Create dropdown state
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  // ── Fetch doc content when docId changes ─────────────────────────────

  useEffect(() => {
    if (!activeProjectId || !docId || isArtifactView) {
      setDocData(null);
      setRenderedHtmlUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRenderedHtmlUrl(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setDocData({ doc: data.doc, content: data.content, contentHash: data.contentHash });
        } else {
          setDocData(null);
        }
      } catch {
        /* silent */
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, epic.id, docId]);

  // ── Refresh design docs list on mount ────────────────────────────────

  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
        );
        if (res.ok) {
          const data = await res.json();
          const freshDocs = data.docs ?? [];
          if (freshDocs.length !== epic.designDocs.length) {
            setEpic({ ...epic, designDocs: freshDocs });
          }
        }
      } catch { /* best-effort */ }
    })();
  }, []); // Only on mount

  // ── Listen for agent-created design docs ─────────────────────────────

  const commandBus = useCommandBus();
  useEffect(() => {
    if (!commandBus || !activeProjectId) return;
    const unsub = commandBus.on("codascope:design-doc-created", (async (data: { epicId: string; docId: string }) => {
      if (data.epicId !== epic.id) return;
      try {
        // Refresh the doc list
        const listRes = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          setEpic({ ...epic, designDocs: listData.docs ?? [] });
        }
        // Navigate to the new doc
        navigate(`project/${activeProjectId}/epic/${epic.id}/design/${data.docId}`);
      } catch { /* best-effort */ }
    }) as (payload: unknown) => void);
    return () => { unsub(); };
  }, [commandBus, activeProjectId, epic, setEpic, navigate]);

  /* ── Handlers ──────────────────────────────────────────────────────── */

  const openChatPanel = useCallback(() => {
    useShellStore.getState().openRightPanel("assistant");
  }, []);

  const handleContentChange = useCallback((newContent: string, newContentHash?: string) => {
    if (!docData) return;
    const wordCount = newContent.trim() ? newContent.trim().split(/\s+/).length : 0;
    const updatedDoc = { ...docData.doc, wordCount, updatedAt: new Date().toISOString() };
    setDocData({ doc: updatedDoc, content: newContent, contentHash: newContentHash ?? docData.contentHash });
    setEpic({
      ...epic,
      designDocs: epic.designDocs.map((d) => d.id === updatedDoc.id ? updatedDoc : d),
    });
  }, [docData, epic, setEpic]);

  const handleClose = useCallback(() => {
    if (!activeProjectId) return;
    navigate(`project/${activeProjectId}/epic/${epic.id}/design`);
  }, [activeProjectId, epic.id, navigate]);



  // ── Create artifact handler ───────────────────────────────────────────

  const handleCreateArtifact = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const art = await artifactApi.createArtifact(activeProjectId, epic.id, {
        title: "New Visual Artifact",
        createdBy: "user",
      });
      onArtifactsChange?.([...(artifacts ?? []), art]);
      navigate(`project/${activeProjectId}/epic/${epic.id}/design/artifact:${art.id}`);
    } catch {
      /* silent */
    }
    setShowCreateMenu(false);
  }, [activeProjectId, epic.id, artifacts, onArtifactsChange, navigate]);

  const handleCreateDoc = useCallback(() => {
    // Open chat to create doc via agent
    useShellStore.getState().openRightPanel("assistant");
    setShowCreateMenu(false);
  }, []);

  /* ── Rendered HTML preview ─────────────────────────────────────────── */

  if (renderedHtmlUrl && docData) {
    return (
      <div className="codascope-rendered-preview">
        <div className="codascope-rendered-preview-header">
          <h3>{docData.doc.title ?? "Rendered Document"}</h3>
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
              onClick={() => setRenderedHtmlUrl(null)}
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

  /* ── Artifact view (when docId starts with "artifact:") ────────────── */

  if (isArtifactView && artifactId && activeProjectId) {
    return (
      <ArtifactViewer
        projectId={activeProjectId}
        epicId={epic.id}
        artifactId={artifactId}
      />
    );
  }

  /* ── No doc selected — empty state ─────────────────────────────────── */

  if (!docId) {
    return (
      <div className="codascope-empty-state">
        <span className="codascope-empty-state-icon"><IconPaintbrush size={32} /></span>
        <div className="codascope-empty-state-title">
          {epic.designDocs.filter((d) => !d.archivedAt).length === 0 && !(artifacts?.length)
            ? "No design documents yet"
            : "Select a design document"}
        </div>
        <div className="codascope-empty-state-text">
          Create a markdown document or a rich visual artifact.
        </div>
        <div className="codascope-artifact-create-actions">
          <div className="codascope-artifact-create-trigger">
            <button
              className="codascope-btn codascope-btn-primary codascope-artifact-create-btn"
              onClick={() => setShowCreateMenu((p) => !p)}
              type="button"
            >
              <IconInsert size={14} />
              Create
            </button>
            {showCreateMenu && (
              <div className="codascope-artifact-create-menu">
                <button
                  className="codascope-btn codascope-btn-ghost codascope-artifact-create-menu-item"
                  onClick={handleCreateDoc}
                  type="button"
                >
                  <IconPaintbrush size={14} />
                  Markdown Document
                </button>
                <button
                  className="codascope-btn codascope-btn-ghost codascope-artifact-create-menu-item"
                  onClick={() => void handleCreateArtifact()}
                  type="button"
                >
                  <IconArtifact size={14} />
                  Visual Artifact
                </button>
              </div>
            )}
          </div>
          <button
            className="codascope-btn codascope-btn-ghost codascope-artifact-create-btn"
            onClick={openChatPanel}
            type="button"
          >
            <IconChat size={14} />
            Open Chat
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading state ─────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="codascope-empty-state">
        <p>Loading document…</p>
      </div>
    );
  }

  /* ── Doc not found ─────────────────────────────────────────────────── */

  if (!docData) {
    return (
      <div className="codascope-empty-state">
        <p>Document not found.</p>
        <button
          className="codascope-btn codascope-btn-ghost"
          onClick={handleClose}
          type="button"
        >
          ← Back
        </button>
      </div>
    );
  }

  /* ── Active document editor view ───────────────────────────────────── */

  return (
    <DocumentEditor
      epicId={epic.id}
      doc={docData.doc}
      content={docData.content}
      contentHash={docData.contentHash}
      onContentChange={handleContentChange}
      onClose={handleClose}
      wikiPages={wikiPages}
    />
  );
}
