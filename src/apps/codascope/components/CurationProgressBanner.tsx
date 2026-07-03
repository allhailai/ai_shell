/* ── CodaScope: CurationProgressBanner ───────────────────────────────
   Inline progress banner shown below the tab bar during an active
   curation run. Two modes:

   1. SSE mode (default): Connects to the curation SSE endpoint, starts
      a new run, and displays live step-by-step updates.
   2. Reconnect mode (reconnect=true): Polls the build-status API to
      track an already-running curation build (e.g., after page refresh
      or when triggered by the chat agent).
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useRef, useCallback } from "react";
import { connectToSseStream } from "../codaScopeSseClient";
import { IconCurate, IconClose, IconCheckCircle, IconWarning } from "./CodaScopeIcons";

/* ── Types ───────────────────────────────────────────────────────────── */

interface CurationProgressBannerProps {
  projectId: string;
  epicId: string;
  modelId: string;
  onComplete: () => void;
  onCancel: () => void;
  /** If true, poll build-status instead of starting a new SSE stream */
  reconnect?: boolean;
}

type BannerState = "running" | "complete" | "error";

/* ── Reconnect Polling ───────────────────────────────────────────────── */

function useReconnectPolling(
  projectId: string,
  epicId: string,
  enabled: boolean,
  onStepUpdate: (text: string) => void,
  onComplete: () => void,
  onError: (msg: string) => void,
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${projectId}/build-status?scope=curation::${epicId}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const build = data.build;

        if (!build) {
          // No build found — curation may have completed before we started polling
          onComplete();
          return;
        }

        if (build.status === "building") {
          // Extract latest pipeline step for display
          const steps = build.pipelineSteps;
          if (Array.isArray(steps) && steps.length > 0) {
            const latest = steps[steps.length - 1];
            const desc = latest.detail ?? latest.label ?? latest.id ?? "Processing…";
            onStepUpdate(desc);
          } else {
            onStepUpdate("Curation in progress…");
          }
        } else if (build.status === "complete") {
          onComplete();
        } else if (build.status === "error") {
          onError(build.error ?? "Curation failed");
        }
      } catch {
        // Network error — keep polling
      }
    };

    // Initial poll immediately
    void poll();
    intervalRef.current = setInterval(() => void poll(), 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId, epicId, enabled, onStepUpdate, onComplete, onError]);
}

/* ── Component ───────────────────────────────────────────────────────── */

export function CurationProgressBanner({
  projectId,
  epicId,
  modelId,
  onComplete,
  onCancel,
  reconnect = false,
}: CurationProgressBannerProps) {
  const [state, setState] = useState<BannerState>("running");
  const [stepText, setStepText] = useState(
    reconnect ? "Curation in progress…" : "Initializing curation…",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // ── Reconnect polling callbacks (stable refs) ─────────────────────
  const handleReconnectStep = useCallback((text: string) => {
    setStepText(text);
  }, []);

  const handleReconnectComplete = useCallback(() => {
    setState("complete");
    setStepText("Curation complete");
    setTimeout(onComplete, 3000);
  }, [onComplete]);

  const handleReconnectError = useCallback((msg: string) => {
    setState("error");
    setErrorMsg(msg);
    setStepText("Curation failed");
  }, []);

  // ── Reconnect mode: poll build-status ─────────────────────────────
  useReconnectPolling(
    projectId,
    epicId,
    reconnect && state === "running",
    handleReconnectStep,
    handleReconnectComplete,
    handleReconnectError,
  );

  // ── SSE mode: connect to SSE on mount ─────────────────────────────
  useEffect(() => {
    if (reconnect) return; // Skip SSE in reconnect mode

    const url = `/api/codascope/projects/${projectId}/epics/${epicId}/curation/run`;

    const controller = connectToSseStream(
      { url, method: "POST", body: { modelId } },
      {
        onText: () => {
          // Streaming agent text — we just note that it's active
        },
        onRunStarted: () => {
          setStepText("Curation started — resolving triggers…");
        },
        onPipelineStep: (step) => {
          // Build human-readable step description
          const desc = step.topic
            ? `${step.step}: ${step.topic}`
            : step.progress ?? step.step;
          setStepText(desc);
        },
        onDone: () => {
          setState("complete");
          setStepText("Curation complete");
          // Auto-dismiss after 3 seconds
          setTimeout(onComplete, 3000);
        },
        onError: (error) => {
          setState("error");
          setErrorMsg(error);
          setStepText("Curation failed");
        },
      },
    );

    controllerRef.current = controller;

    return () => {
      controller.abort();
    };
  }, [projectId, epicId, modelId, onComplete, reconnect]);

  const handleCancel = useCallback(() => {
    controllerRef.current?.abort();
    onCancel();
  }, [onCancel]);

  const handleDismissError = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <div className={`codascope-curation-progress codascope-curation-progress-${state}`}>
      <div className="codascope-curation-progress-left">
        {state === "running" && (
          <span className="codascope-curation-progress-spinner">
            <IconCurate size={14} />
          </span>
        )}
        {state === "complete" && (
          <span className="codascope-curation-progress-icon-success">
            <IconCheckCircle size={14} />
          </span>
        )}
        {state === "error" && (
          <span className="codascope-curation-progress-icon-error">
            <IconWarning size={14} />
          </span>
        )}
        <span className="codascope-curation-progress-text">
          {stepText}
        </span>
      </div>

      <div className="codascope-curation-progress-right">
        {state === "running" && (
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={handleCancel}
            type="button"
          >
            <IconClose size={12} />
            Cancel
          </button>
        )}
        {state === "error" && (
          <>
            {errorMsg && (
              <span className="codascope-curation-progress-error-msg" title={errorMsg}>
                {errorMsg.length > 80 ? errorMsg.slice(0, 80) + "…" : errorMsg}
              </span>
            )}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={handleDismissError}
              type="button"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {state === "running" && (
        <div className="codascope-curation-progress-bar">
          <div className="codascope-curation-progress-bar-fill" />
        </div>
      )}
    </div>
  );
}
