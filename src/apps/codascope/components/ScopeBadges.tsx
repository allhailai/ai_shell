/* ── CodaScope: Scope Badge Components ─────────────────────────────────
   Shared badge components for scope entries. Extracted from EpicScope.tsx
   to reduce file size and enable reuse.
   ──────────────────────────────────────────────────────────────────── */

import type { TopicDepth, EpicScopeEntry } from "../codaScopeTypes";

/* ── Depth Labels ────────────────────────────────────────────────────── */

const DEPTH_LABELS: Record<string, string> = {
  none: "None",
  stub: "Stub",
  outline: "Outline",
  developed: "Developed",
  comprehensive: "Comprehensive",
};

/* ── DepthBadge ──────────────────────────────────────────────────────── */

export function DepthBadge({ depth, size = "sm" }: { depth?: TopicDepth; size?: "sm" | "md" }) {
  if (!depth) return null;
  const cls = size === "md" ? "codascope-scope-depth-badge codascope-scope-depth-badge--md" : "codascope-scope-depth-badge";
  return (
    <span className={`${cls} codascope-scope-depth-badge--${depth}`}>
      {DEPTH_LABELS[depth] ?? depth}
    </span>
  );
}

/* ── TypeBadge ────────────────────────────────────────────────────────── */

export function TypeBadge({ type }: { type: EpicScopeEntry["type"] }) {
  const labels: Record<string, string> = {
    "existing-wiki": "Wiki",
    "existing-concept": "Concept",
    "new": "New",
  };
  return <span className={`codascope-scope-type-badge codascope-scope-type-badge--${type}`}>{labels[type] ?? type}</span>;
}

/* ── SourceBadge ──────────────────────────────────────────────────────── */

export function SourceBadge({ source }: { source: EpicScopeEntry["source"] }) {
  return (
    <span className={`codascope-scope-source-badge codascope-scope-source-badge--${source}`}>
      {source === "agent" ? "Agent" : "User"}
    </span>
  );
}

/* ── EnrichmentStatus ────────────────────────────────────────────────── */

export function EnrichmentStatus({ entry }: { entry: EpicScopeEntry }) {
  if (entry.enrichedAt) return <span className="codascope-scope-enriched-badge">Enriched</span>;
  if (entry.enrichmentRunId) return <span className="codascope-scope-enriching-badge">Enriching…</span>;
  return <span className="codascope-scope-queued-badge">Queued</span>;
}
