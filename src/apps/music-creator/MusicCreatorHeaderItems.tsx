import { useSyncExternalStore } from "react";
import { TransportBar } from "./components/TransportBar";
import {
  getStudioSessionSnapshot,
  invokeStudioSessionAction,
  subscribeStudioSession,
} from "./routing/studioSession";

/**
 * Studio transport injected into the shell topbar — visible only on studio routes.
 * Subscribes to module store published by Studio (separate React tree from mainContent).
 */
export function MusicCreatorHeaderItems() {
  const state = useSyncExternalStore(subscribeStudioSession, getStudioSessionSnapshot);

  if (!state.active) return null;

  return (
    <div className="music-creator-header-items topbar-app-items">
      <TransportBar
        name={state.name}
        tempo={state.tempo}
        isDirty={state.isDirty}
        isPlaying={state.isPlaying}
        onNameChange={(name) => invokeStudioSessionAction("onNameChange", name)}
        onTempoChange={(tempo) => invokeStudioSessionAction("onTempoChange", tempo)}
        onTogglePlayback={() => invokeStudioSessionAction("onTogglePlayback")}
        onSave={() => invokeStudioSessionAction("onSave")}
      />
    </div>
  );
}
