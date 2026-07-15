/* ── CodaScope: Note Document Panel ──────────────────────────────────
   Managed opaque document cards for a single note. This UI intentionally
   never previews or reads uploaded bytes; downloads remain attachment-only.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { NoteDocument, NoteDocumentListResponse } from "../codaScopeTypes";
import { IconArchive, IconChevronDown, IconChevronUp, IconClose, IconComment, IconDownload, IconFile, IconPin, IconStar, IconStarFilled, IconUnarchive, IconUpload } from "./CodaScopeIcons";

interface NoteDocumentPanelProps {
  notePath: string;
  apiBase: string;
  queryString: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function withQuery(url: string, queryString: string): string {
  return queryString ? `${url}?${queryString}` : url;
}

export function NoteDocumentPanel({ notePath, apiBase, queryString, onClose }: NoteDocumentPanelProps) {
  const [data, setData] = useState<NoteDocumentListResponse>({ active: [], archived: [], totalBytes: 0, maxBytes: 500 * 1024 * 1024 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<NoteDocument | null>(null);
  const [editName, setEditName] = useState("");
  const [editComment, setEditComment] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const baseUrl = `${apiBase}/note/${notePath}/documents`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(withQuery(baseUrl, queryString));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Unable to load documents.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load documents.");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, queryString]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { editNameRef.current?.focus(); }, [editing]);

  const mutate = useCallback(async (url: string, method: "POST" | "PUT" | "DELETE" | "PATCH", body?: unknown) => {
    setError(null);
    try {
      const response = await fetch(withQuery(url, queryString), {
        method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Document update failed.");
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document update failed.");
      return false;
    }
  }, [load, queryString]);

  const upload = useCallback(async (files: Iterable<File>) => {
    const uploadFiles = Array.from(files);
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setError(null);
    const failures: string[] = [];
    try {
      for (const file of uploadFiles) {
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch(withQuery(baseUrl, queryString), { method: "POST", body: form });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Document upload failed.");
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Document upload failed.";
          failures.push(`${file.name}: ${message}`);
        }
      }
      await load();
      if (failures.length > 0) setError(failures.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [baseUrl, load, queryString]);

  const supportsFileDrop = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");
  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!supportsFileDrop(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropActive(true);
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!supportsFileDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!supportsFileDrop(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!supportsFileDrop(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDropActive(false);
    void upload(event.dataTransfer.files);
  };

  const toggleComment = (documentId: string) => {
    setExpandedComments((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  const toggleAllComments = () => {
    const documentsWithComments = [...data.active, ...data.archived].filter((document) => document.comment).map((document) => document.id);
    const allExpanded = documentsWithComments.length > 0 && documentsWithComments.every((id) => expandedComments.has(id));
    setExpandedComments(allExpanded ? new Set() : new Set(documentsWithComments));
  };

  const openEditor = (document: NoteDocument) => {
    setEditing(document);
    setEditName(document.displayName);
    setEditComment(document.comment);
  };

  const saveEditor = async () => {
    if (!editing) return;
    const saved = await mutate(`${baseUrl}/${editing.id}`, "PATCH", { displayName: editName, comment: editComment });
    if (saved) setEditing(null);
  };

  const renderCard = (document: NoteDocument, archived = false) => {
    const isEditing = editing?.id === document.id;
    const downloadUrl = withQuery(`${baseUrl}/${document.id}/download`, queryString);
    return (
      <article className="codascope-notes-document-card" key={document.id}>
        <div className="codascope-notes-document-icon" aria-hidden="true"><IconFile size={18} /></div>
        <div className="codascope-notes-document-main">
          {isEditing ? (
            <div className="codascope-notes-document-edit">
              <input ref={editNameRef} aria-label="Document display name" value={editName} onChange={(event) => setEditName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} />
              <textarea aria-label="Document comment" value={editComment} onChange={(event) => setEditComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} placeholder="Add a shared comment" />
              <div className="codascope-notes-document-edit-actions">
                <button className="codascope-btn codascope-btn-sm" type="button" onClick={() => void saveEditor()}>Save</button>
                <button className="codascope-btn codascope-btn-ghost codascope-btn-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="codascope-notes-document-name-row">
                <span className="codascope-notes-document-name">{document.displayName}</span>
              </div>
              {document.originalFilename !== document.displayName && <div className="codascope-notes-document-original">Original: {document.originalFilename}</div>}
              <div className="codascope-notes-document-meta">
                <span>{formatBytes(document.sizeBytes)}</span>
                <span>{document.uploadedBy} · {new Date(document.uploadedAt).toLocaleDateString()}</span>
                {archived && document.archivedAt && <span>Archived {new Date(document.archivedAt).toLocaleDateString()}</span>}
              </div>
              {document.comment && (
                <button className="codascope-notes-document-comment-toggle" type="button" onClick={() => toggleComment(document.id)} aria-expanded={expandedComments.has(document.id)}>
                  <IconComment size={13} /> {expandedComments.has(document.id) ? "Hide comment" : "Show comment"}
                </button>
              )}
              {document.comment && expandedComments.has(document.id) && <p className="codascope-notes-document-comment">{document.comment}</p>}
            </>
          )}
        </div>
        {!isEditing && (
          <div className="codascope-notes-document-actions">
            {!archived && document.pinnedAt && <span className="codascope-notes-document-action-label" title={`Pinned by ${document.pinnedBy ?? "a collaborator"}`}>Pinned</span>}
            {!archived && <button type="button" className={`codascope-notes-document-action${document.pinnedAt ? " codascope-notes-document-action-active" : ""}`} title={document.pinnedAt ? "Unpin for everyone" : "Pin for everyone"} aria-label={document.pinnedAt ? "Unpin document for everyone" : "Pin document for everyone"} onClick={() => void mutate(`${baseUrl}/${document.id}/pin`, document.pinnedAt ? "DELETE" : "PUT")}><IconPin size={14} className={document.pinnedAt ? "codascope-notes-document-pin-icon-pinned" : undefined} /></button>}
            {!archived && <button type="button" className={`codascope-notes-document-action${document.starred ? " codascope-notes-document-action-active" : ""}`} title={document.starred ? "Remove personal star" : "Star personally"} aria-label={document.starred ? "Remove personal document star" : "Star document personally"} onClick={() => void mutate(`${baseUrl}/${document.id}/star`, document.starred ? "DELETE" : "PUT")}>{document.starred ? <IconStarFilled size={14} /> : <IconStar size={14} />}</button>}
            <a className="codascope-notes-document-action" href={downloadUrl} title="Download document" aria-label="Download document"><IconDownload size={14} /></a>
            <button type="button" className="codascope-notes-document-action" title="Edit name and comment" aria-label="Edit document name and comment" onClick={() => openEditor(document)}>Edit</button>
            <button type="button" className="codascope-notes-document-action" title={archived ? "Restore document" : "Archive document"} aria-label={archived ? "Restore document" : "Archive document"} onClick={() => void mutate(`${baseUrl}/${document.id}/${archived ? "restore" : "archive"}`, "POST")}>{archived ? <IconUnarchive size={14} /> : <IconArchive size={14} />}</button>
          </div>
        )}
      </article>
    );
  };

  const commentDocuments = [...data.active, ...data.archived].filter((document) => document.comment);
  const allCommentsExpanded = commentDocuments.length > 0 && commentDocuments.every((document) => expandedComments.has(document.id));

  return (
    <aside
      className={`codascope-notes-document-panel${dropActive ? " codascope-notes-document-panel--drop-active" : ""}`}
      aria-label="Note documents"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="codascope-notes-document-panel-header">
        <div><IconFile size={15} /> <span>Documents</span> <span className="codascope-notes-document-count">{data.active.length + data.archived.length}</span></div>
        <button className="codascope-btn codascope-btn-ghost codascope-btn-sm" type="button" onClick={onClose} title="Close documents" aria-label="Close documents"><IconClose size={15} /></button>
      </header>
      <div className="codascope-notes-document-panel-controls">
        <input ref={fileInputRef} type="file" multiple className="codascope-notes-document-file-input" onChange={(event) => { if (event.target.files) void upload(event.target.files); }} />
        <button className="codascope-btn codascope-btn-sm" type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}><IconUpload size={14} /> {uploading ? "Uploading…" : "Upload"}</button>
        <button className="codascope-btn codascope-btn-ghost codascope-btn-sm" type="button" onClick={toggleAllComments} disabled={commentDocuments.length === 0}>{allCommentsExpanded ? "Collapse all comments" : "Expand all comments"}</button>
      </div>
      <div className="codascope-notes-document-panel-content">
        {error && <div className="codascope-notes-document-error" role="alert">{error}</div>}
        {loading ? <div className="codascope-notes-document-empty">Loading documents…</div> : (
          <div className="codascope-notes-document-list">
            {data.active.length === 0 && <div className="codascope-notes-document-empty">No active documents. Drop files here or choose Upload to keep opaque files with this note.</div>}
            {data.active.map((document) => renderCard(document))}
            {data.archived.length > 0 && (
              <section className="codascope-notes-document-archived">
                <button type="button" className="codascope-notes-document-archived-toggle" onClick={() => setArchivedExpanded((expanded) => !expanded)} aria-expanded={archivedExpanded}>
                  <span>Archived ({data.archived.length})</span>
                  {archivedExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </button>
                {archivedExpanded && data.archived.map((document) => renderCard(document, true))}
              </section>
            )}
          </div>
        )}
      </div>
      <footer className="codascope-notes-document-panel-footer">
        <div className="codascope-notes-document-drop-hint" aria-hidden="true">Drop files anywhere in this panel to upload</div>
        <div className="codascope-notes-document-quota">{formatBytes(data.totalBytes)} of {formatBytes(data.maxBytes)} used · 100 MB per file</div>
      </footer>
    </aside>
  );
}
