interface LoadingPanelProps {
  message: string;
}

/** Shared loading placeholder for hub and studio while store/route resolves */
export function LoadingPanel({ message }: LoadingPanelProps) {
  return (
    <div
      className="music-creator-loading-panel"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="music-creator-loading-spinner" aria-hidden />
      <p className="music-creator-muted">{message}</p>
    </div>
  );
}
