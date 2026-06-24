/* ── Explorer State Hook ──────────────────────────────────────────────
   Shared state for the database explorer, using useSyncExternalStore
   for cross-component synchronization.

   This module also bridges the leftNav and mainContent by holding
   the connections list and a navigation callback so the left nav
   can drive the main canvas.
   ──────────────────────────────────────────────────────────────────── */

import { useSyncExternalStore, useCallback } from "react";
import type { DbConnectionInfo } from "../types";

// ── Types ────────────────────────────────────────────────────────────

export interface SchemaInfo {
  name: string;
  tables?: TableInfo[];
  loading?: boolean;
}

export interface TableInfo {
  name: string;
  type: "table" | "view";
}

export interface ExplorerState {
  /** All available connections (kept in sync by mainContent). */
  connections: DbConnectionInfo[];
  /** Currently exploring this connection (empty = none). */
  connectionId: string;
  connectionName: string;
  schemas: SchemaInfo[];
  loadingSchemas: boolean;
  selectedSchema: string | null;
  selectedTable: string | null;
  activeTab: "data" | "structure" | "sql";
  /** Persisted SQL editor content (survives tab switches). */
  editorContent: string;
}

// ── Store ────────────────────────────────────────────────────────────

let state: ExplorerState = {
  connections: [],
  connectionId: "",
  connectionName: "",
  schemas: [],
  loadingSchemas: false,
  selectedSchema: null,
  selectedTable: null,
  activeTab: "data",
  editorContent: "SELECT 1;",
};

const listeners = new Set<() => void>();

function getState(): ExplorerState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(partial: Partial<ExplorerState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

// ── Navigation callback (set by mainContent) ─────────────────────────

let navigateFn: ((connId: string) => void) | null = null;
let navigateToNewFn: (() => void) | null = null;
let navigateToEditFn: ((conn: DbConnectionInfo) => void) | null = null;

export function registerNavigation(fns: {
  explore: (connId: string) => void;
  addNew: () => void;
  edit: (conn: DbConnectionInfo) => void;
}): void {
  navigateFn = fns.explore;
  navigateToNewFn = fns.addNew;
  navigateToEditFn = fns.edit;
}

export function navigateToExplore(connId: string): void {
  navigateFn?.(connId);
}

export function navigateToNew(): void {
  navigateToNewFn?.();
}

export function navigateToEdit(conn: DbConnectionInfo): void {
  navigateToEditFn?.(conn);
}

// ── Actions ──────────────────────────────────────────────────────────

export function setConnections(connections: DbConnectionInfo[]): void {
  setState({ connections });
}

export function initExplorer(connectionId: string, connectionName: string): void {
  setState({
    connectionId,
    connectionName,
    schemas: [],
    loadingSchemas: true,
    selectedSchema: null,
    selectedTable: null,
    activeTab: "data",
    editorContent: "SELECT 1;",
  });
}

export function clearExplorer(): void {
  setState({
    connectionId: "",
    connectionName: "",
    schemas: [],
    loadingSchemas: false,
    selectedSchema: null,
    selectedTable: null,
    activeTab: "data",
    editorContent: "SELECT 1;",
  });
}

export function setSchemas(schemas: SchemaInfo[]): void {
  setState({ schemas, loadingSchemas: false });
}

export function updateSchema(name: string, update: Partial<SchemaInfo>): void {
  setState({
    schemas: state.schemas.map((s) =>
      s.name === name ? { ...s, ...update } : s,
    ),
  });
}

export function selectTable(schema: string, table: string): void {
  setState({
    selectedSchema: schema,
    selectedTable: table,
    activeTab: "data",
  });
}

export function setActiveTab(tab: ExplorerState["activeTab"]): void {
  setState({ activeTab: tab });
}

/** Save editor content silently (no subscriber notification — avoids re-renders on every keystroke). */
export function saveEditorContent(content: string): void {
  state = { ...state, editorContent: content };
}

/** Get current editor content (non-reactive read). */
export function getEditorContent(): string {
  return state.editorContent;
}

export function setConnection(connectionId: string, connectionName: string): void {
  initExplorer(connectionId, connectionName);
}

// ── Query History (localStorage) ─────────────────────────────────────

const HISTORY_KEY = "db-helper-query-history";
const MAX_HISTORY = 50;

export function getQueryHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToQueryHistory(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) return;
  const history = getQueryHistory().filter((q) => q !== trimmed);
  history.unshift(trimmed);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore quota errors
  }
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useExplorerState(): ExplorerState & {
  selectTable: (schema: string, table: string) => void;
  setActiveTab: (tab: ExplorerState["activeTab"]) => void;
} {
  const currentState = useSyncExternalStore(subscribe, getState, getState);

  const selectTableFn = useCallback(
    (schema: string, table: string) => selectTable(schema, table),
    [],
  );
  const setActiveTabFn = useCallback(
    (tab: ExplorerState["activeTab"]) => setActiveTab(tab),
    [],
  );

  return {
    ...currentState,
    selectTable: selectTableFn,
    setActiveTab: setActiveTabFn,
  };
}
