/* ── CodaScope: EpicDesignDocs View ──────────────────────────────────
   The Design tab content. Shows:
   - List of design documents with title, template badge, word count
   - "New Design Doc" button with template picker
   - Click doc → opens DocumentEditor in-page
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { DocumentEditor } from "../components/DocumentEditor";
import { IconArchitecture, IconLink, IconPackage, IconBolt, IconClipboard, IconFile } from "../components/CodaScopeIcons";
import type { EpicDesignDetail, EpicDesignDoc, DesignDocTemplate } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicDesignDocsProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Template icons ──────────────────────────────────────────────────── */

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  architecture: <IconArchitecture size={24} />,
  "api-design": <IconLink size={24} />,
  "data-model": <IconPackage size={24} />,
  "migration-plan": <IconBolt size={24} />,
  "decision-record": <IconClipboard size={24} />,
  "task-breakdown": <IconFile size={24} />,
};

const DEFAULT_ICON = <IconFile size={24} />;

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDesignDocs({ epic, setEpic }: EpicDesignDocsProps) {
  const { activeProjectId } = useCodaScopeStore();

  const [templates, setTemplates] = useState<DesignDocTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeDoc, setActiveDoc] = useState<{ doc: EpicDesignDoc; content: string } | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  // Fetch templates on mount
  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/templates`,
        );
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, [activeProjectId, epic.id]);

  /* ── Handlers ──────────────────────────────────────────────────────── */

  const createFromTemplate = useCallback(async (template: DesignDocTemplate) => {
    if (!activeProjectId || creating) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: template.title,
            template: template.id,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const newDoc: EpicDesignDoc = data.doc;
        setEpic({ ...epic, designDocs: [...epic.designDocs, newDoc] });
        setShowTemplatePicker(false);
        // Open the new doc immediately
        void openDoc(newDoc);
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [activeProjectId, epic, setEpic, creating]);

  const createBlank = useCallback(async () => {
    if (!activeProjectId || creating || !customTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: customTitle.trim() }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const newDoc: EpicDesignDoc = data.doc;
        setEpic({ ...epic, designDocs: [...epic.designDocs, newDoc] });
        setShowTemplatePicker(false);
        setCustomTitle("");
        void openDoc(newDoc);
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [activeProjectId, epic, setEpic, creating, customTitle]);

  const openDoc = useCallback(async (doc: EpicDesignDoc) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${doc.id}`,
      );
      if (res.ok) {
        const data = await res.json();
        setActiveDoc({ doc: data.doc, content: data.content });
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id]);

  const deleteDoc = useCallback(async (docId: string) => {
    if (!activeProjectId) return;
    setDeleting(docId);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/designs/${docId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setEpic({
          ...epic,
          designDocs: epic.designDocs.filter((d) => d.id !== docId),
        });
      }
    } catch { /* ignore */ }
    setDeleting(null);
  }, [activeProjectId, epic, setEpic]);

  const handleContentChange = useCallback((newContent: string) => {
    if (!activeDoc) return;
    const wordCount = newContent.trim() ? newContent.trim().split(/\s+/).length : 0;
    const updatedDoc = { ...activeDoc.doc, wordCount, updatedAt: new Date().toISOString() };
    setActiveDoc({ doc: updatedDoc, content: newContent });
    setEpic({
      ...epic,
      designDocs: epic.designDocs.map((d) => d.id === updatedDoc.id ? updatedDoc : d),
    });
  }, [activeDoc, epic, setEpic]);

  /* ── Active document editor view ───────────────────────────────────── */

  if (activeDoc) {
    return (
      <DocumentEditor
        epicId={epic.id}
        doc={activeDoc.doc}
        content={activeDoc.content}
        onContentChange={handleContentChange}
        onClose={() => setActiveDoc(null)}
      />
    );
  }

  /* ── Template picker modal ─────────────────────────────────────────── */

  if (showTemplatePicker) {
    return (
      <div className="codascope-template-picker">
        <div className="codascope-template-picker-header">
          <h3>Choose a Template</h3>
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={() => { setShowTemplatePicker(false); setCustomTitle(""); }}
            type="button"
          >
            ✕ Cancel
          </button>
        </div>
        <p className="codascope-template-picker-hint">
          Select a template to start with a structured outline, or create a blank document.
        </p>

        <div className="codascope-template-picker-grid">
          {templates.map((t) => (
            <button
              key={t.id}
              className="codascope-template-card"
              onClick={() => createFromTemplate(t)}
              disabled={creating}
              type="button"
            >
              <span className="codascope-template-card-icon">{TEMPLATE_ICONS[t.id] ?? DEFAULT_ICON}</span>
              <span className="codascope-template-card-title">{t.title}</span>
              <span className="codascope-template-card-desc">{t.description}</span>
            </button>
          ))}
        </div>

        <div className="codascope-template-picker-blank">
          <span className="codascope-template-picker-blank-label">Or create a blank document:</span>
          <div className="codascope-template-picker-blank-form">
            <input
              className="codascope-input"
              type="text"
              placeholder="Document title…"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createBlank()}
            />
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={createBlank}
              disabled={creating || !customTitle.trim()}
              type="button"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Design doc list ───────────────────────────────────────────────── */

  return (
    <div className="codascope-design-doc-list">
      <div className="codascope-design-doc-list-header">
        <span className="codascope-design-doc-list-count">
          {epic.designDocs.length} document{epic.designDocs.length !== 1 ? "s" : ""}
        </span>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={() => setShowTemplatePicker(true)}
          type="button"
        >
          + New Design Doc
        </button>
      </div>

      {epic.designDocs.length === 0 ? (
        <div className="codascope-empty-state">
          <span className="codascope-empty-state-icon">📐</span>
          <h3>No design documents yet</h3>
          <p>Create a design document from a template to start drafting your epic's technical design.</p>
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowTemplatePicker(true)}
            type="button"
          >
            + New Design Doc
          </button>
        </div>
      ) : (
        <div className="codascope-design-doc-grid">
          {epic.designDocs.map((doc) => (
            <div key={doc.id} className="codascope-design-doc-card" onClick={() => openDoc(doc)}>
              <div className="codascope-design-doc-card-header">
                <span className="codascope-design-doc-card-icon">
                  {doc.template ? (TEMPLATE_ICONS[doc.template] ?? DEFAULT_ICON) : DEFAULT_ICON}
                </span>
                <h4 className="codascope-design-doc-card-title">{doc.title}</h4>
              </div>
              <div className="codascope-design-doc-card-meta">
                {doc.template && (
                  <span className="codascope-design-doc-card-template">{doc.template}</span>
                )}
                <span>{doc.wordCount.toLocaleString()} words</span>
                <span>
                  {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                    month: "short", day: "numeric",
                  })}
                </span>
              </div>
              <div className="codascope-design-doc-card-actions">
                <button
                  className="codascope-epic-card-action"
                  onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id); }}
                  disabled={deleting === doc.id}
                  title="Delete document"
                  type="button"
                >
                  {deleting === doc.id ? "…" : "🗑️"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
