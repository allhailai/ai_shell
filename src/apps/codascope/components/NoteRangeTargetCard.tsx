import type { NoteRangeHandoff } from "../noteRangeHandoff";
import { IconClose, IconFile, IconSparkle } from "./CodaScopeIcons";

const PREVIEW_LIMIT = 600;

function lineLabel(startLine: number, endLine: number): string {
  return startLine === endLine
    ? `Line ${startLine}`
    : `Lines ${startLine}–${endLine}`;
}

function scopeLabel(handoff: NoteRangeHandoff): string {
  const target = handoff.target;
  if (target.scope === "codascope") return `CodaScope · ${target.path}`;
  if (target.scope === "epic") return `Epic · ${target.path}`;
  return `Project · ${target.path}`;
}

function boundedPreview(text: string): string {
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}…`
    : text;
}

export function NoteRangeTargetCard({
  handoff,
  onRemove,
  onQuickAction,
  quickActionDisabled,
}: {
  handoff: NoteRangeHandoff;
  onRemove: () => void;
  onQuickAction: () => void;
  quickActionDisabled: boolean;
}) {
  const inFlight = handoff.status === "in-flight";
  const targetScopeLabel = scopeLabel(handoff);
  return (
    <section
      className={`codascope-note-range-target-card${inFlight
        ? " codascope-note-range-target-card-in-flight"
        : ""}`}
      aria-labelledby={`note-range-target-${handoff.handoffId}`}
    >
      <div className="codascope-note-range-target-heading">
        <span className="codascope-note-range-target-icon">
          <IconSparkle size={14} />
        </span>
        <div>
          <strong id={`note-range-target-${handoff.handoffId}`}>
            Editing selection
          </strong>
          <span aria-live="polite">
            {inFlight ? "Agent edit in progress" : "Ready for an instruction"}
          </span>
        </div>
        <button
          className="codascope-note-range-target-remove"
          type="button"
          onClick={onRemove}
          disabled={inFlight}
          aria-label={`Remove selected range from ${handoff.target.title}`}
          title={inFlight ? "The selection is in progress" : "Remove selection"}
        >
          <IconClose size={13} />
        </button>
      </div>
      <div className="codascope-note-range-target-note">
        <IconFile size={13} />
        <span>
          <strong title={handoff.target.title}>{handoff.target.title}</strong>
          <small title={targetScopeLabel}>{targetScopeLabel}</small>
        </span>
        <span className="codascope-note-range-target-lines">
          {lineLabel(handoff.target.startLine, handoff.target.endLine)}
        </span>
      </div>
      <blockquote className="codascope-note-range-target-preview">
        {boundedPreview(handoff.target.selectedText)}
      </blockquote>
      <p className="codascope-note-range-target-limit">
        The agent will edit only this selection.
      </p>
      <button
        className="codascope-btn codascope-btn-primary codascope-btn-sm codascope-note-range-target-quick"
        type="button"
        onClick={onQuickAction}
        disabled={quickActionDisabled || inFlight}
        aria-label={`Apply the instruction in the selected text from ${handoff.target.title}`}
      >
        <IconSparkle size={13} />
        {inFlight ? "Working…" : "Do this"}
      </button>
    </section>
  );
}
