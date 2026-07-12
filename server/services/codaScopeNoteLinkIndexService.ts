/* ── CodaScope: Note Link Index Service ──────────────────────────────
   Tracks inter-note links (backlinks) for CodaScope notes.
   Scans markdown content for [[noteId]] and [text](note://<id>) patterns,
   maintains a per-scope link index on disk.

   Storage: <notesRoot>/_link-index/notes-links.json

   Design:
   - The service receives a CodaScopeNoteService to resolve note paths
   - The link index maps targetNoteId → sourceNoteIds[]
   - Updates are fire-and-forget after note saves
   ──────────────────────────────────────────────────────────────────── */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import type {
  NoteScope,
  NoteVisibility,
  NoteLinkIndex,
  NoteBacklink,
} from "../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteLinkIndexService {
  private noteSvc: CodaScopeNoteService;

  constructor(noteSvc: CodaScopeNoteService) {
    this.noteSvc = noteSvc;
  }

  setNoteService(noteSvc: CodaScopeNoteService): void {
    this.noteSvc = noteSvc;
  }

  /* ── Link Patterns ─────────────────────────────────────────────── */

  /**
   * Extract note IDs that this content links to.
   * Patterns:
   *   [[<noteId>]]         — wikilink by ID
   *   [text](note://<id>)  — explicit note link
   */
  private extractLinkedIds(content: string): string[] {
    const ids = new Set<string>();

    // [[noteId]] pattern — UUID-like IDs inside double brackets
    const wikiRe = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;
    let m: RegExpExecArray | null;
    while ((m = wikiRe.exec(content)) !== null) {
      ids.add(m[1].toLowerCase());
    }

    // [text](note://<id>) pattern
    const linkRe = /\[.*?\]\(note:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
    while ((m = linkRe.exec(content)) !== null) {
      ids.add(m[1].toLowerCase());
    }

    return Array.from(ids);
  }

  /* ── Index Path Resolution ─────────────────────────────────────── */

  /** Resolve the link index directory for a scope/visibility. */
  private resolveIndexDir(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): string | null {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;
    // Go up to the _notes parent and store link index there
    const notesRoot = path.dirname(notesDir);
    return path.join(notesRoot, "_link-index");
  }

  /** Resolve the link index file path. */
  private resolveIndexPath(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): string | null {
    const indexDir = this.resolveIndexDir(scope, visibility, opts);
    if (!indexDir) return null;
    return path.join(indexDir, "notes-links.json");
  }

  /** Read the link index from disk. Returns empty index if not found. */
  private readIndex(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): NoteLinkIndex {
    const indexPath = this.resolveIndexPath(scope, visibility, opts);
    if (!indexPath || !existsSync(indexPath)) {
      return { generatedAt: new Date().toISOString(), links: {} };
    }
    try {
      return JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch {
      return { generatedAt: new Date().toISOString(), links: {} };
    }
  }

  /** Write the link index to disk. */
  private writeIndex(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, index: NoteLinkIndex): void {
    const indexPath = this.resolveIndexPath(scope, visibility, opts);
    if (!indexPath) return;

    const indexDir = path.dirname(indexPath);
    if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });

    index.generatedAt = new Date().toISOString();
    writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  /* ── Public API ────────────────────────────────────────────────── */

  /**
   * Update the link index for a specific note after its content changes.
   * Removes old links from this source, adds new links.
   */
  updateLinksForNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
    content: string,
  ): void {
    try {
      const index = this.readIndex(scope, visibility, opts);
      const linkedIds = this.extractLinkedIds(content);
      const lowerNoteId = noteId.toLowerCase();

      // Remove this note as a source from all targets
      for (const targetId of Object.keys(index.links)) {
        index.links[targetId] = index.links[targetId].filter(
          (src) => src.toLowerCase() !== lowerNoteId,
        );
        // Clean up empty arrays
        if (index.links[targetId].length === 0) {
          delete index.links[targetId];
        }
      }

      // Add this note as a source for each linked target
      for (const targetId of linkedIds) {
        if (targetId === lowerNoteId) continue; // Don't self-link
        if (!index.links[targetId]) index.links[targetId] = [];
        if (!index.links[targetId].includes(noteId)) {
          index.links[targetId].push(noteId);
        }
      }

      this.writeIndex(scope, visibility, opts, index);
    } catch { /* fire-and-forget — don't break saves */ }
  }

  /**
   * Remove a note from the link index (when archived/deleted).
   */
  removeNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
  ): void {
    try {
      const index = this.readIndex(scope, visibility, opts);
      const lowerNoteId = noteId.toLowerCase();

      // Remove as source from all targets
      for (const targetId of Object.keys(index.links)) {
        index.links[targetId] = index.links[targetId].filter(
          (src) => src.toLowerCase() !== lowerNoteId,
        );
        if (index.links[targetId].length === 0) {
          delete index.links[targetId];
        }
      }

      // Remove as target
      delete index.links[lowerNoteId];
      delete index.links[noteId];

      this.writeIndex(scope, visibility, opts, index);
    } catch { /* fire-and-forget */ }
  }

  /**
   * Get backlinks for a note: notes that link TO the given noteId.
   * Returns enriched backlink entries with title and path.
   */
  async getBacklinks(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
  ): Promise<NoteBacklink[]> {
    const index = this.readIndex(scope, visibility, opts);

    // Look up by both exact case and lowercase
    const sourceIds = index.links[noteId] ?? index.links[noteId.toLowerCase()] ?? [];
    if (sourceIds.length === 0) return [];

    const backlinks: NoteBacklink[] = [];

    for (const srcId of sourceIds) {
      // Try to find the note by ID in the current scope
      const found = await this.noteSvc.findNoteById(scope, visibility, opts, srcId);
      if (found) {
        backlinks.push({
          noteId: srcId,
          title: found.title,
          path: found.path,
          scope,
          visibility,
          isArchived: false,
        });
      } else {
        // Might be archived — still include with a flag
        backlinks.push({
          noteId: srcId,
          title: `Note ${srcId.slice(0, 8)}…`,
          path: "",
          scope,
          visibility,
          isArchived: true,
        });
      }
    }

    return backlinks;
  }

  /**
   * Full rebuild of the link index by scanning all notes.
   */
  async rebuildIndex(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<void> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir || !existsSync(notesDir)) return;

    const newIndex: NoteLinkIndex = {
      generatedAt: new Date().toISOString(),
      links: {},
    };

    // Recursively scan all notes
    this.scanForLinks(notesDir, newIndex);
    this.writeIndex(scope, visibility, opts, newIndex);
  }

  /** Recursively scan .md files for links. */
  private scanForLinks(dir: string, index: NoteLinkIndex): void {
    if (!existsSync(dir)) return;
    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          this.scanForLinks(fullPath, index);
        } else if (item.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const { frontmatter } = this.noteSvc.parseFrontmatter(content);
            const sourceId = frontmatter.id;
            const linkedIds = this.extractLinkedIds(content);

            for (const targetId of linkedIds) {
              if (targetId === sourceId.toLowerCase()) continue;
              if (!index.links[targetId]) index.links[targetId] = [];
              if (!index.links[targetId].includes(sourceId)) {
                index.links[targetId].push(sourceId);
              }
            }
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* directory unreadable */ }
  }
}
