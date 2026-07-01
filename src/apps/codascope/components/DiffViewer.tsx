/* ── CodaScope: DiffViewer Component ─────────────────────────────────
   Line-by-line diff viewer for markdown content.
   Shows additions (green), deletions (red), unchanged (dimmed).
   Supports multiple files with a file selector.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { FileDiff, VersionDiff } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface DiffViewerProps {
  diff: VersionDiff;
  onClose?: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function DiffViewer({ diff, onClose }: DiffViewerProps) {
  const [activeFileIdx, setActiveFileIdx] = useState(0);

  if (diff.files.length === 0) {
    return (
      <div className="codascope-diff-viewer">
        <div className="codascope-diff-viewer-header">
          <h3 className="codascope-diff-viewer-title">
            Comparing v{diff.from} → v{diff.to}
          </h3>
          {onClose && (
            <button className="codascope-btn codascope-btn-ghost" onClick={onClose} type="button">
              ✕ Close
            </button>
          )}
        </div>
        <div className="codascope-empty-state">
          <p>No differences found between these versions.</p>
        </div>
      </div>
    );
  }

  const activeFile = diff.files[activeFileIdx];

  return (
    <div className="codascope-diff-viewer">
      {/* Header */}
      <div className="codascope-diff-viewer-header">
        <h3 className="codascope-diff-viewer-title">
          Comparing v{diff.from} → v{diff.to}
        </h3>
        <div className="codascope-diff-viewer-summary">
          {diff.files.reduce((sum, f) => sum + f.addedCount, 0)} additions,{" "}
          {diff.files.reduce((sum, f) => sum + f.removedCount, 0)} deletions
        </div>
        {onClose && (
          <button className="codascope-btn codascope-btn-ghost" onClick={onClose} type="button">
            ✕ Close
          </button>
        )}
      </div>

      {/* File tabs (if multiple files) */}
      {diff.files.length > 1 && (
        <div className="codascope-diff-viewer-file-tabs">
          {diff.files.map((file, idx) => (
            <button
              key={file.filename}
              className={`codascope-diff-viewer-file-tab ${idx === activeFileIdx ? "codascope-diff-viewer-file-tab--active" : ""}`}
              onClick={() => setActiveFileIdx(idx)}
              type="button"
            >
              <span className="codascope-diff-viewer-file-name">{file.filename}</span>
              <span className="codascope-diff-viewer-file-stats">
                <span className="codascope-diff-viewer-stat-add">+{file.addedCount}</span>
                <span className="codascope-diff-viewer-stat-remove">-{file.removedCount}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Diff content */}
      {activeFile && <DiffFileContent file={activeFile} />}
    </div>
  );
}

/* ── File content renderer ───────────────────────────────────────────── */

function DiffFileContent({ file }: { file: FileDiff }) {
  let lineNumber = 0;

  return (
    <div className="codascope-diff-viewer-content">
      <div className="codascope-diff-viewer-file-header">
        <span className="codascope-diff-viewer-file-label">{file.filename}</span>
        <span className="codascope-diff-viewer-file-changes">
          <span className="codascope-diff-viewer-stat-add">+{file.addedCount}</span>
          <span className="codascope-diff-viewer-stat-remove">-{file.removedCount}</span>
        </span>
      </div>
      <pre className="codascope-diff-viewer-lines">
        {file.lines.map((line, idx) => {
          if (line.type !== "remove") lineNumber++;
          const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
          return (
            <div
              key={idx}
              className={`codascope-diff-line codascope-diff-line--${line.type}`}
            >
              <span className="codascope-diff-line-number">
                {line.type !== "remove" ? lineNumber : ""}
              </span>
              <span className="codascope-diff-line-prefix">{prefix}</span>
              <span className="codascope-diff-line-content">{line.content}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
