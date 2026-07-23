/* ── CodaScope: useBuildState Hook ────────────────────────────────────
   Reusable hook for hydrating build pipeline state on mount.

   On mount, fetches the server's build-status for a given scope.
   If a build is currently running, reconnects to the SSE stream.
   If a build completed or failed, exposes its final state.

   Returns:
   - status: "idle" | "running" | "success" | "error"
   - progressMsg: human-readable progress string
   - summary: build completion summary
   - error: error message (if status === "error")
   - rebuild: function to reset state back to idle (allowing re-trigger)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { connectToSseStream } from "../codaScopeSseClient";
import type { PipelineStep } from "../codaScopeSseClient";

export type HydratedBuildStatus = "idle" | "running" | "success" | "error";

export interface UseBuildStateOptions {
  /** CodaScope project ID */
  projectId: string | null;
  /** Build scope key (e.g. "research::epicId", "epic-deepen::epicId") */
  scope: string;
  /** If true, the hook is active and will fetch status on mount */
  enabled?: boolean;
}

export interface UseBuildStateResult {
  status: HydratedBuildStatus;
  progressMsg: string | null;
  summary: string | null;
  error: string | null;
  /** Reset state back to "idle" to allow re-triggering */
  rebuild: () => void;
  /** The runId of the current/last build, if any */
  runId: string | null;
}

export function useBuildState(options: UseBuildStateOptions): UseBuildStateResult {
  const { projectId, scope, enabled = true } = options;

  const [status, setStatus] = useState<HydratedBuildStatus>("idle");
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  // Track if we've already hydrated to avoid double-fetch in dev mode StrictMode
  const hydratedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const rebuild = useCallback(() => {
    setStatus("idle");
    setProgressMsg(null);
    setSummary(null);
    setError(null);
    setRunId(null);
    hydratedRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled || !projectId || hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${projectId}/build-status?scope=${encodeURIComponent(scope)}`,
        );
        if (!res.ok || cancelled) return;

        const data = await res.json();
        const build = data.build;
        if (!build || cancelled) return;

        setRunId(build.runId);

        if (build.status === "building") {
          // Build is currently running — set running state and reconnect to SSE
          setStatus("running");

          // Derive progress from pipeline steps
          const steps = build.pipelineSteps ?? [];
          const runningStep = steps.find((s: PipelineStep) => s.status === "running");
          if (runningStep) {
            const label = (runningStep as any).label ?? runningStep.step;
            const detail = (runningStep as any).detail;
            setProgressMsg(detail ? `${label}: ${detail}` : label);
          } else {
            setProgressMsg("Running…");
          }

          // Reconnect to the build log stream for live updates
          const streamUrl = `/api/codascope/projects/${projectId}/build-log/${build.runId}/stream`;
          const ctrl = connectToSseStream(streamUrl, {
            onText: () => { /* discard text output */ },
            onPipelineStep: (step) => {
              const label = step.topic ?? step.step;
              const progress = step.progress ? ` (${step.progress})` : "";
              setProgressMsg(`${step.status === "running" ? "Running" : step.status}: ${label}${progress}`);
            },
            onDone: () => {
              if (!cancelled) {
                setStatus("success");
                setProgressMsg(null);
              }
            },
            onError: (err) => {
              if (!cancelled) {
                setStatus("error");
                setError(err);
                setProgressMsg(null);
              }
            },
            onCancelled: () => {
              if (!cancelled) {
                setStatus("error");
                setError("Build was cancelled.");
                setProgressMsg(null);
              }
            },
          });
          abortRef.current = ctrl;

        } else if (build.status === "complete") {
          // Build completed — show persistent success state
          setStatus("success");
          setSummary(build.summary ?? null);

        } else if (build.status === "error") {
          // Build failed — show persistent error state
          setStatus("error");
          setError(build.error ?? "Unknown error");
          setSummary(build.summary ?? null);
        }
        // "idle" status → do nothing, keep default idle state
      } catch {
        // Network error during hydration — silently ignore, stay idle
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [projectId, scope, enabled]);

  return { status, progressMsg, summary, error, rebuild, runId };
}
