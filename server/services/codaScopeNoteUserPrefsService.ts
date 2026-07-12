/* ── CodaScope: Note User Preferences Service ─────────────────────────
   Manages per-user starred notes and recent notes.

   Storage layout:
   <root>/_notes/_user-prefs/<userId>/starred.json
   <root>/_notes/_user-prefs/<userId>/recents.json

   Starred: simple ordered list keyed by noteId.
   Recents: circular buffer (last 25), deduplicating by noteId.
   ──────────────────────────────────────────────────────────────────── */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Types ────────────────────────────────────────────────────────── */

export interface StarredNoteRef {
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  title: string;
  starredAt: string;
}

export interface RecentNoteRef {
  noteId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  title: string;
  viewedAt: string;
}

interface StarredFile {
  items: StarredNoteRef[];
}

interface RecentsFile {
  items: RecentNoteRef[];
  maxSize: number;
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteUserPrefsService {
  private root: string;
  private static readonly DEFAULT_MAX_RECENTS = 25;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ─────────────────────────────────────────────────── */

  private prefsDir(userId: string): string {
    return path.join(this.root, "_notes", "_user-prefs", userId);
  }

  private starredPath(userId: string): string {
    return path.join(this.prefsDir(userId), "starred.json");
  }

  private recentsPath(userId: string): string {
    return path.join(this.prefsDir(userId), "recents.json");
  }

  private ensureDir(userId: string): void {
    const dir = this.prefsDir(userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /* ── Starred ──────────────────────────────────────────────────────── */

  /** Read the starred list from disk. */
  private readStarredFile(userId: string): StarredFile {
    const p = this.starredPath(userId);
    if (!existsSync(p)) return { items: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { items: [] };
    }
  }

  /** Write the starred list to disk. */
  private writeStarredFile(userId: string, data: StarredFile): void {
    this.ensureDir(userId);
    writeFileSync(this.starredPath(userId), JSON.stringify(data, null, 2), "utf-8");
  }

  /** Get all starred notes for a user. */
  getStarred(userId: string): StarredNoteRef[] {
    return this.readStarredFile(userId).items;
  }

  /** Star a note. Idempotent — if already starred, updates the entry. */
  star(userId: string, ref: Omit<StarredNoteRef, "starredAt">): void {
    const file = this.readStarredFile(userId);
    // Remove existing entry for this noteId (if any)
    file.items = file.items.filter((s) => s.noteId !== ref.noteId);
    // Add at the beginning
    file.items.unshift({
      ...ref,
      starredAt: new Date().toISOString(),
    });
    this.writeStarredFile(userId, file);
  }

  /** Unstar a note by noteId. */
  unstar(userId: string, noteId: string): boolean {
    const file = this.readStarredFile(userId);
    const before = file.items.length;
    file.items = file.items.filter((s) => s.noteId !== noteId);
    if (file.items.length === before) return false;
    this.writeStarredFile(userId, file);
    return true;
  }

  /** Check if a note is starred. */
  isStarred(userId: string, noteId: string): boolean {
    return this.readStarredFile(userId).items.some((s) => s.noteId === noteId);
  }

  /* ── Recents ──────────────────────────────────────────────────────── */

  /** Read the recents list from disk. */
  private readRecentsFile(userId: string): RecentsFile {
    const p = this.recentsPath(userId);
    if (!existsSync(p)) return { items: [], maxSize: CodaScopeNoteUserPrefsService.DEFAULT_MAX_RECENTS };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { items: [], maxSize: CodaScopeNoteUserPrefsService.DEFAULT_MAX_RECENTS };
    }
  }

  /** Write the recents list to disk. */
  private writeRecentsFile(userId: string, data: RecentsFile): void {
    this.ensureDir(userId);
    writeFileSync(this.recentsPath(userId), JSON.stringify(data, null, 2), "utf-8");
  }

  /** Get recent notes for a user. */
  getRecents(userId: string): RecentNoteRef[] {
    return this.readRecentsFile(userId).items;
  }

  /**
   * Add or bump a note to the top of the recents list.
   * Deduplicates by noteId — if already present, moves it to the top
   * with an updated viewedAt timestamp.
   */
  addRecent(userId: string, ref: Omit<RecentNoteRef, "viewedAt">): void {
    const file = this.readRecentsFile(userId);
    // Remove existing entry for this noteId
    file.items = file.items.filter((r) => r.noteId !== ref.noteId);
    // Add at the beginning
    file.items.unshift({
      ...ref,
      viewedAt: new Date().toISOString(),
    });
    // Enforce max size
    const max = file.maxSize || CodaScopeNoteUserPrefsService.DEFAULT_MAX_RECENTS;
    if (file.items.length > max) {
      file.items = file.items.slice(0, max);
    }
    this.writeRecentsFile(userId, file);
  }
}
