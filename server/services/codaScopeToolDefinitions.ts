/* ── CodaScope: Agent Tool Definitions ────────────────────────────────
   Facade that composes domain-specific tool modules into the correct
   combination for each agent purpose. The actual tool implementations
   live in `./tools/`:
     - codaScopeReadOnlyTools.ts  — 14 read-only discovery tools
     - codaScopeEpicTools.ts      — 21 epic read/write tools
     - codaScopeWriteTools.ts     — 1 code map write tool
     - codaScopeArtifactTools.ts  — 3 artifact tools
     - codaScopeNoteTools.ts      — 6 note read/write tools

   Service instances are created once per call via the shared factory
   in `codaScopeToolServiceFactory.ts`.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import { createToolServices } from "./codaScopeToolServiceFactory.js";
import { buildReadOnlyTools } from "./tools/codaScopeReadOnlyTools.js";
import { buildEpicTools } from "./tools/codaScopeEpicTools.js";
import { buildWriteTools } from "./tools/codaScopeWriteTools.js";
import { buildArtifactTools } from "./tools/codaScopeArtifactTools.js";
import { buildNoteReadTools, buildNoteWriteTools } from "./tools/codaScopeNoteTools.js";

// ── Types ───────────────────────────────────────────────────────────

export type AgentPurpose = "chat" | "assistant" | "wiki-build" | "curation" | "research" | "artifact-build" | "artifact-section-regen";

// ── Tool Result Collector ───────────────────────────────────────────
// Per-run collector for tool return values that contain action tags.
// Each agent run creates its own collector instance so concurrent runs
// don't cross-contaminate results.
//
// Because the Cursor SDK agent pool caches agents with baked-in tool
// closures, tools capture a *holder* (stable reference) whose `.current`
// property is swapped to a fresh collector before each run.

/**
 * Collects tool result text (e.g., action tags) during a single agent run.
 */
export class ToolResultCollector {
  private results: string[] = [];

  /** Push a tool result text for later action-tag extraction. */
  collect(text: string): void {
    this.results.push(text);
  }

  /** Drain all collected tool results (clears the collector). */
  drain(): string[] {
    return this.results.splice(0);  // returns and clears
  }
}

/**
 * Stable holder that tool closures capture. Before each agent run,
 * swap `.current` to a fresh `ToolResultCollector` instance.
 */
export class ToolResultCollectorHolder {
  current = new ToolResultCollector();

  /** Convenience: collect via the current collector. */
  collect(text: string): void {
    this.current.collect(text);
  }
}

// ── Re-exports for backward compatibility ───────────────────────────
// Tests and any code importing individual builders still work.

export { buildReadOnlyTools } from "./tools/codaScopeReadOnlyTools.js";
export { buildEpicTools } from "./tools/codaScopeEpicTools.js";
export { buildWriteTools } from "./tools/codaScopeWriteTools.js";
export { buildArtifactTools } from "./tools/codaScopeArtifactTools.js";
export { buildNoteReadTools, buildNoteWriteTools } from "./tools/codaScopeNoteTools.js";

// ── Assembly ────────────────────────────────────────────────────────

/**
 * Get the appropriate tools for a given agent purpose.
 * - assistant / chat: ALL tools (read + epic write + code map write + artifact) — full autonomy
 * - wiki-build: read-only + code map write tools
 * - curation / research: read-only + epic tools
 * - artifact-build / artifact-section-regen: read-only + artifact tools
 *
 * Services are instantiated once and shared across all tool tiers.
 *
 * @param collectorHolder — optional per-run collector holder; when provided,
 *   tools that emit action tags push results into holder.current.
 */
export function getToolsForPurpose(
  projectId: string,
  projectsRoot: string,
  purpose: AgentPurpose | string,
  collectorHolder?: ToolResultCollectorHolder,
): Record<string, SDKCustomTool> {
  const services = createToolServices(projectsRoot);

  const readOnly = buildReadOnlyTools(projectId, services);
  const noteRead = buildNoteReadTools(projectId, services);

  if (purpose === "wiki-build") {
    const write = buildWriteTools(projectId, services);
    return { ...readOnly, ...noteRead, ...write };
  }

  if (purpose === "curation" || purpose === "research") {
    const epicTools = buildEpicTools(projectId, services, collectorHolder);
    return { ...readOnly, ...noteRead, ...epicTools };
  }

  // Artifact purposes: read-only project context + artifact-specific tools
  if (purpose === "artifact-build" || purpose === "artifact-section-regen") {
    const artifactTools = buildArtifactTools(projectId, services, collectorHolder);
    return { ...readOnly, ...noteRead, ...artifactTools };
  }

  // assistant and chat get ALL tools — full agent autonomy
  const epicTools = buildEpicTools(projectId, services, collectorHolder);
  const write = buildWriteTools(projectId, services);
  const artifactTools = buildArtifactTools(projectId, services, collectorHolder);
  const noteWrite = buildNoteWriteTools(projectId, services, collectorHolder);
  return { ...readOnly, ...noteRead, ...epicTools, ...write, ...artifactTools, ...noteWrite };
}
