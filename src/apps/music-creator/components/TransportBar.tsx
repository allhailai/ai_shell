import { useEffect, useState } from "react";
import { TEMPO_MAX, TEMPO_MIN } from "../constants";

function clampTempo(value: number): number {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(value)));
}

interface TempoControlsProps {
  tempo: number;
  onTempoChange: (tempo: number) => void;
  sliderId: string;
  numberId: string;
}

/** Slider for coarse adjustment + number field for precise BPM entry */
function TempoControls({ tempo, onTempoChange, sliderId, numberId }: TempoControlsProps) {
  const [draft, setDraft] = useState(String(tempo));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraft(String(tempo));
    }
  }, [isEditing, tempo]);

  const commitDraft = () => {
    if (draft.trim() === "") {
      setIsEditing(false);
      return;
    }

    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onTempoChange(clampTempo(parsed));
    }
    setIsEditing(false);
  };

  return (
    <div className="music-creator-transport-tempo-row">
      <input
        id={sliderId}
        type="range"
        className="music-creator-transport-tempo-slider"
        min={TEMPO_MIN}
        max={TEMPO_MAX}
        step={1}
        value={tempo}
        onChange={(event) => onTempoChange(Number(event.target.value))}
        aria-valuemin={TEMPO_MIN}
        aria-valuemax={TEMPO_MAX}
        aria-valuenow={tempo}
        aria-valuetext={`${tempo} beats per minute`}
      />
      <div className="music-creator-transport-tempo-input-wrap">
        <input
          id={numberId}
          type="number"
          className="music-creator-input music-creator-transport-tempo-number"
          min={TEMPO_MIN}
          max={TEMPO_MAX}
          step={1}
          inputMode="numeric"
          value={isEditing ? draft : tempo}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setIsEditing(true);
            setDraft(String(tempo));
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraft(String(tempo));
              setIsEditing(false);
              event.currentTarget.blur();
            }
          }}
          aria-label={`Tempo in beats per minute (${TEMPO_MIN} to ${TEMPO_MAX})`}
        />
        <span className="music-creator-transport-tempo-unit" aria-hidden="true">
          BPM
        </span>
      </div>
    </div>
  );
}

export interface TransportBarProps {
  name: string;
  tempo: number;
  /** True when workingCopy differs from last saved state — drives Save affordance */
  isDirty: boolean;
  /** Transport running — toggles Play vs Stop icon (M4) */
  isPlaying: boolean;
  onNameChange: (name: string) => void;
  onTempoChange: (tempo: number) => void;
  /** Single transport control — Studio starts or stops audioEngine */
  onTogglePlayback: () => void;
  /** Wired by Studio — persists workingCopy via router saveStore */
  onSave: () => void;
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5-9-5.5z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Shell topbar transport — Play/Stop, name, tempo, Save (rendered via headerItems).
 */
export function TransportBar({
  name,
  tempo,
  isDirty,
  isPlaying,
  onNameChange,
  onTempoChange,
  onTogglePlayback,
  onSave,
}: TransportBarProps) {
  const tempoSliderId = "music-creator-header-tempo-slider";
  const tempoNumberId = "music-creator-header-tempo-number";
  const nameInputId = "music-creator-header-name";

  return (
    <div
      className="music-creator-transport"
      role="toolbar"
      aria-label="Transport and project settings"
    >
      <div className="music-creator-transport-playback" aria-label="Playback">
        <button
          type="button"
          className="music-creator-btn music-creator-btn-secondary music-creator-transport-btn"
          aria-label={isPlaying ? "Stop playback" : "Play pattern"}
          onClick={onTogglePlayback}
        >
          {isPlaying ? <StopIcon /> : <PlayIcon />}
          <span className="music-creator-transport-btn-label">{isPlaying ? "Stop" : "Play"}</span>
        </button>
      </div>

      <div className="music-creator-transport-fields">
        <div className="music-creator-transport-field">
          <label className="music-creator-transport-label" htmlFor={nameInputId}>
            Project name
          </label>
          <input
            id={nameInputId}
            type="text"
            className="music-creator-input music-creator-transport-name-input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="music-creator-transport-field music-creator-transport-tempo-field">
          <label className="music-creator-transport-label" htmlFor={tempoNumberId}>
            Tempo ({TEMPO_MIN}–{TEMPO_MAX} BPM)
          </label>
          <TempoControls
            tempo={tempo}
            onTempoChange={onTempoChange}
            sliderId={tempoSliderId}
            numberId={tempoNumberId}
          />
        </div>
      </div>

      <div className="music-creator-transport-save">
        <span
          className="music-creator-transport-dirty"
          aria-live="polite"
          aria-atomic="true"
        >
          {isDirty ? "Unsaved changes" : "Saved"}
        </span>
        <button
          type="button"
          className="music-creator-btn music-creator-btn-primary"
          onClick={onSave}
          disabled={!isDirty}
          aria-label={isDirty ? "Save project" : "Save project (no changes)"}
        >
          Save
        </button>
      </div>
    </div>
  );
}
