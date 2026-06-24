/* ── Table Info Panel ─────────────────────────────────────────────────
   Right panel showing quick-glance metadata for the selected table.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect } from "react";
import { useExplorerState } from "./useExplorerState";

interface TableMeta {
  columns: { name: string; dataType: string; nullable: boolean }[];
  indexes: { name: string; isPrimary: boolean }[];
  rowCount: number | null;
}

export function TableInfoPanel() {
  const { connectionId, selectedSchema, selectedTable } = useExplorerState();
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connectionId || !selectedSchema || !selectedTable) {
      setMeta(null);
      return;
    }

    setLoading(true);
    const schema = encodeURIComponent(selectedSchema);
    const table = encodeURIComponent(selectedTable);

    Promise.all([
      fetch(`/api/db-helper/${connectionId}/schemas/${schema}/tables/${table}/structure`).then(
        (r) => (r.ok ? r.json() : null),
      ),
      fetch(`/api/db-helper/${connectionId}/schemas/${schema}/tables/${table}/count`).then(
        (r) => (r.ok ? r.json() : null),
      ),
    ])
      .then(([structure, countData]) => {
        setMeta({
          columns: structure?.columns ?? [],
          indexes: structure?.indexes ?? [],
          rowCount: countData?.count ?? null,
        });
      })
      .catch(() => setMeta(null))
      .finally(() => setLoading(false));
  }, [connectionId, selectedSchema, selectedTable]);

  if (!selectedTable) {
    return (
      <div className="dbh-exp-info-panel">
        <div className="dbh-exp-info-empty">Select a table to view metadata</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dbh-exp-info-panel">
        <div className="dbh-loading" style={{ padding: "1rem" }}>
          <div className="dbh-loading-spinner dbh-loading-spinner-sm" />
        </div>
      </div>
    );
  }

  if (!meta) return null;

  return (
    <div className="dbh-exp-info-panel">
      <h3 className="dbh-exp-info-title">{selectedTable}</h3>
      <span className="dbh-exp-info-schema">{selectedSchema}</span>

      {/* Stats */}
      <div className="dbh-exp-info-stats">
        <div className="dbh-exp-info-stat">
          <span className="dbh-exp-info-stat-value">
            {meta.rowCount !== null ? `~${meta.rowCount.toLocaleString()}` : "—"}
          </span>
          <span className="dbh-exp-info-stat-label">Rows</span>
        </div>
        <div className="dbh-exp-info-stat">
          <span className="dbh-exp-info-stat-value">{meta.columns.length}</span>
          <span className="dbh-exp-info-stat-label">Columns</span>
        </div>
        <div className="dbh-exp-info-stat">
          <span className="dbh-exp-info-stat-value">{meta.indexes.length}</span>
          <span className="dbh-exp-info-stat-label">Indexes</span>
        </div>
      </div>

      {/* Compact column list */}
      <div className="dbh-exp-info-section">
        <h4 className="dbh-exp-info-section-title">Columns</h4>
        <div className="dbh-exp-info-col-list">
          {meta.columns.map((col) => (
            <div key={col.name} className="dbh-exp-info-col">
              <span className="dbh-exp-info-col-name">{col.name}</span>
              <span className="dbh-exp-info-col-type">{col.dataType}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
