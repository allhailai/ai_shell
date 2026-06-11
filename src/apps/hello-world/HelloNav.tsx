import { useSyncExternalStore } from "react";

/**
 * Left navigation component for the Hello World app.
 * Provides internal sub-route navigation between Home and About pages.
 */
export function HelloNav() {
  const subPath = useSyncExternalStore(subscribeToPath, getSubPath, getSubPath);

  return (
    <nav className="hello-nav" aria-label="Hello World navigation">
      <div className="hello-nav-content scrollable-y">
        <HelloNavItem
          label="Home"
          icon={<HomeIcon />}
          active={subPath === ""}
          onClick={() => navigateTo("/hello")}
        />
        <HelloNavItem
          label="About"
          icon={<InfoIcon />}
          active={subPath === "about"}
          onClick={() => navigateTo("/hello/about")}
        />
      </div>
    </nav>
  );
}

function HelloNavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      type="button"
    >
      <span className="nav-item-icon">{icon}</span>
      <span className="nav-item-label">{label}</span>
    </button>
  );
}

function getSubPath(): string {
  const segments = window.location.pathname.split("/").filter(Boolean);
  // segments[0] = appId ("hello"), rest = sub-path
  return segments.slice(1).join("/");
}

function navigateTo(path: string) {
  window.history.pushState(null, "", path + window.location.search);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function subscribeToPath(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
