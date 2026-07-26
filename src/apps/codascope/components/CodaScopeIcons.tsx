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

/** Document with lines — Notes */
export function IconNotes({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
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

/** Paper plane — Send */
export function IconSend({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M14 2L2 7l5 2 2 5 5-12z" />
      <path d="M7 9l3-3" />
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

/** Layered blueprint — Epic Design */
export function IconEpic({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="3" width="8" height="10" rx="1" />
      <path d="M5 1h8a1 1 0 011 1v10" />
      <line x1="5.5" y1="6" x2="8.5" y2="6" />
      <line x1="5.5" y1="8.5" x2="9" y2="8.5" />
      <line x1="5.5" y1="11" x2="7.5" y2="11" />
    </svg>
  );
}

/** Speech bubble with line — Comment / Annotation */
export function IconAnnotation({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v6a1 1 0 01-1 1H6l-3 3V3z" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" />
      <line x1="5" y1="7.5" x2="9" y2="7.5" />
    </svg>
  );
}

/** Plus in circle — Insert */
export function IconInsert({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="5" x2="8" y2="11" />
      <line x1="5" y1="8" x2="11" y2="8" />
    </svg>
  );
}

/** Two stacked arrows — Rewrite / Replace */
export function IconRewrite({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M12 4H5.5" />
      <polyline points="7.5,2 5.5,4 7.5,6" />
      <path d="M4 12h6.5" />
      <polyline points="8.5,10 10.5,12 8.5,14" />
    </svg>
  );
}

/** Lines expanding outward — Expand */
export function IconExpand({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="4" y1="4" x2="12" y2="4" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  );
}

/** Wand / sparkle — Generate */
export function IconGenerate({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="3" y1="13" x2="13" y2="3" />
      <path d="M10 2l1.5.5.5 1.5.5-1.5L14 2l-1.5-.5L12 0l-.5 1.5z" />
      <path d="M4 8l1 .3.3 1 .3-1L6.6 8l-1-.3L5.3 6.7 5 7.7z" />
    </svg>
  );
}

/** X mark — Close */
export function IconClose({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

/** Trash can outline — Delete */
export function IconDelete({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M3 4h10l-.75 9a1 1 0 01-1 1H4.75a1 1 0 01-1-1L3 4z" />
      <line x1="2" y1="4" x2="14" y2="4" />
      <path d="M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4" />
    </svg>
  );
}

/** Pencil — Edit / Rename */
export function IconEdit({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M3 11.5V14h2.5L13 6.5 9.5 3 2 10.5z" />
      <path d="M8.75 3.75l3.5 3.5" />
      <path d="M2 14h12" />
    </svg>
  );
}

/** Counterclockwise arrow — Undo */
export function IconUndo({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M4 7a5 5 0 119 3" />
      <polyline points="2,4.5 4,7 6.5,4.5" />
    </svg>
  );
}

/** Person outline — User */
export function IconUser({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}

/** Circuit node — Agent / Bot */
export function IconAgent({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="4" width="10" height="8" rx="1.5" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <line x1="8" y1="2" x2="8" y2="4" />
      <line x1="6" y1="1.5" x2="10" y2="1.5" />
    </svg>
  );
}

/** Arrow reply — Reply */
export function IconReply({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M6 4L2 8l4 4" />
      <path d="M2 8h8a4 4 0 014 4" />
    </svg>
  );
}

/** Checkmark — Resolve / Done */
export function IconCheckmark({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="3,8 6.5,11.5 13,5" />
    </svg>
  );
}

/** Hourglass — Pending / Loading */
export function IconPending({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M4 2h8v3L9 8l3 3v3H4v-3l3-3-3-3V2z" />
      <line x1="4" y1="2" x2="12" y2="2" />
      <line x1="4" y1="14" x2="12" y2="14" />
    </svg>
  );
}

/** Horizontal lines with plus — Insert content directive */
export function IconInsertContent({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="12" x2="14" y2="12" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <line x1="6.5" y1="8" x2="9.5" y2="8" />
    </svg>
  );
}

/** Layered arrows with center dot — Curation/synthesis */
export function IconCurate({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M3 8a5 5 0 018.5-3.5" />
      <polyline points="11.5,2 11.5,4.5 9,4.5" />
      <path d="M13 8a5 5 0 01-8.5 3.5" />
      <polyline points="4.5,14 4.5,11.5 7,11.5" />
      <circle cx="8" cy="8" r="1.25" />
    </svg>
  );
}

/** Checkmark circle — Success/complete */
export function IconCheckCircle({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <polyline points="5.5,8 7.5,10 10.5,6" />
    </svg>
  );
}

/** Warning triangle — Error/warning */
export function IconWarning({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 2L1.5 13h13L8 2z" />
      <line x1="8" y1="6" x2="8" y2="9.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Open book — Knowledge/research */
export function IconKnowledge({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 3c1.5-1 3.5-1 6 0v10c-2.5-1-4.5-1-6 0V3z" />
      <path d="M14 3c-1.5-1-3.5-1-6 0v10c2.5-1 4.5-1 6 0V3z" />
    </svg>
  );
}

/** Upload arrow — File upload */
export function IconUpload({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 11V3" />
      <path d="M4.5 6.5L8 3l3.5 3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

/** Download arrow — File download */
export function IconDownload({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 3v8" />
      <path d="M4.5 7.5L8 11l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

/** External link — Open in new tab */
export function IconExternalLink({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
      <path d="M10 2.5h3.5V6" />
      <path d="M7 9L13.5 2.5" />
    </svg>
  );
}

/** Eye — View/preview */
export function IconEye({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

/** Shield with X — Blocked download */
export function IconBlocked({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z" />
      <path d="M6 6l4 4" />
      <path d="M10 6l-4 4" />
    </svg>
  );
}

/** Overlapping rectangles — Copy to clipboard */
export function IconCopy({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </svg>
  );
}

/** Question mark in circle — Help / Info */
export function IconHelp({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6 6.5a2 2 0 0 1 3.9.5c0 1-1.4 1.5-1.9 2" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Right-pointing arrow — Navigation / CTA */
export function IconArrowRight({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  );
}

/** Left-pointing arrow — Back navigation */
export function IconArrowLeft({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M13 8H3" />
      <path d="M7 4 3 8l4 4" />
    </svg>
  );
}

/** Grid/compass — Map / Explore */
export function IconMap({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 3.5l4-1.5v10L2 13.5V3.5z" />
      <path d="M6 2l4 2v10l-4-2V2z" />
      <path d="M10 4l4-1.5V13l-4 1V4z" />
    </svg>
  );
}

/** Open book with pages — Build Wiki */
export function IconBook({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 2.5v10a1 1 0 001 1h10a1 1 0 001-1v-10" />
      <path d="M2 2.5C2 2.5 4 1 8 1s6 1.5 6 1.5" />
      <line x1="8" y1="1" x2="8" y2="13.5" />
      <line x1="5" y1="5" x2="7" y2="5" />
      <line x1="5" y1="7.5" x2="7" y2="7.5" />
      <line x1="9" y1="5" x2="11" y2="5" />
      <line x1="9" y1="7.5" x2="11" y2="7.5" />
    </svg>
  );
}

/** Shield with checkmark — Quality / Protect */
export function IconShield({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z" />
      <polyline points="5.5,8 7,9.5 10.5,6" />
    </svg>
  );
}

/** Clipboard with checklist — Plan / Epic */
export function IconPlan({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="3" y="3" width="10" height="11" rx="1" />
      <path d="M6 1h4v3H6z" />
      <line x1="5.5" y1="7" x2="6.5" y2="7" />
      <line x1="8" y1="7" x2="10.5" y2="7" />
      <line x1="5.5" y1="9.5" x2="6.5" y2="9.5" />
      <line x1="8" y1="9.5" x2="10.5" y2="9.5" />
      <line x1="5.5" y1="12" x2="6.5" y2="12" />
      <line x1="8" y1="12" x2="10.5" y2="12" />
    </svg>
  );
}



/** Browser viewport with code brackets — Visual Artifact */
export function IconArtifact({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
      <line x1="1.5" y1="5" x2="14.5" y2="5" />
      <circle cx="3.5" cy="3.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="3.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="3.5" r="0.5" fill="currentColor" stroke="none" />
      <polyline points="5.5,8 4,10 5.5,12" />
      <polyline points="10.5,8 12,10 10.5,12" />
      <line x1="7" y1="12" x2="9" y2="8" />
    </svg>
  );
}

/** Thumbtack — Pin */
export function IconPin({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M9.5 2.5L13.5 6.5L10 10L9 13L3 7L6 6L9.5 2.5Z" />
      <line x1="3" y1="13" x2="5.5" y2="10.5" />
    </svg>
  );
}

/** Filled thumbtack — Pinned */
export function IconPinFilled({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <path d="M9.5 2.5L13.5 6.5L10 10L9 13L3 7L6 6L9.5 2.5Z" />
      <line x1="3" y1="13" x2="5.5" y2="10.5" />
    </svg>
  );
}

/** Box with down arrow — Archive */
export function IconArchive({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 4.5h12L13 2.5H3L2 4.5z" />
      <path d="M2 4.5v8a1 1 0 001 1h10a1 1 0 001-1v-8" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <polyline points="6,9.5 8,11 10,9.5" />
    </svg>
  );
}

/** Box with up arrow — Restore from archive */
export function IconUnarchive({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 4.5h12L13 2.5H3L2 4.5z" />
      <path d="M2 4.5v8a1 1 0 001 1h10a1 1 0 001-1v-8" />
      <line x1="8" y1="11" x2="8" y2="7" />
      <polyline points="6,8.5 8,7 10,8.5" />
    </svg>
  );
}

/** Down arrow into branch — Git pull */
export function IconGitPull({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 2v7" />
      <path d="M5 6.5L8 9.5l3-3" />
      <circle cx="8" cy="12.5" r="1.5" />
    </svg>
  );
}

/** Speech bubble — Comments / Annotations */
export function IconComment({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H6l-3 2.5V11H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <line x1="5" y1="6" x2="11" y2="6" />
      <line x1="5" y1="8.5" x2="9" y2="8.5" />
    </svg>
  );
}

/** Arrow into box — Move */
export function IconMove({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2" y="5" width="12" height="8" rx="1.5" />
      <path d="M8 2v6" />
      <polyline points="5.5,5.5 8,8 10.5,5.5" />
    </svg>
  );
}

/** Bold B — Formatting toolbar */
export function IconBold({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M5 3h4a2.5 2.5 0 010 5H5V3z" />
      <path d="M5 8h5a2.5 2.5 0 010 5H5V8z" />
    </svg>
  );
}

/** Italic I — Formatting toolbar */
export function IconItalic({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="9.5" y1="3" x2="6.5" y2="13" />
      <line x1="7" y1="3" x2="11" y2="3" />
      <line x1="5" y1="13" x2="9" y2="13" />
    </svg>
  );
}

/** Strikethrough S — Formatting toolbar */
export function IconStrikethrough({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M5.5 4.5C5.5 3.67 6.62 3 8 3c1.38 0 2.5.67 2.5 1.5 0 .5-.3.96-.8 1.25" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <path d="M10.5 11.5c0 .83-1.12 1.5-2.5 1.5s-2.5-.67-2.5-1.5c0-.5.3-.96.8-1.25" />
    </svg>
  );
}

/** Code brackets — Inline code formatting */
export function IconInlineCode({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="5.5,4 2.5,8 5.5,12" />
      <polyline points="10.5,4 13.5,8 10.5,12" />
    </svg>
  );
}

/** Highlighter pen — Highlight formatting */
export function IconHighlight({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M5.9 11.5L12.7 4.7a2 2 0 10-2.8-2.8L3.1 8.7z" />
      <path d="M3.1 8.7L1.5 11.3a1 1 0 001.4 1.4l2.6-1.6" />
      <path d="M1.25 14h13.5" />
    </svg>
  );
}

/** Chain link — Link formatting */
export function IconLink({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M7 9a3 3 0 004.24 0l2-2a3 3 0 00-4.24-4.24L7.76 3.88" />
      <path d="M9 7a3 3 0 00-4.24 0l-2 2a3 3 0 004.24 4.24l1.24-1.12" />
    </svg>
  );
}

/** H with level — Heading formatting */
export function IconHeading({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <line x1="3" y1="3" x2="3" y2="13" />
      <line x1="10" y1="3" x2="10" y2="13" />
      <line x1="3" y1="8" x2="10" y2="8" />
    </svg>
  );
}

/** Checkbox square — Checklist formatting */
export function IconChecklist({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <polyline points="3.5,4.5 4.5,5.5 6,3.5" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <line x1="9" y1="4.5" x2="14" y2="4.5" />
      <line x1="9" y1="11.5" x2="14" y2="11.5" />
    </svg>
  );
}

/** Chevron down — Dropdown indicator */
export function IconChevronDown({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

/** Chevron up — Previous item indicator */
export function IconChevronUp({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="4,10 8,6 12,10" />
    </svg>
  );
}

/** Color palette — Highlight color picker */
export function IconPalette({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Text color — "A" with color underline */
export function IconTextColor({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M5 12L8 3l3 9" />
      <line x1="6" y1="9.5" x2="10" y2="9.5" />
      <line x1="3" y1="14" x2="13" y2="14" strokeWidth="2" />
    </svg>
  );
}

/** Plus circle — Add button */
export function IconPlus({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="5" x2="8" y2="11" />
      <line x1="5" y1="8" x2="11" y2="8" />
    </svg>
  );
}

/** Star outline — for un-starred state */
export function IconStar({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 1.5l2 4 4.5.7-3.25 3.1.75 4.5L8 11.5l-4 2.3.75-4.5L1.5 6.2l4.5-.7z" />
    </svg>
  );
}

/** Star filled — for starred state */
export function IconStarFilled({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <path d="M8 1.5l2 4 4.5.7-3.25 3.1.75 4.5L8 11.5l-4 2.3.75-4.5L1.5 6.2l4.5-.7z" />
    </svg>
  );
}

/** Inbox tray — for inbox/capture */
export function IconInbox({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="4.5 6 8 9.5 11.5 6" />
      <line x1="8" y1="1.5" x2="8" y2="9.5" />
      <path d="M2.5 9.5H5l1 2h4l1-2h2.5v4h-11z" />
    </svg>
  );
}

/** Quick capture — lightning bolt */
export function IconCapture({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M9 1.5L4 9h4l-1 5.5L12 7H8z" />
    </svg>
  );
}

/** Tag / label */
export function IconTag({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M1.5 2.5h5l7 7-5 5-7-7z" />
      <circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Empty checkbox */
export function IconCheckbox({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    </svg>
  );
}

/** Checked checkbox */
export function IconCheckboxChecked({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <polyline points="5.5 8 7.5 10 10.5 6" />
    </svg>
  );
}

/** Activity / timeline pulse */
export function IconActivity({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <polyline points="1.5 8 4 8 5.5 4 8 12 10 6 11.5 8 14.5 8" />
    </svg>
  );
}

/** Draft (pencil in circle) */
export function IconDraft({ size = 16, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6 10.5l-.5-2L9.5 4.5l2 2L7.5 10.5z" />
      <line x1="5.5" y1="10.5" x2="7.5" y2="10.5" />
    </svg>
  );
}
