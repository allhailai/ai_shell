/* ── CodaScope: Web Search Service ───────────────────────────────────
   Encapsulates DuckDuckGo HTML scraping logic, previously inlined
   inside the `search_web` tool definition (~75 lines).
   ──────────────────────────────────────────────────────────────────── */

/** A single web search result. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web via DuckDuckGo's HTML interface.
 * Returns up to `maxResults` results (default 10).
 */
export async function searchWeb(
  query: string,
  maxResults = 10,
): Promise<WebSearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CodaScopeResearch/1.0)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: WebSearchResult[] = [];

  // Primary regex: DuckDuckGo structured result blocks
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: simpler regex for alternate HTML structures
  if (results.length === 0) {
    const simpleRegex =
      /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = simpleRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      if (url && title && url.startsWith("http")) {
        results.push({ title, url, snippet: "" });
      }
    }
  }

  return results;
}
