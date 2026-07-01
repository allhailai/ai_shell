/* ── CodaScope: InsertionPrompt Component ────────────────────────────
   Inline prompt for creating and managing insertion directives.
   Appears between document blocks when the user clicks the + trigger.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconInsert, IconRewrite, IconExpand, IconGenerate, IconPending, IconClose, IconCheckmark, IconUndo } from "./CodaScopeIcons";
import type { InsertionDirective, DirectiveType } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface InsertionPromptProps {
  /** Project ID for API calls */
  projectId: string;
  /** Epic ID for API calls */
  epicId: string;
  /** Document ID ('definition' or design doc ID) */
  documentId: string;
  /** Line number after which to insert content */
  afterLine: number;
  /** Block ID at the insertion point (optional) */
  blockId?: string;
  /** Default directive type */
  defaultType?: DirectiveType;
  /** For replace/expand: the selected text range */
  startLine?: number;
  endLine?: number;
  anchorText?: string;
  /** Existing directive (if editing/viewing an existing one) */
  existingDirective?: InsertionDirective;
  /** Called when the directive state changes */
  onUpdate: () => void;
  /** Called when user cancels/closes */
  onClose: () => void;
}

/* ── Type labels ─────────────────────────────────────────────────────── */

const TYPE_OPTIONS: { value: DirectiveType; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { value: "insert", label: "Insert", Icon: IconInsert },
  { value: "replace", label: "Rewrite", Icon: IconRewrite },
  { value: "expand", label: "Expand", Icon: IconExpand },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function InsertionPrompt({
  projectId,
  epicId,
  documentId,
  afterLine,
  blockId,
  defaultType = "insert",
  startLine,
  endLine,
  anchorText,
  existingDirective,
  onUpdate,
  onClose,
}: InsertionPromptProps) {
  const [type, setType] = useState<DirectiveType>(existingDirective?.type ?? defaultType);
  const [instruction, setInstruction] = useState(existingDirective?.instruction ?? "");
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [directive, setDirective] = useState<InsertionDirective | undefined>(existingDirective);

  const hasGenerated = !!directive?.generatedContent;
  const isApplied = directive?.status === "applied";

  /* ── Create directive ────────────────────────────────────────────── */

  const handleCreate = useCallback(async () => {
    if (!instruction.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            afterLine,
            startLine,
            endLine,
            blockId,
            anchorText,
            instruction: instruction.trim(),
            author: "user",
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setDirective(data.directive);
        onUpdate();
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [projectId, epicId, documentId, type, afterLine, startLine, endLine, blockId, anchorText, instruction, onUpdate]);

  /* ── Execute (generate content) ──────────────────────────────────── */

  const handleGenerate = useCallback(async () => {
    if (!directive) return;
    setGenerating(true);
    try {
      // For now, send a placeholder generated content request
      // In production, this triggers the agent via do_insert_content.md
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives/${directive.id}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generatedContent: `<!-- Generated content for: ${directive.instruction} -->\n\n_Agent-generated content will appear here once the agent integration is complete._`,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setDirective(data.directive);
        onUpdate();
      }
    } catch { /* ignore */ }
    setGenerating(false);
  }, [projectId, epicId, documentId, directive, onUpdate]);

  /* ── Apply ───────────────────────────────────────────────────────── */

  const handleApply = useCallback(async () => {
    if (!directive) return;
    setApplying(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives/${directive.id}/apply`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = await res.json();
        setDirective(data.directive);
        onUpdate();
      }
    } catch { /* ignore */ }
    setApplying(false);
  }, [projectId, epicId, documentId, directive, onUpdate]);

  /* ── Reject ──────────────────────────────────────────────────────── */

  const handleReject = useCallback(async () => {
    if (!directive) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives/${directive.id}/reject`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = await res.json();
        setDirective(data.directive);
        onUpdate();
      }
    } catch { /* ignore */ }
  }, [projectId, epicId, documentId, directive, onUpdate]);

  /* ── Undo ────────────────────────────────────────────────────────── */

  const handleUndo = useCallback(async () => {
    if (!directive) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives/${directive.id}/undo`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = await res.json();
        setDirective(data.directive);
        onUpdate();
      }
    } catch { /* ignore */ }
  }, [projectId, epicId, documentId, directive, onUpdate]);

  /* ── Delete ──────────────────────────────────────────────────────── */

  const handleDelete = useCallback(async () => {
    if (!directive) return;
    try {
      await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${documentId}/directives/${directive.id}`,
        { method: "DELETE" },
      );
      onUpdate();
      onClose();
    } catch { /* ignore */ }
  }, [projectId, epicId, documentId, directive, onUpdate, onClose]);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className={`codascope-insertion-prompt${isApplied ? " codascope-insertion-prompt--applied" : ""}`}>
      {/* Header */}
      <div className="codascope-insertion-prompt-header">
        <div className="codascope-insertion-prompt-type-selector">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`codascope-btn codascope-btn-xs${type === opt.value ? " codascope-btn-primary" : " codascope-btn-ghost"}`}
              onClick={() => setType(opt.value)}
              disabled={!!directive}
              type="button"
            >
              <opt.Icon size={12} /> {opt.label}
            </button>
          ))}
        </div>
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={directive ? handleDelete : onClose}
          type="button"
          title={directive ? "Delete directive" : "Cancel"}
        >
          <IconClose size={12} />
        </button>
      </div>

      {/* Instruction input */}
      {!directive && (
        <div className="codascope-insertion-prompt-input-area">
          <textarea
            className="codascope-insertion-prompt-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={`Describe what to ${type === "insert" ? "insert" : type === "replace" ? "rewrite" : "expand"}…`}
            rows={2}
          />
          <div className="codascope-insertion-prompt-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-xs"
              onClick={handleCreate}
              disabled={creating || !instruction.trim()}
              type="button"
            >
              {creating ? "Creating…" : "Create Directive"}
            </button>
          </div>
        </div>
      )}

      {/* Directive created — show instruction + generate button */}
      {directive && !hasGenerated && !isApplied && (
        <div className="codascope-insertion-prompt-pending">
          <div className="codascope-insertion-prompt-instruction">
            <span className="codascope-insertion-prompt-instruction-label">Instruction:</span>
            {directive.instruction}
          </div>
          <button
            className="codascope-btn codascope-btn-primary codascope-btn-xs"
            onClick={handleGenerate}
            disabled={generating}
            type="button"
          >
            {generating ? <><IconPending size={12} /> Generating…</> : <><IconGenerate size={12} /> Generate</>}
          </button>
        </div>
      )}

      {/* Generated content preview */}
      {directive && hasGenerated && !isApplied && (
        <div className="codascope-directive-preview">
          <div className="codascope-directive-preview-label">Preview:</div>
          <div className="codascope-directive-preview-content">
            <MarkdownViewer content={directive.generatedContent!} />
          </div>
          <div className="codascope-directive-preview-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={handleReject}
              type="button"
            >
              <IconClose size={12} /> Reject
            </button>
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={handleGenerate}
              disabled={generating}
              type="button"
            >
              <IconRewrite size={12} /> Regenerate
            </button>
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-xs"
              onClick={handleApply}
              disabled={applying}
              type="button"
            >
              {applying ? "Applying…" : <><IconCheckmark size={12} /> Apply</>}
            </button>
          </div>
        </div>
      )}

      {/* Applied state */}
      {directive && isApplied && (
        <div className="codascope-insertion-prompt-applied">
          <span className="codascope-insertion-prompt-applied-label"><IconCheckmark size={12} /> Applied</span>
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={handleUndo}
            type="button"
          >
            <IconUndo size={12} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
