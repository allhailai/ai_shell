/* ── SQL Editor ───────────────────────────────────────────────────────
   CodeMirror 6 SQL editor with execution, results grid, query
   history, and export. "DataGrip lite" experience.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState as CMEditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { useExplorerState, addToQueryHistory, getQueryHistory, getEditorContent, saveEditorContent } from "./useExplorerState";
import { ExportMenu } from "./ExportMenu";

interface ColumnDef {
  name: string;
  dataTypeId: number;
}

interface QueryResult {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated?: boolean;
  command?: string;
  message?: string;
}

export function SqlEditor() {
  const { connectionId } = useExplorerState();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

  // ── Initialize CodeMirror ──────────────────────────────────────────

  useEffect(() => {
    if (!editorRef.current) return;

    const runQuery = () => {
      handleExecute();
      return true;
    };

    // Restore persisted content (survives tab switches)
    const initialContent = getEditorContent();

    const state = CMEditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL }),
        oneDark,
        cmPlaceholder("Enter SQL query… (Cmd/Ctrl+Enter to execute)"),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              runQuery();
              return true;
            },
          },
        ]),
        // Save content on every document change (silently, no re-render)
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            saveEditorContent(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "13px",
            backgroundColor: "transparent",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            borderRight: "1px solid var(--color-border-primary)",
          },
          ".cm-content": {
            fontFamily: "var(--font-mono)",
          },
          ".cm-scroller": {
            minHeight: "120px",
            maxHeight: "300px",
            overflow: "auto",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Close history on outside click ─────────────────────────────────

  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHistory]);

  // ── Get SQL (selection or full) ────────────────────────────────────

  const getSql = useCallback((): string => {
    const view = viewRef.current;
    if (!view) return "";
    const selection = view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    );
    if (selection.trim()) return selection.trim();
    return view.state.doc.toString().trim();
  }, []);

  // ── Execute query ──────────────────────────────────────────────────

  const handleExecute = useCallback(async () => {
    const querySql = getSql();
    if (!querySql || !connectionId) return;

    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      addToQueryHistory(querySql);

      const res = await fetch(`/api/db-helper/${connectionId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: querySql }),
      });

      if (res.ok) {
        const data: QueryResult = await res.json();
        setResult(data);
      } else {
        const data = await res.json().catch(() => ({ error: "Query failed" }));
        setError(data.error ?? data.message ?? "Query execution failed.");
      }
    } catch {
      setError("Network error — server may be offline.");
    } finally {
      setExecuting(false);
    }
  }, [connectionId, getSql]);

  // ── Server CSV export ──────────────────────────────────────────────

  const handleServerExport = useCallback(async () => {
    const querySql = getSql();
    if (!querySql || !connectionId) return;

    try {
      const res = await fetch(`/api/db-helper/${connectionId}/query/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: querySql }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "query_results.csv";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // silent fail
    }
  }, [connectionId, getSql]);

  // ── Load into editor ───────────────────────────────────────────────

  const loadQuery = useCallback((querySql: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: querySql },
    });
    setShowHistory(false);
  }, []);

  // ── Toggle history ─────────────────────────────────────────────────

  const toggleHistory = useCallback(() => {
    if (!showHistory) {
      setHistory(getQueryHistory());
    }
    setShowHistory(!showHistory);
  }, [showHistory]);

  return (
    <div className="dbh-exp-sql">
      {/* Toolbar */}
      <div className="dbh-exp-sql-toolbar">
        <button
          className="dbh-btn dbh-btn-primary dbh-btn-sm"
          onClick={handleExecute}
          disabled={executing}
          type="button"
        >
          {executing ? "Running…" : "▶ Run"}
        </button>

        <div className="dbh-exp-sql-history-wrap" ref={historyRef}>
          <button
            className="dbh-btn dbh-btn-ghost dbh-btn-sm"
            onClick={toggleHistory}
            type="button"
          >
            History ▾
          </button>
          {showHistory && (
            <div className="dbh-exp-sql-history-menu">
              {history.length === 0 ? (
                <div className="dbh-exp-sql-history-empty">No query history</div>
              ) : (
                history.map((q, i) => (
                  <button
                    key={i}
                    className="dbh-exp-sql-history-item"
                    onClick={() => loadQuery(q)}
                    type="button"
                    title={q}
                  >
                    {q.length > 100 ? q.slice(0, 100) + "…" : q}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {result && (
          <ExportMenu
            columns={result.columns.map((c) => c.name)}
            rows={result.rows}
            onServerExport={handleServerExport}
          />
        )}

        {/* Status */}
        <div className="dbh-exp-sql-status">
          {executing && <span className="dbh-exp-sql-status-running">Running…</span>}
          {result && !executing && (
            <span className="dbh-exp-sql-status-done">
              {result.command && result.command !== "SELECT"
                ? `${result.command}: ${result.rowCount} rows affected`
                : `${result.rows.length} rows`}
              {result.truncated && " (truncated)"}
              {" · "}
              {result.durationMs}ms
            </span>
          )}
        </div>

        <span className="dbh-exp-sql-shortcut">⌘/Ctrl + Enter</span>
      </div>

      {/* Editor */}
      <div className="dbh-exp-sql-editor" ref={editorRef} />

      {/* Error */}
      {error && (
        <div className="dbh-exp-sql-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {result && result.columns.length > 0 && (
        <div className="dbh-exp-sql-results">
          <div className="dbh-exp-table-wrap">
            <table className="dbh-exp-table">
              <thead>
                <tr>
                  <th className="dbh-exp-th dbh-exp-th-row">#</th>
                  {result.columns.map((col) => (
                    <th key={col.name} className="dbh-exp-th">
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="dbh-exp-tr">
                    <td className="dbh-exp-td dbh-exp-td-row">{i + 1}</td>
                    {result.columns.map((col) => (
                      <td key={col.name} className="dbh-exp-td">
                        <CellValue value={row[col.name]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.message && (
            <div className="dbh-exp-sql-message">{result.message}</div>
          )}
        </div>
      )}

      {/* Non-SELECT result (INSERT/UPDATE/DELETE) */}
      {result && result.columns.length === 0 && (
        <div className="dbh-exp-sql-nonselect">
          <span className="dbh-exp-sql-nonselect-icon">✓</span>
          {result.command}: {result.rowCount} rows affected in {result.durationMs}ms
        </div>
      )}
    </div>
  );
}

// ── Cell Value ───────────────────────────────────────────────────────

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="dbh-exp-null">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span className="dbh-exp-bool">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    const truncated = json.length > 100 ? json.slice(0, 100) + "…" : json;
    return <span className="dbh-exp-json" title={json}>{truncated}</span>;
  }
  const str = String(value);
  if (str.length > 200) {
    return <span title={str}>{str.slice(0, 200)}…</span>;
  }
  return <>{str}</>;
}
