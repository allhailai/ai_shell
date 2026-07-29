import {
  normalizeCanonicalProjectNoteRangeTarget,
} from "../projectNoteRangeTargetValidation";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
} from "../workspaceNoteRangeTargetValidation";
import { IconFile } from "./CodaScopeIcons";

const MESSAGE_PREVIEW_LIMIT = 240;

function normalizeTarget(value: unknown) {
  return normalizeCanonicalWorkspaceNoteRangeTarget(value)
    ?? normalizeCanonicalProjectNoteRangeTarget(value);
}

export function NoteRangeMessageReference({
  value,
}: {
  value: unknown;
}) {
  const target = normalizeTarget(value);
  if (!target) return null;
  const lines = target.startLine === target.endLine
    ? `Line ${target.startLine}`
    : `Lines ${target.startLine}–${target.endLine}`;
  const context = target.scope === "codascope"
    ? `CodaScope · ${target.path}`
    : target.scope === "epic"
      ? `Epic · ${target.path}`
      : `Project · ${target.path}`;
  const preview = target.selectedText.length > MESSAGE_PREVIEW_LIMIT
    ? `${target.selectedText.slice(0, MESSAGE_PREVIEW_LIMIT)}…`
    : target.selectedText;

  return (
    <aside
      className="codascope-note-range-message-reference"
      aria-label={`Selected range from ${target.title}`}
    >
      <div className="codascope-note-range-message-reference-heading">
        <IconFile size={12} />
        <strong title={target.title}>{target.title}</strong>
        <span>{lines}</span>
      </div>
      <small title={context}>{context}</small>
      <blockquote>{preview}</blockquote>
    </aside>
  );
}
