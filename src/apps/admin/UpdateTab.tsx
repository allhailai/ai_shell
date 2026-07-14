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

interface WorktreeChange {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  blocksUpdate: boolean;
}

interface WorktreeStatusResult {
  branch: string | null;
  revision: string;
  changes: WorktreeChange[];
  hasBlockingChanges: boolean;
  fingerprint: string;
}

interface RecoveryStash {
  id: string;
  createdAt: string;
  summary: string;
}

interface RecoveryStashResult {
  stash: RecoveryStash;
  worktree: WorktreeStatusResult;
  auditRecorded: boolean;
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

async function apiGetWorktree(): Promise<WorktreeStatusResult> {
  const res = await fetch("/api/system/update/worktree");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not inspect local changes (HTTP ${res.status})`);
  }
  return res.json();
}

async function apiListRecoveryStashes(): Promise<RecoveryStash[]> {
  const res = await fetch("/api/system/update/stashes");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not list recovery stashes (HTTP ${res.status})`);
  }
  const data = await res.json() as { stashes: RecoveryStash[] };
  return data.stashes;
}

async function apiStashWorkingTree(statusFingerprint: string): Promise<RecoveryStashResult> {
  const res = await fetch("/api/system/update/stash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "stash", statusFingerprint }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not stash local changes (HTTP ${res.status})`);
  }
  return res.json();
}

async function apiRestoreRecoveryStash(stashId: string): Promise<RecoveryStashResult> {
  const res = await fetch(`/api/system/update/stashes/${encodeURIComponent(stashId)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "restore" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not restore the selected stash (HTTP ${res.status})`);
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
  const [worktree, setWorktree] = useState<WorktreeStatusResult | null>(null);
  const [recoveryStashes, setRecoveryStashes] = useState<RecoveryStash[]>([]);
  const [recoveryAction, setRecoveryAction] = useState<"stash" | "restore" | null>(null);
  const [selectedStash, setSelectedStash] = useState<RecoveryStash | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useServerReadyPoller(restarting);

  const refreshRecovery = async () => {
    try {
      const [nextWorktree, nextStashes] = await Promise.all([
        apiGetWorktree(),
        apiListRecoveryStashes(),
      ]);
      setWorktree(nextWorktree);
      setRecoveryStashes(nextStashes);
    } catch {
      // The normal update error remains the most useful message to show.
    }
  };

  useEffect(() => {
    void refreshRecovery();
  }, []);

  const checkForUpdates = async () => {
    if (loading || updating || restarting) return;

    setUpdateCheck(null);
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      setUpdateCheck(await apiCheckUpdate());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check for updates.");
      void refreshRecovery();
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAndRestart = async () => {
    if (updating || restarting) return;

    setError("");
    setSuccess("");
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

  const beginRecoveryAction = (action: "stash" | "restore", stash?: RecoveryStash) => {
    setError("");
    setSuccess("");
    setRecoveryAction(action);
    setSelectedStash(stash ?? null);
    setConfirmationText("");
  };

  const cancelRecoveryAction = () => {
    if (recoveryBusy) return;
    setRecoveryAction(null);
    setSelectedStash(null);
    setConfirmationText("");
  };

  const confirmRecoveryAction = async () => {
    if (!recoveryAction || recoveryBusy) return;
    const requiredText = recoveryAction === "stash" ? "stash" : "restore";
    if (confirmationText !== requiredText) return;

    setError("");
    setSuccess("");
    setRecoveryBusy(true);
    try {
      const result = recoveryAction === "stash"
        ? await apiStashWorkingTree(worktree?.fingerprint ?? "")
        : await apiRestoreRecoveryStash(selectedStash?.id ?? "");
      setWorktree(result.worktree);
      await refreshRecovery();
      setSuccess(
        recoveryAction === "stash"
          ? `Saved local changes in recovery stash ${result.stash.id.slice(0, 12)}.`
          : `Restored ${result.stash.id.slice(0, 12)}. The recovery stash was kept for safety.`,
      );
      if (!result.auditRecorded) {
        setError("The Git action succeeded, but its completion could not be recorded in the system audit log.");
      }
      cancelRecoveryAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the recovery action.");
      void refreshRecovery();
    } finally {
      setRecoveryBusy(false);
    }
  };

  const busy = loading || updating || restarting || recoveryBusy;
  const canRestore = worktree?.changes.length === 0 && !busy;

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

        {success ? (
          <div className="admin-message admin-message-success" role="status">
            <span>{success}</span>
            <button
              className="admin-message-close"
              onClick={() => setSuccess("")}
              type="button"
              aria-label="Dismiss success message"
            >
              ×
            </button>
          </div>
        ) : null}

        <UpdateRecoveryPanel
          worktree={worktree}
          stashes={recoveryStashes}
          action={recoveryAction}
          selectedStash={selectedStash}
          confirmationText={confirmationText}
          busy={busy}
          canRestore={canRestore}
          onBegin={beginRecoveryAction}
          onCancel={cancelRecoveryAction}
          onConfirmationChange={setConfirmationText}
          onConfirm={() => void confirmRecoveryAction()}
        />

        {/* Restarting overlay */}
        {restarting ? (
          <div className="admin-update-restarting">
            <div className="admin-update-restarting-spinner" />
            <div>
              <p className="admin-update-restarting-title">
                Updating and restarting AIShell…
              </p>
              <p className="admin-update-restarting-hint">
                Installing dependencies, rebuilding the frontend, and restarting
                the server. This page will reload automatically when the new version is ready.
              </p>
              <p className="admin-update-restarting-timing">
                This usually takes 30–60 seconds. Do not close this tab.
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

interface UpdateRecoveryPanelProps {
  worktree: WorktreeStatusResult | null;
  stashes: RecoveryStash[];
  action: "stash" | "restore" | null;
  selectedStash: RecoveryStash | null;
  confirmationText: string;
  busy: boolean;
  canRestore: boolean;
  onBegin: (action: "stash" | "restore", stash?: RecoveryStash) => void;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onConfirm: () => void;
}

function updateChangeLabel(change: WorktreeChange): string {
  if (change.indexStatus === "?" && change.worktreeStatus === "?") return "Untracked";
  if (change.indexStatus === "A") return "Added";
  if (change.indexStatus === "D" || change.worktreeStatus === "D") return "Deleted";
  if (change.indexStatus === "R") return "Renamed";
  if (change.indexStatus === "C") return "Copied";
  if (change.indexStatus === "M" && change.worktreeStatus === "M") return "Modified (staged and unstaged)";
  if (change.indexStatus === "M") return "Modified (staged)";
  if (change.worktreeStatus === "M") return "Modified";
  return "Changed";
}

function UpdateRecoveryPanel({
  worktree,
  stashes,
  action,
  selectedStash,
  confirmationText,
  busy,
  canRestore,
  onBegin,
  onCancel,
  onConfirmationChange,
  onConfirm,
}: UpdateRecoveryPanelProps) {
  const hasChanges = (worktree?.changes.length ?? 0) > 0;
  const needsStash = worktree?.hasBlockingChanges === true;
  const requiredText = action === "stash" ? "stash" : "restore";

  if (!hasChanges && stashes.length === 0 && !action) return null;

  return (
    <section className="admin-update-recovery" aria-label="Local change recovery">
      {hasChanges ? (
        <>
          <div className={`admin-status-banner ${needsStash ? "admin-status-warn" : "admin-status-ok"}`}>
            <span className="admin-status-dot" />
            <span>
              {needsStash ? "Local changes are blocking updates." : "Only package-lock.json changed; updates are not blocked."}
              {worktree?.branch ? <span className="admin-status-detail"> Branch: <code>{worktree.branch}</code></span> : null}
            </span>
          </div>
          <ul className="admin-update-change-list">
            {worktree?.changes.map((change) => (
              <li key={`${change.path}:${change.originalPath ?? ""}`} className="admin-update-change-item">
                <span className="admin-update-change-kind">{updateChangeLabel(change)}</span>
                <code>{change.path}</code>
                {change.originalPath ? <span className="admin-update-change-from">from <code>{change.originalPath}</code></span> : null}
                {!change.blocksUpdate ? <span className="admin-update-change-note">Ignored by update checks</span> : null}
              </li>
            ))}
          </ul>
          {needsStash && !action ? (
            <div className="admin-update-actions">
              <button
                className="admin-btn admin-update-danger-btn"
                disabled={busy}
                onClick={() => onBegin("stash")}
                type="button"
              >
                Stash local changes
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {stashes.length > 0 && !action ? (
        <div className="admin-update-stashes">
          <h4 className="admin-update-recovery-title">Recovery stashes</h4>
          <p className="admin-update-recovery-copy">
            Restoring makes the checkout dirty again. A restored stash is kept so it can be recovered again if needed.
          </p>
          <ul className="admin-update-stash-list">
            {stashes.map((stash) => (
              <li key={stash.id} className="admin-update-stash-item">
                <div>
                  <code>{stash.id.slice(0, 12)}</code>
                  <span>{new Date(stash.createdAt).toLocaleString()}</span>
                </div>
                <button
                  className="admin-btn admin-btn-ghost"
                  disabled={!canRestore}
                  onClick={() => onBegin("restore", stash)}
                  title={canRestore ? "Restore this stash" : "A completely clean working tree is required to restore"}
                  type="button"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {action ? (
        <div className="admin-update-confirmation">
          <h4 className="admin-update-recovery-title">
            {action === "stash" ? "Stash local changes" : "Restore local changes"}
          </h4>
          <p className="admin-update-recovery-copy">
            {action === "stash"
              ? "This saves all tracked and untracked local changes shown above in Git stash. It does not update or restart AIShell."
              : `This applies recovery stash ${selectedStash?.id.slice(0, 12)} to a clean checkout. It does not remove the stash.`}
          </p>
          <label className="admin-field admin-update-confirmation-field">
            <span className="admin-label">Type {requiredText} to confirm</span>
            <input
              autoFocus
              className="admin-input"
              disabled={busy}
              onChange={(event) => onConfirmationChange(event.target.value)}
              value={confirmationText}
            />
          </label>
          <div className="admin-update-actions">
            <button className="admin-btn admin-btn-ghost" disabled={busy} onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="admin-btn admin-update-danger-btn"
              disabled={busy || confirmationText !== requiredText}
              onClick={onConfirm}
              type="button"
            >
              {busy ? "Working…" : action === "stash" ? "Stash changes" : "Restore changes"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
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
