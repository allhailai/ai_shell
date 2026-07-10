/* ── CodaScope: Note Service — Unit Tests ────────────────────────────
   Tests for frontmatter parsing, CRUD, image upload, search, and
   content hashing.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/* ── Helpers ──────────────────────────────────────────────────────── */

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `note-test-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeNoteService", () => {
  let root: string;
  let svc: CodaScopeNoteService;

  beforeEach(() => {
    root = tmpDir();
    svc = new CodaScopeNoteService(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── Frontmatter Parsing ──────────────────────────────────────────

  describe("parseFrontmatter", () => {
    it("should parse valid frontmatter", () => {
      const content = [
        "---",
        "title: My Note",
        "tags: [meeting, sprint-12]",
        "created: 2026-07-09T21:00:00Z",
        "updated: 2026-07-09T22:15:00Z",
        "---",
        "",
        "# My Note",
        "Some content here.",
      ].join("\n");

      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe("My Note");
      expect(result.frontmatter.tags).toEqual(["meeting", "sprint-12"]);
      expect(result.frontmatter.created).toBe("2026-07-09T21:00:00Z");
      expect(result.frontmatter.updated).toBe("2026-07-09T22:15:00Z");
      expect(result.body).toContain("# My Note");
    });

    it("should handle content without frontmatter", () => {
      const content = "# Just a heading\nSome text.";
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe("Untitled");
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.body).toBe(content);
    });

    it("should handle empty tags", () => {
      const content = "---\ntitle: Empty Tags\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nBody.";
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.tags).toEqual([]);
    });

    it("should handle quoted title", () => {
      const content = '---\ntitle: "My Quoted Title"\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nBody.';
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe("My Quoted Title");
    });
  });

  // ── Serialization ────────────────────────────────────────────────

  describe("serializeFrontmatter", () => {
    it("should produce valid frontmatter", () => {
      const fm = {
        title: "Test Note",
        tags: ["a", "b"],
        created: "2026-07-09T00:00:00Z",
        updated: "2026-07-09T01:00:00Z",
      };
      const result = svc.serializeFrontmatter(fm);
      expect(result).toContain("---");
      expect(result).toContain("title: Test Note");
      expect(result).toContain('tags: ["a", "b"]');
      expect(result).toContain("created: 2026-07-09T00:00:00Z");
    });

    it("should roundtrip frontmatter", () => {
      const fm = {
        title: "Roundtrip",
        tags: ["x"],
        created: "2026-07-09T00:00:00Z",
        updated: "2026-07-09T01:00:00Z",
      };
      const serialized = svc.serializeFrontmatter(fm);
      const parsed = svc.parseFrontmatter(serialized + "Some body text.");
      expect(parsed.frontmatter.title).toBe("Roundtrip");
      expect(parsed.frontmatter.tags).toEqual(["x"]);
      expect(parsed.body).toContain("Some body text.");
    });
  });

  // ── Path Resolution ──────────────────────────────────────────────

  describe("resolveNotesDir", () => {
    it("should resolve personal notes dir", () => {
      const dir = svc.resolveNotesDir("personal", { username: "alan" });
      expect(dir).toBe(path.join(root, "_notes", "alan"));
    });

    it("should resolve public notes dir", () => {
      const dir = svc.resolveNotesDir("public", {});
      expect(dir).toBe(path.join(root, "_notes", "_public_notes"));
    });

    it("should default username to 'default' for personal", () => {
      const dir = svc.resolveNotesDir("personal", {});
      expect(dir).toBe(path.join(root, "_notes", "default"));
    });

    it("should return null for project level without projectId", () => {
      const dir = svc.resolveNotesDir("project", {});
      expect(dir).toBeNull();
    });

    it("should return null for epic level without epicId", () => {
      const dir = svc.resolveNotesDir("epic", { projectId: "p1" });
      expect(dir).toBeNull();
    });
  });

  // ── CRUD ─────────────────────────────────────────────────────────

  describe("CRUD", () => {
    it("should create and read a note", async () => {
      const result = await svc.createNote("personal", { username: "alan" }, "test-note.md");
      expect(result.path).toBe("test-note.md");
      expect(result.contentHash).toBeTruthy();

      const note = await svc.readNote("personal", { username: "alan" }, "test-note.md");
      expect(note).not.toBeNull();
      expect(note!.frontmatter.title).toBe("test note");
      expect(note!.contentHash).toBeTruthy();
    });

    it("should create note with initial content", async () => {
      const content = "# Hello World\nThis is my note.";
      await svc.createNote("public", {}, "hello.md", content);

      const note = await svc.readNote("public", {}, "hello.md");
      expect(note).not.toBeNull();
      expect(note!.content).toContain("# Hello World");
      expect(note!.frontmatter.title).toBe("hello");
    });

    it("should create note with custom frontmatter", async () => {
      const content = "---\ntitle: Custom Title\ntags: [important]\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\n# Custom Title\nBody.";
      await svc.createNote("public", {}, "custom.md", content);

      const note = await svc.readNote("public", {}, "custom.md");
      expect(note!.frontmatter.title).toBe("Custom Title");
      expect(note!.frontmatter.tags).toEqual(["important"]);
    });

    it("should reject creating duplicate note", async () => {
      await svc.createNote("personal", { username: "alan" }, "dup.md");
      await expect(svc.createNote("personal", { username: "alan" }, "dup.md")).rejects.toThrow("already exists");
    });

    it("should update a note", async () => {
      await svc.createNote("personal", { username: "alan" }, "update-me.md");
      const note = await svc.readNote("personal", { username: "alan" }, "update-me.md");

      const newContent = "---\ntitle: Updated Title\ntags: [updated]\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nNew body content.";
      const result = await svc.updateNote("personal", { username: "alan" }, "update-me.md", newContent, note!.contentHash);
      expect(result).not.toBeNull();
      expect("contentHash" in result!).toBe(true);

      const updated = await svc.readNote("personal", { username: "alan" }, "update-me.md");
      expect(updated!.frontmatter.title).toBe("Updated Title");
      expect(updated!.content).toContain("New body content.");
    });

    it("should detect conflict on stale hash", async () => {
      await svc.createNote("personal", { username: "alan" }, "conflict.md");
      const note = await svc.readNote("personal", { username: "alan" }, "conflict.md");

      // Simulate another write
      const notesDir = svc.resolveNotesDir("personal", { username: "alan" })!;
      writeFileSync(path.join(notesDir, "conflict.md"), "---\ntitle: Sneaky Update\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nDifferent content.", "utf-8");

      const result = await svc.updateNote("personal", { username: "alan" }, "conflict.md", "new content", note!.contentHash);
      expect(result).not.toBeNull();
      expect("conflict" in result!).toBe(true);
    });

    it("should delete a note and its assets", async () => {
      await svc.createNote("personal", { username: "alan" }, "delete-me.md");

      // Create a fake assets directory
      const notesDir = svc.resolveNotesDir("personal", { username: "alan" })!;
      const assetsDir = path.join(notesDir, "delete-me.assets");
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(path.join(assetsDir, "img.png"), "fake-image");

      const deleted = await svc.deleteNote("personal", { username: "alan" }, "delete-me.md");
      expect(deleted).toBe(true);
      expect(existsSync(path.join(notesDir, "delete-me.md"))).toBe(false);
      expect(existsSync(assetsDir)).toBe(false);
    });

    it("should return null for non-existent note read", async () => {
      const result = await svc.readNote("personal", { username: "alan" }, "no-such-note.md");
      expect(result).toBeNull();
    });
  });

  // ── List ──────────────────────────────────────────────────────────

  describe("listNotes", () => {
    it("should list notes in a directory", async () => {
      await svc.createNote("public", {}, "note-a.md", "Content A");
      await svc.createNote("public", {}, "note-b.md", "Content B");

      const notes = await svc.listNotes("public", {});
      expect(notes.length).toBe(2);
    });

    it("should list notes in a subfolder", async () => {
      await svc.createNote("personal", { username: "alan" }, "meeting/standup.md", "Standup notes");

      const notes = await svc.listNotes("personal", { username: "alan" }, "meeting");
      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe("standup");
    });

    it("should return empty array for empty directory", async () => {
      const notes = await svc.listNotes("public", {});
      expect(notes).toEqual([]);
    });
  });

  // ── Folders ───────────────────────────────────────────────────────

  describe("folders", () => {
    it("should create and list folders", async () => {
      await svc.createFolder("personal", { username: "alan" }, "meeting-notes");
      await svc.createFolder("personal", { username: "alan" }, "meeting-notes/2026");
      await svc.createNote("personal", { username: "alan" }, "meeting-notes/test.md", "test");

      const folders = await svc.listFolders("personal", { username: "alan" });
      expect(folders.length).toBe(1);
      expect(folders[0].name).toBe("meeting-notes");
      expect(folders[0].noteCount).toBe(1);
      expect(folders[0].subfolders.length).toBe(1);
    });
  });

  // ── Image Upload ──────────────────────────────────────────────────

  describe("uploadImage", () => {
    it("should upload an image and return relative path", async () => {
      await svc.createNote("personal", { username: "alan" }, "img-note.md", "Note with images");

      const buffer = Buffer.from("fake-png-data");
      const result = await svc.uploadImage(
        "personal",
        { username: "alan" },
        "img-note.md",
        buffer,
        "image/png",
      );

      expect(result.relativePath).toMatch(/img-note\.assets\/.+\.png$/);
      expect(result.filename).toMatch(/^\d+_[a-f0-9]+\.png$/);

      // Verify file was actually written
      const notesDir = svc.resolveNotesDir("personal", { username: "alan" })!;
      const imgPath = path.join(notesDir, result.relativePath);
      expect(existsSync(imgPath)).toBe(true);
    });

    it("should reject upload for non-existent note", async () => {
      await expect(
        svc.uploadImage("personal", { username: "alan" }, "no-note.md", Buffer.from("data"), "image/png"),
      ).rejects.toThrow("Note not found");
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe("searchNotes", () => {
    it("should find notes matching a query", async () => {
      await svc.createNote("personal", { username: "alan" }, "search-a.md", "This mentions architecture decisions.");
      await svc.createNote("personal", { username: "alan" }, "search-b.md", "This is about design patterns.");

      const results = await svc.searchNotes("architecture", { username: "alan" }, ["personal"]);
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("search-a.md");
      expect(results[0].matchLine).toContain("architecture");
    });

    it("should be case-insensitive", async () => {
      await svc.createNote("personal", { username: "alan" }, "case.md", "This is IMPORTANT content.");

      const results = await svc.searchNotes("important", { username: "alan" }, ["personal"]);
      expect(results.length).toBe(1);
    });

    it("should return empty for no matches", async () => {
      await svc.createNote("personal", { username: "alan" }, "no-match.md", "Nothing special here.");
      const results = await svc.searchNotes("zyxwvutsrqponmlk", { username: "alan" }, ["personal"]);
      expect(results.length).toBe(0);
    });
  });

  // ── Move ──────────────────────────────────────────────────────────

  describe("moveNote", () => {
    it("should move a note within the same level", async () => {
      await svc.createNote("personal", { username: "alan" }, "movable.md", "Move me");
      await svc.createFolder("personal", { username: "alan" }, "archive");

      const moved = await svc.moveNote({
        fromLevel: "personal",
        fromOpts: { username: "alan" },
        fromPath: "movable.md",
        toLevel: "personal",
        toOpts: { username: "alan" },
        toPath: "archive/movable.md",
      });

      expect(moved).toBe(true);

      // Original should not exist
      const original = await svc.readNote("personal", { username: "alan" }, "movable.md");
      expect(original).toBeNull();

      // Moved note should exist
      const movedNote = await svc.readNote("personal", { username: "alan" }, "archive/movable.md");
      expect(movedNote).not.toBeNull();
      expect(movedNote!.content).toContain("Move me");
    });

    it("should move assets along with the note", async () => {
      await svc.createNote("personal", { username: "alan" }, "with-assets.md", "Note");
      await svc.uploadImage("personal", { username: "alan" }, "with-assets.md", Buffer.from("img"), "image/png");

      await svc.createFolder("personal", { username: "alan" }, "moved");
      const moved = await svc.moveNote({
        fromLevel: "personal",
        fromOpts: { username: "alan" },
        fromPath: "with-assets.md",
        toLevel: "personal",
        toOpts: { username: "alan" },
        toPath: "moved/with-assets.md",
      });

      expect(moved).toBe(true);

      // Assets dir should exist at new location
      const notesDir = svc.resolveNotesDir("personal", { username: "alan" })!;
      expect(existsSync(path.join(notesDir, "moved", "with-assets.assets"))).toBe(true);
      // Old assets should not exist
      expect(existsSync(path.join(notesDir, "with-assets.assets"))).toBe(false);
    });
  });

  // ── Index ─────────────────────────────────────────────────────────

  describe("refreshIndex", () => {
    it("should generate _notes-index.json", async () => {
      await svc.createNote("public", {}, "indexed-note.md", "Indexed content");

      const notesDir = svc.resolveNotesDir("public", {})!;
      const indexPath = path.join(notesDir, "_notes-index.json");
      expect(existsSync(indexPath)).toBe(true);

      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.notes.length).toBe(1);
      expect(index.notes[0].path).toBe("indexed-note.md");
      expect(index.generatedAt).toBeTruthy();
    });
  });

  // ── Content Hash ──────────────────────────────────────────────────

  describe("content hash", () => {
    it("should produce consistent MD5 hash", async () => {
      await svc.createNote("personal", { username: "alan" }, "hash-test.md", "Consistent content");
      const read1 = await svc.readNote("personal", { username: "alan" }, "hash-test.md");
      const read2 = await svc.readNote("personal", { username: "alan" }, "hash-test.md");
      expect(read1!.contentHash).toBe(read2!.contentHash);
    });

    it("should change hash after update", async () => {
      await svc.createNote("personal", { username: "alan" }, "hash-change.md", "Original");
      const read1 = await svc.readNote("personal", { username: "alan" }, "hash-change.md");

      const newContent = "---\ntitle: hash change\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nModified content.";
      await svc.updateNote("personal", { username: "alan" }, "hash-change.md", newContent);

      const read2 = await svc.readNote("personal", { username: "alan" }, "hash-change.md");
      expect(read1!.contentHash).not.toBe(read2!.contentHash);
    });
  });
});
