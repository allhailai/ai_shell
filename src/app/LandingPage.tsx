import { useCallback, useMemo, useState } from "react";
import { useShellStore } from "../shell/store";
import type { AppManifest } from "../types/app";

/**
 * Landing page — shown when no application is active.
 * Displays a searchable card grid of all registered apps with pin and hide support.
 */
export function LandingPage({ apps }: { apps: AppManifest[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const setActiveApp = useShellStore((s) => s.setActiveApp);
  const pinnedApps = useShellStore((s) => s.pinnedApps);
  const hiddenApps = useShellStore((s) => s.hiddenApps);
  const togglePinApp = useShellStore((s) => s.togglePinApp);
  const toggleHideApp = useShellStore((s) => s.toggleHideApp);

  // Filter and sort apps
  const { visibleApps, hiddenAppsList } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    // System apps are never shown on the landing page
    const nonSystemApps = apps.filter((app) => !app.system);

    const filtered = nonSystemApps.filter((app) => {
      if (!query) return true;
      return (
        app.name.toLowerCase().includes(query) ||
        (app.description?.toLowerCase().includes(query) ?? false)
      );
    });

    const visible: AppManifest[] = [];
    const hidden: AppManifest[] = [];

    for (const app of filtered) {
      if (hiddenApps.includes(app.id)) {
        hidden.push(app);
      } else {
        visible.push(app);
      }
    }

    // Sort visible: pinned first, then alphabetical
    visible.sort((a, b) => {
      const aPinned = pinnedApps.includes(a.id);
      const bPinned = pinnedApps.includes(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.name.localeCompare(b.name);
    });

    return { visibleApps: visible, hiddenAppsList: hidden };
  }, [apps, searchQuery, pinnedApps, hiddenApps]);

  const handleLaunch = useCallback(
    (appId: string) => {
      setActiveApp(appId);
    },
    [setActiveApp],
  );

  return (
    <div className="landing-page">
      <div className="landing-page-inner">
        {/* Header */}
        <div className="landing-header">
          <div className="landing-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="landing-title">AIShell</h1>
          <p className="landing-subtitle">Select an application to get started</p>
        </div>

        {/* Search */}
        <div className="landing-search-wrapper">
          <SearchIcon />
          <input
            className="landing-search"
            type="text"
            placeholder="Search applications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button
              className="landing-search-clear"
              onClick={() => setSearchQuery("")}
              type="button"
              aria-label="Clear search"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {/* App Cards Grid */}
        {visibleApps.length > 0 ? (
          <div className="landing-grid">
            {visibleApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                isPinned={pinnedApps.includes(app.id)}
                onLaunch={handleLaunch}
                onTogglePin={togglePinApp}
                onHide={toggleHideApp}
              />
            ))}
          </div>
        ) : (
          <div className="landing-empty">
            <p>No applications found{searchQuery ? ` matching "${searchQuery}"` : ""}.</p>
          </div>
        )}

        {/* Hidden apps section */}
        {hiddenAppsList.length > 0 && (
          <div className="landing-hidden-section">
            <button
              className="landing-hidden-toggle"
              onClick={() => setShowHidden(!showHidden)}
              type="button"
            >
              <ChevronIcon open={showHidden} />
              <span>{hiddenAppsList.length} hidden application{hiddenAppsList.length !== 1 ? "s" : ""}</span>
            </button>
            {showHidden && (
              <div className="landing-grid landing-grid-hidden">
                {hiddenAppsList.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    isPinned={false}
                    isHidden
                    onLaunch={handleLaunch}
                    onTogglePin={togglePinApp}
                    onHide={toggleHideApp}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── App Card ─────────────────────────────────────────────────────── */

function AppCard({
  app,
  isPinned,
  isHidden,
  onLaunch,
  onTogglePin,
  onHide,
}: {
  app: AppManifest;
  isPinned: boolean;
  isHidden?: boolean;
  onLaunch: (id: string) => void;
  onTogglePin: (id: string) => void;
  onHide: (id: string) => void;
}) {
  const Icon = app.icon;
  const accentStyle = app.accentColor
    ? ({ "--app-accent": app.accentColor } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`app-card${isPinned ? " app-card-pinned" : ""}${isHidden ? " app-card-hidden" : ""}`}
      style={accentStyle}
    >
      {/* Card actions (pin / hide) */}
      <div className="app-card-actions">
        <button
          className={`app-card-action${isPinned ? " active" : ""}`}
          onClick={(e) => { e.stopPropagation(); onTogglePin(app.id); }}
          title={isPinned ? "Unpin" : "Pin to top"}
          type="button"
          aria-pressed={isPinned}
        >
          <PinIcon />
        </button>
        <button
          className="app-card-action"
          onClick={(e) => { e.stopPropagation(); onHide(app.id); }}
          title={isHidden ? "Unhide" : "Hide"}
          type="button"
        >
          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>

      {/* Card body — clickable to launch */}
      <button
        className="app-card-body"
        onClick={() => onLaunch(app.id)}
        type="button"
      >
        <div className="app-card-icon-wrapper">
          {Icon ? <Icon size={28} /> : <DefaultAppIcon />}
          {isPinned && <span className="app-card-pin-badge"><PinIcon /></span>}
        </div>
        <div className="app-card-info">
          <span className="app-card-name">{app.name}</span>
          {app.description && (
            <span className="app-card-desc">{app.description}</span>
          )}
        </div>
      </button>
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */

function DefaultAppIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="landing-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1l1-.5V2H7v1.5l1 .5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`landing-chevron${open ? " open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
