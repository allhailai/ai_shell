/* ── Explorer View ────────────────────────────────────────────────────
   Main canvas for the database explorer.
   Tab navigation (Data/Structure/SQL) only — the schema tree
   and connection picker live in the shell's leftNav panel.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { useExplorerState } from "./useExplorerState";
import { DataGrid } from "./DataGrid";
import { TableStructure } from "./TableStructure";
import { SqlEditor } from "./SqlEditor";
import type { DbConnectionInfo } from "../types";

interface ExplorerViewProps {
  connectionId: string;
  connections: DbConnectionInfo[];
  onBack: () => void;
}

export function ExplorerView({
  connectionId,
  connections,
  onBack,
}: ExplorerViewProps) {
  const { connectionName, loadingSchemas, activeTab, selectedSchema, selectedTable, setActiveTab } =
    useExplorerState();

  const conn = connections.find((c) => c.id === connectionId);

  // ── Tab content ────────────────────────────────────────────────────

  const renderTabContent = useCallback(() => {
    switch (activeTab) {
      case "data":
        return <DataGrid />;
      case "structure":
        return <TableStructure />;
      case "sql":
        return <SqlEditor />;
      default:
        return <DataGrid />;
    }
  }, [activeTab]);

  return (
    <div className="dbh-exp-root">
      {/* Explorer header — breadcrumb + back */}
      <div className="dbh-exp-header">
        <button
          className="dbh-btn dbh-btn-ghost dbh-btn-sm"
          onClick={onBack}
          type="button"
        >
          ← Connections
        </button>

        <span className="dbh-exp-header-conn-name">
          {conn?.name ?? connectionName}
        </span>

        {conn && (
          <span className="dbh-exp-header-conn-detail">
            {conn.host}:{conn.port}/{conn.database}
          </span>
        )}

        {selectedSchema && selectedTable && (
          <span className="dbh-exp-header-breadcrumb">
            › {selectedSchema}.{selectedTable}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="dbh-exp-tabs">
        <button
          className={`dbh-exp-tab ${activeTab === "data" ? "dbh-exp-tab-active" : ""}`}
          onClick={() => setActiveTab("data")}
          type="button"
        >
          Data
        </button>
        <button
          className={`dbh-exp-tab ${activeTab === "structure" ? "dbh-exp-tab-active" : ""}`}
          onClick={() => setActiveTab("structure")}
          type="button"
        >
          Structure
        </button>
        <button
          className={`dbh-exp-tab ${activeTab === "sql" ? "dbh-exp-tab-active" : ""}`}
          onClick={() => setActiveTab("sql")}
          type="button"
        >
          SQL
        </button>
      </div>

      {/* Tab content */}
      <div className="dbh-exp-content">
        {loadingSchemas ? (
          <div className="dbh-loading" style={{ padding: "2rem" }}>
            <div className="dbh-loading-spinner" />
            <span>Connecting to {connectionName || "database"}…</span>
          </div>
        ) : (
          renderTabContent()
        )}
      </div>
    </div>
  );
}
