import {
  WORKSPACE_NOTE_MAX_TITLE,
  isCanonicalNoteTitle,
  type CanonicalWorkspaceNoteState,
} from "./workspaceMutationActionValidation";
import type {
  WorkspaceNoteApi,
  WorkspaceNoteApiResult,
} from "./workspaceNoteApi";
import { buildWorkspaceNoteSubRoute } from "./workspaceCreatedNote";

export type WorkspaceNoteCardPhase =
  | "loading"
  | "ready"
  | "unavailable"
  | "error";
export type WorkspaceNoteCardPending =
  | "title"
  | "visibility"
  | "open"
  | null;
export type WorkspaceNoteVisibility = "private" | "shared";

export interface WorkspaceNoteCardState {
  phase: WorkspaceNoteCardPhase;
  note: CanonicalWorkspaceNoteState | null;
  pending: WorkspaceNoteCardPending;
  editing: boolean;
  titleDraft: string;
  titleError: string | null;
  confirmation: WorkspaceNoteVisibility | null;
  statusText: string;
}

export const PRIVATE_TO_SHARED_WARNING =
  "This note will become visible to all CodaScope users.";
export const SHARED_TO_PRIVATE_WARNING =
  "Existing CodaScope users will lose access to this note.";

const LOAD_FAILURE = "The note could not be loaded. Please try again.";
const TITLE_FAILURE =
  "The display title could not be saved. Please try again.";
const VISIBILITY_FAILURE =
  "Visibility could not be changed. Please try again.";
const OPEN_FAILURE = "The note could not be opened. Please try again.";
const REVIEW_REQUIRED =
  "This note changed elsewhere. Review the latest details before retrying.";

export function visibilityConfirmationMessage(
  visibility: WorkspaceNoteVisibility,
): string {
  return visibility === "shared"
    ? PRIVATE_TO_SHARED_WARNING
    : SHARED_TO_PRIVATE_WARNING;
}

export function validateWorkspaceDisplayTitle(title: string): string | null {
  const normalized = title.trim();
  if (!normalized) return "Enter a display title.";
  if (normalized.length > WORKSPACE_NOTE_MAX_TITLE) {
    return `Display titles can be at most ${WORKSPACE_NOTE_MAX_TITLE} characters.`;
  }
  if (!isCanonicalNoteTitle(normalized)) {
    return "Display titles must fit on one line.";
  }
  return null;
}

export function isWorkspaceNoteRequestCurrent(
  requestId: number,
  currentRequestId: number,
  signal: AbortSignal,
): boolean {
  return requestId === currentRequestId && !signal.aborted;
}

type StateListener = (state: WorkspaceNoteCardState) => void;

export class WorkspaceCreatedNoteCardController {
  private state: WorkspaceNoteCardState = {
    phase: "loading",
    note: null,
    pending: null,
    editing: false,
    titleDraft: "",
    titleError: null,
    confirmation: null,
    statusText: "",
  };

  private readonly listeners = new Set<StateListener>();
  private requestId = 0;
  private abortController: AbortController | null = null;
  private disposed = false;

  constructor(
    private readonly stableId: string,
    private readonly api: WorkspaceNoteApi,
    private readonly navigate: (subRoute: string) => void,
  ) {}

  getState(): WorkspaceNoteCardState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    const request = this.beginRequest();
    if (!request) return;
    this.publish({
      phase: "loading",
      pending: null,
      statusText: "Loading current note details…",
    });
    try {
      const result = await this.api.read(this.stableId, {
        signal: request.controller.signal,
      });
      if (!this.isCurrent(request)) return;
      if (result.status === "success") {
        this.applyCanonicalNote(result.note);
        this.publish({ statusText: "Current note details loaded." });
      } else {
        this.applyReadFailure(result);
      }
    } catch (error) {
      if (!this.isCurrent(request) || isAbortError(error)) return;
      this.publish({
        phase: "error",
        note: null,
        editing: false,
        confirmation: null,
        statusText: LOAD_FAILURE,
      });
    }
  }

  retry(): Promise<void> {
    return this.load();
  }

  beginTitleEdit(): void {
    if (!this.state.note || this.state.pending) return;
    this.publish({
      editing: true,
      titleDraft: this.state.note.title,
      titleError: null,
      statusText: "",
    });
  }

  setTitleDraft(titleDraft: string): void {
    if (!this.state.editing || this.state.pending) return;
    this.publish({ titleDraft, titleError: null });
  }

  cancelTitleEdit(): void {
    if (!this.state.note || this.state.pending) return;
    this.publish({
      editing: false,
      titleDraft: this.state.note.title,
      titleError: null,
    });
  }

  async saveTitle(): Promise<void> {
    const note = this.state.note;
    if (!note || this.state.pending) return;
    const normalizedTitle = this.state.titleDraft.trim();
    const validationError = validateWorkspaceDisplayTitle(normalizedTitle);
    if (validationError) {
      this.publish({ titleError: validationError });
      return;
    }
    if (normalizedTitle === note.title) {
      this.publish({
        editing: false,
        titleError: null,
        statusText: "Display title is unchanged.",
      });
      return;
    }

    const request = this.beginRequest();
    if (!request) return;
    this.publish({
      pending: "title",
      titleError: null,
      statusText: "Saving display title…",
    });
    try {
      const result = await this.api.updateTitle(
        this.stableId,
        normalizedTitle,
        note.contentHash,
        { signal: request.controller.signal },
      );
      if (!this.isCurrent(request)) return;
      if (result.status === "success") {
        this.applyCanonicalNote(result.note);
        this.publish({
          editing: false,
          statusText: "Display title saved.",
        });
      } else if (result.status === "conflict") {
        await this.reconcileConflict(request);
      } else if (result.status === "absence") {
        this.applyReadFailure(result);
      } else {
        this.publish({ statusText: TITLE_FAILURE });
      }
    } catch (error) {
      if (!this.isCurrent(request) || isAbortError(error)) return;
      this.publish({ statusText: TITLE_FAILURE });
    } finally {
      if (this.isCurrent(request)) this.publish({ pending: null });
    }
  }

  selectVisibility(visibility: WorkspaceNoteVisibility): void {
    const note = this.state.note;
    if (!note || this.state.pending) return;
    this.publish({
      confirmation: visibility === note.visibility ? null : visibility,
      statusText: "",
    });
  }

  cancelVisibility(): void {
    if (this.state.pending) return;
    this.publish({ confirmation: null });
  }

  async confirmVisibility(): Promise<void> {
    const note = this.state.note;
    const target = this.state.confirmation;
    if (!note || !target || this.state.pending) return;
    const request = this.beginRequest();
    if (!request) return;
    this.publish({
      pending: "visibility",
      statusText: target === "shared"
        ? "Sharing note with CodaScope users…"
        : "Making note private…",
    });
    try {
      const result = await this.api.updateVisibility(
        this.stableId,
        target,
        note.contentHash,
        { signal: request.controller.signal },
      );
      if (!this.isCurrent(request)) return;
      if (result.status === "success") {
        this.applyCanonicalNote(result.note);
        this.publish({
          confirmation: null,
          statusText: result.note.visibility === "shared"
            ? "Note is now Shared."
            : "Note is now Private.",
        });
      } else if (result.status === "conflict") {
        await this.reconcileConflict(request);
      } else if (result.status === "absence") {
        this.applyReadFailure(result);
      } else {
        this.publish({ statusText: VISIBILITY_FAILURE });
      }
    } catch (error) {
      if (!this.isCurrent(request) || isAbortError(error)) return;
      this.publish({ statusText: VISIBILITY_FAILURE });
    } finally {
      if (this.isCurrent(request)) this.publish({ pending: null });
    }
  }

  async open(): Promise<void> {
    if (!this.state.note || this.state.pending) return;
    const request = this.beginRequest();
    if (!request) return;
    this.publish({
      pending: "open",
      statusText: "Checking the current note location…",
    });
    try {
      const result = await this.api.read(this.stableId, {
        signal: request.controller.signal,
      });
      if (!this.isCurrent(request)) return;
      if (result.status === "success") {
        this.applyCanonicalNote(result.note);
        this.publish({ statusText: "Opening note…" });
        if (this.isCurrent(request)) {
          this.navigate(buildWorkspaceNoteSubRoute(result.note));
        }
      } else {
        this.applyReadFailure(result);
      }
    } catch (error) {
      if (!this.isCurrent(request) || isAbortError(error)) return;
      this.publish({ statusText: OPEN_FAILURE });
    } finally {
      if (this.isCurrent(request)) this.publish({ pending: null });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestId += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.listeners.clear();
  }

  private beginRequest(): {
    requestId: number;
    controller: AbortController;
  } | null {
    if (this.disposed) return null;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.requestId += 1;
    return { requestId: this.requestId, controller };
  }

  private isCurrent(request: {
    requestId: number;
    controller: AbortController;
  }): boolean {
    return !this.disposed && isWorkspaceNoteRequestCurrent(
      request.requestId,
      this.requestId,
      request.controller.signal,
    );
  }

  private publish(patch: Partial<WorkspaceNoteCardState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private applyCanonicalNote(note: CanonicalWorkspaceNoteState): void {
    this.publish({
      note,
      titleDraft: note.title,
      phase: "ready",
    });
  }

  private applyReadFailure(result: WorkspaceNoteApiResult): void {
    this.publish({
      note: null,
      editing: false,
      confirmation: null,
      phase: result.status === "absence" ? "unavailable" : "error",
      statusText: result.status === "absence"
        ? "This note is archived or no longer available."
        : LOAD_FAILURE,
    });
  }

  private async reconcileConflict(request: {
    requestId: number;
    controller: AbortController;
  }): Promise<void> {
    try {
      const refreshed = await this.api.read(this.stableId, {
        signal: request.controller.signal,
      });
      if (!this.isCurrent(request)) return;
      if (refreshed.status === "success") {
        this.applyCanonicalNote(refreshed.note);
        this.publish({
          editing: false,
          confirmation: null,
          statusText: REVIEW_REQUIRED,
        });
      } else {
        this.applyReadFailure(refreshed);
      }
    } catch (error) {
      if (!this.isCurrent(request) || isAbortError(error)) return;
      this.publish({
        phase: "error",
        note: null,
        editing: false,
        confirmation: null,
        statusText: LOAD_FAILURE,
      });
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
