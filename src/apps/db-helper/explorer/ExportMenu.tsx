/* ── Export Menu ──────────────────────────────────────────────────────
   Dropdown for exporting data to CSV or clipboard.
   Used by DataGrid and QueryResults.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";

interface ExportMenuProps {
  /** Returns the current visible columns. */
  columns: string[];
  /** Returns the current visible rows. */
  rows: Record<string, unknown>[];
  /** Optional: callback to trigger server-side CSV export. */
  onServerExport?: () => void;
}

export function ExportMenu({ columns, rows, onServerExport }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toTsv = useCallback((): string => {
    const header = columns.join("\t");
    const body = rows.map((row) =>
      columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        return String(val).replace(/\t/g, " ").replace(/\n/g, " ");
      }).join("\t"),
    );
    return [header, ...body].join("\n");
  }, [columns, rows]);

  const toCsv = useCallback((): string => {
    const escape = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const header = columns.map(escape).join(",");
    const body = rows.map((row) => columns.map((col) => escape(row[col])).join(","));
    return [header, ...body].join("\n");
  }, [columns, rows]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(toTsv());
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = toTsv();
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
    setOpen(false);
  }, [toTsv]);

  const handleDownloadCsv = useCallback(() => {
    const csv = toCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [toCsv]);

  if (rows.length === 0) return null;

  return (
    <div className="dbh-exp-export" ref={menuRef}>
      <button
        className="dbh-btn dbh-btn-ghost dbh-btn-sm"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {copyFeedback ? "✓ Copied" : "⬇ Export"}
      </button>

      {open && (
        <div className="dbh-exp-export-menu">
          <button
            className="dbh-exp-export-item"
            onClick={handleCopy}
            type="button"
          >
            <span>📋</span> Copy to Clipboard
            <span className="dbh-exp-export-hint">Tab-separated (paste into Excel)</span>
          </button>
          <button
            className="dbh-exp-export-item"
            onClick={handleDownloadCsv}
            type="button"
          >
            <span>📄</span> Download CSV
            <span className="dbh-exp-export-hint">{rows.length} rows</span>
          </button>
          {onServerExport && (
            <button
              className="dbh-exp-export-item"
              onClick={() => {
                onServerExport();
                setOpen(false);
              }}
              type="button"
            >
              <span>🔄</span> Export Full Results
              <span className="dbh-exp-export-hint">Re-run query as CSV</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
