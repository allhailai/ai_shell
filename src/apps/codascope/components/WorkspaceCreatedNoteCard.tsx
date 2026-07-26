import {
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import type { CodaScopeAction } from "../codaScopeTypes";
import {
  WORKSPACE_NOTE_MAX_TITLE,
  normalizeCanonicalWorkspaceMutationAction,
} from "../workspaceMutationActionValidation";
import {
  createWorkspaceNoteApi,
  type WorkspaceNoteApi,
} from "../workspaceNoteApi";
import {
  WorkspaceCreatedNoteCardController,
  visibilityConfirmationMessage,
} from "../workspaceCreatedNoteCardController";
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

interface WorkspaceCreatedNoteCardProps {
  action: CodaScopeAction;
  api?: WorkspaceNoteApi;
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
  const controller = useMemo(
    () => new WorkspaceCreatedNoteCardController(stableId, api, navigate),
    [api, navigate, stableId],
  );
  const [state, setState] = useState(controller.getState());

  useEffect(() => {
    setState(controller.getState());
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const {
    phase,
    note,
    pending,
    editing,
    titleDraft,
    titleError,
    confirmation,
    statusText,
  } = state;

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
            onClick={() => void controller.retry()}
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
                  void controller.saveTitle();
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
                    controller.setTitleDraft(event.target.value);
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
                      controller.cancelTitleEdit();
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
                    controller.beginTitleEdit();
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
                    controller.selectVisibility(visibility);
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
                {visibilityConfirmationMessage(confirmation)}
              </span>
              <div className="codascope-created-note-card-controls">
                <button
                  className="codascope-created-note-card-btn codascope-created-note-card-btn-primary"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void controller.confirmVisibility()}
                  aria-label={`Confirm ${confirmation} note visibility`}
                >
                  <IconCheck size={13} />
                  {pending === "visibility" ? "Changing…" : "Confirm"}
                </button>
                <button
                  className="codascope-created-note-card-btn"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => controller.cancelVisibility()}
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
              onClick={() => void controller.open()}
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
