/* ── CodaScope: Shared Note Tag Suggestions ───────────────────────────
   Maintains the deliberately small piece of shared tag-management state:
   tags hidden from the suggestion list. Hiding never edits document metadata.
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface HiddenTagsFile {
  hiddenTags: string[];
}

export class CodaScopeNoteTagSuggestionService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  private filePath(): string {
    return path.join(this.root, "_notes", "_tag-suggestions.json");
  }

  private read(): HiddenTagsFile {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return { hiddenTags: [] };
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as HiddenTagsFile;
      return { hiddenTags: Array.isArray(data.hiddenTags) ? data.hiddenTags : [] };
    } catch {
      return { hiddenTags: [] };
    }
  }

  private write(data: HiddenTagsFile): void {
    const filePath = this.filePath();
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.tmp.${randomUUID()}`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tempPath, filePath);
  }

  hiddenTags(): string[] {
    return this.read().hiddenTags;
  }

  hide(tag: string): boolean {
    const normalized = tag.trim();
    if (!normalized) return false;
    const data = this.read();
    if (data.hiddenTags.some((candidate) => candidate.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return false;
    data.hiddenTags.push(normalized);
    this.write(data);
    return true;
  }

  restore(tag: string): boolean {
    const normalized = tag.trim().toLocaleLowerCase();
    const data = this.read();
    const remaining = data.hiddenTags.filter((candidate) => candidate.toLocaleLowerCase() !== normalized);
    if (remaining.length === data.hiddenTags.length) return false;
    this.write({ hiddenTags: remaining });
    return true;
  }

  filter<T extends { tag: string }>(tags: T[]): T[] {
    const hidden = new Set(this.hiddenTags().map((tag) => tag.toLocaleLowerCase()));
    return tags.filter((entry) => !hidden.has(entry.tag.toLocaleLowerCase()));
  }
}
