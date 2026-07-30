import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "../audio/audioEngine";
import { ConfirmLeaveStudioDialog } from "../components/ConfirmLeaveStudioDialog";
import { DrumSequencer } from "../components/DrumSequencer";
import { MelodyGrid } from "../components/MelodyGrid";
import { DEFAULT_PROJECT_NAME, MELODY_SCALE_MIDI, TEMPO_MAX, TEMPO_MIN } from "../constants";
import { createEmptyProject } from "../project/createProject";
import { areStudioEditsEqual } from "../project/projectUtils";
import { registerStudioLeaveGuard, tryLeaveStudio } from "../routing/leaveGuard";
import {
  clearStudioSession,
  registerStudioSessionActions,
  setStudioSession,
} from "../routing/studioSession";
import { useDirtyBeforeUnload } from "../routing/useDirtyBeforeUnload";
import type { DrumTrackId, MusicProject, MuteTargetId } from "../types";

export type StudioSaveResult =
  | { ok: true }
  | { ok: false; message: string };

export interface StudioProps {
  projectId: string;
  /** Persisted project from the store */
  savedProject?: MusicProject;
  /** Writes workingCopy to localStorage; router refreshes savedProject on success */
  onSaveProject: (project: MusicProject) => StudioSaveResult;
  onBackToProjects: () => void;
}

/**
 * Unified music workspace.
 *
 * Router passes `savedProject` when the URL id exists in localStorage.
 * Edits live in `workingCopy` until Save (explicit — hub rename still saves immediately).
 *
 * Playback (M4): Studio owns `isPlaying` / `currentStep` React state; `audioEngine`
 * owns Tone nodes and Transport schedule. Pattern/mute edits during playback call
 * `audioEngine.updatePattern` so the grid stays audible while playing.
 */
export function Studio({
  projectId,
  savedProject,
  onSaveProject,
  onBackToProjects,
}: StudioProps) {
  // workingCopy: editable in-memory project — cloned from disk on mount / id change
  const [workingCopy, setWorkingCopy] = useState<MusicProject>(() =>
    resolveInitialWorkingCopy(projectId, savedProject),
  );
  const savedBaseline = useMemo(
    () => resolveInitialWorkingCopy(projectId, savedProject),
    [projectId, savedProject],
  );
  // Derived — true when editable fields differ from last saved / load snapshot
  const isDirty = useMemo(
    () => !areStudioEditsEqual(workingCopy, savedBaseline),
    [workingCopy, savedBaseline],
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  // Playback UI — engine callbacks update these; synths stay in audioEngine module
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  /** Ignores engine onStep(0) fired during stop — playhead hides when not playing */
  const playbackActiveRef = useRef(false);

  // When parent refreshes store after Save (or project id changes), sync from disk.
  useEffect(() => {
    setWorkingCopy(resolveInitialWorkingCopy(projectId, savedProject));
    setSaveError(null);
  }, [projectId, savedProject]);

  // Full teardown when switching projects (4.5)
  useEffect(() => {
    playbackActiveRef.current = false;
    audioEngine.dispose();
    setIsPlaying(false);
    setCurrentStep(null);
  }, [projectId]);

  // Leaving Studio (hub, browser back, another app) — silence audio and free synths
  useEffect(() => {
    return () => {
      audioEngine.dispose();
    };
  }, []);

  // Live pattern — push grid/mute edits to the engine while Transport runs
  useEffect(() => {
    if (!isPlaying) return;
    audioEngine.updatePattern({
      drums: workingCopy.drums,
      melody: workingCopy.melody,
      mutes: workingCopy.mutes,
    });
  }, [isPlaying, workingCopy.drums, workingCopy.melody, workingCopy.mutes]);

  const updateWorkingCopy = useCallback((updater: (prev: MusicProject) => MusicProject) => {
    setWorkingCopy((prev) => updater(prev));
    setSaveError(null);
  }, []);

  const handleNameChange = useCallback(
    (name: string) => {
      updateWorkingCopy((prev) => ({ ...prev, name }));
    },
    [updateWorkingCopy],
  );

  const handleTempoChange = useCallback(
    (tempo: number) => {
      const clamped = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, tempo));
      updateWorkingCopy((prev) => ({ ...prev, tempo: clamped }));
      // Live BPM — Transport schedule stays; only step rate changes (M4)
      if (isPlayingRef.current) {
        audioEngine.setTempo(clamped);
      }
    },
    [updateWorkingCopy],
  );

  /**
   * Start playback from the current workingCopy. Pattern edits while playing
   * flow through updatePattern (see effect above).
   */
  const handlePlay = useCallback(async () => {
    playbackActiveRef.current = true;
    setIsPlaying(true);

    try {
      const snapshot = structuredClone(workingCopy);
      await audioEngine.play(snapshot, {
        onStep: (stepIndex) => {
          if (playbackActiveRef.current) {
            setCurrentStep(stepIndex);
          }
        },
      });
    } catch {
      playbackActiveRef.current = false;
      setIsPlaying(false);
      setCurrentStep(null);
    }
  }, [workingCopy]);

  const handleStop = useCallback(() => {
    playbackActiveRef.current = false;
    audioEngine.stop();
    setIsPlaying(false);
    setCurrentStep(null);
  }, []);

  const handleTogglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      handleStop();
      return;
    }
    void handlePlay();
  }, [handlePlay, handleStop]);

  /** Toggle one drum cell — clones the lane array so React sees an immutable update */
  const handleDrumToggle = useCallback(
    (trackId: DrumTrackId, stepIndex: number) => {
      updateWorkingCopy((prev) => {
        const lane = [...prev.drums[trackId]];
        lane[stepIndex] = !lane[stepIndex];
        return {
          ...prev,
          drums: {
            ...prev.drums,
            [trackId]: lane,
          },
        };
      });
    },
    [updateWorkingCopy],
  );

  /**
   * Monophonic melody toggle — workingCopy.melody[step] holds one MIDI note or null.
   * Clicking the active pitch in a column clears it; clicking another pitch replaces it.
   */
  const handleMelodyToggle = useCallback(
    (rowIndex: number, stepIndex: number) => {
      updateWorkingCopy((prev) => {
        const melody = [...prev.melody];
        const note = MELODY_SCALE_MIDI[rowIndex];
        melody[stepIndex] = melody[stepIndex] === note ? null : note;
        return { ...prev, melody };
      });
    },
    [updateWorkingCopy],
  );

  /** Flip one entry in workingCopy.mutes — persisted on Save */
  const handleMuteToggle = useCallback(
    (targetId: MuteTargetId) => {
      updateWorkingCopy((prev) => ({
        ...prev,
        mutes: {
          ...prev.mutes,
          [targetId]: !prev.mutes[targetId],
        },
      }));
    },
    [updateWorkingCopy],
  );

  const handleSave = useCallback(() => {
    const trimmed = workingCopy.name.trim();
    if (!trimmed) {
      setSaveError("Project name cannot be empty.");
      return;
    }

    const result = onSaveProject(workingCopy);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }

    setSaveError(null);
    // isDirty clears when parent refreshStore updates savedProject prop
  }, [onSaveProject, workingCopy]);

  // Publish transport state to shell topbar (separate React tree via studioSession).
  useEffect(() => {
    registerStudioSessionActions({
      onNameChange: handleNameChange,
      onTempoChange: handleTempoChange,
      onTogglePlayback: handleTogglePlayback,
      onSave: handleSave,
    });
    return () => registerStudioSessionActions(null);
  }, [handleNameChange, handleTempoChange, handleTogglePlayback, handleSave]);

  useEffect(() => {
    setStudioSession({
      active: true,
      projectId,
      name: workingCopy.name,
      tempo: workingCopy.tempo,
      isDirty,
      isPlaying,
    });
  }, [projectId, workingCopy.name, workingCopy.tempo, isDirty, isPlaying]);

  useEffect(() => {
    return () => clearStudioSession();
  }, []);

  const handleBackToProjects = useCallback(() => {
    tryLeaveStudio(onBackToProjects);
  }, [onBackToProjects]);

  // Register leave guard for left nav (separate manifest region from this tree).
  useEffect(() => {
    registerStudioLeaveGuard({
      getIsDirty: () => isDirtyRef.current,
      confirmLeave: (proceed) => setPendingLeave(() => proceed),
    });
    return () => registerStudioLeaveGuard(null);
  }, []);

  useDirtyBeforeUnload(isDirty);

  const displayName = workingCopy.name.trim() || DEFAULT_PROJECT_NAME;

  return (
    <div
      className="music-creator-page music-creator-studio"
      role="region"
      aria-labelledby="music-creator-studio-heading"
    >
      <div className="music-creator-studio-inner">
        <header className="music-creator-studio-header">
          <div className="music-creator-studio-header-row">
            <button
              type="button"
              className="music-creator-btn music-creator-btn-ghost"
              onClick={handleBackToProjects}
            >
              All projects
            </button>
            <h1 id="music-creator-studio-heading" className="music-creator-title music-creator-title-sm">
              Studio
            </h1>
          </div>
          <p className="music-creator-muted">
            Project: <strong>{displayName}</strong> · ID{" "}
            <code className="music-creator-code">{projectId}</code>
          </p>
        </header>

        {saveError ? (
          <div className="music-creator-banner music-creator-banner--error" role="alert">
            <p className="music-creator-banner-text">{saveError}</p>
            <button
              type="button"
              className="music-creator-btn music-creator-btn-ghost music-creator-banner-dismiss"
              onClick={() => setSaveError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="music-creator-sequencer-stack">
          <DrumSequencer
            pattern={workingCopy.drums}
            mutes={workingCopy.mutes}
            currentStep={currentStep}
            onToggleStep={handleDrumToggle}
            onToggleMute={(trackId) => handleMuteToggle(trackId)}
          />

          <MelodyGrid
            pattern={workingCopy.melody}
            isMelodyMuted={workingCopy.mutes.melody}
            currentStep={currentStep}
            onToggleNote={handleMelodyToggle}
            onToggleMelodyMute={() => handleMuteToggle("melody")}
          />
        </div>
      </div>

      {pendingLeave ? (
        <ConfirmLeaveStudioDialog
          onStay={() => setPendingLeave(null)}
          onLeaveWithoutSaving={() => {
            const proceed = pendingLeave;
            setPendingLeave(null);
            proceed();
          }}
        />
      ) : null}
    </div>
  );
}

/** Resolve the initial working copy from the saved project or create an empty project. */
function resolveInitialWorkingCopy(
  projectId: string,
  savedProject: MusicProject | undefined,
): MusicProject {
  if (savedProject) {
    // structuredClone keeps nested drum/melody arrays independent of store snapshot
    return structuredClone(savedProject);
  }

  return createEmptyProject(projectId, {
    name: DEFAULT_PROJECT_NAME,
  });
}
