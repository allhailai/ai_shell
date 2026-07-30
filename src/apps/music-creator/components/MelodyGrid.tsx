import { audioEngine } from "../audio/audioEngine";
import {
  isBarEnd,
  isBlackKeyRow,
  MELODY_NOTE_LABELS,
  MELODY_SCALE_MIDI,
  MUTE_TARGET_LABELS,
  STEPS,
} from "../constants";
import type { MelodyPattern } from "../types";
import { MuteToggle } from "./MuteToggle";
import { StepCell } from "./StepCell";

export interface MelodyGridProps {
  /** 16-step monophonic line — MIDI note or null per step from workingCopy.melody */
  pattern: MelodyPattern;
  /** workingCopy.mutes.melody — true silences melody at playback (M4) */
  isMelodyMuted: boolean;
  /** Active transport step (0–15), or null when stopped — playhead column highlight */
  currentStep: number | null;
  onToggleNote: (rowIndex: number, stepIndex: number) => void;
  onToggleMelodyMute: () => void;
}

/** Screen-reader label: "G4, step 5, on" (steps are 1-based in copy) */
function melodyStepAriaLabel(rowIndex: number, stepIndex: number, isActive: boolean): string {
  const pitch = MELODY_NOTE_LABELS[rowIndex];
  const stepNumber = stepIndex + 1;
  return `${pitch}, step ${stepNumber}, ${isActive ? "on" : "off"}`;
}

/**
 * Chromatic melody grid (C4–C5, sharps) × 16 steps. Monophonic: at most one row lit
 * per column. Row labels preview the pitch without changing the pattern.
 */
export function MelodyGrid({
  pattern,
  isMelodyMuted,
  currentStep,
  onToggleNote,
  onToggleMelodyMute,
}: MelodyGridProps) {
  const stepIndices = Array.from({ length: STEPS }, (_, index) => index);
  const rowIndices = Array.from({ length: MELODY_SCALE_MIDI.length }, (_, index) => index);
  // Piano-roll style: highest pitch (C5) at top, lowest (C4) at bottom.
  const displayRowIndices = [...rowIndices].reverse();

  const handlePreviewPitch = (rowIndex: number) => {
    const midi = MELODY_SCALE_MIDI[rowIndex];
    if (midi === undefined) return;
    void audioEngine.previewMelody(midi);
  };

  return (
    <section
      className="music-creator-melody-sequencer"
      aria-labelledby="music-creator-melody-heading"
    >
      <div className="music-creator-section-header-row">
        <h2 id="music-creator-melody-heading" className="music-creator-section-title">
          Melody
        </h2>
        <MuteToggle
          trackName={MUTE_TARGET_LABELS.melody}
          isMuted={isMelodyMuted}
          onToggle={onToggleMelodyMute}
        />
      </div>
      <p className="music-creator-muted music-creator-melody-hint">
        One note per step — click a row or cell to set a pitch and hear it.
        Sharps (dark rows) and naturals (light rows) follow a piano layout.
      </p>

      <div
        className={
          isMelodyMuted
            ? "music-creator-melody-grid music-creator-melody-grid--muted"
            : "music-creator-melody-grid"
        }
        role="group"
        aria-label="Melody pattern, chromatic C4 to C5 by 16 steps"
      >
        <div className="music-creator-melody-grid-row music-creator-sequencer-grid-row music-creator-sequencer-grid-row--header">
          <span aria-hidden="true" />
          {stepIndices.map((stepIndex) => (
            <span
              key={`melody-header-${stepIndex}`}
              className={[
                "music-creator-sequencer-step-header",
                currentStep === stepIndex ? "music-creator-sequencer-step-header--playhead" : "",
                isBarEnd(stepIndex) ? "music-creator-sequencer-step-header--bar-end" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            >
              {stepIndex + 1}
            </span>
          ))}
        </div>

        {displayRowIndices.map((rowIndex) => {
          const pitchLabel = MELODY_NOTE_LABELS[rowIndex];
          const isBlackKey = isBlackKeyRow(rowIndex);
          return (
            <div
              key={pitchLabel}
              className={[
                "music-creator-melody-grid-row",
                "music-creator-sequencer-grid-row",
                isBlackKey ? "music-creator-melody-grid-row--black-key" : "music-creator-melody-grid-row--white-key",
              ].join(" ")}
            >
              <button
                type="button"
                className={[
                  "music-creator-preview-label",
                  "music-creator-preview-label--fill",
                  "music-creator-melody-pitch-label",
                  isBlackKey ? "music-creator-preview-label--black-key" : "music-creator-preview-label--white-key",
                ].join(" ")}
                aria-label={`Preview ${pitchLabel}`}
                title={`Preview ${pitchLabel}`}
                onClick={() => handlePreviewPitch(rowIndex)}
              >
                {pitchLabel}
              </button>
              {stepIndices.map((stepIndex) => {
                const midiNote = MELODY_SCALE_MIDI[rowIndex];
                const isActive = pattern[stepIndex] === midiNote;
                return (
                  <StepCell
                    key={`${rowIndex}-${stepIndex}`}
                    isActive={isActive}
                    isPlayhead={currentStep === stepIndex}
                    isBarEnd={isBarEnd(stepIndex)}
                    pianoKeyStyle={isBlackKey ? "black" : "white"}
                    ariaLabel={melodyStepAriaLabel(rowIndex, stepIndex, isActive)}
                    onToggle={() => {
                      void audioEngine.previewMelody(midiNote);
                      onToggleNote(rowIndex, stepIndex);
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
