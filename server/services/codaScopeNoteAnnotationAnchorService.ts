/* ── CodaScope: Note Annotation Anchor Service ────────────────────────
   Pure parser and Markdown transforms for durable inline annotation anchors.

   The grammar is deliberately small. This module never searches for a quote
   to place a pin: it either validates an explicit marker pair or reports why
   the pair cannot be trusted.
   ──────────────────────────────────────────────────────────────────── */

export const INLINE_ANNOTATION_ID_RE = /^nann_[a-f0-9]{12,64}$/;

export type AnnotationMarkerIssue =
  | "malformed_marker"
  | "unmatched_marker"
  | "duplicate_marker"
  | "crossing_markers";

export interface InlineAnnotationMarker {
  id: string;
  kind: "start" | "end";
  from: number;
  to: number;
  text: string;
}

export interface InlineAnnotationRange {
  id: string;
  startMarkerFrom: number;
  startMarkerTo: number;
  endMarkerFrom: number;
  endMarkerTo: number;
  rangeFrom: number;
  rangeTo: number;
}

export interface InlineAnnotationParseResult {
  markers: InlineAnnotationMarker[];
  ranges: InlineAnnotationRange[];
  issuesById: Record<string, AnnotationMarkerIssue[]>;
}

export interface InsertInlineAnnotationAnchorOptions {
  id: string;
  from: number;
  to: number;
  selectedText: string;
}

const STRICT_MARKER_RE = /<!--\s*codascope:ann-(start|end)\s+id="([^"]+)"\s*-->/g;
const ANNOTATION_COMMENT_RE = /<!--\s*codascope:ann-(start|end)\b[\s\S]*?-->/g;

export function annotationStartMarker(id: string): string {
  return `<!-- codascope:ann-start id="${id}" -->`;
}

export function annotationEndMarker(id: string): string {
  return `<!-- codascope:ann-end id="${id}" -->`;
}

/** Parse only marker comments that are outside fenced and inline code syntax. */
export function parseInlineAnnotationAnchors(markdown: string): InlineAnnotationParseResult {
  const issues = new Map<string, Set<AnnotationMarkerIssue>>();
  const markers: InlineAnnotationMarker[] = [];
  const seenMarkerStarts = new Set<number>();

  const addIssue = (id: string, issue: AnnotationMarkerIssue) => {
    const entry = issues.get(id) ?? new Set<AnnotationMarkerIssue>();
    entry.add(issue);
    issues.set(id, entry);
  };

  // First surface malformed annotation comments for a recognisable nann ID.
  for (const candidate of markerCommentMatches(markdown)) {
    if (isCodeSyntax(markdown, candidate.index)) continue;
    const strict = candidate[0].match(/^<!--\s*codascope:ann-(?:start|end)\s+id="([^"]+)"\s*-->$/);
    const id = strict?.[1] ?? candidate[0].match(/\bid="([^"]+)"/)?.[1];
    if (!strict || !id || !INLINE_ANNOTATION_ID_RE.test(id)) {
      if (id?.startsWith("nann_")) addIssue(id, "malformed_marker");
    }
  }

  STRICT_MARKER_RE.lastIndex = 0;
  for (let match = STRICT_MARKER_RE.exec(markdown); match; match = STRICT_MARKER_RE.exec(markdown)) {
    if (isCodeSyntax(markdown, match.index)) continue;
    seenMarkerStarts.add(match.index);
    const id = match[2];
    if (!INLINE_ANNOTATION_ID_RE.test(id)) {
      addIssue(id, "malformed_marker");
      continue;
    }
    markers.push({
      id,
      kind: match[1] as "start" | "end",
      from: match.index,
      to: match.index + match[0].length,
      text: match[0],
    });
  }

  // Defensive: a loose matcher that was not considered by the strict loop is
  // malformed, even if it happens to resemble a marker.
  for (const candidate of markerCommentMatches(markdown)) {
    if (seenMarkerStarts.has(candidate.index) || isCodeSyntax(markdown, candidate.index)) continue;
    const id = candidate[0].match(/\bid="([^"]+)"/)?.[1];
    if (id?.startsWith("nann_")) addIssue(id, "malformed_marker");
  }

  markers.sort((a, b) => a.from - b.from);
  const starts = new Map<string, InlineAnnotationMarker[]>();
  const ends = new Map<string, InlineAnnotationMarker[]>();
  for (const marker of markers) {
    const target = marker.kind === "start" ? starts : ends;
    const list = target.get(marker.id) ?? [];
    list.push(marker);
    target.set(marker.id, list);
  }
  for (const [id, list] of starts) if (list.length !== 1) addIssue(id, "duplicate_marker");
  for (const [id, list] of ends) if (list.length !== 1) addIssue(id, "duplicate_marker");

  const stack: InlineAnnotationMarker[] = [];
  const pairs = new Map<string, { start: InlineAnnotationMarker; end: InlineAnnotationMarker }>();
  for (const marker of markers) {
    if (marker.kind === "start") {
      stack.push(marker);
      continue;
    }

    if (stack.length === 0) {
      addIssue(marker.id, "unmatched_marker");
      continue;
    }

    const top = stack[stack.length - 1];
    if (top.id !== marker.id) {
      addIssue(marker.id, "crossing_markers");
      addIssue(top.id, "crossing_markers");
      const matchingStart = stack.map((item) => item.id).lastIndexOf(marker.id);
      if (matchingStart >= 0) {
        for (const dangling of stack.splice(matchingStart)) addIssue(dangling.id, "crossing_markers");
      }
      continue;
    }

    stack.pop();
    if (pairs.has(marker.id)) addIssue(marker.id, "duplicate_marker");
    else pairs.set(marker.id, { start: top, end: marker });
  }
  for (const dangling of stack) addIssue(dangling.id, "unmatched_marker");

  const ranges: InlineAnnotationRange[] = [];
  for (const [id, pair] of pairs) {
    if (issues.has(id) || starts.get(id)?.length !== 1 || ends.get(id)?.length !== 1) continue;
    ranges.push({
      id,
      startMarkerFrom: pair.start.from,
      startMarkerTo: pair.start.to,
      endMarkerFrom: pair.end.from,
      endMarkerTo: pair.end.to,
      rangeFrom: pair.start.to,
      rangeTo: pair.end.from,
    });
  }

  return {
    markers,
    ranges: ranges.sort((a, b) => a.rangeFrom - b.rangeFrom || a.rangeTo - b.rangeTo),
    issuesById: Object.fromEntries(Array.from(issues, ([id, values]) => [id, Array.from(values)])),
  };
}

/** Insert a paired marker around an explicitly verified source range. */
export function insertInlineAnnotationAnchors(
  markdown: string,
  options: InsertInlineAnnotationAnchorOptions,
): string {
  if (!INLINE_ANNOTATION_ID_RE.test(options.id)) throw new Error("Invalid annotation marker ID.");
  if (!Number.isInteger(options.from) || !Number.isInteger(options.to) || options.from < 0 || options.to <= options.from || options.to > markdown.length) {
    throw new Error("Annotation selection positions are invalid.");
  }
  if (!options.selectedText || markdown.slice(options.from, options.to) !== options.selectedText) {
    throw new Error("The selected text no longer matches the note content. Reload and try again.");
  }
  if (isCodeSyntax(markdown, options.from) || isCodeSyntax(markdown, options.to - 1)) {
    throw new Error("Annotations cannot be placed inside Markdown code syntax.");
  }

  const parsed = parseInlineAnnotationAnchors(markdown);
  if (parsed.markers.some((marker) => rangesIntersect(options.from, options.to, marker.from, marker.to))) {
    throw new Error("The selected text crosses an existing annotation marker. Select a visible range instead.");
  }

  const start = annotationStartMarker(options.id);
  const end = annotationEndMarker(options.id);
  return `${markdown.slice(0, options.from)}${start}${markdown.slice(options.from, options.to)}${end}${markdown.slice(options.to)}`;
}

/** Remove every well-formed marker for an annotation outside code syntax. */
export function removeInlineAnnotationAnchors(markdown: string, id: string): string {
  const parsed = parseInlineAnnotationAnchors(markdown);
  const removals = parsed.markers.filter((marker) => marker.id === id);
  if (removals.length === 0) return markdown;
  let result = markdown;
  for (const marker of removals.sort((a, b) => b.from - a.from)) {
    result = `${result.slice(0, marker.from)}${result.slice(marker.to)}`;
  }
  return result;
}

/** Remove annotation control syntax from search, snippets, and word counts. */
export function stripInlineAnnotationMarkers(markdown: string): string {
  const parsed = parseInlineAnnotationAnchors(markdown);
  let result = markdown;
  for (const marker of parsed.markers.sort((a, b) => b.from - a.from)) {
    result = `${result.slice(0, marker.from)}${result.slice(marker.to)}`;
  }
  return result;
}

export function annotationContext(markdown: string, from: number, to: number, limit = 80): { prefix: string; suffix: string } {
  return {
    prefix: markdown.slice(Math.max(0, from - limit), from),
    suffix: markdown.slice(to, Math.min(markdown.length, to + limit)),
  };
}

export function findExactTextOccurrences(markdown: string, quote: string): Array<{ from: number; to: number }> {
  if (!quote) return [];
  const matches: Array<{ from: number; to: number }> = [];
  for (let from = markdown.indexOf(quote); from >= 0; from = markdown.indexOf(quote, from + 1)) {
    const to = from + quote.length;
    if (!isCodeSyntax(markdown, from) && !isCodeSyntax(markdown, to - 1)) matches.push({ from, to });
  }
  return matches;
}

function markerCommentMatches(markdown: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  ANNOTATION_COMMENT_RE.lastIndex = 0;
  for (let match = ANNOTATION_COMMENT_RE.exec(markdown); match; match = ANNOTATION_COMMENT_RE.exec(markdown)) matches.push(match);
  return matches;
}

function rangesIntersect(from: number, to: number, otherFrom: number, otherTo: number): boolean {
  return from < otherTo && otherFrom < to;
}

function isCodeSyntax(markdown: string, offset: number): boolean {
  return isInsideFencedCode(markdown, offset) || isInsideInlineCode(markdown, offset);
}

function isInsideFencedCode(markdown: string, offset: number): boolean {
  let fence: "`" | "~" | null = null;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const next = markdown.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? markdown.length : next;
    if (lineStart > offset) break;
    const line = markdown.slice(lineStart, lineEnd);
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const wasInFence = fence !== null;
    if (match) {
      const char = match[1][0] as "`" | "~";
      if (!fence) fence = char;
      else if (fence === char) fence = null;
    }
    if (offset >= lineStart && offset <= lineEnd) return wasInFence || Boolean(match);
    if (next === -1) break;
    lineStart = next + 1;
  }
  return false;
}

function isInsideInlineCode(markdown: string, offset: number): boolean {
  let delimiterLength = 0;
  for (let index = 0; index < offset; index++) {
    if (markdown[index] !== "`") continue;
    let end = index + 1;
    while (markdown[end] === "`") end++;
    const runLength = end - index;
    if (delimiterLength === 0) delimiterLength = runLength;
    else if (delimiterLength === runLength) delimiterLength = 0;
    index = end - 1;
  }
  return delimiterLength !== 0;
}
