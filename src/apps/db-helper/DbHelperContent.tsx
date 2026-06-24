/* ── DB Helper: Main Content ──────────────────────────────────────────
   Root component for the DB Helper application.
   Handles routing between connection list, add, edit, and explorer
   views via pushState/popstate for deep-linkable URLs.

   Also exports DbHelperLeftNav and DbHelperRightPanel for the manifest.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { ConnectionList } from "./ConnectionList";
import { ConnectionForm } from "./ConnectionForm";
import { ExplorerView } from "./explorer/ExplorerView";
import { SchemaTree } from "./explorer/SchemaTree";
import { TableInfoPanel } from "./explorer/TableInfoPanel";
import {
  useExplorerState,
  setConnections as setExplorerConnections,
  registerNavigation,
  navigateToExplore as navExplore,
  navigateToNew as navNew,
  navigateToEdit as navEdit,
  clearExplorer,
  initExplorer,
  setSchemas,
} from "./explorer/useExplorerState";
import type { DbConnectionInfo } from "./types";

type View =
  | { type: "list" }
  | { type: "new" }
  | { type: "edit"; connection: DbConnectionInfo }
  | { type: "explore"; connectionId: string };

const APP_ID = "db-helper";

// ── URL helpers ──────────────────────────────────────────────────────

function getSubRouteFromUrl(): string | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[1] ?? null;
}

function getParamFromUrl(): string | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[2] ?? null;
}

function pushSubRoute(subRoute: string | null): void {
  const path = subRoute ? `/${APP_ID}/${subRoute}` : `/${APP_ID}`;
  window.history.pushState(null, "", `${path}${window.location.search}`);
}

// ── Component ────────────────────────────────────────────────────────

export function DbHelperContent() {
  const [connections, setConnections] = useState<DbConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(() => {
    const sub = getSubRouteFromUrl();
    if (sub === "new") return { type: "new" };
    if (sub === "edit") return { type: "list" };
    if (sub === "explore") {
      const connId = getParamFromUrl();
      if (connId) return { type: "explore", connectionId: connId };
    }
    return { type: "list" };
  });

  // ── Fetch connections ──────────────────────────────────────────────

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/db-helper/connections");
      if (res.ok) {
        const data = await res.json();
        const conns: DbConnectionInfo[] = data.connections ?? [];
        setConnections(conns);
        setExplorerConnections(conns);

        // Resolve deferred edit view from URL
        const sub = getSubRouteFromUrl();
        const paramId = getParamFromUrl();
        if (sub === "edit" && paramId) {
          const target = conns.find((c) => c.id === paramId);
          if (target) {
            setView({ type: "edit", connection: target });
          } else {
            setView({ type: "list" });
          }
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // ── Navigation ─────────────────────────────────────────────────────

  const navigateToList = useCallback(() => {
    pushSubRoute(null);
    setView({ type: "list" });
    clearExplorer();
    fetchConnections();
  }, [fetchConnections]);

  const navigateToNew = useCallback(() => {
    pushSubRoute("new");
    setView({ type: "new" });
  }, []);

  const navigateToEdit = useCallback((conn: DbConnectionInfo) => {
    pushSubRoute(`edit/${conn.id}`);
    setView({ type: "edit", connection: conn });
  }, []);

  const navigateToExplore = useCallback((connOrId: DbConnectionInfo | string) => {
    const connId = typeof connOrId === "string" ? connOrId : connOrId.id;
    pushSubRoute(`explore/${connId}`);
    setView({ type: "explore", connectionId: connId });

    // Initialize the explorer state for the left nav
    const conn = connections.find((c) => c.id === connId);
    if (conn) {
      initExplorer(connId, conn.name);
      fetch(`/api/db-helper/${connId}/schemas`)
        .then((r) => (r.ok ? r.json() : { schemas: [] }))
        .then((data) =>
          setSchemas(
            (data.schemas as string[]).map((name: string) => ({ name })),
          ),
        )
        .catch(() => setSchemas([]));
    }
  }, [connections]);

  const handleDelete = useCallback(
    (_conn: DbConnectionInfo) => {
      fetchConnections();
    },
    [fetchConnections],
  );

  // ── Register navigation for left nav to use ────────────────────────

  useEffect(() => {
    registerNavigation({
      explore: (connId: string) => {
        navigateToExplore(connId);
      },
      addNew: navigateToNew,
      edit: navigateToEdit,
    });
  }, [navigateToExplore, navigateToNew, navigateToEdit]);

  // ── Popstate listener for back/forward ─────────────────────────────

  useEffect(() => {
    const handler = () => {
      const sub = getSubRouteFromUrl();
      if (sub === "new") {
        setView({ type: "new" });
      } else if (sub === "edit") {
        const paramId = getParamFromUrl();
        const target = connections.find((c) => c.id === paramId);
        if (target) {
          setView({ type: "edit", connection: target });
        } else {
          setView({ type: "list" });
        }
      } else if (sub === "explore") {
        const connId = getParamFromUrl();
        if (connId) {
          setView({ type: "explore", connectionId: connId });
        } else {
          setView({ type: "list" });
        }
      } else {
        setView({ type: "list" });
        clearExplorer();
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [connections]);

  // ── Render ─────────────────────────────────────────────────────────

  switch (view.type) {
    case "new":
      return (
        <div className="dbh-page">
          <ConnectionForm onCancel={navigateToList} onSaved={navigateToList} />
        </div>
      );

    case "edit":
      return (
        <div className="dbh-page">
          <ConnectionForm
            existing={view.connection}
            onCancel={navigateToList}
            onSaved={navigateToList}
          />
        </div>
      );

    case "explore":
      return (
        <ExplorerView
          connectionId={view.connectionId}
          connections={connections}
          onBack={navigateToList}
        />
      );

    case "list":
    default:
      return (
        <ConnectionList
          connections={connections}
          loading={loading}
          onAdd={navigateToNew}
          onEdit={navigateToEdit}
          onExplore={(conn) => navigateToExplore(conn)}
          onDelete={handleDelete}
          onRefresh={fetchConnections}
        />
      );
  }
}

// ── Left Nav: Connection picker + Schema tree ───────────────────────

export function DbHelperLeftNav() {
  const { connections, connectionId } = useExplorerState();
  const [filter, setFilter] = useState("");

  const handleConnectionChange = useCallback((connId: string) => {
    if (connId) {
      navExplore(connId);
    }
  }, []);

  const filterLower = filter.toLowerCase();
  const filteredConnections = filter
    ? connections.filter(
        (c) =>
          c.name.toLowerCase().includes(filterLower) ||
          c.host.toLowerCase().includes(filterLower) ||
          c.database.toLowerCase().includes(filterLower),
      )
    : connections;

  return (
    <div className="dbh-exp-leftnav">
      {/* Connection selector */}
      <div className="dbh-exp-leftnav-conn">
        <label className="dbh-exp-leftnav-label">Connection</label>
        {connections.length > 5 && (
          <input
            className="dbh-exp-tree-search-input"
            type="text"
            placeholder="Filter connections…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <select
          className="dbh-exp-conn-select dbh-exp-conn-select-full"
          value={connectionId}
          onChange={(e) => handleConnectionChange(e.target.value)}
        >
          <option value="">— Select a connection —</option>
          {filteredConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.database})
            </option>
          ))}
        </select>
        <div className="dbh-exp-leftnav-actions">
          <button
            className="dbh-btn dbh-btn-ghost dbh-btn-sm"
            onClick={() => navNew()}
            type="button"
            title="Add new connection"
          >
            + New
          </button>
          {connectionId && (
            <button
              className="dbh-btn dbh-btn-ghost dbh-btn-sm"
              onClick={() => {
                const conn = connections.find((c) => c.id === connectionId);
                if (conn) navEdit(conn);
              }}
              type="button"
              title="Edit current connection"
            >
              ✎ Edit
            </button>
          )}
        </div>
      </div>

      {/* Schema tree (only when a connection is active) */}
      {connectionId && (
        <div className="dbh-exp-leftnav-tree">
          <SchemaTree />
        </div>
      )}

      {/* Empty state */}
      {!connectionId && connections.length > 0 && (
        <div className="dbh-exp-leftnav-hint">
          Select a connection to browse schemas and tables.
        </div>
      )}

      {!connectionId && connections.length === 0 && (
        <div className="dbh-exp-leftnav-hint">
          No connections configured. Click "+ New" to add one.
        </div>
      )}
    </div>
  );
}

// ── Right Panel: Table Info ─────────────────────────────────────────

export function DbHelperRightPanel() {
  return <TableInfoPanel />;
}
