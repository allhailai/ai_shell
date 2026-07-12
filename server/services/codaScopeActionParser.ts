/* ── CodaScope: Action Parser ─────────────────────────────────────────
   Extracts structured action tags from agent response text.

   The agent emits tags like:
     <codascope_action type="build_wiki_page" topic="auth-flow">
       Build a wiki page for the authentication flow module
     </codascope_action>

   This parser extracts them into structured objects for storage in
   message.metadata.actions and rendering as interactive cards.

   Pattern modeled on kiss_ai's chatParsers.js allTagContent().
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";

// Re-export for existing consumers
export type { CodaScopeAction };

/** Valid action types the agent can suggest */
export const VALID_ACTION_TYPES = new Set([
  "build_wiki_page",
  "build_full_wiki",
  "navigate",
  "explore_codebase",
  // Epic Design actions (P1)
  "create_epic",
  "update_epic_definition",
  "scope_epic",
  "deepen_wiki",
  // Epic Design actions (P2a)
  "create_design_doc",
  "update_design_doc",
  "create_version",
  // Epic Design actions (P2b)
  "insert_content",
  "replace_content",
  "expand_content",
  // Epic Design Reimagined — agent write tools
  "design_doc_created",
  "design_doc_edited",
  // Knowledge & Research
  "trigger_research",
  // Visual Artifacts
  "artifact_built",
  // Tool-confirmed mutations. These are rendered as completed cards, not
  // proposals that require a second user action.
  "operation_completed",
]);

/**
 * Create a notification tag for a mutation that has already succeeded.
 *
 * Tool implementations return the tag to the agent and place it in the
 * per-run collector. The client can then render a durable completion card
 * alongside the assistant's prose without trusting the model to report work
 * accurately in free-form text.
 */
export function formatCompletedAction(
  operation: string,
  description: string,
  attributes: Record<string, string | number | undefined> = {},
): string {
  const escapedAttributes = Object.entries({ operation, ...attributes })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`)
    .join("");

  return `<codascope_action type="operation_completed"${escapedAttributes}>${escapeText(description)}</codascope_action>`;
}

/* ── Parser ────────────────────────────────────────────────────────── */

/**
 * Extract all `<codascope_action>` tags from agent response text.
 *
 * Returns an array of parsed actions with type, attributes, and description.
 * Invalid or malformed tags are silently skipped.
 */
export function extractActions(text: string): CodaScopeAction[] {
  if (!text) return [];

  // Match <codascope_action ...>...</codascope_action> tags
  // Uses non-greedy match for content between tags
  const tagPattern = /<codascope_action\s+([^>]*)>\s*([\s\S]*?)\s*<\/codascope_action>/gi;
  const actions: CodaScopeAction[] = [];

  for (const match of text.matchAll(tagPattern)) {
    const attrString = match[1] ?? "";
    const description = decodeEntities((match[2] ?? "").trim());

    // Parse attributes from the opening tag
    const attributes = parseAttributes(attrString);
    const type = attributes.type;

    // Skip if no type or invalid type
    if (!type || !VALID_ACTION_TYPES.has(type)) continue;

    // Remove 'type' from attributes (it's a top-level field)
    delete attributes.type;

    actions.push({ type, attributes, description });
  }

  return actions;
}

/**
 * Strip `<codascope_action>` tags from text, returning clean markdown.
 * Used client-side to render the message without raw XML tags.
 */
export function stripActionTags(text: string): string {
  if (!text) return "";

  return text
    .replace(/<codascope_action\s+[^>]*>[\s\S]*?<\/codascope_action>/gi, "")
    .replace(/\n{3,}/g, "\n\n") // Collapse excessive blank lines left by removed tags
    .trim();
}

/* ── Internal Helpers ──────────────────────────────────────────────── */

/**
 * Parse HTML-style attributes from a string.
 *
 * Handles both quoted and unquoted values:
 *   type="build_wiki_page" topic="auth-flow"
 *   type=build_wiki_page topic=auth-flow
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  // Match key="value" or key='value' or key=value patterns
  const attrPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

  for (const match of attrString.matchAll(attrPattern)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (key) attrs[key] = decodeEntities(value);
  }

  return attrs;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
