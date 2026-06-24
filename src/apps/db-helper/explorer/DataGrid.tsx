/* ── Data Grid ────────────────────────────────────────────────────────
   Table data viewer with server-side pagination, column sorting,
   and data export. Used for both table preview and query results.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useExplorerState } from "./useExplorerState";
import { ExportMenu } from "./ExportMenu";

interface ColumnDef {
  name: string;
  dataTypeId: number;
}

export function DataGrid() {
  const { connectionId, selectedSchema, selectedTable } = useExplorerState();

  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [rowCount, setRowCount] = useState<number | null>(null);

  const limit = 100;

  // ── Fetch data ─────────────────────────────────────────────────────

  const fetchData = useCallback(
    async (newOffset: number, sortCol?: string | null, sortOrd?: string) => {
      if (!connectionId || !selectedSchema || !selectedTable) return;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(newOffset),
        });
        if (sortCol) {
          params.set("sortColumn", sortCol);
          params.set("sortOrder", sortOrd ?? "asc");
        }

        const res = await fetch(
          `/api/db-helper/${connectionId}/schemas/${encodeURIComponent(selectedSchema)}/tables/${encodeURIComponent(selectedTable)}/data?${params}`,
        );

        if (res.ok) {
          const data = await res.json();
          setColumns(data.columns);
          setRows(data.rows);
          setHasMore(data.hasMore);
          setOffset(newOffset);
        } else {
          const data = await res.json().catch(() => ({ error: "Failed to fetch data" }));
          setError(data.error ?? "Failed to fetch data.");
        }
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    },
    [connectionId, selectedSchema, selectedTable],
  );

  // Fetch row count
  useEffect(() => {
    if (!connectionId || !selectedSchema || !selectedTable) return;
    setRowCount(null);
    fetch(
      `/api/db-helper/${connectionId}/schemas/${encodeURIComponent(selectedSchema)}/tables/${encodeURIComponent(selectedTable)}/count`,
    )
      .then((r) => r.json())
      .then((data) => setRowCount(data.count ?? null))
      .catch(() => setRowCount(null));
  }, [connectionId, selectedSchema, selectedTable]);

  // Reset and fetch on table change
  useEffect(() => {
    setOffset(0);
    setSortColumn(null);
    setSortOrder("asc");
    fetchData(0, null, "asc");
  }, [connectionId, selectedSchema, selectedTable, fetchData]);

  // ── Sort handler ───────────────────────────────────────────────────

  const handleSort = useCallback(
    (col: string) => {
      let newOrder: "asc" | "desc" = "asc";
      if (sortColumn === col && sortOrder === "asc") {
        newOrder = "desc";
      }
      setSortColumn(col);
      setSortOrder(newOrder);
      fetchData(0, col, newOrder);
    },
    [sortColumn, sortOrder, fetchData],
  );

  // ── Pagination ─────────────────────────────────────────────────────

  const handlePrev = useCallback(() => {
    const newOffset = Math.max(0, offset - limit);
    fetchData(newOffset, sortColumn, sortOrder);
  }, [offset, sortColumn, sortOrder, fetchData]);

  const handleNext = useCallback(() => {
    fetchData(offset + limit, sortColumn, sortOrder);
  }, [offset, sortColumn, sortOrder, fetchData]);

  // ── No table selected ─────────────────────────────────────────────

  if (!selectedTable) {
    return (
      <div className="dbh-exp-empty-canvas">
        <p>Select a table from the schema tree to preview its data.</p>
      </div>
    );
  }

  return (
    <div className="dbh-exp-datagrid">
      {/* Header bar */}
      <div className="dbh-exp-datagrid-header">
        <span className="dbh-exp-datagrid-title">
          {selectedSchema}.{selectedTable}
        </span>
        {rowCount !== null && (
          <span className="dbh-exp-datagrid-count">
            ~{rowCount.toLocaleString()} rows
          </span>
        )}
        <ExportMenu
          columns={columns.map((c) => c.name)}
          rows={rows}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="dbh-message dbh-message-error">{error}</div>
      )}

      {/* Table */}
      <div className="dbh-exp-table-wrap">
        {loading && rows.length === 0 ? (
          <div className="dbh-loading" style={{ padding: "2rem" }}>
            <div className="dbh-loading-spinner" />
            <span>Loading data…</span>
          </div>
        ) : (
          <table className="dbh-exp-table">
            <thead>
              <tr>
                <th className="dbh-exp-th dbh-exp-th-row">#</th>
                {columns.map((col) => (
                  <th
                    key={col.name}
                    className={`dbh-exp-th ${sortColumn === col.name ? "dbh-exp-th-sorted" : ""}`}
                    onClick={() => handleSort(col.name)}
                  >
                    {col.name}
                    {sortColumn === col.name && (
                      <span className="dbh-exp-sort-indicator">
                        {sortOrder === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="dbh-exp-tr">
                  <td className="dbh-exp-td dbh-exp-td-row">{offset + i + 1}</td>
                  {columns.map((col) => (
                    <td key={col.name} className="dbh-exp-td">
                      <CellValue value={row[col.name]} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="dbh-exp-td"
                    style={{ textAlign: "center", padding: "2rem" }}
                  >
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="dbh-exp-pagination">
        <span className="dbh-exp-pagination-info">
          Rows {offset + 1}–{offset + rows.length}
          {rowCount !== null && ` of ~${rowCount.toLocaleString()}`}
        </span>
        <div className="dbh-exp-pagination-btns">
          <button
            className="dbh-btn dbh-btn-ghost dbh-btn-sm"
            onClick={handlePrev}
            disabled={offset === 0 || loading}
            type="button"
          >
            ◀ Previous
          </button>
          <button
            className="dbh-btn dbh-btn-ghost dbh-btn-sm"
            onClick={handleNext}
            disabled={!hasMore || loading}
            type="button"
          >
            Next ▶
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cell Value Renderer ──────────────────────────────────────────────

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
