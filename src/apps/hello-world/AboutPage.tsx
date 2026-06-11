import { useShellStore } from "../../shell/store";
import { useCallback } from "react";

/**
 * About sub-page — demonstrates app sub-routing.
 */
export function AboutPage() {
  const navigateBack = useCallback(() => {
    window.history.pushState(null, "", "/hello" + window.location.search);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const activeAppId = useShellStore((s) => s.activeAppId);

  return (
    <div className="hello-page">
      <div className="hello-hero">
        <div className="hello-hero-icon hello-hero-icon-secondary">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <h1 className="hello-title">About This App</h1>
        <p className="hello-description">
          This is a sub-page of the Hello World app, rendered at <code>/hello/about</code>.
          It demonstrates how apps own their own sub-routes within the chassis.
        </p>
      </div>

      <div className="hello-section">
        <h2 className="hello-section-title">Current State</h2>
        <div className="hello-state-grid">
          <div className="hello-state-item">
            <span className="hello-state-label">Active App</span>
            <span className="hello-state-value">{activeAppId ?? "—"}</span>
          </div>
          <div className="hello-state-item">
            <span className="hello-state-label">Current Path</span>
            <span className="hello-state-value">{window.location.pathname}</span>
          </div>
          <div className="hello-state-item">
            <span className="hello-state-label">Query String</span>
            <span className="hello-state-value">{window.location.search || "—"}</span>
          </div>
        </div>
      </div>

      <div className="hello-section">
        <button className="hello-button" onClick={navigateBack} type="button">
          ← Back to Home
        </button>
      </div>
    </div>
  );
}
