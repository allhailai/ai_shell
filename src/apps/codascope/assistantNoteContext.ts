import { useSyncExternalStore } from "react";
import type { WorkspaceCurrentNoteMetadata } from "./codaScopeTypes";

type Listener = () => void;
export type RootNoteContextOwner = symbol;

interface RootNoteContextState {
  owner: RootNoteContextOwner | null;
  metadata: WorkspaceCurrentNoteMetadata | null;
}

let state: RootNoteContextState = { owner: null, metadata: null };
const listeners = new Set<Listener>();

export function createRootNoteContextOwner(): RootNoteContextOwner {
  return Symbol("codascope-root-note-context");
}

export function publishRootNoteContext(
  owner: RootNoteContextOwner,
  metadata: WorkspaceCurrentNoteMetadata,
): void {
  state = {
    owner,
    metadata: sanitizeMetadata(metadata),
  };
  notify();
}

export function updateRootNoteContext(
  owner: RootNoteContextOwner,
  metadata: Partial<Pick<WorkspaceCurrentNoteMetadata, "title" | "contentHash">>,
): void {
  if (state.owner !== owner || !state.metadata) return;
  state = {
    owner,
    metadata: sanitizeMetadata({ ...state.metadata, ...metadata }),
  };
  notify();
}

export function clearRootNoteContext(owner: RootNoteContextOwner): void {
  if (state.owner !== owner) return;
  state = { owner: null, metadata: null };
  notify();
}

export function getRootNoteContextSnapshot(): WorkspaceCurrentNoteMetadata | null {
  return state.metadata;
}

export function useRootNoteContext(): WorkspaceCurrentNoteMetadata | null {
  return useSyncExternalStore(
    subscribe,
    getRootNoteContextSnapshot,
    getRootNoteContextSnapshot,
  );
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function sanitizeMetadata(
  metadata: WorkspaceCurrentNoteMetadata,
): WorkspaceCurrentNoteMetadata {
  return {
    stableId: metadata.stableId,
    scope: "codascope",
    path: metadata.path,
    title: metadata.title,
    visibility: metadata.visibility,
    ...(metadata.contentHash
      ? { contentHash: metadata.contentHash }
      : {}),
  };
}
