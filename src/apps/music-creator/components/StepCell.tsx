export interface StepCellProps {
  /** Whether this step is active (hit / note on) */
  isActive: boolean;
  /** Current transport step column — playhead highlight while playing (M4) */
  isPlayhead?: boolean;
  /** Right border after steps 3, 7, 11 — 4-bar visual grouping (not after the last column) */
  isBarEnd?: boolean;
  /** When set, inactive cells use piano white/black key backgrounds (melody rows only) */
  pianoKeyStyle?: "white" | "black";
  /** Full accessible name, e.g. "Kick, step 5, on" */
  ariaLabel: string;
  onToggle: () => void;
}

/**
 * One sequencer step — native button (not ARIA grid) per plan M3 a11y.
 * Wrapper spans the full grid column so bar dividers align with step headers.
 */
export function StepCell({
  isActive,
  isPlayhead = false,
  isBarEnd = false,
  pianoKeyStyle,
  ariaLabel,
  onToggle,
}: StepCellProps) {
  const wrapClasses = ["music-creator-step-cell-wrap"];
  if (isBarEnd) wrapClasses.push("music-creator-step-cell-wrap--bar-end");

  const classNames = ["music-creator-step-cell"];
  if (isActive) classNames.push("music-creator-step-cell--active");
  if (isPlayhead) classNames.push("music-creator-step-cell--playhead");
  if (!isActive && pianoKeyStyle) {
    classNames.push(
      pianoKeyStyle === "black"
        ? "music-creator-step-cell--black-key"
        : "music-creator-step-cell--white-key",
    );
  }

  return (
    <div className={wrapClasses.join(" ")}>
      <button
        type="button"
        className={classNames.join(" ")}
        aria-label={ariaLabel}
        aria-pressed={isActive}
        onClick={onToggle}
      />
    </div>
  );
}
