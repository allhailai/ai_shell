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

/** Folder — assessments list */
export function IconAssessments({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5H12.5A1.5 1.5 0 0114 6v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-8z" />
    </svg>
  );
}

/** Plus — create-assessment context */
export function IconNew({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** Layout — workspace overview */
export function IconOverview({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
    </svg>
  );
}

/** Overlapping marks — candidate analogs (future) */
export function IconAnalogs({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <circle cx="6" cy="8" r="3.5" />
      <circle cx="10" cy="8" r="3.5" />
    </svg>
  );
}

/** Document — evidence / sources (future) */
export function IconEvidence({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M4 2.5h5.5L12 5v8.5H4v-11z" />
      <path d="M9.5 2.5V5H12" />
      <path d="M6 8h4M6 10.5h4" />
    </svg>
  );
}

/** Upload arrow — package file picker */
export function IconUpload({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 11V3" />
      <path d="M4.5 6.5L8 3l3.5 3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

/** Book — structured knowledge (future) */
export function IconKnowledge({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} style={style} className={className}>
      <path d="M8 3.5C6.5 2.5 4.5 2 2.5 2.5v10c2-.5 4 0 5.5 1" />
      <path d="M8 3.5c1.5-1 3.5-1.5 5.5-1v10c-2-.5-4 0-5.5 1" />
    </svg>
  );
}
