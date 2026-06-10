/**
 * Empty state shown when no plugin is active.
 */
export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h1 className="empty-state-title">AIShell</h1>
      <p className="empty-state-hint">
        Select a module from the sidebar to get started.
      </p>
    </div>
  );
}
