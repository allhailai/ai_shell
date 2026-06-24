/* ── Table Structure ──────────────────────────────────────────────────
   Shows column definitions, indexes, foreign keys, and check
   constraints for the selected table.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect } from "react";
import { useExplorerState } from "./useExplorerState";

interface Column {
  name: string;
  dataType: string;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  nullable: boolean;
  defaultValue: string | null;
  position: number;
}

interface Index {
  name: string;
  type: string;
  isPrimary: boolean;
  isUnique: boolean;
  columns: string[];
}

interface ForeignKey {
  name: string;
  column: string;
  foreignSchema: string;
  foreignTable: string;
  foreignColumn: string;
}

interface CheckConstraint {
  name: string;
  clause: string;
}

interface TableStructureData {
  columns: Column[];
  indexes: Index[];
  foreignKeys: ForeignKey[];
  checkConstraints: CheckConstraint[];
}

export function TableStructure() {
  const { connectionId, selectedSchema, selectedTable } = useExplorerState();
  const [data, setData] = useState<TableStructureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId || !selectedSchema || !selectedTable) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(
      `/api/db-helper/${connectionId}/schemas/${encodeURIComponent(selectedSchema)}/tables/${encodeURIComponent(selectedTable)}/structure`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch structure");
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [connectionId, selectedSchema, selectedTable]);

  if (!selectedTable) {
    return (
      <div className="dbh-exp-empty-canvas">
        <p>Select a table from the schema tree to view its structure.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dbh-loading" style={{ padding: "2rem" }}>
        <div className="dbh-loading-spinner" />
        <span>Loading structure…</span>
      </div>
    );
  }

  if (error) {
    return <div className="dbh-message dbh-message-error">{error}</div>;
  }

  if (!data) return null;

  return (
    <div className="dbh-exp-structure">
      <div className="dbh-exp-datagrid-header">
        <span className="dbh-exp-datagrid-title">
          {selectedSchema}.{selectedTable}
        </span>
        <span className="dbh-exp-datagrid-count">
          {data.columns.length} columns
        </span>
      </div>

      {/* Columns */}
      <section className="dbh-exp-structure-section">
        <h3 className="dbh-exp-structure-heading">Columns</h3>
        <div className="dbh-exp-table-wrap">
          <table className="dbh-exp-table">
            <thead>
              <tr>
                <th className="dbh-exp-th">#</th>
                <th className="dbh-exp-th">Name</th>
                <th className="dbh-exp-th">Type</th>
                <th className="dbh-exp-th">Nullable</th>
                <th className="dbh-exp-th">Default</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((col) => (
                <tr key={col.name} className="dbh-exp-tr">
                  <td className="dbh-exp-td dbh-exp-td-row">{col.position}</td>
                  <td className="dbh-exp-td">
                    <strong>{col.name}</strong>
                  </td>
                  <td className="dbh-exp-td">
                    <code className="dbh-exp-type">{formatType(col)}</code>
                  </td>
                  <td className="dbh-exp-td">
                    {col.nullable ? (
                      <span className="dbh-exp-nullable-yes">YES</span>
                    ) : (
                      <span className="dbh-exp-nullable-no">NO</span>
                    )}
                  </td>
                  <td className="dbh-exp-td">
                    {col.defaultValue ? (
                      <code className="dbh-exp-default">{col.defaultValue}</code>
                    ) : (
                      <span className="dbh-exp-null">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Indexes */}
      {data.indexes.length > 0 && (
        <section className="dbh-exp-structure-section">
          <h3 className="dbh-exp-structure-heading">
            Indexes <span className="dbh-exp-structure-count">{data.indexes.length}</span>
          </h3>
          <div className="dbh-exp-table-wrap">
            <table className="dbh-exp-table">
              <thead>
                <tr>
                  <th className="dbh-exp-th">Name</th>
                  <th className="dbh-exp-th">Type</th>
                  <th className="dbh-exp-th">Columns</th>
                  <th className="dbh-exp-th">Properties</th>
                </tr>
              </thead>
              <tbody>
                {data.indexes.map((idx) => (
                  <tr key={idx.name} className="dbh-exp-tr">
                    <td className="dbh-exp-td">
                      <strong>{idx.name}</strong>
                    </td>
                    <td className="dbh-exp-td">
                      <code className="dbh-exp-type">{idx.type}</code>
                    </td>
                    <td className="dbh-exp-td">
                      {idx.columns.join(", ")}
                    </td>
                    <td className="dbh-exp-td">
                      {idx.isPrimary && (
                        <span className="dbh-exp-badge dbh-exp-badge-primary">PRIMARY</span>
                      )}
                      {idx.isUnique && !idx.isPrimary && (
                        <span className="dbh-exp-badge dbh-exp-badge-unique">UNIQUE</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Foreign keys */}
      {data.foreignKeys.length > 0 && (
        <section className="dbh-exp-structure-section">
          <h3 className="dbh-exp-structure-heading">
            Foreign Keys <span className="dbh-exp-structure-count">{data.foreignKeys.length}</span>
          </h3>
          <div className="dbh-exp-table-wrap">
            <table className="dbh-exp-table">
              <thead>
                <tr>
                  <th className="dbh-exp-th">Name</th>
                  <th className="dbh-exp-th">Column</th>
                  <th className="dbh-exp-th">References</th>
                </tr>
              </thead>
              <tbody>
                {data.foreignKeys.map((fk) => (
                  <tr key={fk.name} className="dbh-exp-tr">
                    <td className="dbh-exp-td">{fk.name}</td>
                    <td className="dbh-exp-td"><strong>{fk.column}</strong></td>
                    <td className="dbh-exp-td">
                      <code className="dbh-exp-type">
                        {fk.foreignSchema}.{fk.foreignTable}({fk.foreignColumn})
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Check constraints */}
      {data.checkConstraints.length > 0 && (
        <section className="dbh-exp-structure-section">
          <h3 className="dbh-exp-structure-heading">
            Check Constraints <span className="dbh-exp-structure-count">{data.checkConstraints.length}</span>
          </h3>
          <div className="dbh-exp-table-wrap">
            <table className="dbh-exp-table">
              <thead>
                <tr>
                  <th className="dbh-exp-th">Name</th>
                  <th className="dbh-exp-th">Clause</th>
                </tr>
              </thead>
              <tbody>
                {data.checkConstraints.map((chk) => (
                  <tr key={chk.name} className="dbh-exp-tr">
                    <td className="dbh-exp-td">{chk.name}</td>
                    <td className="dbh-exp-td">
                      <code className="dbh-exp-type">{chk.clause}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatType(col: Column): string {
  let t = col.dataType;
  if (col.maxLength) {
    t += `(${col.maxLength})`;
  } else if (col.numericPrecision && col.numericScale) {
    t += `(${col.numericPrecision},${col.numericScale})`;
  }
  return t;
}
