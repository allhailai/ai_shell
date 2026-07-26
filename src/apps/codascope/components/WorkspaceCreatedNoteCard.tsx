import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import type { CodaScopeAction } from "../codaScopeTypes";
import {
  WORKSPACE_NOTE_MAX_TITLE,
  isCanonicalNoteTitle,
  normalizeCanonicalWorkspaceMutationAction,
  type CanonicalWorkspaceNoteState,
} from "../workspaceMutationActionValidation";
import {
  createWorkspaceNoteApi,
  type WorkspaceNoteApi,
  type WorkspaceNoteApiResult,
} from "../workspaceNoteApi";
import { buildWorkspaceNoteSubRoute } from "../workspaceCreatedNote";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconFile,
  IconLaunch,
  IconRefresh,
  IconWarning,
} from "./CodaScopeIcons";

const defaultWorkspaceNoteApi = createWorkspaceNoteApi();

type CardPhase = "loading" | "ready" | "unavailable" | "error";
type PendingOperation = "title" | "visibility" | "open" | null;

interface WorkspaceCreatedNoteCardProps {
  action: CodaScopeAction;
  api?: WorkspaceNoteApi;
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

export function WorkspaceCreatedNoteCard({
  action,
  api = defaultWorkspaceNoteApi,
}: WorkspaceCreatedNoteCardProps) {
  const trustedAction = normalizeCanonicalWorkspaceMutationAction(action);
  if (!trustedAction || trustedAction.type !== "note_created") return null;
  return (
    <TrustedWorkspaceCreatedNoteCard
      key={trustedAction.attributes.stableId}
      stableId={trustedAction.attributes.stableId}
      api={api}
    />
  );
}

function TrustedWorkspaceCreatedNoteCard({
  stableId,
  api,
}: {
  stableId: string;
  api: WorkspaceNoteApi;
}) {
  const { navigate } = useAppSubRoute("codascope");
  const titleInputId = useId();
  const [phase, setPhase] = useState<CardPhase>("loading");
  const [note, setNote] = useState<CanonicalWorkspaceNoteState | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<
    "private" | "shared" | null
  >(null);
  const [statusText, setStatusText] = useState("");
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const beginRequest = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    controllerRef.current = controller;
    return { controller, requestId };
  }, []);

  const isCurrent = useCallback((
    requestId: number,
    controller: AbortController,
  ) => isWorkspaceNoteRequestCurrent(
    requestId,
    requestIdRef.current,
    controller.signal,
  ), []);

  const applyCanonicalNote = useCallback((
    canonical: CanonicalWorkspaceNoteState,
  ) => {
    setNote(canonical);
    setTitleDraft(canonical.title);
    setPhase("ready");
  }, []);

  const applyReadFailure = useCallback((result: WorkspaceNoteApiResult) => {
    setNote(null);
    setEditing(false);
    setConfirmation(null);
    if (result.status === "absence") {
      setPhase("unavailable");
      setStatusText("This note is archived or no longer available.");
      return;
    }
    setPhase("error");
    setStatusText(
      result.status === "failure"
        ? result.message
        : "The note could not be loaded. Please try again.",
    );
  }, []);

  const loadNote = useCallback(async () => {
    const { controller, requestId } = beginRequest();
    setPhase("loading");
    setPending(null);
    setStatusText("Loading current note details…");
    try {
      const result = await api.read(stableId, { signal: controller.signal });
      if (!isCurrent(requestId, controller)) return;
      if (result.status === "success") {
        applyCanonicalNote(result.note);
        setStatusText("Current note details loaded.");
      } else {
        applyReadFailure(result);
      }
    } catch (error) {
      if (!isCurrent(requestId, controller)
        || (error instanceof Error && error.name === "AbortError")) return;
      setPhase("error");
      setStatusText("The note could not be loaded. Please try again.");
    }
  }, [
    api,
    applyCanonicalNote,
    applyReadFailure,
    beginRequest,
    isCurrent,
    stableId,
  ]);

  useEffect(() => {
    void loadNote();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [loadNote]);

  const reconcileConflict = useCallback(async (
    requestId: number,
    controller: AbortController,
  ) => {
    const refreshed = await api.read(stableId, { signal: controller.signal });
    if (!isCurrent(requestId, controller)) return;
    if (refreshed.status === "success") {
      applyCanonicalNote(refreshed.note);
      setEditing(false);
      setConfirmation(null);
      setStatusText(
        "This note changed elsewhere. Review the latest details before retrying.",
      );
    } else {
      applyReadFailure(refreshed);
    }
  }, [
    api,
    applyCanonicalNote,
    applyReadFailure,
    isCurrent,
    stableId,
  ]);

  const saveTitle = useCallback(async () => {
    if (!note || pending) return;
    const normalizedTitle = titleDraft.trim();
    const validationError = validateWorkspaceDisplayTitle(normalizedTitle);
    if (validationError) {
      setTitleError(validationError);
      return;
    }
    if (normalizedTitle === note.title) {
      setEditing(false);
      setTitleError(null);
      setStatusText("Display title is unchanged.");
      return;
    }

    const { controller, requestId } = beginRequest();
    setPending("title");
    setTitleError(null);
    setStatusText("Saving display title…");
    try {
      const result = await api.updateTitle(
        stableId,
        normalizedTitle,
        note.contentHash,
        { signal: controller.signal },
      );
      if (!isCurrent(requestId, controller)) return;
      if (result.status === "success") {
        applyCanonicalNote(result.note);
        setEditing(false);
        setStatusText("Display title saved.");
      } else if (result.status === "conflict") {
        await reconcileConflict(requestId, controller);
      } else if (result.status === "absence") {
        applyReadFailure(result);
      } else {
        setStatusText(result.message);
      }
    } catch (error) {
      if (!isCurrent(requestId, controller)
        || (error instanceof Error && error.name === "AbortError")) return;
      setStatusText("The display title could not be saved. Please try again.");
    } finally {
      if (isCurrent(requestId, controller)) setPending(null);
    }
  }, [
    applyCanonicalNote,
    applyReadFailure,
    beginRequest,
    isCurrent,
    note,
    pending,
    reconcileConflict,
    stableId,
    titleDraft,
    api,
  ]);

  const confirmVisibility = useCallback(async () => {
    if (!note || !confirmation || pending) return;
    const target = confirmation;
    const { controller, requestId } = beginRequest();
    setPending("visibility");
    setStatusText(
      target === "shared"
        ? "Sharing note with CodaScope users…"
        : "Making note private…",
    );
    try {
      const result = await api.updateVisibility(
        stableId,
        target,
        note.contentHash,
        { signal: controller.signal },
      );
      if (!isCurrent(requestId, controller)) return;
      if (result.status === "success") {
        applyCanonicalNote(result.note);
        setConfirmation(null);
        setStatusText(
          result.note.visibility === "shared"
            ? "Note is now Shared."
            : "Note is now Private.",
        );
      } else if (result.status === "conflict") {
        await reconcileConflict(requestId, controller);
      } else if (result.status === "absence") {
        applyReadFailure(result);
      } else {
        setStatusText(result.message);
      }
    } catch (error) {
      if (!isCurrent(requestId, controller)
        || (error instanceof Error && error.name === "AbortError")) return;
      setStatusText("Visibility could not be changed. Please try again.");
    } finally {
      if (isCurrent(requestId, controller)) setPending(null);
    }
  }, [
    api,
    applyCanonicalNote,
    applyReadFailure,
    beginRequest,
    confirmation,
    isCurrent,
    note,
    pending,
    reconcileConflict,
    stableId,
  ]);

  const openNote = useCallback(async () => {
    if (!note || pending) return;
    const { controller, requestId } = beginRequest();
    setPending("open");
    setStatusText("Checking the current note location…");
    try {
      const result = await api.read(stableId, { signal: controller.signal });
      if (!isCurrent(requestId, controller)) return;
      if (result.status === "success") {
        applyCanonicalNote(result.note);
        setStatusText("Opening note…");
        navigate(buildWorkspaceNoteSubRoute(result.note));
      } else {
        applyReadFailure(result);
      }
    } catch (error) {
      if (!isCurrent(requestId, controller)
        || (error instanceof Error && error.name === "AbortError")) return;
      setStatusText("The note could not be opened. Please try again.");
    } finally {
      if (isCurrent(requestId, controller)) setPending(null);
    }
  }, [
    api,
    applyCanonicalNote,
    applyReadFailure,
    beginRequest,
    isCurrent,
    navigate,
    note,
    pending,
    stableId,
  ]);

  return (
    <article className="codascope-created-note-card">
      <header className="codascope-created-note-card-header">
        <span className="codascope-created-note-card-icon">
          <IconFile size={15} />
        </span>
        <div>
          <strong>Note created</strong>
          <span className="codascope-created-note-card-scope">
            CodaScope Notes
          </span>
        </div>
        <span className="codascope-created-note-card-badge">
          <IconCheck size={12} /> Completed
        </span>
      </header>

      {phase === "loading" && (
        <div className="codascope-created-note-card-state">
          <span className="codascope-action-card-spinner" />
          Loading current note details…
        </div>
      )}

      {(phase === "error" || phase === "unavailable") && (
        <div className="codascope-created-note-card-state">
          <IconWarning size={14} />
          <span>{statusText}</span>
          <button
            className="codascope-created-note-card-btn"
            onClick={() => void loadNote()}
            type="button"
            aria-label="Retry loading created note"
          >
            <IconRefresh size={13} /> Retry
          </button>
          {phase === "unavailable" && (
            <button
              className="codascope-created-note-card-btn"
              type="button"
              disabled
              aria-label="Open created note (unavailable)"
            >
              <IconLaunch size={13} /> Open
            </button>
          )}
        </div>
      )}

      {phase === "ready" && note && (
        <>
          <div className="codascope-created-note-card-title-row">
            {editing ? (
              <form
                className="codascope-created-note-card-title-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTitle();
                }}
              >
                <label
                  className="codascope-created-note-card-label"
                  htmlFor={titleInputId}
                >
                  Display title
                </label>
                <input
                  id={titleInputId}
                  className="codascope-created-note-card-title-input"
                  value={titleDraft}
                  maxLength={WORKSPACE_NOTE_MAX_TITLE}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    setTitleError(null);
                  }}
                  disabled={pending !== null}
                  autoFocus
                />
                <div className="codascope-created-note-card-controls">
                  <button
                    className="codascope-created-note-card-btn codascope-created-note-card-btn-primary"
                    type="submit"
                    disabled={pending !== null}
                    aria-label="Save note display title"
                  >
                    <IconCheck size={13} />
                    {pending === "title" ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="codascope-created-note-card-btn"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => {
                      setTitleDraft(note.title);
                      setTitleError(null);
                      setEditing(false);
                    }}
                    aria-label="Cancel note title editing"
                  >
                    <IconClose size={13} /> Cancel
                  </button>
                </div>
                {titleError && (
                  <span className="codascope-created-note-card-error">
                    {titleError}
                  </span>
                )}
              </form>
            ) : (
              <>
                <div>
                  <span className="codascope-created-note-card-label">
                    Display title
                  </span>
                  <strong className="codascope-created-note-card-title">
                    {note.title}
                  </strong>
                </div>
                <button
                  className="codascope-created-note-card-icon-btn"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setTitleDraft(note.title);
                    setEditing(true);
                    setStatusText("");
                  }}
                  aria-label={`Edit display title for ${note.title}`}
                >
                  <IconEdit size={14} />
                </button>
              </>
            )}
          </div>

          <fieldset
            className="codascope-created-note-card-visibility"
            disabled={pending !== null}
          >
            <legend className="codascope-created-note-card-label">
              Visibility
            </legend>
            <div className="codascope-created-note-card-segments">
              {(["private", "shared"] as const).map((visibility) => (
                <button
                  key={visibility}
                  className={`codascope-created-note-card-segment${
                    note.visibility === visibility
                      ? " codascope-created-note-card-segment-active"
                      : ""
                  }`}
                  type="button"
                  aria-pressed={note.visibility === visibility}
                  aria-label={`Set note visibility to ${visibility}`}
                  onClick={() => {
                    if (note.visibility !== visibility) {
                      setConfirmation(visibility);
                      setStatusText("");
                    }
                  }}
                >
                  {visibility === "private" ? "Private" : "Shared"}
                </button>
              ))}
            </div>
          </fieldset>

          {confirmation && confirmation !== note.visibility && (
            <div
              className="codascope-created-note-card-confirmation"
              role="alert"
            >
              <IconWarning size={14} />
              <span>
                {confirmation === "shared"
                  ? "This note will become visible to all CodaScope users."
                  : "Existing CodaScope users will lose access to this note."}
              </span>
              <div className="codascope-created-note-card-controls">
                <button
                  className="codascope-created-note-card-btn codascope-created-note-card-btn-primary"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void confirmVisibility()}
                  aria-label={`Confirm ${confirmation} note visibility`}
                >
                  <IconCheck size={13} />
                  {pending === "visibility" ? "Changing…" : "Confirm"}
                </button>
                <button
                  className="codascope-created-note-card-btn"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => setConfirmation(null)}
                  aria-label="Cancel note visibility change"
                >
                  <IconClose size={13} /> Cancel
                </button>
              </div>
            </div>
          )}

          <footer className="codascope-created-note-card-footer">
            <span
              className="codascope-created-note-card-status"
              aria-live="polite"
            >
              {statusText}
            </span>
            <button
              className="codascope-created-note-card-btn codascope-created-note-card-btn-primary"
              type="button"
              disabled={pending !== null}
              onClick={() => void openNote()}
              aria-label={`Open ${note.title}`}
            >
              <IconLaunch size={13} />
              {pending === "open" ? "Opening…" : "Open"}
            </button>
          </footer>
        </>
      )}
    </article>
  );
}
