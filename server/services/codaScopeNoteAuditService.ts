/* ── CodaScope: Note Audit Service ───────────────────────────────────
   Append-only JSONL audit log for note operations.
   One file per month: _audit/notes/2026-07.jsonl
   ──────────────────────────────────────────────────────────────────── */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import type {
  NoteAuditEvent,
  NoteAuditQueryFilters,
} from "../../src/apps/codascope/codaScopeTypes.js";

export class CodaScopeNoteAuditService {
  private auditDir: string;

  constructor(root: string) {
    this.auditDir = path.join(root, "_audit", "notes");
  }

  setRoot(root: string): void {
    this.auditDir = path.join(root, "_audit", "notes");
  }

  /** Append a single audit event to the monthly JSONL file. */
  log(event: NoteAuditEvent): void {
    try {
      if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });
      const month = event.timestamp.slice(0, 7); // "2026-07"
      const filePath = path.join(this.auditDir, `${month}.jsonl`);
      appendFileSync(filePath, JSON.stringify(event) + "\n");
    } catch {
      // Best effort — audit logging must never break note operations
    }
  }

  /** Query audit events with optional filters. */
  query(filters: NoteAuditQueryFilters): NoteAuditEvent[] {
    if (!existsSync(this.auditDir)) return [];

    const results: NoteAuditEvent[] = [];
    const limit = filters.limit ?? 200;

    // Determine which JSONL files to read
    const files = this.getRelevantFiles(filters.from, filters.to);

    for (const file of files) {
      const filePath = path.join(this.auditDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const event: NoteAuditEvent = JSON.parse(line);
            if (this.matchesFilters(event, filters)) {
              results.push(event);
              if (results.length >= limit) return results;
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  /** Get JSONL files relevant to the date range, sorted newest-first. */
  private getRelevantFiles(from?: string, to?: string): string[] {
    try {
      const files = readdirSync(this.auditDir)
        .filter((f: string) => f.endsWith(".jsonl"))
        .sort()
        .reverse();

      if (!from && !to) return files;

      const fromMonth = from ? from.slice(0, 7) : "0000-00";
      const toMonth = to ? to.slice(0, 7) : "9999-99";

      return files.filter((f: string) => {
        const month = f.replace(".jsonl", "");
        return month >= fromMonth && month <= toMonth;
      });
    } catch {
      return [];
    }
  }

  /** Check if an event matches the query filters. */
  private matchesFilters(event: NoteAuditEvent, filters: NoteAuditQueryFilters): boolean {
    if (filters.noteId && event.noteId !== filters.noteId) return false;
    if (filters.event && event.event !== filters.event) return false;
    if (filters.actor && event.actor !== filters.actor) return false;
    if (filters.from && event.timestamp < filters.from) return false;
    if (filters.to && event.timestamp > filters.to) return false;
    return true;
  }
}
