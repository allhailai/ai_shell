import { audioEngine } from "../audio/audioEngine";
import { DRUM_TRACK_IDS, DRUM_TRACK_LABELS, isBarEnd, MUTE_TARGET_LABELS, STEPS } from "../constants";
import type { DrumPattern, DrumTrackId } from "../types";
import { MuteToggle } from "./MuteToggle";
import { StepCell } from "./StepCell";

export interface DrumSequencerProps {
  /** Current drum lanes — 16 booleans per track from workingCopy.drums */
  pattern: DrumPattern;
  /** Per-lane mute flags from workingCopy.mutes (true = muted) */
  mutes: Record<DrumTrackId, boolean>;
  /** Active transport step (0–15), or null when stopped — playhead column highlight */
  currentStep: number | null;
  onToggleStep: (trackId: DrumTrackId, stepIndex: number) => void;
  onToggleMute: (trackId: DrumTrackId) => void;
}

/** Build screen-reader label: "Kick, step 5, on" (steps are 1-based in copy) */
function drumStepAriaLabel(trackId: DrumTrackId, stepIndex: number, isActive: boolean): string {
  const lane = DRUM_TRACK_LABELS[trackId];
  const stepNumber = stepIndex + 1;
  return `${lane}, step ${stepNumber}, ${isActive ? "on" : "off"}`;
}

/**
 * Four-lane × 16-step drum grid. Lane names preview the sound without toggling steps.
 */
export function DrumSequencer({
  pattern,
  mutes,
  currentStep,
  onToggleStep,
  onToggleMute,
}: DrumSequencerProps) {
  const stepIndices = Array.from({ length: STEPS }, (_, index) => index);

  const handlePreviewLane = (trackId: DrumTrackId) => {
    void audioEngine.previewDrum(trackId);
  };

  return (
    <section
      className="music-creator-drum-sequencer"
      aria-labelledby="music-creator-drum-heading"
    >
      <h2 id="music-creator-drum-heading" className="music-creator-section-title">
        Drums
      </h2>

      <div className="music-creator-drum-grid" role="group" aria-label="Drum pattern, 4 lanes by 16 steps">
        <div className="music-creator-drum-grid-row music-creator-sequencer-grid-row music-creator-sequencer-grid-row--header">
          <span aria-hidden="true" />
          {stepIndices.map((stepIndex) => (
            <span
              key={`header-${stepIndex}`}
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

        {DRUM_TRACK_IDS.map((trackId) => {
          const isMuted = mutes[trackId];
          const laneLabel = DRUM_TRACK_LABELS[trackId];
          return (
            <div
              key={trackId}
              className={
                isMuted
                  ? "music-creator-drum-grid-row music-creator-sequencer-grid-row music-creator-sequencer-grid-row--muted"
                  : "music-creator-drum-grid-row music-creator-sequencer-grid-row"
              }
            >
              <div className="music-creator-drum-track-label-cell">
                <MuteToggle
                  trackName={MUTE_TARGET_LABELS[trackId]}
                  isMuted={isMuted}
                  onToggle={() => onToggleMute(trackId)}
                />
                <button
                  type="button"
                  className="music-creator-preview-label music-creator-preview-label--fill music-creator-drum-track-label"
                  aria-label={`Preview ${laneLabel}`}
                  title={`Preview ${laneLabel}`}
                  onClick={() => handlePreviewLane(trackId)}
                >
                  {laneLabel}
                </button>
              </div>
              {stepIndices.map((stepIndex) => {
                const isActive = pattern[trackId][stepIndex] ?? false;
                return (
                  <StepCell
                    key={`${trackId}-${stepIndex}`}
                    isActive={isActive}
                    isPlayhead={currentStep === stepIndex}
                    isBarEnd={isBarEnd(stepIndex)}
                    ariaLabel={drumStepAriaLabel(trackId, stepIndex, isActive)}
                    onToggle={() => {
                      void audioEngine.previewDrum(trackId);
                      onToggleStep(trackId, stepIndex);
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
