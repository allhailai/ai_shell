/* ── CodaScope: Note Service — Unit Tests ────────────────────────────
   Tests for frontmatter parsing, CRUD, image upload, search, and
   content hashing.

   Updated for scope+visibility model (codascope/project/epic × shared/private).
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { annotationEndMarker, annotationStartMarker } from "./codaScopeNoteAnnotationAnchorService.js";

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
        "id: 550e8400-e29b-41d4-a716-446655440000",
        "title: My Note",
        "tags: [meeting, sprint-12]",
        "created: 2026-07-09T21:00:00Z",
        "updated: 2026-07-09T22:15:00Z",
        "owner: alan",
        "---",
        "",
        "# My Note",
        "Some content here.",
      ].join("\n");

      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(result.frontmatter.title).toBe("My Note");
      expect(result.frontmatter.tags).toEqual(["meeting", "sprint-12"]);
      expect(result.frontmatter.created).toBe("2026-07-09T21:00:00Z");
      expect(result.frontmatter.updated).toBe("2026-07-09T22:15:00Z");
      expect(result.frontmatter.owner).toBe("alan");
      expect(result.body).toContain("# My Note");
    });

    it("should handle content without frontmatter", () => {
      const content = "# Just a heading\nSome text.";
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe("Untitled");
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.frontmatter.id).toBeTruthy(); // auto-generated UUID
      expect(result.frontmatter.owner).toBe("default");
      expect(result.body).toBe(content);
    });

    it("should handle empty tags", () => {
      const content = "---\nid: abc-123\ntitle: Empty Tags\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: default\n---\n\nBody.";
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.tags).toEqual([]);
    });

    it("should handle quoted title", () => {
      const content = '---\nid: abc-456\ntitle: "My Quoted Title"\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: default\n---\n\nBody.';
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.title).toBe("My Quoted Title");
    });

    it("should auto-generate id when missing from frontmatter", () => {
      const content = "---\ntitle: No ID\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\n---\n\nBody.";
      const result = svc.parseFrontmatter(content);
      expect(result.frontmatter.id).toBeTruthy();
      expect(result.frontmatter.id.length).toBeGreaterThan(0);
    });
  });

  // ── Serialization ────────────────────────────────────────────────

  describe("serializeFrontmatter", () => {
    it("should produce valid frontmatter", () => {
      const fm = {
        id: "test-uuid-123",
        title: "Test Note",
        tags: ["a", "b"],
        created: "2026-07-09T00:00:00Z",
        updated: "2026-07-09T01:00:00Z",
        owner: "alan",
      };
      const result = svc.serializeFrontmatter(fm);
      expect(result).toContain("---");
      expect(result).toContain("id: test-uuid-123");
      expect(result).toContain("title: Test Note");
      expect(result).toContain('tags: ["a", "b"]');
      expect(result).toContain("created: 2026-07-09T00:00:00Z");
      expect(result).toContain("owner: alan");
    });

    it("should roundtrip frontmatter", () => {
      const fm = {
        id: "roundtrip-uuid",
        title: "Roundtrip",
        tags: ["x"],
        created: "2026-07-09T00:00:00Z",
        updated: "2026-07-09T01:00:00Z",
        owner: "alan",
      };
      const serialized = svc.serializeFrontmatter(fm);
      const parsed = svc.parseFrontmatter(serialized + "Some body text.");
      expect(parsed.frontmatter.id).toBe("roundtrip-uuid");
      expect(parsed.frontmatter.title).toBe("Roundtrip");
      expect(parsed.frontmatter.tags).toEqual(["x"]);
      expect(parsed.frontmatter.owner).toBe("alan");
      expect(parsed.body).toContain("Some body text.");
    });
  });

  // ── Path Resolution ──────────────────────────────────────────────

  describe("resolveNotesDir", () => {
    it("should resolve codascope private notes dir", () => {
      const dir = svc.resolveNotesDir("codascope", "private", { userId: "alan" });
      expect(dir).toBe(path.join(root, "_notes", "private", "alan"));
    });

    it("should resolve codascope shared notes dir", () => {
      const dir = svc.resolveNotesDir("codascope", "shared", {});
      expect(dir).toBe(path.join(root, "_notes", "shared"));
    });

    it("should default userId to 'default' for private", () => {
      const dir = svc.resolveNotesDir("codascope", "private", {});
      expect(dir).toBe(path.join(root, "_notes", "private", "default"));
    });

    it("rejects user IDs that would escape the private-notes namespace", () => {
      expect(() => svc.resolveNotesDir("codascope", "private", { userId: "../other-user" })).toThrow("Invalid user ID");
    });

    it("should return null for project scope without projectId", () => {
      const dir = svc.resolveNotesDir("project", "shared", {});
      expect(dir).toBeNull();
    });

    it("should return null for epic scope without epicId", () => {
      const dir = svc.resolveNotesDir("epic", "shared", { projectId: "p1" });
      expect(dir).toBeNull();
    });
  });

  // ── CRUD ─────────────────────────────────────────────────────────

  describe("CRUD", () => {
    it("should create and read a note", async () => {
      const result = await svc.createNote("codascope", "private", { userId: "alan" }, "test-note.md");
      expect(result.path).toBe("test-note.md");
      expect(result.contentHash).toBeTruthy();

      const note = await svc.readNote("codascope", "private", { userId: "alan" }, "test-note.md");
      expect(note).not.toBeNull();
      expect(note!.frontmatter.title).toBe("test note");
      expect(note!.frontmatter.id).toBeTruthy();
      expect(note!.frontmatter.owner).toBe("alan");
      expect(note!.contentHash).toBeTruthy();
    });

    it("defaults shared notes to draft and leaves private notes without a shared status", async () => {
      await svc.createNote("codascope", "shared", { userId: "alan" }, "shared.md");
      await svc.createNote("codascope", "private", { userId: "alan" }, "private.md");

      const shared = await svc.readNote("codascope", "shared", { userId: "alan" }, "shared.md");
      const privateNote = await svc.readNote("codascope", "private", { userId: "alan" }, "private.md");

      expect(shared!.frontmatter.status).toBe("draft");
      expect(privateNote!.frontmatter.status).toBeUndefined();
    });

    it("should create note with initial content", async () => {
      const content = "# Hello World\nThis is my note.";
      await svc.createNote("codascope", "shared", {}, "hello.md", content);

      const note = await svc.readNote("codascope", "shared", {}, "hello.md");
      expect(note).not.toBeNull();
      expect(note!.content).toContain("# Hello World");
      expect(note!.frontmatter.title).toBe("hello");
    });

    it("should create note with custom frontmatter", async () => {
      const content = "---\nid: custom-id\ntitle: Custom Title\ntags: [important]\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: alan\n---\n\n# Custom Title\nBody.";
      await svc.createNote("codascope", "shared", {}, "custom.md", content);

      const note = await svc.readNote("codascope", "shared", {}, "custom.md");
      expect(note!.frontmatter.title).toBe("Custom Title");
      expect(note!.frontmatter.tags).toEqual(["important"]);
    });

    it("owns server-managed frontmatter even when callers provide it", async () => {
      const content = "---\nid: ../../reader-log\ntitle: Custom Title\ntags: [important]\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: another-user\n---\n\nBody.";
      await svc.createNote("codascope", "private", { userId: "alan" }, "owned.md", content);

      const created = await svc.readNote("codascope", "private", { userId: "alan" }, "owned.md");
      expect(created!.frontmatter.id).not.toContain("/");
      expect(created!.frontmatter.owner).toBe("alan");

      const updatedContent = created!.content.replace(
        /^id:.*$/m,
        "id: ../../another-reader-log",
      ).replace(/^owner:.*$/m, "owner: another-user");
      await svc.updateNote("codascope", "private", { userId: "alan" }, "owned.md", updatedContent, created!.contentHash);

      const updated = await svc.readNote("codascope", "private", { userId: "alan" }, "owned.md");
      expect(updated!.frontmatter.id).toBe(created!.frontmatter.id);
      expect(updated!.frontmatter.owner).toBe("alan");
    });

    it("keeps shared pin metadata server-owned and indexed", async () => {
      await svc.createNote("codascope", "shared", { userId: "alan" }, "pinned.md", "# Pinned");
      const pinned = await svc.setNotePin("codascope", "shared", { userId: "alan" }, "pinned.md", true);
      expect(pinned).toMatchObject({ pinned: true, pinnedBy: "alan", pinnedAt: expect.any(String) });

      const current = await svc.readNote("codascope", "shared", { userId: "alan" }, "pinned.md");
      const forged = current!.content.replace("pinned: true", "pinned: false").replace(/^pinnedBy:.*$/m, "pinnedBy: mallory");
      await svc.updateNote("codascope", "shared", { userId: "alan" }, "pinned.md", forged, current!.contentHash);
      const afterSave = await svc.readNote("codascope", "shared", { userId: "alan" }, "pinned.md");
      expect(afterSave!.frontmatter).toMatchObject({ pinned: true, pinnedBy: "alan" });
      expect((await svc.listNotes("codascope", "shared", { userId: "alan" })).find((entry) => entry.path === "pinned.md"))
        .toMatchObject({ pinned: true, pinnedBy: "alan" });
    });

    it("should reject creating duplicate note", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "dup.md");
      await expect(svc.createNote("codascope", "private", { userId: "alan" }, "dup.md")).rejects.toThrow("already exists");
    });

    it("should update a note", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "update-me.md");
      const note = await svc.readNote("codascope", "private", { userId: "alan" }, "update-me.md");

      const newContent = "---\nid: update-id\ntitle: Updated Title\ntags: [updated]\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: alan\n---\n\nNew body content.";
      const result = await svc.updateNote("codascope", "private", { userId: "alan" }, "update-me.md", newContent, note!.contentHash);
      expect(result).not.toBeNull();
      expect("contentHash" in result!).toBe(true);

      const updated = await svc.readNote("codascope", "private", { userId: "alan" }, "update-me.md");
      expect(updated!.frontmatter.title).toBe("Updated Title");
      expect(updated!.content).toContain("New body content.");
    });

    it("records the last editor in the directory index after an update", async () => {
      await svc.createNote("codascope", "shared", { userId: "alex" }, "edited.md");
      const note = await svc.readNote("codascope", "shared", { userId: "alex" }, "edited.md");
      const updatedContent = note!.content.replace("Untitled", "Edited");

      await svc.updateNote("codascope", "shared", { userId: "alex" }, "edited.md", updatedContent, note!.contentHash);

      const notes = await svc.listNotes("codascope", "shared", { userId: "alex" });
      const entry = notes.find((item) => item.path === "edited.md");
      expect(entry?.noteId).toBe(note!.frontmatter.id);
      expect(entry?.lastEditor).toBe("alex");
      expect(entry?.lastEditedAt).toBeTruthy();
    });

    it("should detect conflict on stale hash", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "conflict.md");
      const note = await svc.readNote("codascope", "private", { userId: "alan" }, "conflict.md");

      // Simulate another write
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      writeFileSync(path.join(notesDir, "conflict.md"), "---\nid: conflict-id\ntitle: Sneaky Update\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: alan\n---\n\nDifferent content.", "utf-8");

      const result = await svc.updateNote("codascope", "private", { userId: "alan" }, "conflict.md", "new content", note!.contentHash);
      expect(result).not.toBeNull();
      expect("conflict" in result!).toBe(true);
    });

    it("should delete a note and its assets", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "delete-me.md");

      // Create a fake assets directory
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      const assetsDir = path.join(notesDir, "delete-me.assets");
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(path.join(assetsDir, "img.png"), "fake-image");

      const deleted = await svc.deleteNote("codascope", "private", { userId: "alan" }, "delete-me.md");
      expect(deleted).toBe(true);
      expect(existsSync(path.join(notesDir, "delete-me.md"))).toBe(false);
      expect(existsSync(assetsDir)).toBe(false);
    });

    it("should return null for non-existent note read", async () => {
      const result = await svc.readNote("codascope", "private", { userId: "alan" }, "no-such-note.md");
      expect(result).toBeNull();
    });
  });

  // ── List ──────────────────────────────────────────────────────────

  describe("listNotes", () => {
    it("should list notes in a directory", async () => {
      await svc.createNote("codascope", "shared", {}, "note-a.md", "Content A");
      await svc.createNote("codascope", "shared", {}, "note-b.md", "Content B");

      const notes = await svc.listNotes("codascope", "shared", {});
      expect(notes.length).toBe(2);
    });

    it("should list notes in a subfolder", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "meeting/standup.md", "Standup notes");

      const notes = await svc.listNotes("codascope", "private", { userId: "alan" }, "meeting");
      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe("standup");
      expect(notes[0].path).toBe("meeting/standup.md");
    });

    it("should return empty array for empty directory", async () => {
      const notes = await svc.listNotes("codascope", "shared", {});
      expect(notes).toEqual([]);
    });

    it("rejects traversal in folder filters", async () => {
      await expect(svc.listNotes("codascope", "private", { userId: "alan" }, "../other-user")).rejects.toThrow("Invalid folder path.");
    });
  });

  // ── Folders ───────────────────────────────────────────────────────

  describe("folders", () => {
    it("should create and list folders", async () => {
      await svc.createFolder("codascope", "private", { userId: "alan" }, "meeting-notes");
      await svc.createFolder("codascope", "private", { userId: "alan" }, "meeting-notes/2026");
      await svc.createNote("codascope", "private", { userId: "alan" }, "meeting-notes/test.md", "test");

      const folders = await svc.listFolders("codascope", "private", { userId: "alan" });
      expect(folders.length).toBe(1);
      expect(folders[0].name).toBe("meeting-notes");
      expect(folders[0].noteCount).toBe(1);
      expect(folders[0].subfolders.length).toBe(1);
    });

    it("rejects traversal when creating folders", async () => {
      await expect(svc.createFolder("codascope", "private", { userId: "alan" }, "../../outside")).rejects.toThrow("Invalid folder path.");
      expect(existsSync(path.join(root, "outside"))).toBe(false);
    });

    it("archives and restores a nested folder tree with note companions", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "planning/2026/brief.md", "Brief");
      await svc.uploadImage("codascope", "private", { userId: "alan" }, "planning/2026/brief.md", Buffer.from("image"), "image/png");

      const archived = await svc.archiveFolder("codascope", "private", { userId: "alan" }, "planning");
      expect(archived).toMatchObject({ kind: "folder", originalPath: "planning", title: "planning" });
      expect(await svc.readNote("codascope", "private", { userId: "alan" }, "planning/2026/brief.md")).toBeNull();

      const restored = await svc.restoreNote("codascope", "private", { userId: "alan" }, archived!.noteId);
      expect(restored?.restoredPath).toBe("planning");
      expect(await svc.readNote("codascope", "private", { userId: "alan" }, "planning/2026/brief.md")).not.toBeNull();
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      expect(existsSync(path.join(notesDir, "planning", "2026", "brief.assets"))).toBe(true);
    });
  });

  // ── Image Upload ──────────────────────────────────────────────────

  describe("uploadImage", () => {
    it("should upload an image and return relative path", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "img-note.md", "Note with images");

      const buffer = Buffer.from("fake-png-data");
      const result = await svc.uploadImage(
        "codascope",
        "private",
        { userId: "alan" },
        "img-note.md",
        buffer,
        "image/png",
      );

      expect(result.relativePath).toMatch(/img-note\.assets\/.+\.png$/);
      expect(result.filename).toMatch(/^\d+_[a-f0-9]+\.png$/);

      // Verify file was actually written
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      const imgPath = path.join(notesDir, result.relativePath);
      expect(existsSync(imgPath)).toBe(true);
    });

    it("should reject upload for non-existent note", async () => {
      await expect(
        svc.uploadImage("codascope", "private", { userId: "alan" }, "no-note.md", Buffer.from("data"), "image/png"),
      ).rejects.toThrow("Note not found");
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe("searchNotes", () => {
    it("should find notes matching a query", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "search-a.md", "This mentions architecture decisions.");
      await svc.createNote("codascope", "private", { userId: "alan" }, "search-b.md", "This is about design patterns.");

      const results = await svc.searchNotes("architecture", "codascope", { userId: "alan" });
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("search-a.md");
      expect(results[0].matchLine).toContain("architecture");
    });

    it("should be case-insensitive", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "case.md", "This is IMPORTANT content.");

      const results = await svc.searchNotes("important", "codascope", { userId: "alan" });
      expect(results.length).toBe(1);
    });

    it("should return empty for no matches", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "no-match.md", "Nothing special here.");
      const results = await svc.searchNotes("zyxwvutsrqponmlk", "codascope", { userId: "alan" });
      expect(results.length).toBe(0);
    });

    it("should search both shared and private within scope", async () => {
      await svc.createNote("codascope", "shared", {}, "shared-note.md", "This has architecture info.");
      await svc.createNote("codascope", "private", { userId: "alan" }, "private-note.md", "Architecture private thoughts.");

      const results = await svc.searchNotes("architecture", "codascope", { userId: "alan" });
      expect(results.length).toBe(2);
    });
  });

  // ── Move ──────────────────────────────────────────────────────────

  describe("moveNote", () => {
    it("should move a note within the same scope and visibility", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "movable.md", "Move me");
      await svc.createFolder("codascope", "private", { userId: "alan" }, "archive");

      const moved = await svc.moveNote({
        fromScope: "codascope",
        fromVisibility: "private",
        fromOpts: { userId: "alan" },
        fromPath: "movable.md",
        toScope: "codascope",
        toVisibility: "private",
        toOpts: { userId: "alan" },
        toPath: "archive/movable.md",
      });

      expect(moved).toBe(true);

      // Original should not exist
      const original = await svc.readNote("codascope", "private", { userId: "alan" }, "movable.md");
      expect(original).toBeNull();

      // Moved note should exist
      const movedNote = await svc.readNote("codascope", "private", { userId: "alan" }, "archive/movable.md");
      expect(movedNote).not.toBeNull();
      expect(movedNote!.content).toContain("Move me");
    });

    it("should move assets along with the note", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "with-assets.md", "Note");
      await svc.uploadImage("codascope", "private", { userId: "alan" }, "with-assets.md", Buffer.from("img"), "image/png");

      await svc.createFolder("codascope", "private", { userId: "alan" }, "moved");
      const moved = await svc.moveNote({
        fromScope: "codascope",
        fromVisibility: "private",
        fromOpts: { userId: "alan" },
        fromPath: "with-assets.md",
        toScope: "codascope",
        toVisibility: "private",
        toOpts: { userId: "alan" },
        toPath: "moved/with-assets.md",
      });

      expect(moved).toBe(true);

      // Assets dir should exist at new location
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      expect(existsSync(path.join(notesDir, "moved", "with-assets.assets"))).toBe(true);
      // Old assets should not exist
      expect(existsSync(path.join(notesDir, "with-assets.assets"))).toBe(false);
    });

    it("leaves a note and its assets untouched when destination data already exists", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "source.md", "Note");
      await svc.uploadImage("codascope", "private", { userId: "alan" }, "source.md", Buffer.from("img"), "image/png");
      const notesDir = svc.resolveNotesDir("codascope", "private", { userId: "alan" })!;
      mkdirSync(path.join(notesDir, "target", "source.assets"), { recursive: true });

      await expect(svc.moveNote({
        fromScope: "codascope",
        fromVisibility: "private",
        fromOpts: { userId: "alan" },
        fromPath: "source.md",
        toScope: "codascope",
        toVisibility: "private",
        toOpts: { userId: "alan" },
        toPath: "target/source.md",
      })).rejects.toThrow("Target note data already exists");

      expect(existsSync(path.join(notesDir, "source.md"))).toBe(true);
      expect(existsSync(path.join(notesDir, "source.assets"))).toBe(true);
      expect(existsSync(path.join(notesDir, "target", "source.md"))).toBe(false);
    });

    it("moves an entire nested folder between visibility libraries", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "research/decisions/choice.md", "Decision");
      await svc.uploadImage("codascope", "private", { userId: "alan" }, "research/decisions/choice.md", Buffer.from("image"), "image/png");

      const moved = await svc.moveFolder({
        fromScope: "codascope",
        fromVisibility: "private",
        fromOpts: { userId: "alan" },
        fromFolder: "research",
        toScope: "codascope",
        toVisibility: "shared",
        toOpts: { userId: "alan" },
        toFolder: "team/research",
      });

      expect(moved).toBe(true);
      expect(await svc.readNote("codascope", "private", { userId: "alan" }, "research/decisions/choice.md")).toBeNull();
      expect(await svc.readNote("codascope", "shared", {}, "team/research/decisions/choice.md")).not.toBeNull();
      const sharedDir = svc.resolveNotesDir("codascope", "shared", {})!;
      expect(existsSync(path.join(sharedDir, "team", "research", "decisions", "choice.assets"))).toBe(true);
    });

    it("refuses to move a folder into its own nested path", async () => {
      await svc.createFolder("codascope", "private", { userId: "alan" }, "parent/child");
      await expect(svc.moveFolder({
        fromScope: "codascope",
        fromVisibility: "private",
        fromOpts: { userId: "alan" },
        fromFolder: "parent",
        toScope: "codascope",
        toVisibility: "private",
        toOpts: { userId: "alan" },
        toFolder: "parent/child/parent",
      })).rejects.toThrow("cannot be moved into itself");
    });
  });

  // ── Index ─────────────────────────────────────────────────────────

  describe("refreshIndex", () => {
    it("should generate _notes-index.json", async () => {
      await svc.createNote("codascope", "shared", {}, "indexed-note.md", "Indexed content");

      const notesDir = svc.resolveNotesDir("codascope", "shared", {})!;
      const indexPath = path.join(notesDir, "_notes-index.json");
      expect(existsSync(indexPath)).toBe(true);

      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.notes.length).toBe(1);
      expect(index.notes[0].path).toBe("indexed-note.md");
      expect(index.generatedAt).toBeTruthy();
    });
  });

  // ── Activity ──────────────────────────────────────────────────────

  describe("getActivity", () => {
    it("uses audit actors and word deltas for versioned edits", async () => {
      await svc.createNote("codascope", "shared", { userId: "alex" }, "activity.md", "one two");
      const original = await svc.readNote("codascope", "shared", { userId: "alex" }, "activity.md");
      await svc.updateNote(
        "codascope",
        "shared",
        { userId: "alex" },
        "activity.md",
        `${original!.content} three four`,
        original!.contentHash,
      );

      const activity = await svc.getActivity("codascope", "shared", { userId: "alex" }, "activity.md", {
        query: () => [
          {
            event: "note.updated",
            timestamp: "2026-07-11T00:00:01.000Z",
            actor: "alex",
            noteId: original!.frontmatter.id,
            scope: "codascope",
            visibility: "shared",
            path: "activity.md",
          },
          {
            event: "note.visibility_changed",
            timestamp: "2026-07-11T00:00:02.000Z",
            actor: "alex",
            noteId: original!.frontmatter.id,
            scope: "codascope",
            visibility: "shared",
            path: "activity.md",
            metadata: { fromVisibility: "private", toVisibility: "shared" },
          },
        ],
      });

      expect(activity).toContainEqual(expect.objectContaining({
        type: "edit",
        actor: "alex",
        details: expect.stringContaining("Added 2 words"),
      }));
      expect(activity).toContainEqual(expect.objectContaining({
        type: "visibility_changed",
        actor: "alex",
        details: "Changed visibility from private to shared",
      }));
    });
  });

  // ── Annotation control syntax ─────────────────────────────────────

  describe("annotation control syntax", () => {
    it("excludes inline marker comments from note word counts and search snippets", async () => {
      const id = "nann_abcdef123456";
      await svc.createNote(
        "codascope",
        "private",
        { userId: "alan" },
        "anchored.md",
        `Visible ${annotationStartMarker(id)}selected text${annotationEndMarker(id)} remains.`,
      );

      const entries = await svc.listNotes("codascope", "private", { userId: "alan" });
      expect(entries.find((entry) => entry.path === "anchored.md")?.wordCount).toBe(4);
      expect(await svc.searchNotes("codascope:ann-start", "codascope", { userId: "alan" })).toEqual([]);
      expect(await svc.searchNotes("selected text", "codascope", { userId: "alan" })).toHaveLength(1);
    });
  });

  // ── Content Hash ──────────────────────────────────────────────────

  describe("content hash", () => {
    it("should produce consistent MD5 hash", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "hash-test.md", "Consistent content");
      const read1 = await svc.readNote("codascope", "private", { userId: "alan" }, "hash-test.md");
      const read2 = await svc.readNote("codascope", "private", { userId: "alan" }, "hash-test.md");
      expect(read1!.contentHash).toBe(read2!.contentHash);
    });

    it("should change hash after update", async () => {
      await svc.createNote("codascope", "private", { userId: "alan" }, "hash-change.md", "Original");
      const read1 = await svc.readNote("codascope", "private", { userId: "alan" }, "hash-change.md");

      const newContent = "---\nid: hash-id\ntitle: hash change\ntags: []\ncreated: 2026-07-09T00:00:00Z\nupdated: 2026-07-09T00:00:00Z\nowner: alan\n---\n\nModified content.";
      await svc.updateNote("codascope", "private", { userId: "alan" }, "hash-change.md", newContent);

      const read2 = await svc.readNote("codascope", "private", { userId: "alan" }, "hash-change.md");
      expect(read1!.contentHash).not.toBe(read2!.contentHash);
    });
  });
});
