import {
  isCanonicalContentHash,
  isCanonicalNoteTitle,
  isCanonicalStableId,
  normalizeCanonicalWorkspaceNoteState,
  type CanonicalWorkspaceNoteState,
} from "./workspaceMutationActionValidation";

export type WorkspaceNoteApiResult =
  | { status: "success"; note: CanonicalWorkspaceNoteState }
  | { status: "absence" }
  | { status: "conflict"; currentHash: string }
  | { status: "failure"; message: string };

export interface WorkspaceNoteRequestOptions {
  signal?: AbortSignal;
}

export interface WorkspaceNoteApi {
  read(
    stableId: string,
    options?: WorkspaceNoteRequestOptions,
  ): Promise<WorkspaceNoteApiResult>;
  updateTitle(
    stableId: string,
    title: string,
    expectedHash: string,
    options?: WorkspaceNoteRequestOptions,
  ): Promise<WorkspaceNoteApiResult>;
  updateVisibility(
    stableId: string,
    visibility: "private" | "shared",
    expectedHash: string,
    options?: WorkspaceNoteRequestOptions,
  ): Promise<WorkspaceNoteApiResult>;
}

const INVALID_RESPONSE_MESSAGE = "CodaScope returned an invalid note response.";
const INVALID_REQUEST_MESSAGE = "The note request was invalid.";
const REQUEST_FAILED_MESSAGE = "The note could not be updated. Please try again.";
const LOAD_FAILED_MESSAGE = "The note could not be loaded. Please try again.";

export function createWorkspaceNoteApi(
  fetchImpl: typeof fetch = fetch,
): WorkspaceNoteApi {
  const request = async (
    stableId: string,
    urlSuffix: "" | "/title" | "/visibility",
    init: RequestInit,
    failureMessage: string,
  ): Promise<WorkspaceNoteApiResult> => {
    if (!isCanonicalStableId(stableId)) {
      return { status: "failure", message: INVALID_RESPONSE_MESSAGE };
    }
    let response: Response;
    try {
      response = await fetchImpl(
        `/api/codascope/workspace/notes/${encodeURIComponent(stableId)}${urlSuffix}`,
        init,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return { status: "failure", message: failureMessage };
    }

    if (response.status === 404) return { status: "absence" };
    if (response.status === 409) {
      return parseWorkspaceNoteConflict(await readJson(response));
    }
    if (!response.ok) {
      return { status: "failure", message: failureMessage };
    }

    const note = normalizeCanonicalWorkspaceNoteState(
      await readJson(response),
      stableId,
    );
    return note
      ? { status: "success", note }
      : { status: "failure", message: INVALID_RESPONSE_MESSAGE };
  };

  return {
    read(stableId, options = {}) {
      return request(
        stableId,
        "",
        { method: "GET", signal: options.signal },
        LOAD_FAILED_MESSAGE,
      );
    },
    updateTitle(stableId, title, expectedHash, options = {}) {
      if (!isCanonicalNoteTitle(title)
        || !isCanonicalContentHash(expectedHash)) {
        return Promise.resolve({
          status: "failure",
          message: INVALID_REQUEST_MESSAGE,
        });
      }
      return request(
        stableId,
        "/title",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, expectedHash }),
          signal: options.signal,
        },
        REQUEST_FAILED_MESSAGE,
      );
    },
    updateVisibility(
      stableId,
      visibility,
      expectedHash,
      options = {},
    ) {
      if ((visibility !== "private" && visibility !== "shared")
        || !isCanonicalContentHash(expectedHash)) {
        return Promise.resolve({
          status: "failure",
          message: INVALID_REQUEST_MESSAGE,
        });
      }
      return request(
        stableId,
        "/visibility",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility, expectedHash }),
          signal: options.signal,
        },
        REQUEST_FAILED_MESSAGE,
      );
    },
  };
}

export function parseWorkspaceNoteConflict(
  value: unknown,
): WorkspaceNoteApiResult {
  if (!isRecord(value)
    || !hasExactKeys(value, ["error", "message", "currentHash"])
    || value.error !== "conflict"
    || typeof value.message !== "string"
    || !isCanonicalContentHash(value.currentHash)) {
    return { status: "failure", message: INVALID_RESPONSE_MESSAGE };
  }
  return { status: "conflict", currentHash: value.currentHash };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
