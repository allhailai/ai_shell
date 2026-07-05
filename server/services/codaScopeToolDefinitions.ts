/* ── CodaScope: Agent Tool Definitions ────────────────────────────────
   Facade that composes domain-specific tool modules into the correct
   combination for each agent purpose. The actual tool implementations
   live in `./tools/`:
     - codaScopeReadOnlyTools.ts  — 14 read-only discovery tools
     - codaScopeEpicTools.ts      — 21 epic read/write tools
     - codaScopeWriteTools.ts     — 1 code map write tool
     - codaScopeArtifactTools.ts  — 3 artifact tools

   Service instances are created once per call via the shared factory
   in `codaScopeToolServiceFactory.ts`.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import { createToolServices } from "./codaScopeToolServiceFactory.js";
import { buildReadOnlyTools } from "./tools/codaScopeReadOnlyTools.js";
import { buildEpicTools } from "./tools/codaScopeEpicTools.js";
import { buildWriteTools } from "./tools/codaScopeWriteTools.js";
import { buildArtifactTools } from "./tools/codaScopeArtifactTools.js";

// ── Types ───────────────────────────────────────────────────────────

export type AgentPurpose = "chat" | "assistant" | "wiki-build" | "curation" | "research" | "artifact-build" | "artifact-section-regen";

// ── Tool Result Collector ───────────────────────────────────────────
// Module-level collector for tool return values that contain action tags.
// The agent service drains this after each run completes.

const toolResultCollector: string[] = [];

/** Push a tool result text for later action-tag extraction. */
export function collectToolResult(text: string): void {
  toolResultCollector.push(text);
}

/** Drain all collected tool results (clears the collector). */
export function drainToolResults(): string[] {
  return toolResultCollector.splice(0);  // returns and clears
}

// ── Re-exports for backward compatibility ───────────────────────────
// Tests and any code importing individual builders still work.

export { buildReadOnlyTools } from "./tools/codaScopeReadOnlyTools.js";
export { buildEpicTools } from "./tools/codaScopeEpicTools.js";
export { buildWriteTools } from "./tools/codaScopeWriteTools.js";
export { buildArtifactTools } from "./tools/codaScopeArtifactTools.js";

// ── Assembly ────────────────────────────────────────────────────────

/**
 * Get the appropriate tools for a given agent purpose.
 * - assistant / chat: ALL tools (read + epic write + code map write + artifact) — full autonomy
 * - wiki-build: read-only + code map write tools
 * - curation / research: read-only + epic tools
 * - artifact-build / artifact-section-regen: read-only + artifact tools
 *
 * Services are instantiated once and shared across all tool tiers.
 */
export function getToolsForPurpose(
  projectId: string,
  projectsRoot: string,
  purpose: AgentPurpose | string,
): Record<string, SDKCustomTool> {
  const services = createToolServices(projectsRoot);

  const readOnly = buildReadOnlyTools(projectId, services);

  if (purpose === "wiki-build") {
    const write = buildWriteTools(projectId, services);
    return { ...readOnly, ...write };
  }

  if (purpose === "curation" || purpose === "research") {
    const epicTools = buildEpicTools(projectId, services);
    return { ...readOnly, ...epicTools };
  }

  // Artifact purposes: read-only project context + artifact-specific tools
  if (purpose === "artifact-build" || purpose === "artifact-section-regen") {
    const artifactTools = buildArtifactTools(projectId, services);
    return { ...readOnly, ...artifactTools };
  }

  // assistant and chat get ALL tools — full agent autonomy
  const epicTools = buildEpicTools(projectId, services);
  const write = buildWriteTools(projectId, services);
  const artifactTools = buildArtifactTools(projectId, services);
  return { ...readOnly, ...epicTools, ...write, ...artifactTools };
}
