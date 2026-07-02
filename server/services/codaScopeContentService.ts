/* ── CodaScope: Content Download & Extraction Service ────────────────
   Handles deterministic downloading of URLs and extraction of content
   into clean markdown format.

   Supported content types:
   - HTML → clean markdown (via turndown, with boilerplate stripping)
   - PDF → full text extraction (via pdf-parse, with diagram notes)
   - Markdown/text → stored as-is
   - Images → stored as-is (no text extraction)
   - Other → best-effort text read
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  contentType?: string;
  sizeBytes?: number;
  error?: string;
  blocked?: boolean;
  blockReason?: string;
}

/* ── Blocked content detection ──────────────────────────────────────── */

/** Text patterns that indicate paywalled or bot-blocked content. */
const PAYWALL_INDICATORS = [
  "subscribe to continue",
  "subscribe to read",
  "paywall",
  "sign in to continue",
  "create a free account",
  "this content is for subscribers",
  "premium content",
  "you've reached your limit",
  "article limit reached",
  "please log in",
  "access denied",
];

/** HTTP status codes that indicate blocked access. */
const BLOCKED_STATUS_CODES = new Set([401, 403, 429, 451]);

/** User-Agent header for polite crawling. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; CodaScopeResearch/1.0; +https://github.com/all-hail-ai)";

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeContentService {
  /* ── Downloading ──────────────────────────────────────────────────── */

  /**
   * Download content from a URL to a destination directory.
   * Returns a structured result indicating success, failure, or blocked status.
   */
  async downloadUrl(url: string, destDir: string): Promise<DownloadResult> {
    try {
      // Validate URL
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { success: false, error: `Unsupported protocol: ${parsed.protocol}` };
      }

      // Fetch with timeout and proper headers
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s timeout

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          redirect: "follow",
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("abort") || msg.includes("timeout")) {
          return { success: false, blocked: true, blockReason: "timeout" };
        }
        return { success: false, error: `Fetch failed: ${msg}` };
      } finally {
        clearTimeout(timeoutId);
      }

      // Check for blocked status codes
      if (BLOCKED_STATUS_CODES.has(response.status)) {
        return {
          success: false,
          blocked: true,
          blockReason: `HTTP ${response.status} — ${response.statusText}`,
        };
      }

      // Check for non-success status
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Read body
      const buffer = Buffer.from(await response.arrayBuffer());

      // Check for paywall indicators in HTML content
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const textSample = buffer.toString("utf-8").toLowerCase().slice(0, 10_000);
        for (const indicator of PAYWALL_INDICATORS) {
          if (textSample.includes(indicator)) {
            return {
              success: false,
              blocked: true,
              blockReason: `paywall detected: "${indicator}"`,
            };
          }
        }
      }

      // Determine file extension from content type
      const ext = this.extFromContentType(contentType, url);

      // Store the file
      mkdirSync(destDir, { recursive: true });
      const filePath = path.join(destDir, `original.${ext}`);
      writeFileSync(filePath, buffer);

      return {
        success: true,
        filePath,
        contentType,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /* ── Content Extraction ───────────────────────────────────────────── */

  /**
   * Extract content from a file to clean markdown.
   * Produces COMPLETE content, not summaries. Strips boilerplate noise
   * but preserves all substantive content.
   */
  async extractToMarkdown(filePath: string, contentType: string): Promise<string> {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const normalizedType = contentType.toLowerCase().split(";")[0].trim();

    // HTML
    if (normalizedType === "text/html" || normalizedType === "application/xhtml+xml") {
      return this.extractHtml(filePath);
    }

    // PDF
    if (normalizedType === "application/pdf") {
      return this.extractPdf(filePath);
    }

    // Markdown
    if (normalizedType === "text/markdown" || filePath.endsWith(".md")) {
      return readFileSync(filePath, "utf-8");
    }

    // Plain text (including CSV, JSON, XML, etc.)
    if (normalizedType.startsWith("text/") || normalizedType === "application/json" || normalizedType === "application/xml") {
      const content = readFileSync(filePath, "utf-8");
      return content;
    }

    // Images
    if (normalizedType.startsWith("image/")) {
      const filename = path.basename(filePath);
      return `[Image file: ${filename} — no text extraction available. The agent can describe the image if needed.]`;
    }

    // Other: try text extraction
    try {
      const content = readFileSync(filePath, "utf-8");
      return `> _Note: This content was extracted from a ${normalizedType} file. Formatting may be imperfect._\n\n${content}`;
    } catch {
      const filename = path.basename(filePath);
      return `[Binary file: ${filename} (${normalizedType}) — text extraction not available.]`;
    }
  }

  /* ── HTML Extraction ──────────────────────────────────────────────── */

  /**
   * Convert HTML to clean markdown, stripping boilerplate elements.
   */
  async extractHtml(filePath: string): Promise<string> {
    const html = readFileSync(filePath, "utf-8");

    // Dynamically import turndown (ESM compatibility)
    const TurndownService = (await import("turndown")).default;
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });

    // Strip boilerplate elements before conversion
    const cleanedHtml = this.stripHtmlBoilerplate(html);

    // Convert to markdown
    let markdown = turndown.turndown(cleanedHtml);

    // Post-processing cleanup
    markdown = this.cleanupMarkdown(markdown);

    return markdown;
  }

  /**
   * Remove boilerplate HTML elements (nav, footer, ads, scripts, etc.)
   */
  private stripHtmlBoilerplate(html: string): string {
    // Remove script and style tags with content
    let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
    cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

    // Remove common boilerplate elements
    const boilerplateTags = ["nav", "footer", "header", "aside"];
    for (const tag of boilerplateTags) {
      // Remove both self-closing and opening/closing pairs
      const regex = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi");
      cleaned = cleaned.replace(regex, "");
    }

    // Remove common boilerplate class patterns
    const boilerplateClasses = [
      "advertisement", "ad-container", "sidebar", "cookie-banner",
      "popup", "modal-overlay", "newsletter-signup", "social-share",
      "related-posts", "comments-section",
    ];
    for (const cls of boilerplateClasses) {
      const regex = new RegExp(`<[^>]*class="[^"]*\\b${cls}\\b[^"]*"[\\s\\S]*?<\\/[^>]+>`, "gi");
      cleaned = cleaned.replace(regex, "");
    }

    // Remove HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

    // Try to extract just the main/article content if it exists
    const mainMatch = cleaned.match(/<main[\s\S]*?<\/main>/i) ||
                      cleaned.match(/<article[\s\S]*?<\/article>/i);
    if (mainMatch) {
      cleaned = mainMatch[0];
    }

    return cleaned;
  }

  /* ── PDF Extraction ───────────────────────────────────────────────── */

  /**
   * Extract text from a PDF file.
   * Returns full text content with diagram annotations.
   */
  async extractPdf(filePath: string): Promise<string> {
    const buffer = readFileSync(filePath);

    // Dynamically import pdf-parse
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);

    const pageCount = result.numpages;
    let text = result.text;

    // Clean up common PDF noise
    text = this.cleanupPdfText(text, pageCount);

    // Add metadata header
    const header = `> _Extracted from PDF: ${path.basename(filePath)} (${pageCount} pages)_\n\n`;

    return header + text;
  }

  /**
   * Clean up extracted PDF text — remove repeated headers/footers, page numbers, etc.
   */
  private cleanupPdfText(text: string, pageCount: number): string {
    let cleaned = text;

    // Remove common page number patterns
    cleaned = cleaned.replace(/\n\s*\d+\s*\n/g, "\n");
    cleaned = cleaned.replace(/\nPage \d+ of \d+\n/gi, "\n");

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\n{4,}/g, "\n\n\n");

    // Remove common copyright/footer patterns repeated across pages
    cleaned = cleaned.replace(/©\s*\d{4}[^\n]*/gi, "");
    cleaned = cleaned.replace(/All rights reserved\.?\s*/gi, "");

    // Note potential diagrams (large whitespace gaps may indicate figures)
    if (pageCount > 1) {
      // Add diagram notes for pages where text is very sparse
      // (heuristic: if a "page" section has < 50 chars, it's likely a diagram)
      const sections = cleaned.split(/\f/); // Form feeds often separate PDF pages
      if (sections.length > 1) {
        cleaned = sections.map((section, i) => {
          if (section.trim().length < 50 && section.trim().length > 0) {
            return `\n[Diagram — see original file, page ${i + 1}]\n`;
          }
          return section;
        }).join("\n");
      }
    }

    return cleaned.trim();
  }

  /* ── Markdown Cleanup ─────────────────────────────────────────────── */

  /**
   * Post-process converted markdown to clean up artifacts.
   */
  private cleanupMarkdown(markdown: string): string {
    let cleaned = markdown;

    // Remove excessive blank lines
    cleaned = cleaned.replace(/\n{4,}/g, "\n\n\n");

    // Remove lines that are just whitespace
    cleaned = cleaned.replace(/^\s+$/gm, "");

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, "\n");

    // Remove leading/trailing whitespace
    cleaned = cleaned.trim();

    return cleaned;
  }

  /* ── Utilities ────────────────────────────────────────────────────── */

  /**
   * Determine file extension from content type and URL.
   */
  private extFromContentType(contentType: string, url: string): string {
    const normalized = contentType.toLowerCase().split(";")[0].trim();

    const typeMap: Record<string, string> = {
      "text/html": "html",
      "application/xhtml+xml": "html",
      "application/pdf": "pdf",
      "text/markdown": "md",
      "text/plain": "txt",
      "application/json": "json",
      "application/xml": "xml",
      "text/xml": "xml",
      "text/csv": "csv",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/webp": "webp",
    };

    if (typeMap[normalized]) return typeMap[normalized];

    // Try to infer from URL
    try {
      const urlPath = new URL(url).pathname;
      const ext = path.extname(urlPath).replace(/^\./, "");
      if (ext && ext.length <= 5) return ext;
    } catch { /* ignore */ }

    return "bin";
  }

  /**
   * Detect the likely content type from a file path.
   */
  detectContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
    const extMap: Record<string, string> = {
      html: "text/html",
      htm: "text/html",
      pdf: "application/pdf",
      md: "text/markdown",
      txt: "text/plain",
      json: "application/json",
      xml: "application/xml",
      csv: "text/csv",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
    };
    return extMap[ext] ?? "application/octet-stream";
  }

  /**
   * Generate a hash-based ID from file content.
   */
  generateSourceId(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  }
}
