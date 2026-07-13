/* ── Highlight Markup Normalization ───────────────────────────────────
   Canonical syntax: ==text== or ==text=={.color-name}.

   Highlight edits always normalize the affected range before applying a new
   wrapper. This keeps multiple independent highlight colors valid while
   preventing nested ==...== markup.
   ──────────────────────────────────────────────────────────────────── */

export const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+)==(?:\{\.(\w+)\})?/g;

interface HighlightRange {
  from: number;
  to: number;
}

export interface HighlightMarkupEdit {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

function findHighlightRanges(documentText: string): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  HIGHLIGHT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HIGHLIGHT_RE.exec(documentText)) !== null) {
    const from = match.index;
    ranges.push({ from, to: from + match[0].length });
  }
  return ranges;
}

function getAffectedRange(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
): HighlightRange | null {
  let from = selectionFrom;
  let to = selectionTo;
  let found = false;
  let changed = true;
  const ranges = findHighlightRanges(documentText);

  while (changed) {
    changed = false;
    for (const range of ranges) {
      const intersects = from === to
        ? from >= range.from && from <= range.to
        : from < range.to && to > range.from;
      if (!intersects) continue;
      found = true;
      const nextFrom = Math.min(from, range.from);
      const nextTo = Math.max(to, range.to);
      if (nextFrom !== from || nextTo !== to) {
        from = nextFrom;
        to = nextTo;
        changed = true;
      }
    }
  }

  return found ? { from, to } : null;
}

/** Remove all canonical and legacy nested highlight wrappers from markup. */
export function stripHighlightMarkup(markup: string): string {
  let result = markup;
  // Each pass peels one nesting level. The bound prevents malformed input
  // from causing an unbounded normalization loop.
  for (let pass = 0; pass < 20; pass++) {
    HIGHLIGHT_RE.lastIndex = 0;
    const next = result
      .replace(HIGHLIGHT_RE, "$1")
      // A legacy nested run can be matched from an outer opening marker,
      // leaving an inner closure suffix behind. It has highlight syntax only
      // inside this selected normalization fragment, so discard it here.
      .replace(/\{\.\w+\}/g, "");
    if (next === result) break;
    result = next;
  }
  return result;
}

/**
 * Create the normalized edit for applying a highlight color. Any existing
 * highlighted runs intersecting the selection are flattened into one run.
 */
export function getHighlightApplyEdit(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
  colorName = "",
): HighlightMarkupEdit {
  const affected = getAffectedRange(documentText, selectionFrom, selectionTo);
  const from = affected?.from ?? selectionFrom;
  const to = affected?.to ?? selectionTo;
  const selected = documentText.slice(from, to);
  const content = (affected ? stripHighlightMarkup(selected) : selected) || "text";
  const suffix = colorName ? `{.${colorName}}` : "";
  const openLength = 2;

  return {
    from,
    to,
    insert: `==${content}==${suffix}`,
    selectionFrom: from + openLength,
    selectionTo: from + openLength + content.length,
  };
}

/** Remove every affected highlight wrapper without changing its text. */
export function getHighlightClearEdit(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
): HighlightMarkupEdit | null {
  const affected = getAffectedRange(documentText, selectionFrom, selectionTo);
  if (!affected) return null;
  const insert = stripHighlightMarkup(documentText.slice(affected.from, affected.to));
  return {
    from: affected.from,
    to: affected.to,
    insert,
    selectionFrom: affected.from,
    selectionTo: affected.from + insert.length,
  };
}
