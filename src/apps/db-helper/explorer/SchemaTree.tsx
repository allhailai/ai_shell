/* ── Schema Tree ─────────────────────────────────────────────────────
   Left nav component for browsing database schemas and tables.
   Schemas are collapsible, tables are loaded on expand.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import {
  useExplorerState,
  updateSchema,
  type SchemaInfo,
} from "./useExplorerState";

const HIDDEN_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

export function SchemaTree() {
  const { connectionId, schemas, loadingSchemas, selectedSchema, selectedTable, selectTable } =
    useExplorerState();
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  // Auto-expand 'public' if present
  useEffect(() => {
    if (schemas.some((s) => s.name === "public")) {
      setExpandedSchemas(new Set(["public"]));
      // Also load its tables
      loadTables("public");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas.length]);

  const loadTables = useCallback(
    async (schemaName: string) => {
      if (!connectionId) return;
      const schema = schemas.find((s) => s.name === schemaName);
      if (schema?.tables) return; // already loaded

      updateSchema(schemaName, { loading: true });

      try {
        const res = await fetch(
          `/api/db-helper/${connectionId}/schemas/${encodeURIComponent(schemaName)}/tables`,
        );
        if (res.ok) {
          const data = await res.json();
          updateSchema(schemaName, { tables: data.tables, loading: false });
        } else {
          updateSchema(schemaName, { tables: [], loading: false });
        }
      } catch {
        updateSchema(schemaName, { tables: [], loading: false });
      }
    },
    [connectionId, schemas],
  );

  const toggleSchema = useCallback(
    (name: string) => {
      setExpandedSchemas((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
          loadTables(name);
        }
        return next;
      });
    },
    [loadTables],
  );

  const handleTableClick = useCallback(
    (schema: string, table: string) => {
      selectTable(schema, table);
    },
    [selectTable],
  );

  // Filter schemas and tables
  const filterLower = filter.toLowerCase();
  const filteredSchemas = schemas.filter((s) => {
    if (!showSystem && HIDDEN_SCHEMAS.has(s.name)) return false;
    if (!filterLower) return true;
    if (s.name.toLowerCase().includes(filterLower)) return true;
    return s.tables?.some((t) => t.name.toLowerCase().includes(filterLower));
  });

  if (loadingSchemas) {
    return (
      <div className="dbh-exp-tree">
        <div className="dbh-exp-tree-loading">
          <div className="dbh-loading-spinner dbh-loading-spinner-sm" />
          <span>Loading schemas…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dbh-exp-tree">
      {/* Search/filter */}
      <div className="dbh-exp-tree-search">
        <input
          className="dbh-exp-tree-search-input"
          type="text"
          placeholder="Filter tables…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Schema list */}
      <div className="dbh-exp-tree-list">
        {filteredSchemas.map((schema) => (
          <SchemaNode
            key={schema.name}
            schema={schema}
            expanded={expandedSchemas.has(schema.name)}
            selectedSchema={selectedSchema}
            selectedTable={selectedTable}
            filter={filterLower}
            onToggle={toggleSchema}
            onSelectTable={handleTableClick}
          />
        ))}
      </div>

      {/* Show system schemas toggle */}
      <label className="dbh-exp-tree-system-toggle">
        <input
          type="checkbox"
          checked={showSystem}
          onChange={(e) => setShowSystem(e.target.checked)}
        />
        Show system schemas
      </label>
    </div>
  );
}

// ── Schema Node ──────────────────────────────────────────────────────

function SchemaNode({
  schema,
  expanded,
  selectedSchema,
  selectedTable,
  filter,
  onToggle,
  onSelectTable,
}: {
  schema: SchemaInfo;
  expanded: boolean;
  selectedSchema: string | null;
  selectedTable: string | null;
  filter: string;
  onToggle: (name: string) => void;
  onSelectTable: (schema: string, table: string) => void;
}) {
  const tables = schema.tables ?? [];
  const filteredTables = filter
    ? tables.filter((t) => t.name.toLowerCase().includes(filter))
    : tables;

  return (
    <div className="dbh-exp-schema">
      <button
        className="dbh-exp-schema-header"
        onClick={() => onToggle(schema.name)}
        type="button"
      >
        <span className={`dbh-exp-chevron ${expanded ? "dbh-exp-chevron-open" : ""}`}>
          ▸
        </span>
        <SchemaIcon />
        <span className="dbh-exp-schema-name">{schema.name}</span>
        {tables.length > 0 && (
          <span className="dbh-exp-schema-count">{tables.length}</span>
        )}
      </button>

      {expanded && (
        <div className="dbh-exp-table-list">
          {schema.loading ? (
            <div className="dbh-exp-table-loading">
              <div className="dbh-loading-spinner dbh-loading-spinner-sm" />
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="dbh-exp-table-empty">No tables</div>
          ) : (
            filteredTables.map((t) => (
              <button
                key={t.name}
                className={`dbh-exp-table-item ${
                  selectedSchema === schema.name && selectedTable === t.name
                    ? "dbh-exp-table-item-active"
                    : ""
                }`}
                onClick={() => onSelectTable(schema.name, t.name)}
                type="button"
              >
                {t.type === "view" ? <ViewIcon /> : <TableIcon />}
                <span className="dbh-exp-table-name">{t.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────

function SchemaIcon() {
  return (
    <svg className="dbh-exp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg className="dbh-exp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg className="dbh-exp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
