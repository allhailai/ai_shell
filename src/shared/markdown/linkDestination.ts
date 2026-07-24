const SAFE_PROTOCOL_RE = /^(https?|ircs?|mailto|xmpp)$/i;
const SCHEMELESS_WEB_RE = /^www\./i;

/**
 * Normalizes a Markdown link destination for browser navigation while keeping
 * the same protocol allowlist as react-markdown's default URL transform.
 *
 * Markdown treats `www.example.com` as a relative destination. In AIShell's
 * browser-based viewers that would incorrectly resolve inside the current app,
 * so web-looking destinations receive an explicit HTTPS scheme.
 */
export function normalizeMarkdownLinkHref(destination: string): string {
  const value = destination.trim();
  if (!value) return "";

  const normalized = SCHEMELESS_WEB_RE.test(value) ? `https://${value}` : value;
  const colon = normalized.indexOf(":");
  const questionMark = normalized.indexOf("?");
  const numberSign = normalized.indexOf("#");
  const slash = normalized.indexOf("/");

  if (
    colon === -1
    || (slash !== -1 && colon > slash)
    || (questionMark !== -1 && colon > questionMark)
    || (numberSign !== -1 && colon > numberSign)
    || SAFE_PROTOCOL_RE.test(normalized.slice(0, colon))
  ) {
    return normalized;
  }

  return "";
}
