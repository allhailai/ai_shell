/* ── CodaScope: Wiki Topic Policy ────────────────────────────────────
   Pure classification helpers for deciding whether a wiki page contains
   substantive, user-facing documentation.
   ──────────────────────────────────────────────────────────────────── */

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HEADING_RE = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$).*$/gm;

const PLACEHOLDER_ONLY_PATTERNS = [
  /^(?:todo|tbd)(?:\s*[:.!-]\s*.*)?$/i,
  /^(?:coming|available)\s+soon(?:\s*[:.!-]\s*.*)?$/i,
  /^(?:content|documentation|details?|information)\s+(?:is\s+)?(?:coming|available|forthcoming)\s+soon[.!]?$/i,
  /^(?:content|documentation|details?|information)\s+(?:to\s+be\s+)?(?:added|written|documented|completed)[.!]?$/i,
  /^(?:to\s+be\s+)?(?:added|written|documented|completed)[.!]?$/i,
  /^(?:not\s+yet|currently\s+not)\s+(?:available|documented|written|implemented)[.!]?$/i,
  /^(?:work|page|section|document)\s+in\s+progress[.!]?$/i,
  /^(?:placeholder|stub)(?:\s+(?:content|text|page|section))?[.!]?$/i,
  /^(?:this\s+)?(?:page|section|topic|document)\s+(?:is\s+)?(?:a\s+)?(?:placeholder|stub|under\s+construction)[.!]?$/i,
  /^(?:under\s+construction)[.!]?$/i,
];

/** Index and underscore-prefixed pages are implementation/system topics. */
export function isSystemWikiTopicId(topicId: string): boolean {
  const normalized = topicId.trim().toLowerCase();
  return normalized === "index" || normalized === "_index" || normalized.startsWith("_");
}

/**
 * Return the prose that remains after markdown-only structure and comments
 * are ignored. This intentionally preserves short, legitimate prose.
 */
export function substantiveWikiText(content: string): string {
  return content
    .replace(FRONTMATTER_RE, "")
    .replace(HTML_COMMENT_RE, "")
    .replace(HEADING_RE, "")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, "")
      .replace(/^[ \t]*>[ \t]?/, "")
      .replace(/[`*_~]+/g, "")
      .trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Whether content is made entirely from recognized placeholder boilerplate. */
export function isPlaceholderOnlyWikiText(content: string): boolean {
  const text = substantiveWikiText(content);
  if (!text) return false;

  const statements = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return statements.length > 0
    && statements.every((statement) => PLACEHOLDER_ONLY_PATTERNS.some((pattern) => pattern.test(statement)));
}

/** Apply the authoritative workspace substantive-topic policy. */
export function isSubstantiveWikiTopic(topicId: string, content: string): boolean {
  if (isSystemWikiTopicId(topicId)) return false;
  const text = substantiveWikiText(content);
  return Boolean(text) && !isPlaceholderOnlyWikiText(text);
}
