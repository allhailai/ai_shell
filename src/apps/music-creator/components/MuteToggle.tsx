export interface MuteToggleProps {
  /** Track name for labels, e.g. "Kick" or "Melody" */
  trackName: string;
  /** true = track silenced at playback (M4); stored on workingCopy.mutes */
  isMuted: boolean;
  onToggle: () => void;
}

/**
 * Per-track mute control — aria-pressed when muted so screen readers match DAW convention.
 * Pattern editing stays enabled while muted; audio engine respects mutes in M4.
 */
export function MuteToggle({ trackName, isMuted, onToggle }: MuteToggleProps) {
  return (
    <button
      type="button"
      className={
        isMuted
          ? "music-creator-mute-toggle music-creator-mute-toggle--muted"
          : "music-creator-mute-toggle"
      }
      aria-pressed={isMuted}
      aria-label={isMuted ? `Unmute ${trackName}` : `Mute ${trackName}`}
      title={isMuted ? `Unmute ${trackName}` : `Mute ${trackName}`}
      onClick={onToggle}
    >
      M
    </button>
  );
}
