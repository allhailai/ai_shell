/* ── Update Tab ───────────────────────────────────────────────────────
   Settings sub-tab for checking for updates and triggering
   update-and-restart. Inline panel (not a modal) within the admin page.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────

interface UpdateCheckResult {
  status: "up_to_date" | "update_available";
  updateAvailable: boolean;
  localRevision: string;
  remoteRevision: string;
  upstream: string;
}

interface UpdateAndRestartResult {
  status: "up_to_date" | "updated";
  restarting: boolean;
  beforeRevision: string;
  afterRevision: string;
  pullOutput: string;
}

// ── API helpers ─────────────────────────────────────────────────────

async function apiCheckUpdate(): Promise<UpdateCheckResult> {
  const res = await fetch("/api/system/update/check", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Check failed (HTTP ${res.status})`);
  }
  return res.json();
}

async function apiUpdateAndRestart(): Promise<UpdateAndRestartResult> {
  const res = await fetch("/api/system/update-and-restart", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Update failed (HTTP ${res.status})`);
  }
  return res.json();
}

// ── Poller hook ─────────────────────────────────────────────────────

function useServerReadyPoller(enabled: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/version");
        if (res.ok) {
          // Server is back — reload the page.
          window.location.reload();
        }
      } catch {
        // Server still down, keep polling.
      }
    }, 2_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);
}

// ── Component ───────────────────────────────────────────────────────

export function UpdateTab() {
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState("");

  useServerReadyPoller(restarting);

  const checkForUpdates = async () => {
    if (loading || updating || restarting) return;

    setUpdateCheck(null);
    setError("");
    setLoading(true);
    try {
      setUpdateCheck(await apiCheckUpdate());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check for updates.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAndRestart = async () => {
    if (updating || restarting) return;

    setError("");
    setUpdating(true);
    try {
      const result = await apiUpdateAndRestart();

      if (result.restarting) {
        setRestarting(true);
      } else {
        // Already up to date — nothing to restart.
        setUpdateCheck({
          status: "up_to_date",
          updateAvailable: false,
          localRevision: result.afterRevision,
          remoteRevision: result.afterRevision,
          upstream: "",
        });
        setUpdating(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update AIShell.");
      setUpdating(false);
    }
  };

  const busy = loading || updating || restarting;

  return (
    <div className="admin-section">
      <div className="admin-card">
        <h3 className="admin-card-title">Software Updates</h3>
        <p className="admin-update-description">
          Check for the latest AIShell version and apply updates. The server
          will automatically restart with the new code.
        </p>

        {/* Error display */}
        {error ? (
          <div className="admin-message admin-message-error" role="alert">
            <span>{error}</span>
            <button
              className="admin-message-close"
              onClick={() => setError("")}
              type="button"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        ) : null}

        {/* Restarting overlay */}
        {restarting ? (
          <div className="admin-update-restarting">
            <div className="admin-update-restarting-spinner" />
            <div>
              <p className="admin-update-restarting-title">
                Updating and restarting AIShell…
              </p>
              <p className="admin-update-restarting-hint">
                Installing dependencies and restarting the server. This page
                will reload automatically when the new version is ready.
              </p>
              <p className="admin-update-restarting-timing">
                This usually takes 15–30 seconds. Do not close this tab.
              </p>
            </div>
          </div>
        ) : null}

        {/* Check result: up to date */}
        {!loading && !restarting && updateCheck?.status === "up_to_date" ? (
          <div className="admin-status-banner admin-status-ok">
            <span className="admin-status-dot" />
            <span>
              AIShell is up to date.{" "}
              <span className="admin-status-detail">
                Revision: <code>{updateCheck.localRevision}</code>
              </span>
            </span>
          </div>
        ) : null}

        {/* Check result: update available */}
        {!loading && !restarting && updateCheck?.updateAvailable ? (
          <div className="admin-update-available">
            <div className="admin-status-banner admin-status-warn">
              <span className="admin-status-dot" />
              <span>
                A new version is available.{" "}
                <span className="admin-status-detail">
                  Current: <code>{updateCheck.localRevision}</code> → Latest:{" "}
                  <code>{updateCheck.remoteRevision}</code>
                </span>
              </span>
            </div>
            <button
              className="admin-btn admin-btn-primary admin-update-restart-btn"
              disabled={updating}
              onClick={() => void handleUpdateAndRestart()}
              type="button"
            >
              {updating ? (
                <>
                  <span className="admin-update-btn-spinner" />
                  Updating…
                </>
              ) : (
                <>
                  <DownloadIcon />
                  Update & Restart
                </>
              )}
            </button>
          </div>
        ) : null}

        {/* Check button (when no result shown yet or after dismissing) */}
        {!restarting && !updateCheck ? (
          <div className="admin-update-actions">
            <button
              className="admin-btn admin-btn-secondary"
              disabled={busy}
              onClick={() => void checkForUpdates()}
              type="button"
            >
              {loading ? (
                <>
                  <span className="admin-update-btn-spinner" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshIcon />
                  Check for Updates
                </>
              )}
            </button>
          </div>
        ) : null}

        {/* Re-check button (after a result is shown) */}
        {!restarting && updateCheck && !updateCheck.updateAvailable ? (
          <div className="admin-update-actions" style={{ marginTop: "var(--space-3)" }}>
            <button
              className="admin-btn admin-btn-ghost"
              disabled={busy}
              onClick={() => void checkForUpdates()}
              type="button"
            >
              <RefreshIcon />
              Check Again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Auto-check hook (for the banner) ────────────────────────────────

export function useAutoUpdateCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/system/update/check", { method: "POST" });
        if (!res.ok || cancelled) return;
        const data: UpdateCheckResult = await res.json();
        if (!cancelled && data.updateAvailable) {
          setUpdateAvailable(true);
        }
      } catch {
        // Silent failure — don't interrupt Settings load
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return updateAvailable;
}

// ── Icons ───────────────────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.5 2v6h-6M2.5 22v-6h6" />
      <path d="M2.5 11.5a10 10 0 0 1 18.37-4.27L21.5 8M21.5 12.5a10 10 0 0 1-18.37 4.27L2.5 16" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function UpdateTabIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
