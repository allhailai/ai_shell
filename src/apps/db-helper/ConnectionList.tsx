/* ── DB Helper: Connection List ───────────────────────────────────────
   Displays all configured database connections as cards.
   Provides add, edit, delete, and test-connection actions.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import type { DbConnectionInfo, TestResult } from "./types";

interface ConnectionListProps {
  connections: DbConnectionInfo[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (conn: DbConnectionInfo) => void;
  onExplore: (conn: DbConnectionInfo) => void;
  onDelete: (conn: DbConnectionInfo) => void;
  onRefresh: () => void;
}

export function ConnectionList({
  connections,
  loading,
  onAdd,
  onEdit,
  onExplore,
  onDelete: _onDelete,
  onRefresh,
}: ConnectionListProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestResult>
  >({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Test connection ────────────────────────────────────────────────

  const handleTest = useCallback(
    async (conn: DbConnectionInfo) => {
      setTestingId(conn.id);
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[conn.id];
        return next;
      });

      try {
        const res = await fetch(
          `/api/db-helper/connections/${conn.id}/test`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        if (res.ok) {
          const result: TestResult = await res.json();
          setTestResults((prev) => ({ ...prev, [conn.id]: result }));
        } else {
          setTestResults((prev) => ({
            ...prev,
            [conn.id]: { success: false, message: "Request failed." },
          }));
        }
      } catch {
        setTestResults((prev) => ({
          ...prev,
          [conn.id]: { success: false, message: "Network error." },
        }));
      } finally {
        setTestingId(null);
      }
    },
    [],
  );

  // ── Delete confirmation ────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(
    async (conn: DbConnectionInfo) => {
      try {
        const res = await fetch(`/api/db-helper/connections/${conn.id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setDeleteConfirmId(null);
          onRefresh();
        }
      } catch {
        // Silently fail — user can retry
      }
    },
    [onRefresh],
  );

  // ── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="dbh-page">
        <div className="dbh-loading">
          <div className="dbh-loading-spinner" />
          <span>Loading connections…</span>
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────

  if (connections.length === 0) {
    return (
      <div className="dbh-page">
        <div className="dbh-empty">
          <div className="dbh-empty-icon">
            <CylinderIcon size={48} />
          </div>
          <h2 className="dbh-empty-title">No Database Connections</h2>
          <p className="dbh-empty-text">
            Add a Postgres database connection to get started. Your credentials
            are encrypted and stored securely in the system keychain.
          </p>
          <button
            className="dbh-btn dbh-btn-primary dbh-btn-lg"
            onClick={onAdd}
            type="button"
          >
            <PlusIcon /> Add Connection
          </button>
        </div>
      </div>
    );
  }

  // ── Connection cards ───────────────────────────────────────────────

  return (
    <div className="dbh-page">
      <div className="dbh-list-header">
        <div>
          <h2 className="dbh-list-title">Database Connections</h2>
          <p className="dbh-list-subtitle">
            {connections.length} connection{connections.length !== 1 ? "s" : ""}{" "}
            configured
          </p>
        </div>
        <button
          className="dbh-btn dbh-btn-primary"
          onClick={onAdd}
          type="button"
        >
          <PlusIcon /> Add Connection
        </button>
      </div>

      <div className="dbh-card-grid">
        {connections.map((conn) => {
          const result = testResults[conn.id];
          const isTesting = testingId === conn.id;
          const isDeleting = deleteConfirmId === conn.id;

          return (
            <div key={conn.id} className="dbh-card">
              {/* Card header */}
              <div className="dbh-card-header">
                <div className="dbh-card-icon">
                  <CylinderIcon size={20} />
                </div>
                <div className="dbh-card-title-group">
                  <h3 className="dbh-card-name">{conn.name}</h3>
                  <span className="dbh-card-host">
                    {conn.host}:{conn.port}
                  </span>
                </div>
              </div>

              {/* Card details */}
              <div className="dbh-card-details">
                <div className="dbh-card-detail">
                  <span className="dbh-card-detail-label">Database</span>
                  <span className="dbh-card-detail-value">{conn.database}</span>
                </div>
                <div className="dbh-card-detail">
                  <span className="dbh-card-detail-label">User</span>
                  <span className="dbh-card-detail-value">{conn.username}</span>
                </div>
                <div className="dbh-card-detail">
                  <span className="dbh-card-detail-label">SSL</span>
                  <span className="dbh-card-detail-value">
                    {conn.sslMode === "disable"
                      ? "Off"
                      : conn.sslMode === "require"
                        ? "Required"
                        : "Verify Full"}
                    {conn.hasSslCaCert && " + CA"}
                    {conn.hasSslClientCert && " + Client Cert"}
                  </span>
                </div>
              </div>

              {/* Test result */}
              {(result || isTesting) && (
                <div
                  className={`dbh-card-test ${isTesting ? "dbh-card-test-pending" : result?.success ? "dbh-card-test-success" : "dbh-card-test-error"}`}
                >
                  {isTesting ? (
                    <>
                      <div className="dbh-loading-spinner dbh-loading-spinner-sm" />
                      Testing…
                    </>
                  ) : (
                    <>
                      <span>{result!.success ? "✓" : "✗"}</span>
                      <span className="dbh-card-test-msg">
                        {result!.message}
                      </span>
                      {result!.latencyMs != null && (
                        <span className="dbh-card-test-latency">
                          {result!.latencyMs}ms
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Delete confirmation overlay */}
              {isDeleting && (
                <div className="dbh-card-delete-confirm">
                  <p>Delete "{conn.name}"?</p>
                  <div className="dbh-card-delete-actions">
                    <button
                      className="dbh-btn dbh-btn-danger dbh-btn-sm"
                      onClick={() => handleDeleteConfirm(conn)}
                      type="button"
                    >
                      Delete
                    </button>
                    <button
                      className="dbh-btn dbh-btn-ghost dbh-btn-sm"
                      onClick={() => setDeleteConfirmId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Card actions */}
              <div className="dbh-card-actions">
                <button
                  className="dbh-btn dbh-btn-primary dbh-btn-sm"
                  onClick={() => onExplore(conn)}
                  title="Explore database"
                  type="button"
                >
                  🔍 Explore
                </button>
                <button
                  className="dbh-btn dbh-btn-ghost dbh-btn-sm"
                  onClick={() => handleTest(conn)}
                  disabled={isTesting}
                  title="Test connection"
                  type="button"
                >
                  ⚡ Test
                </button>
                <button
                  className="dbh-btn dbh-btn-ghost dbh-btn-sm"
                  onClick={() => onEdit(conn)}
                  title="Edit connection"
                  type="button"
                >
                  ✎ Edit
                </button>
                <button
                  className="dbh-btn dbh-btn-ghost dbh-btn-sm dbh-btn-danger-text"
                  onClick={() => setDeleteConfirmId(conn.id)}
                  title="Delete connection"
                  type="button"
                >
                  ✕ Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────

function CylinderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 5v14a9 3 0 0 1-18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
