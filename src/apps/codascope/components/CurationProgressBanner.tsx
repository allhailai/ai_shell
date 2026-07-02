/* ── CodaScope: CurationProgressBanner ───────────────────────────────
   Inline progress banner shown below the tab bar during an active
   curation run. Connects to the curation SSE endpoint and displays
   live step-by-step updates.
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
}

type BannerState = "running" | "complete" | "error";

/* ── Component ───────────────────────────────────────────────────────── */

export function CurationProgressBanner({
  projectId,
  epicId,
  modelId,
  onComplete,
  onCancel,
}: CurationProgressBannerProps) {
  const [state, setState] = useState<BannerState>("running");
  const [stepText, setStepText] = useState("Initializing curation…");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Connect to SSE on mount
  useEffect(() => {
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
  }, [projectId, epicId, modelId, onComplete]);

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
