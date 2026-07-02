/* ── CodaScope: SourceUpload Component ───────────────────────────────
   Drag-and-drop + file picker for uploading knowledge sources to
   an epic. Accepts PDF, markdown, text, HTML, images.
   Shows upload progress and calls back when upload is complete.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import { IconUpload } from "./CodaScopeIcons";
import type { EpicKnowledgeSource } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface SourceUploadProps {
  projectId: string;
  epicId: string;
  onUploaded: (source: EpicKnowledgeSource) => void;
}

/* ── Accepted file extensions ────────────────────────────────────────── */

const ACCEPTED_EXTENSIONS = ".pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.svg,.json";

/* ── Component ───────────────────────────────────────────────────────── */

export function SourceUpload({ projectId, epicId, onUploaded }: SourceUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(`Uploading "${file.name}"…`);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name.replace(/\.[^/.]+$/, ""));

      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources`,
        { method: "POST", body: formData },
      );

      if (res.ok) {
        const data = await res.json();
        setUploadProgress(null);
        onUploaded(data.source);
      } else {
        const errData = await res.json().catch(() => null);
        setError(errData?.message ?? `Upload failed (${res.status})`);
        setUploadProgress(null);
      }
    } catch {
      setError("Upload failed — network error.");
      setUploadProgress(null);
    }
    setUploading(false);
  }, [projectId, epicId, onUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void uploadFile(files[0]);
    }
  }, [uploadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFile(files[0]);
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadFile]);

  const handleClickZone = useCallback(() => {
    if (!uploading) fileInputRef.current?.click();
  }, [uploading]);

  return (
    <div className="codascope-source-upload-container">
      <div
        className={`codascope-source-upload-zone ${dragOver ? "codascope-source-upload-zone-dragover" : ""} ${uploading ? "codascope-source-upload-zone-uploading" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClickZone}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClickZone(); }}
      >
        <IconUpload size={24} />
        {uploadProgress ? (
          <span className="codascope-source-upload-progress">{uploadProgress}</span>
        ) : (
          <>
            <span className="codascope-source-upload-text">
              Drop files here or click to browse
            </span>
            <span className="codascope-source-upload-hint">
              PDF, Markdown, Text, HTML, Images
            </span>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileSelect}
          className="codascope-source-upload-input"
          tabIndex={-1}
        />
      </div>
      {error && (
        <div className="codascope-source-upload-error">{error}</div>
      )}
    </div>
  );
}
