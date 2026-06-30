/* ── CodaScope: Centralized Icon Components ──────────────────────────
   Clean, conceptual inline SVG icons — NO skeuomorphic emoji.

   Design rules:
   - viewBox="0 0 16 16" (default for nav/inline use)
   - fill="none", stroke="currentColor", strokeWidth="1.5"
   - strokeLinecap="round", strokeLinejoin="round"
   - Geometric, minimal, conceptual forms
   - Each component accepts { size?: number } (defaults to 16)
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

const defaults = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Grid/tiles — Dashboard */
export function IconDashboard({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="3" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="7" width="5" height="7" rx="1" />
    </svg>
  );
}

/** Open book — Wiki */
export function IconWiki({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 3C6.5 2 4.5 1.5 2 2v10c2.5-.5 4.5 0 6 1" />
      <path d="M8 3c1.5-1 3.5-1.5 6-1v10c-2.5-.5-4.5 0-6 1" />
    </svg>
  );
}

/** Speech bubble — Chat */
export function IconChat({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
    </svg>
  );
}

/** Bar chart — Quality */
export function IconQuality({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="4" y1="13" x2="4" y2="7" />
      <line x1="8" y1="13" x2="8" y2="3" />
      <line x1="12" y1="13" x2="12" y2="9" />
    </svg>
  );
}

/** Shield with check — Golden Rules */
export function IconRules({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z" />
      <path d="M6 8l1.5 1.5L10 6.5" />
    </svg>
  );
}

/** Network/nodes — Concepts */
export function IconConcepts({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <line x1="6.5" y1="5.5" x2="5" y2="10.5" />
      <line x1="9.5" y1="5.5" x2="11" y2="10.5" />
    </svg>
  );
}

/** Wrench — Skills */
export function IconSkills({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M10.5 2a3.5 3.5 0 00-3.2 4.8L3 11.2V13h1.8l4.4-4.3A3.5 3.5 0 1010.5 2z" />
    </svg>
  );
}

/** Gear — Settings */
export function IconSettings({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" />
    </svg>
  );
}

/** Folder outline — Projects */
export function IconFolder({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" />
    </svg>
  );
}

/** Folder open — Browse */
export function IconFolderOpen({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 4.5V5h10a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5A1 1 0 013 3.5h3.5L8 5" />
      <path d="M2 7l1.5-1h11L13 12H3" />
    </svg>
  );
}

/** Arrow up-right — Setup / Launch */
export function IconLaunch({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M6 3h7v7" />
      <path d="M13 3L3 13" />
    </svg>
  );
}

/** File tree / sitemap — Code Map */
export function IconCodeMap({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="5.5" y="1" width="5" height="3" rx="0.75" />
      <rect x="1" y="10" width="4.5" height="3" rx="0.75" />
      <rect x="10.5" y="10" width="4.5" height="3" rx="0.75" />
      <line x1="8" y1="4" x2="8" y2="7" />
      <line x1="3.25" y1="10" x2="3.25" y2="7" />
      <line x1="12.75" y1="10" x2="12.75" y2="7" />
      <line x1="3.25" y1="7" x2="12.75" y2="7" />
    </svg>
  );
}

/** Magnifying glass — Search / Analyze */
export function IconSearch({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

/** Box outline — Package / Repos */
export function IconPackage({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" />
      <line x1="8" y1="8" x2="8" y2="14" />
      <line x1="2" y1="5" x2="8" y2="8" />
      <line x1="14" y1="5" x2="8" y2="8" />
    </svg>
  );
}

/** Key outline — API Key */
export function IconKey({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="5.5" cy="10" r="3.5" />
      <path d="M8.5 7.5L14 2" />
      <path d="M11 5l2-1" />
    </svg>
  );
}

/** Link chain — Cross-cutting */
export function IconLink({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M7 9l2-2" />
      <path d="M5.5 7.5L3.3 9.7a2.5 2.5 0 003.5 3.5l2.2-2.2" />
      <path d="M10.5 8.5l2.2-2.2a2.5 2.5 0 00-3.5-3.5L7 5" />
    </svg>
  );
}

/** Star sparkle — Features */
export function IconSparkle({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" />
    </svg>
  );
}

/** Lightning bolt — Performance */
export function IconBolt({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M9 1L4 9h4l-1 6 5-8H8l1-6z" />
    </svg>
  );
}

/** Building blocks — Architecture */
export function IconArchitecture({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2" y="9" width="5" height="5" rx="0.5" />
      <rect x="9" y="9" width="5" height="5" rx="0.5" />
      <rect x="5.5" y="2" width="5" height="5" rx="0.5" />
    </svg>
  );
}

/** Lock — Security */
export function IconLock({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d="M5 7V5a3 3 0 016 0v2" />
    </svg>
  );
}

/** Flask — Testing */
export function IconFlask({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M6 2v4L2.5 12a1 1 0 00.9 1.5h9.2a1 1 0 00.9-1.5L10 6V2" />
      <line x1="5" y1="2" x2="11" y2="2" />
      <line x1="4" y1="9.5" x2="12" y2="9.5" />
    </svg>
  );
}

/** Paintbrush — Style */
export function IconPaintbrush({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M13 2L7 8" />
      <path d="M7 8c-1.5-.5-3 .5-3.5 2S2 13 2 13s2.5-.5 3.5-1 2.5-2 2-3.5" />
    </svg>
  );
}

/** Circular arrows — Complexity / Refresh */
export function IconRefresh({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5" />
      <path d="M13.5 8a5.5 5.5 0 01-9.5 3.5" />
      <polyline points="12,2 12,5 9,5" />
      <polyline points="4,14 4,11 7,11" />
    </svg>
  );
}

/** Clock — Loading / Waiting */
export function IconClock({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,4 8,8 11,10" />
    </svg>
  );
}

/** Checkmark circle — All clear */
export function IconCheck({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <polyline points="5.5,8 7.5,10 10.5,6" />
    </svg>
  );
}

/** File — Document / Page */
export function IconFile({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
      <polyline points="9,2 9,6 13,6" />
    </svg>
  );
}

/** Clipboard list — Duplication */
export function IconClipboard({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="3" width="10" height="11" rx="1" />
      <path d="M6 1h4v3H6z" />
      <line x1="6" y1="7.5" x2="10" y2="7.5" />
      <line x1="6" y1="10" x2="10" y2="10" />
    </svg>
  );
}

/** House — Wiki home / index page */
export function IconHome({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 8l6-5.5L14 8" />
      <path d="M3.5 9v4.5a1 1 0 001 1h7a1 1 0 001-1V9" />
      <rect x="6.5" y="10" width="3" height="4.5" />
    </svg>
  );
}

