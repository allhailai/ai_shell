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
  renameSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

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

export interface NoteRefLocation {
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
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
    return path.join(this.root, "_notes", "_user-prefs", assertSafePathSegment(userId, "user ID"));
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

  private writeJsonAtomically(filePath: string, data: unknown): void {
    const tempPath = `${filePath}.tmp.${randomUUID()}`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tempPath, filePath);
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
    this.writeJsonAtomically(this.starredPath(userId), data);
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
    this.writeJsonAtomically(this.recentsPath(userId), data);
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

  /**
   * Repoint durable starred/recent references after the transfer pipeline
   * moves a note. Shared references follow a shared move; when a note becomes
   * private, references belonging to other users are removed.
   */
  relocateNoteRefs(
    noteId: string,
    destination: NoteRefLocation,
    privateOwnerUserId?: string,
  ): void {
    const usersRoot = path.join(this.root, "_notes", "_user-prefs");
    if (!existsSync(usersRoot)) return;

    let userIds: string[] = [];
    try {
      userIds = readdirSync(usersRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return;
    }

    for (const userId of userIds) {
      const removeForPrivateDestination = destination.visibility === "private" && userId !== privateOwnerUserId;

      const starred = this.readStarredFile(userId);
      const nextStarred = starred.items
        .filter((item) => !(removeForPrivateDestination && item.noteId === noteId))
        .map((item) => item.noteId === noteId ? { ...item, ...destination } : item);
      if (nextStarred.length !== starred.items.length || nextStarred.some((item, index) => item !== starred.items[index])) {
        this.writeStarredFile(userId, { items: nextStarred });
      }

      const recents = this.readRecentsFile(userId);
      const nextRecents = recents.items
        .filter((item) => !(removeForPrivateDestination && item.noteId === noteId))
        .map((item) => item.noteId === noteId ? { ...item, ...destination } : item);
      if (nextRecents.length !== recents.items.length || nextRecents.some((item, index) => item !== recents.items[index])) {
        this.writeRecentsFile(userId, { ...recents, items: nextRecents });
      }
    }
  }

  /* ── Read Status Tracking ──────────────────────────────────────────── */

  /** Path helpers for read tracking */
  private readStatusPath(userId: string): string {
    return path.join(this.prefsDir(userId), "read-status.json");
  }

  private readTrackingDir(): string {
    return path.join(this.root, "_notes", "_read-tracking");
  }

  private noteReadersPath(noteId: string): string {
    return path.join(this.readTrackingDir(), `${assertSafePathSegment(noteId, "note ID")}.json`);
  }

  /** Read the per-user read status map from disk. */
  private readReadStatusFile(userId: string): Record<string, string> {
    const p = this.readStatusPath(userId);
    if (!existsSync(p)) return {};
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return {};
    }
  }

  /** Write the per-user read status map to disk. */
  private writeReadStatusFile(userId: string, data: Record<string, string>): void {
    this.ensureDir(userId);
    this.writeJsonAtomically(this.readStatusPath(userId), data);
  }

  /**
   * Mark a note as read by the user.
   * Also records the user as a reader of the note.
   */
  markRead(userId: string, noteId: string): void {
    const now = new Date().toISOString();
    const data = this.readReadStatusFile(userId);
    data[noteId] = now;
    this.writeReadStatusFile(userId, data);
    // Also record this user as a reader of the note
    this.recordReader(noteId, userId);
  }

  /**
   * Get read status for a list of noteIds for a given user.
   * Returns a map of noteId → readAt (ISO string) or null if unread.
   */
  getReadStatus(userId: string, noteIds: string[]): Record<string, string | null> {
    const data = this.readReadStatusFile(userId);
    const result: Record<string, string | null> = {};
    for (const id of noteIds) {
      result[id] = data[id] ?? null;
    }
    return result;
  }

  /** Record a user as a reader of a specific note. */
  private recordReader(noteId: string, userId: string): void {
    const dir = this.readTrackingDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = this.noteReadersPath(noteId);
    let readers: Array<{ userId: string; readAt: string }> = [];

    if (existsSync(filePath)) {
      try {
        readers = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch { /* reset */ }
    }

    const now = new Date().toISOString();
    const idx = readers.findIndex((r) => r.userId === userId);
    if (idx >= 0) {
      readers[idx].readAt = now;
    } else {
      readers.push({ userId, readAt: now });
    }

    this.writeJsonAtomically(filePath, readers);
  }

  /** Get all readers for a note. */
  getReadersForNote(noteId: string): Array<{ userId: string; readAt: string }> {
    const filePath = this.noteReadersPath(noteId);
    if (!existsSync(filePath)) return [];
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
}
