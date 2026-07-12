/* ── CodaScope: Annotation Service Tests ─────────────────────────────
   Unit tests for CodaScopeAnnotationService.
   Exercises computeBlockIds (pure function), annotation CRUD,
   anchor repair (fuzzy re-anchoring), directive CRUD,
   directive apply/undo/reject, and batch execution with rollback.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeAnnotationService } from "./codaScopeAnnotationService.js";
import { CodaScopeDirectiveService } from "./codaScopeDirectiveService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `annotation-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
}

/** Scaffold a minimal project + epic with annotations/directives dirs. */
function scaffoldProject(root: string, projectId: string, epicId: string): string {
  const projectDir = path.join(root, `project-${projectId}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: "Test Project" }),
    "utf-8",
  );

  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });

  return projectDir;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeAnnotationService", () => {
  let root: string;
  let svc: CodaScopeAnnotationService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeAnnotationService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── computeBlockIds ───────────────────────────────────────────

  describe("computeBlockIds", () => {
    it("returns empty array for empty content", () => {
      const blocks = svc.computeBlockIds("");
      expect(blocks).toEqual([]);
    });

    it("returns empty array for whitespace-only content", () => {
      const blocks = svc.computeBlockIds("   \n  \n  ");
      expect(blocks).toEqual([]);
    });

    it("creates blocks from simple paragraphs", () => {
      const md = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
      const blocks = svc.computeBlockIds(md);
      expect(blocks).toHaveLength(3);
      expect(blocks[0].content).toBe("First paragraph.");
      expect(blocks[1].content).toBe("Second paragraph.");
      expect(blocks[2].content).toBe("Third paragraph.");
    });

    it("produces deterministic block IDs from content", () => {
      const md = "# Heading\n\nSome content here.";
      const blocks1 = svc.computeBlockIds(md);
      const blocks2 = svc.computeBlockIds(md);
      expect(blocks1.map((b) => b.blockId)).toEqual(blocks2.map((b) => b.blockId));
    });

    it("headings create new section context", () => {
      const md = "# Auth Flow\n\nLogin page.\n\n## OAuth\n\nExternal providers.";
      const blocks = svc.computeBlockIds(md);
      expect(blocks.length).toBeGreaterThanOrEqual(4);

      // Heading blocks
      const authBlock = blocks.find((b) => b.content === "# Auth Flow");
      expect(authBlock).toBeDefined();
      expect(authBlock!.sectionSlug).toBe("auth-flow");

      const oauthBlock = blocks.find((b) => b.content === "## OAuth");
      expect(oauthBlock).toBeDefined();
      expect(oauthBlock!.sectionSlug).toBe("oauth");

      // Content after OAuth heading should be in oauth section
      const providersBlock = blocks.find((b) => b.content === "External providers.");
      expect(providersBlock).toBeDefined();
      expect(providersBlock!.sectionSlug).toBe("oauth");
    });

    it("code fences are treated as single blocks", () => {
      const md = "Before code.\n\n```typescript\nconst x = 1;\nconst y = 2;\n```\n\nAfter code.";
      const blocks = svc.computeBlockIds(md);
      expect(blocks).toHaveLength(3);

      const codeBlock = blocks[1];
      expect(codeBlock.content).toContain("```typescript");
      expect(codeBlock.content).toContain("const x = 1;");
      expect(codeBlock.content).toContain("```");
    });

    it("block IDs include section slug and index", () => {
      const md = "# API Design\n\nEndpoints go here.\n\nResponse formats.";
      const blocks = svc.computeBlockIds(md);

      // Content blocks should have section slug in their IDs
      const contentBlocks = blocks.filter((b) => !b.content.startsWith("#"));
      for (const b of contentBlocks) {
        expect(b.blockId).toContain("api-design");
      }
    });

    it("1-indexed line numbers", () => {
      const md = "First line.\n\nThird line.";
      const blocks = svc.computeBlockIds(md);
      expect(blocks[0].lineStart).toBe(1);
      expect(blocks[0].lineEnd).toBe(1);
      expect(blocks[1].lineStart).toBe(3);
      expect(blocks[1].lineEnd).toBe(3);
    });

    it("handles content with no headings (root section)", () => {
      const md = "Just plain text\nwith multiple lines.\n\nAnd a second paragraph.";
      const blocks = svc.computeBlockIds(md);
      expect(blocks.length).toBeGreaterThanOrEqual(2);
      for (const b of blocks) {
        expect(b.sectionSlug).toBe("root");
      }
    });
  });

  // ── Annotation CRUD ───────────────────────────────────────────

  describe("annotation CRUD", () => {
    it("creates an annotation", async () => {
      scaffoldProject(root, "proj-ann", "epic1");
      const ann = await svc.createAnnotation("proj-ann", "epic1", "doc1", {
        anchor: {
          blockId: "blk_root_0_abcd",
          sectionSlug: "root",
          lineNumber: 1,
          anchorText: "First paragraph.",
        },
        author: "user",
        body: "This needs more detail.",
      });

      expect(ann.id).toMatch(/^ann_/);
      expect(ann.author).toBe("user");
      expect(ann.body).toBe("This needs more detail.");
      expect(ann.status).toBe("open");
      expect(ann.parentId).toBeUndefined();
    });

    it("lists annotations for a document", async () => {
      scaffoldProject(root, "proj-ann2", "epic2");
      await svc.createAnnotation("proj-ann2", "epic2", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Comment A",
      });
      await svc.createAnnotation("proj-ann2", "epic2", "doc1", {
        anchor: { blockId: "b2", sectionSlug: "root", lineNumber: 5 },
        author: "agent",
        body: "Comment B",
      });

      const list = await svc.listAnnotations("proj-ann2", "epic2", "doc1");
      expect(list).toHaveLength(2);
    });

    it("updates annotation status", async () => {
      scaffoldProject(root, "proj-ann3", "epic3");
      const ann = await svc.createAnnotation("proj-ann3", "epic3", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Needs work",
      });

      const updated = await svc.updateAnnotation("proj-ann3", "epic3", ann.id, {
        status: "resolved",
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("resolved");
    });

    it("resolving a parent resolves all replies", async () => {
      scaffoldProject(root, "proj-ann4", "epic4");
      const parent = await svc.createAnnotation("proj-ann4", "epic4", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Parent comment",
      });
      await svc.createAnnotation("proj-ann4", "epic4", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "agent",
        body: "Reply 1",
        parentId: parent.id,
      });
      await svc.createAnnotation("proj-ann4", "epic4", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Reply 2",
        parentId: parent.id,
      });

      // Resolve parent
      await svc.updateAnnotation("proj-ann4", "epic4", parent.id, { status: "resolved" });

      // All should be resolved
      const list = await svc.listAnnotations("proj-ann4", "epic4", "doc1");
      expect(list.every((a) => a.status === "resolved")).toBe(true);
    });

    it("deletes an annotation and its replies", async () => {
      scaffoldProject(root, "proj-ann5", "epic5");
      const parent = await svc.createAnnotation("proj-ann5", "epic5", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Deletable",
      });
      await svc.createAnnotation("proj-ann5", "epic5", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "agent",
        body: "Reply",
        parentId: parent.id,
      });

      const result = await svc.deleteAnnotation("proj-ann5", "epic5", parent.id);
      expect(result).toBe(true);

      const list = await svc.listAnnotations("proj-ann5", "epic5", "doc1");
      expect(list).toHaveLength(0);
    });

    it("counts open annotations (top-level only)", async () => {
      scaffoldProject(root, "proj-ann6", "epic6");
      const parent = await svc.createAnnotation("proj-ann6", "epic6", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "user",
        body: "Open parent",
      });
      await svc.createAnnotation("proj-ann6", "epic6", "doc1", {
        anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
        author: "agent",
        body: "Open reply",
        parentId: parent.id,
      });
      const other = await svc.createAnnotation("proj-ann6", "epic6", "doc1", {
        anchor: { blockId: "b2", sectionSlug: "root", lineNumber: 5 },
        author: "user",
        body: "Resolved",
      });
      await svc.updateAnnotation("proj-ann6", "epic6", other.id, { status: "resolved" });

      const count = await svc.getOpenAnnotationCount("proj-ann6", "epic6");
      expect(count).toBe(1); // only the parent, not the reply, not the resolved one
    });

    it("returns null when updating nonexistent annotation", async () => {
      scaffoldProject(root, "proj-ann7", "epic7");
      const result = await svc.updateAnnotation("proj-ann7", "epic7", "nonexistent", { body: "X" });
      expect(result).toBeNull();
    });

    it("throws when creating in nonexistent project", async () => {
      await expect(
        svc.createAnnotation("nonexistent", "epic1", "doc1", {
          anchor: { blockId: "b1", sectionSlug: "root", lineNumber: 1 },
          author: "user",
          body: "Test",
        }),
      ).rejects.toThrow("Project not found");
    });
  });

  // ── Anchor Repair ────────────────────────────────────────────

  describe("anchor repair", () => {
    it("re-anchors annotation when block ID no longer matches", async () => {
      scaffoldProject(root, "proj-repair", "epic-r");

      // Create annotation against original document
      const originalDoc = "# Heading\n\nFirst paragraph about auth.\n\nSecond paragraph.";
      const originalBlocks = svc.computeBlockIds(originalDoc);
      const firstContentBlock = originalBlocks.find((b) => b.content.includes("auth"));

      await svc.createAnnotation("proj-repair", "epic-r", "doc1", {
        anchor: {
          blockId: firstContentBlock!.blockId,
          sectionSlug: firstContentBlock!.sectionSlug,
          lineNumber: firstContentBlock!.lineStart,
          anchorText: "First paragraph about auth.",
        },
        author: "user",
        body: "Clarify this",
      });

      // Now the document changes (heading renamed → block IDs change)
      const modifiedDoc = "# Authentication\n\nFirst paragraph about auth.\n\nSecond paragraph.";

      const list = await svc.listAnnotations("proj-repair", "epic-r", "doc1", modifiedDoc);
      expect(list).toHaveLength(1);

      // Annotation should have been re-anchored via fuzzy text match
      const ann = list[0];
      const newBlocks = svc.computeBlockIds(modifiedDoc);
      const matchingBlock = newBlocks.find((b) => b.content.includes("auth"));

      // The anchor's blockId should now match the new document's block
      expect(ann.anchor.blockId).toBe(matchingBlock!.blockId);
    });

    it("preserves annotations when blocks haven't changed", async () => {
      scaffoldProject(root, "proj-repair2", "epic-r2");
      const doc = "# Heading\n\nSome content.";

      const blocks = svc.computeBlockIds(doc);
      const block = blocks.find((b) => b.content === "Some content.");

      await svc.createAnnotation("proj-repair2", "epic-r2", "doc1", {
        anchor: {
          blockId: block!.blockId,
          sectionSlug: block!.sectionSlug,
          lineNumber: block!.lineStart,
        },
        author: "user",
        body: "Note",
      });

      // Re-list with same doc — no change expected
      const list = await svc.listAnnotations("proj-repair2", "epic-r2", "doc1", doc);
      expect(list[0].anchor.blockId).toBe(block!.blockId);
    });
  });

  // ── Directive CRUD ────────────────────────────────────────────

  describe("directive CRUD", () => {
    let svc: CodaScopeDirectiveService;

    beforeEach(() => {
      svc = new CodaScopeDirectiveService(root);
    });

    it("creates a directive", async () => {
      scaffoldProject(root, "proj-dir", "epic-d");
      const dir = await svc.createDirective("proj-dir", "epic-d", "doc1", {
        type: "insert",
        afterLine: 5,
        instruction: "Add error handling section.",
        author: "user",
      });

      expect(dir.id).toMatch(/^dir_/);
      expect(dir.type).toBe("insert");
      expect(dir.afterLine).toBe(5);
      expect(dir.status).toBe("pending");
    });

    it("lists directives", async () => {
      scaffoldProject(root, "proj-dir2", "epic-d2");
      await svc.createDirective("proj-dir2", "epic-d2", "doc1", {
        type: "insert",
        afterLine: 3,
        instruction: "Insert A",
        author: "user",
      });
      await svc.createDirective("proj-dir2", "epic-d2", "doc1", {
        type: "replace",
        afterLine: 7,
        startLine: 7,
        endLine: 10,
        instruction: "Replace B",
        author: "agent",
      });

      const list = await svc.listDirectives("proj-dir2", "epic-d2", "doc1");
      expect(list).toHaveLength(2);
    });

    it("updates a directive", async () => {
      scaffoldProject(root, "proj-dir3", "epic-d3");
      const dir = await svc.createDirective("proj-dir3", "epic-d3", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Original",
        author: "user",
      });

      const updated = await svc.updateDirective("proj-dir3", "epic-d3", dir.id, "doc1", {
        generatedContent: "# Generated Heading\n\nGenerated content.",
      });

      expect(updated).not.toBeNull();
      expect(updated!.generatedContent).toBe("# Generated Heading\n\nGenerated content.");
    });

    it("deletes a directive", async () => {
      scaffoldProject(root, "proj-dir4", "epic-d4");
      const dir = await svc.createDirective("proj-dir4", "epic-d4", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Deletable",
        author: "user",
      });

      const deleted = await svc.deleteDirective("proj-dir4", "epic-d4", dir.id, "doc1");
      expect(deleted).toBe(true);

      const list = await svc.listDirectives("proj-dir4", "epic-d4", "doc1");
      expect(list).toHaveLength(0);
    });
  });

  // ── Directive Apply / Undo / Reject ─────────────────────────

  describe("directive apply / undo / reject", () => {
    let svc: CodaScopeDirectiveService;

    beforeEach(() => {
      svc = new CodaScopeDirectiveService(root);
    });

    it("applies an insert directive", async () => {
      scaffoldProject(root, "proj-apply", "epic-a");
      const dir = await svc.createDirective("proj-apply", "epic-a", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Add content after line 1",
        author: "user",
      });

      // Set generated content
      await svc.updateDirective("proj-apply", "epic-a", dir.id, "doc1", {
        generatedContent: "INSERTED LINE",
      });

      let docContent = "Line 1\nLine 2\nLine 3";
      const getDoc = async () => docContent;
      const setDoc = async (c: string) => { docContent = c; };

      const result = await svc.applyDirective("proj-apply", "epic-a", "doc1", dir.id, getDoc, setDoc);
      expect(result).not.toBeNull();
      expect(result!.newContent).toBe("Line 1\nINSERTED LINE\nLine 2\nLine 3");
      expect(result!.directive.status).toBe("applied");
    });

    it("applies a replace directive", async () => {
      scaffoldProject(root, "proj-apply2", "epic-a2");
      const dir = await svc.createDirective("proj-apply2", "epic-a2", "doc1", {
        type: "replace",
        afterLine: 2,
        startLine: 2,
        endLine: 3,
        instruction: "Replace lines 2–3",
        author: "user",
      });

      await svc.updateDirective("proj-apply2", "epic-a2", dir.id, "doc1", {
        generatedContent: "REPLACED",
      });

      let docContent = "Line 1\nLine 2\nLine 3\nLine 4";
      const getDoc = async () => docContent;
      const setDoc = async (c: string) => { docContent = c; };

      const result = await svc.applyDirective("proj-apply2", "epic-a2", "doc1", dir.id, getDoc, setDoc);
      expect(result).not.toBeNull();
      expect(result!.newContent).toBe("Line 1\nREPLACED\nLine 4");
    });

    it("undoes an applied directive by restoring snapshot", async () => {
      scaffoldProject(root, "proj-undo", "epic-u");
      const dir = await svc.createDirective("proj-undo", "epic-u", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Undoable insert",
        author: "user",
      });

      await svc.updateDirective("proj-undo", "epic-u", dir.id, "doc1", {
        generatedContent: "INSERTED",
      });

      let docContent = "Original";
      const getDoc = async () => docContent;
      const setDoc = async (c: string) => { docContent = c; };

      await svc.applyDirective("proj-undo", "epic-u", "doc1", dir.id, getDoc, setDoc);
      expect(docContent).toContain("INSERTED");

      const undone = await svc.undoDirective("proj-undo", "epic-u", "doc1", dir.id, setDoc);
      expect(undone).not.toBeNull();
      expect(undone!.status).toBe("pending");
      expect(docContent).toBe("Original");
    });

    it("rejects a directive by clearing generated content", async () => {
      scaffoldProject(root, "proj-reject", "epic-rej");
      const dir = await svc.createDirective("proj-reject", "epic-rej", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Rejectable",
        author: "user",
      });

      await svc.updateDirective("proj-reject", "epic-rej", dir.id, "doc1", {
        generatedContent: "GENERATED",
      });

      const rejected = await svc.rejectDirective("proj-reject", "epic-rej", "doc1", dir.id);
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe("pending");
      expect(rejected!.generatedContent).toBeUndefined();
    });

    it("returns null when applying directive without generated content", async () => {
      scaffoldProject(root, "proj-no-gen", "epic-ng");
      const dir = await svc.createDirective("proj-no-gen", "epic-ng", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "No content yet",
        author: "user",
      });

      const result = await svc.applyDirective(
        "proj-no-gen", "epic-ng", "doc1", dir.id,
        async () => "doc",
        async () => {},
      );
      expect(result).toBeNull();
    });
  });

  // ── Batch Directives ──────────────────────────────────────────

  describe("executeBatchDirectives", () => {
    let svc: CodaScopeDirectiveService;

    beforeEach(() => {
      svc = new CodaScopeDirectiveService(root);
    });

    it("applies all pending directives top-to-bottom", async () => {
      scaffoldProject(root, "proj-batch", "epic-b");

      // Create two insert directives
      const dir1 = await svc.createDirective("proj-batch", "epic-b", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Insert after line 1",
        author: "user",
      });
      const dir2 = await svc.createDirective("proj-batch", "epic-b", "doc1", {
        type: "insert",
        afterLine: 3,
        instruction: "Insert after line 3",
        author: "user",
      });

      await svc.updateDirective("proj-batch", "epic-b", dir1.id, "doc1", {
        generatedContent: "INSERTED_1",
      });
      await svc.updateDirective("proj-batch", "epic-b", dir2.id, "doc1", {
        generatedContent: "INSERTED_2",
      });

      let docContent = "Line 1\nLine 2\nLine 3\nLine 4";
      const getDoc = async () => docContent;
      const setDoc = async (c: string) => { docContent = c; };

      const result = await svc.executeBatchDirectives("proj-batch", "epic-b", "doc1", getDoc, setDoc);
      expect(result).not.toBeNull();
      expect(result!.applied).toHaveLength(2);

      // Both insertions should be in the document
      expect(docContent).toContain("INSERTED_1");
      expect(docContent).toContain("INSERTED_2");
    });

    it("rolls back on error during batch", async () => {
      scaffoldProject(root, "proj-batch2", "epic-b2");

      // Create two directives so the batch processes multiple items
      const dir1 = await svc.createDirective("proj-batch2", "epic-b2", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Insert first",
        author: "user",
      });
      const dir2 = await svc.createDirective("proj-batch2", "epic-b2", "doc1", {
        type: "insert",
        afterLine: 3,
        instruction: "Insert second",
        author: "user",
      });

      await svc.updateDirective("proj-batch2", "epic-b2", dir1.id, "doc1", {
        generatedContent: "INSERTED_1",
      });
      await svc.updateDirective("proj-batch2", "epic-b2", dir2.id, "doc1", {
        generatedContent: "INSERTED_2",
      });

      const originalContent = "Line 1\nLine 2\nLine 3\nLine 4";
      let docContent = originalContent;
      const getDoc = async () => docContent;

      // setDoc throws on first call (success persist) but succeeds on second
      // (rollback restore). This exercises the catch block properly.
      let setDocCalls = 0;
      const setDoc = async (c: string) => {
        setDocCalls++;
        if (setDocCalls === 1) throw new Error("Disk write failed");
        docContent = c;
      };

      await expect(
        svc.executeBatchDirectives("proj-batch2", "epic-b2", "doc1", getDoc, setDoc),
      ).rejects.toThrow("Disk write failed");

      // After rollback, the directives should be back to pending
      const directives = await svc.listDirectives("proj-batch2", "epic-b2", "doc1");
      for (const d of directives) {
        expect(d.status).toBe("pending");
        expect(d.preApplySnapshot).toBeUndefined();
      }
      // Document should be restored
      expect(docContent).toBe(originalContent);
    });

    it("returns empty applied list when no pending directives have content", async () => {
      scaffoldProject(root, "proj-batch3", "epic-b3");

      // Create a directive with no generated content
      await svc.createDirective("proj-batch3", "epic-b3", "doc1", {
        type: "insert",
        afterLine: 1,
        instruction: "Pending without content",
        author: "user",
      });

      let docContent = "Original";
      const result = await svc.executeBatchDirectives(
        "proj-batch3", "epic-b3", "doc1",
        async () => docContent,
        async (c) => { docContent = c; },
      );

      expect(result).not.toBeNull();
      expect(result!.applied).toHaveLength(0);
      expect(result!.newContent).toBe("Original");
    });
  });
});
