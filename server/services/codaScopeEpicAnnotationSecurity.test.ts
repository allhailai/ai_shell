import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CodaScopeAnnotationService,
  type AnnotationActor,
} from "./codaScopeAnnotationService.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceError,
  type PersistenceContext,
} from "./codaScopePersistence.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";

const ALICE: AnnotationActor = { username: "alice", origin: "user" };
const BOB: AnnotationActor = { username: "bob", origin: "user" };
const ALICE_AGENT: AnnotationActor = { username: "alice", origin: "agent" };
const roots: string[] = [];

function scaffold(projectId = "project", epicId = "epic"): { root: string; filePath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-epic-annotation-security-"));
  roots.push(root);
  const projectDir = path.join(root, "project-dir");
  mkdirSync(path.join(projectDir, "epics", epicId, "annotations"), { recursive: true });
  writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({ id: projectId, name: "Project" }), "utf-8");
  const now = "2026-01-01T00:00:00.000Z";
  const epic = {
    id: epicId,
    projectId,
    title: "Epic",
    status: "designing",
    createdAt: now,
    updatedAt: now,
    createdBy: "alice",
    collaborators: ["alice"],
    currentVersion: 0,
  };
  writeFileSync(path.join(projectDir, "epics", "epics.json"), JSON.stringify({ epics: [epic] }), "utf-8");
  writeFileSync(
    path.join(projectDir, "epics", epicId, "epic.json"),
    JSON.stringify({ ...epic, conversationId: null }),
    "utf-8",
  );
  writeFileSync(path.join(projectDir, "epics", epicId, "definition.md"), "# Heading\n\nTarget paragraph.", "utf-8");
  return {
    root,
    filePath: path.join(projectDir, "epics", epicId, "annotations", "definition-annotations.json"),
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function bytes(filePath: string): Buffer {
  return readFileSync(filePath);
}

function exactAnchor(service: CodaScopeAnnotationService, content: string, exactText: string) {
  const block = service.computeBlockIds(content).find((candidate) => candidate.content === exactText);
  if (!block) throw new Error(`Missing test block: ${exactText}`);
  return {
    blockId: block.blockId,
    sectionSlug: block.sectionSlug,
    anchorText: block.content,
    lineNumber: block.lineStart,
  };
}

async function createRoot(
  service: CodaScopeAnnotationService,
  actor: AnnotationActor,
  content = "# Heading\n\nTarget paragraph.",
  body = "Root comment",
) {
  return service.createAnnotation("project", "epic", "definition", actor, {
    anchor: exactAnchor(service, content, "Target paragraph."),
    body,
  });
}

class FailOnceAnnotationWritePersistence extends CodaScopePersistence {
  private failed = false;

  override async writeJson(filePath: string, value: unknown, context: PersistenceContext): Promise<void> {
    if (!this.failed && context.storage === "epic_annotations") {
      this.failed = true;
      throw new CodaScopePersistenceError(context);
    }
    await super.writeJson(filePath, value, context);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("epic annotation actor and ownership policy", () => {
  it("derives human and agent identity from trusted actors and fails closed without one", async () => {
    const { root } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const human = await createRoot(service, ALICE, undefined, "Human comment");
    const agent = await service.createAnnotation("project", "epic", "definition", ALICE_AGENT, {
      anchor: human.anchor,
      body: "Agent-authored comment",
    });

    expect(human).toMatchObject({ author: "alice", origin: "user", ownership: "owned" });
    expect(agent).toMatchObject({ author: "alice", origin: "agent", ownership: "owned" });
    await expect(service.createAnnotation(
      "project",
      "epic",
      "definition",
      { username: "", origin: "agent" },
      { anchor: human.anchor, body: "Unowned" },
    )).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("hides unauthorized body edits and deletes and preserves exact bytes", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    const reply = await service.createAnnotation("project", "epic", "definition", BOB, {
      parentId: rootAnnotation.id,
      body: "Bob reply",
    });
    const before = bytes(filePath);

    expect(await service.updateAnnotation("project", "epic", rootAnnotation.id, BOB, { body: "forged" })).toBeNull();
    expect(bytes(filePath)).toEqual(before);
    expect(await service.deleteAnnotation("project", "epic", rootAnnotation.id, BOB)).toBe(false);
    expect(bytes(filePath)).toEqual(before);
    expect(await service.updateAnnotation("project", "epic", "missing", BOB, { body: "forged" })).toBeNull();
    expect(await service.deleteAnnotation("project", "epic", "missing", BOB)).toBe(false);

    const edited = await service.updateAnnotation("project", "epic", rootAnnotation.id, ALICE, { body: "Owned edit" });
    expect(edited?.body).toBe("Owned edit");
    expect(await service.deleteAnnotation("project", "epic", rootAnnotation.id, ALICE)).toBe(true);
    const discussion = await service.listAnnotations("project", "epic", "definition");
    expect(discussion).toHaveLength(2);
    expect(discussion.find((item) => item.id === rootAnnotation.id)).toMatchObject({ body: "", deletedBy: "alice" });
    expect(discussion.find((item) => item.id === reply.id)?.body).toBe("Bob reply");
  });

  it("removes an owned leaf without affecting its parent or siblings", async () => {
    const { root } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    const bobReply = await service.createAnnotation("project", "epic", "definition", BOB, { parentId: rootAnnotation.id, body: "Bob" });
    const aliceReply = await service.createAnnotation("project", "epic", "definition", ALICE, { parentId: rootAnnotation.id, body: "Alice" });

    expect(await service.deleteAnnotation("project", "epic", aliceReply.id, ALICE)).toBe(true);
    const discussion = await service.listAnnotations("project", "epic", "definition");
    expect(discussion.map((item) => item.id)).toEqual([rootAnnotation.id, bobReply.id]);
  });
});

describe("epic annotation status policy", () => {
  it("enforces the complete transition table and applies root status to descendants", async () => {
    const { root } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    const reply = await service.createAnnotation("project", "epic", "definition", BOB, { parentId: rootAnnotation.id, body: "Reply" });

    await service.updateAnnotation("project", "epic", rootAnnotation.id, BOB, { status: "resolved" });
    expect((await service.listAnnotations("project", "epic", "definition")).every((item) => item.status === "resolved")).toBe(true);
    await service.updateAnnotation("project", "epic", rootAnnotation.id, ALICE, { status: "resolved" });
    await expect(service.updateAnnotation("project", "epic", rootAnnotation.id, ALICE, { status: "wontfix" }))
      .rejects.toMatchObject({ code: "invalid_status_transition" });
    await service.updateAnnotation("project", "epic", rootAnnotation.id, ALICE, { status: "open" });
    await service.updateAnnotation("project", "epic", rootAnnotation.id, BOB, { status: "wontfix" });
    await expect(service.updateAnnotation("project", "epic", rootAnnotation.id, BOB, { status: "resolved" }))
      .rejects.toMatchObject({ code: "invalid_status_transition" });
    await service.updateAnnotation("project", "epic", rootAnnotation.id, BOB, { status: "open" });
    expect((await service.listAnnotations("project", "epic", "definition")).every((item) => item.status === "open")).toBe(true);

    await expect(service.updateAnnotation("project", "epic", reply.id, ALICE, { status: "resolved" }))
      .rejects.toMatchObject({ code: "invalid_status_transition" });
    await expect(service.updateAnnotation("project", "epic", rootAnnotation.id, ALICE, { status: "invalid" as never }))
      .rejects.toMatchObject({ code: "invalid_status_transition" });
  });

  it("rejects a poisoned version 2 descendant status before reconciliation and preserves bytes", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    const reply = await service.createAnnotation("project", "epic", "definition", BOB, {
      parentId: rootAnnotation.id,
      body: "Reply",
    });
    const stored = JSON.parse(readFileSync(filePath, "utf-8"));
    stored.annotations.find((annotation: { id: string }) => annotation.id === reply.id).status = "resolved";
    writeJson(filePath, stored);
    const before = bytes(filePath);

    await expect(service.listAnnotations(
      "project",
      "epic",
      "definition",
      "# Heading\n\nTarget paragraph.",
    )).rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(bytes(filePath)).toEqual(before);
  });
});

describe("epic annotation reactions", () => {
  it("binds reaction identity to the actor and makes duplicate operations idempotent", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const annotation = await createRoot(service, ALICE);

    await Promise.all([
      service.addReaction("project", "epic", annotation.id, ALICE, "👍"),
      service.addReaction("project", "epic", annotation.id, BOB, "👍"),
    ]);
    const reacted = (await service.listAnnotations("project", "epic", "definition"))[0];
    expect(reacted.reactions).toEqual(expect.arrayContaining([
      { emoji: "👍", user: "alice" },
      { emoji: "👍", user: "bob" },
    ]));

    const afterAdds = bytes(filePath);
    await service.addReaction("project", "epic", annotation.id, ALICE, "👍");
    expect(bytes(filePath)).toEqual(afterAdds);
    await service.removeReaction("project", "epic", annotation.id, { username: "mallory", origin: "user" }, "👍");
    expect(bytes(filePath)).toEqual(afterAdds);

    await service.removeReaction("project", "epic", annotation.id, ALICE, "👍");
    expect((await service.listAnnotations("project", "epic", "definition"))[0].reactions)
      .toEqual([{ emoji: "👍", user: "bob" }]);
  });

  it("rejects whole-array reaction replacement at the service boundary without changing bytes", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const annotation = await createRoot(service, ALICE);
    const before = bytes(filePath);

    await expect(service.updateAnnotation(
      "project",
      "epic",
      annotation.id,
      ALICE,
      { body: "Attempted edit", reactions: [{ emoji: "👍", user: "mallory" }] } as never,
    )).rejects.toMatchObject({ code: "invalid_input" });
    expect(bytes(filePath)).toEqual(before);
  });

  it("rejects reactions on deleted or missing annotations", async () => {
    const { root } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    await service.createAnnotation("project", "epic", "definition", BOB, { parentId: rootAnnotation.id, body: "Reply" });
    await service.deleteAnnotation("project", "epic", rootAnnotation.id, ALICE);
    expect(await service.addReaction("project", "epic", rootAnnotation.id, BOB, "👍")).toBeNull();
    expect(await service.removeReaction("project", "epic", "missing", BOB, "👍")).toBeNull();
  });
});

describe("epic annotation attachment reconciliation", () => {
  it("keeps only exact block IDs attached and never substitutes stored anchors", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const original = "# First\n\nTarget paragraph.\n\n# Second\n\nOther paragraph.";
    const annotation = await createRoot(service, ALICE, original);
    const originalAnchor = { ...annotation.anchor };

    expect((await service.listAnnotations("project", "epic", "definition", original))[0].attachmentState).toBe("attached");

    const reordered = "# Second\n\nOther paragraph.\n\n# Renamed\n\nTarget paragraph.";
    const review = (await service.listAnnotations("project", "epic", "definition", reordered))[0];
    expect(review.attachmentState).toBe("needs_review");
    expect(review.detachedReason).toBe("block_missing_exact_text");
    expect(review.anchor).toEqual(originalAnchor);
    expect(JSON.parse(readFileSync(filePath, "utf-8")).annotations[0].anchor).toEqual(originalAnchor);

    const nearbyReplacement = "# First\n\nA nearby but unrelated replacement.\n\n# Second\n\nOther paragraph.";
    const orphan = (await service.listAnnotations("project", "epic", "definition", nearbyReplacement))[0];
    expect(orphan.attachmentState).toBe("orphaned");
    expect(orphan.anchor).toEqual(originalAnchor);
  });

  it("marks duplicate exact text for review and ignores empty or truncated quote evidence", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const original = "# First\n\nTarget paragraph.";
    const annotation = await createRoot(service, ALICE, original);
    const duplicate = "# One\n\nTarget paragraph.\n\n# Two\n\nTarget paragraph.";
    const reviewed = (await service.listAnnotations("project", "epic", "definition", duplicate))[0];
    expect(reviewed).toMatchObject({ attachmentState: "needs_review", detachedReason: "block_missing_ambiguous_text" });

    const stored = JSON.parse(readFileSync(filePath, "utf-8"));
    stored.annotations[0].anchor.blockId = "missing";
    stored.annotations[0].anchor.anchorText = "Target para";
    stored.annotations[0].attachmentState = "needs_review";
    writeJson(filePath, stored);
    expect((await service.listAnnotations("project", "epic", "definition", duplicate))[0].attachmentState).toBe("orphaned");

    stored.annotations[0].anchor.anchorText = "";
    writeJson(filePath, stored);
    expect((await service.listAnnotations("project", "epic", "definition", duplicate))[0].attachmentState).toBe("orphaned");
    expect(annotation.id).toBe(stored.annotations[0].id);
  });

  it("reattaches a root and its replies only through an explicit exact block selection", async () => {
    const { root } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const original = "# First\n\nTarget paragraph.";
    const rootAnnotation = await createRoot(service, ALICE, original);
    const reply = await service.createAnnotation("project", "epic", "definition", BOB, { parentId: rootAnnotation.id, body: "Reply" });
    const changed = "# New\n\nReplacement target.";
    await service.listAnnotations("project", "epic", "definition", changed);
    writeFileSync(path.join(root, "project-dir", "epics", "epic", "definition.md"), changed, "utf-8");
    const target = service.computeBlockIds(changed).find((block) => block.content === "Replacement target.")!;

    const contentHash = createHash("sha256").update(changed).digest("hex").slice(0, 16);
    await expect(service.reattachAnnotation("project", "epic", "definition", reply.id, contentHash, target.blockId))
      .rejects.toMatchObject({ code: "invalid_input" });
    await service.reattachAnnotation("project", "epic", "definition", rootAnnotation.id, contentHash, target.blockId);
    const discussion = await service.listAnnotations("project", "epic", "definition", changed);
    expect(discussion.every((item) => item.attachmentState === "attached")).toBe(true);
    expect(discussion.every((item) => item.anchor.blockId === target.blockId)).toBe(true);
  });

  it("returns conflict without changing annotation bytes when the document changes while reattachment is paused", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const rootAnnotation = await createRoot(service, ALICE);
    await service.createAnnotation("project", "epic", "definition", BOB, {
      parentId: rootAnnotation.id,
      body: "Reply that must not move",
    });
    const firstRevision = "# New\n\nFirst replacement.";
    const definitionPath = path.join(root, "project-dir", "epics", "epic", "definition.md");
    writeFileSync(definitionPath, firstRevision, "utf-8");
    await service.listAnnotations("project", "epic", "definition", firstRevision);
    const target = service.computeBlockIds(firstRevision).find((block) => block.content === "First replacement.")!;
    const expectedHash = createHash("sha256").update(firstRevision).digest("hex").slice(0, 16);
    const before = bytes(filePath);

    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const reattachment = (async () => {
      await paused;
      return service.reattachAnnotation(
        "project",
        "epic",
        "definition",
        rootAnnotation.id,
        expectedHash,
        target.blockId,
      );
    })();
    writeFileSync(definitionPath, "# New\n\nSecond replacement.", "utf-8");
    resume();

    await expect(reattachment).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(bytes(filePath)).toEqual(before);
    expect((await service.listAnnotations("project", "epic", "definition"))
      .every((annotation) => JSON.stringify(annotation.anchor) === JSON.stringify(rootAnnotation.anchor)))
      .toBe(true);
  });
});

describe("epic annotation document-writer coordination", () => {
  it("waits for a definition writer before reconciling attachment state", async () => {
    const { root } = scaffold();
    const persistence = new CodaScopePersistence();
    const epicService = new CodaScopeEpicService(root, persistence);
    const service = new CodaScopeAnnotationService(root, persistence, epicService);
    await createRoot(service, ALICE);
    const projectDir = path.join(root, "project-dir");
    const documentKey = persistence.canonicalKey("epic-storage", path.join(projectDir, "epics"));

    let writerEntered!: () => void;
    let releaseWriter!: () => void;
    const entered = new Promise<void>((resolve) => { writerEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = persistence.withMutation(documentKey, async () => {
      writerEntered();
      await release;
      await epicService.updateDefinition("project", "epic", "# Changed\n\nReplacement paragraph.");
    });
    await entered;

    let settled = false;
    const listing = service.listCurrentDocumentAnnotations("project", "epic", "definition")
      .finally(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    releaseWriter();
    await writer;
    const annotations = await listing;
    expect(annotations?.[0]).toMatchObject({
      attachmentState: "orphaned",
      detachedReason: "block_missing_no_match",
    });
  });

  it("rejects a stale design-doc block after the writer releases without creating a sidecar", async () => {
    const { root } = scaffold();
    const persistence = new CodaScopePersistence();
    const service = new CodaScopeAnnotationService(root, persistence);
    const projectDir = path.join(root, "project-dir");
    const designsDir = path.join(projectDir, "epics", "epic", "designs");
    const original = "# Original\n\nOld target.";
    const designService = new CodaScopeDesignDocService(root, persistence);
    const design = await designService.createDesignDoc("project", "epic", {
      title: "Design",
      content: original,
      createdBy: "alice",
    });
    const documentId = design.id;
    const annotationPath = path.join(projectDir, "epics", "epic", "annotations", `${documentId}-annotations.json`);
    const staleBlock = service.computeBlockIds(original).find((block) => block.content === "Old target.")!;
    const documentKey = persistence.canonicalKey("design-index", designsDir);

    let writerEntered!: () => void;
    let releaseWriter!: () => void;
    const entered = new Promise<void>((resolve) => { writerEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = persistence.withMutation(documentKey, async () => {
      writerEntered();
      await release;
      await designService.updateDesignDoc(
        "project",
        "epic",
        documentId,
        "# Changed\n\nNew target.",
      );
    });
    await entered;

    let settled = false;
    const creation = service.createAnnotationForCurrentDocument(
      "project",
      "epic",
      documentId,
      ALICE,
      { targetBlockId: staleBlock.blockId, body: "Stale comment" },
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ).finally(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    releaseWriter();
    await writer;
    const outcome = await creation;
    expect(outcome).toHaveProperty("error");
    expect((outcome as { error: unknown }).error).toMatchObject({
      code: "invalid_input",
      message: "The selected annotation block no longer exists.",
    });
    expect(existsSync(annotationPath)).toBe(false);
  });

  it("does not treat unindexed design content as an authoritative annotation document", async () => {
    const { root } = scaffold();
    const projectDir = path.join(root, "project-dir");
    const designsDir = path.join(projectDir, "epics", "epic", "designs");
    const documentId = "orphan";
    const content = "# Orphan\n\nUnindexed target.";
    mkdirSync(path.join(designsDir, documentId), { recursive: true });
    writeFileSync(path.join(designsDir, "designs.json"), JSON.stringify({ docs: [] }), "utf-8");
    writeFileSync(path.join(designsDir, documentId, "content.md"), content, "utf-8");
    const service = new CodaScopeAnnotationService(root);
    const block = service.computeBlockIds(content).find((candidate) => candidate.content === "Unindexed target.")!;

    await expect(service.listCurrentDocumentAnnotations("project", "epic", documentId))
      .resolves.toBeNull();
    await expect(service.createAnnotationForCurrentDocument(
      "project",
      "epic",
      documentId,
      ALICE,
      { targetBlockId: block.blockId, body: "Must not be stored" },
    )).resolves.toBeNull();
    expect(existsSync(path.join(
      projectDir,
      "epics",
      "epic",
      "annotations",
      `${documentId}-annotations.json`,
    ))).toBe(false);
  });
});

describe("epic annotation migration and atomic persistence", () => {
  function legacyRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "ann_legacy",
      epicId: "epic",
      documentId: "definition",
      documentVersion: 7,
      anchor: { blockId: "legacy-block", sectionSlug: "heading", anchorText: "Target paragraph.", lineNumber: 3 },
      author: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
      body: "Legacy body",
      status: "open",
      reactions: [{ emoji: "👍", user: "bob" }],
      ...overrides,
    };
  }

  it("migrates valid legacy discussion data and classifies exact anchors", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const content = "# Heading\n\nTarget paragraph.";
    const exact = exactAnchor(service, content, "Target paragraph.");
    writeJson(filePath, { annotations: [
      legacyRecord({ anchor: exact }),
      legacyRecord({
        id: "ann_reply",
        anchor: exact,
        author: "bob",
        body: "Legacy reply",
        parentId: "ann_legacy",
        status: "resolved",
        reactions: [],
      }),
    ] });

    const [annotation, reply] = await service.listAnnotations("project", "epic", "definition", content);
    expect(annotation).toMatchObject({
      id: "ann_legacy",
      author: "alice",
      origin: "user",
      ownership: "owned",
      body: "Legacy body",
      documentVersion: 7,
      status: "open",
      attachmentState: "attached",
      reactions: [{ emoji: "👍", user: "bob" }],
    });
    expect(reply).toMatchObject({
      id: "ann_reply",
      author: "bob",
      body: "Legacy reply",
      parentId: "ann_legacy",
      status: "open",
      attachmentState: "attached",
    });
    expect(JSON.parse(readFileSync(filePath, "utf-8")).version).toBe(2);
  });

  it("preserves a nested legacy graph while normalizing and mutating the complete root thread", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const original = "# Heading\n\nTarget paragraph.";
    const exact = exactAnchor(service, original, "Target paragraph.");
    writeJson(filePath, { annotations: [
      legacyRecord({ anchor: exact, status: "open" }),
      legacyRecord({
        id: "ann_reply",
        anchor: exact,
        author: "bob",
        body: "Reply",
        parentId: "ann_legacy",
        status: "resolved",
        reactions: [],
      }),
      legacyRecord({
        id: "ann_grandchild",
        anchor: exact,
        author: "carol",
        body: "Grandchild",
        parentId: "ann_reply",
        status: "wontfix",
        reactions: [],
      }),
    ] });

    let discussion = await service.listAnnotations("project", "epic", "definition", original);
    expect(discussion.map((annotation) => annotation.id)).toEqual([
      "ann_legacy",
      "ann_reply",
      "ann_grandchild",
    ]);
    expect(discussion.every((annotation) => annotation.status === "open")).toBe(true);
    expect(discussion.every((annotation) => annotation.attachmentState === "attached")).toBe(true);

    await service.updateAnnotation("project", "epic", "ann_legacy", BOB, { status: "resolved" });
    discussion = await service.listAnnotations("project", "epic", "definition");
    expect(discussion.every((annotation) => annotation.status === "resolved")).toBe(true);

    const changed = "# Changed\n\nReplacement.";
    writeFileSync(path.join(root, "project-dir", "epics", "epic", "definition.md"), changed, "utf-8");
    discussion = await service.listAnnotations("project", "epic", "definition", changed);
    expect(discussion.every((annotation) => annotation.attachmentState === "orphaned")).toBe(true);

    const target = service.computeBlockIds(changed).find((block) => block.content === "Replacement.")!;
    const contentHash = createHash("sha256").update(changed).digest("hex").slice(0, 16);
    await service.reattachAnnotation("project", "epic", "definition", "ann_legacy", contentHash, target.blockId);
    discussion = await service.listAnnotations("project", "epic", "definition", changed);
    expect(discussion.every((annotation) => annotation.anchor.blockId === target.blockId)).toBe(true);
    expect(discussion.every((annotation) => annotation.attachmentState === "attached")).toBe(true);

    expect(await service.deleteAnnotation("project", "epic", "ann_legacy", ALICE)).toBe(true);
    discussion = await service.listAnnotations("project", "epic", "definition");
    expect(discussion).toHaveLength(3);
    expect(discussion[0]).toMatchObject({ id: "ann_legacy", body: "", deletedBy: "alice" });
    expect(discussion.slice(1).map((annotation) => annotation.body)).toEqual(["Reply", "Grandchild"]);
  });

  it("classifies ambiguous and missing legacy anchors without moving them", async () => {
    const ambiguous = scaffold();
    const ambiguousService = new CodaScopeAnnotationService(ambiguous.root);
    writeJson(ambiguous.filePath, { annotations: [legacyRecord()] });
    const duplicateContent = "# One\n\nTarget paragraph.\n\n# Two\n\nTarget paragraph.";
    const [review] = await ambiguousService.listAnnotations("project", "epic", "definition", duplicateContent);
    expect(review).toMatchObject({
      attachmentState: "needs_review",
      detachedReason: "block_missing_ambiguous_text",
      anchor: { blockId: "legacy-block" },
    });

    const missing = scaffold();
    const missingService = new CodaScopeAnnotationService(missing.root);
    writeJson(missing.filePath, { annotations: [legacyRecord()] });
    const [orphan] = await missingService.listAnnotations("project", "epic", "definition", "# Heading\n\nDifferent text.");
    expect(orphan).toMatchObject({
      attachmentState: "orphaned",
      detachedReason: "block_missing_no_match",
      anchor: { blockId: "legacy-block" },
    });
  });

  it("keeps legacy literal-agent ownership fail-closed", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    writeJson(filePath, { annotations: [legacyRecord({ author: "agent" })] });
    const [annotation] = await service.listAnnotations("project", "epic", "definition");
    expect(annotation).toMatchObject({ author: "agent", origin: "agent", ownership: "legacy_unowned" });
    const before = bytes(filePath);
    expect(await service.updateAnnotation("project", "epic", annotation.id, { username: "agent", origin: "user" }, { body: "claimed" })).toBeNull();
    expect(await service.deleteAnnotation("project", "epic", annotation.id, { username: "agent", origin: "user" })).toBe(false);
    expect(bytes(filePath)).toEqual(before);
  });

  it("preserves unknown versions and malformed legacy graphs byte-for-byte", async () => {
    for (const value of [
      { version: 99, annotations: [] },
      { annotations: [legacyRecord({ parentId: "missing" })] },
    ]) {
      const { root, filePath } = scaffold();
      writeJson(filePath, value);
      const before = bytes(filePath);
      await expect(new CodaScopeAnnotationService(root).listAnnotations("project", "epic", "definition"))
        .rejects.toMatchObject({ code: "persistence_corrupt" });
      expect(bytes(filePath)).toEqual(before);
    }
  });

  it("leaves legacy and version 2 bytes unchanged when migration or reconciliation writes fail", async () => {
    const legacy = scaffold();
    writeJson(legacy.filePath, { annotations: [legacyRecord()] });
    const legacyBefore = bytes(legacy.filePath);
    await expect(new CodaScopeAnnotationService(legacy.root, new FailOnceAnnotationWritePersistence())
      .listAnnotations("project", "epic", "definition", "# Heading\n\nTarget paragraph."))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(bytes(legacy.filePath)).toEqual(legacyBefore);

    const current = scaffold();
    const normal = new CodaScopeAnnotationService(current.root);
    await createRoot(normal, ALICE);
    const currentBefore = bytes(current.filePath);
    await expect(new CodaScopeAnnotationService(current.root, new FailOnceAnnotationWritePersistence())
      .listAnnotations("project", "epic", "definition", "# Changed\n\nNo matching block."))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(bytes(current.filePath)).toEqual(currentBefore);
  });

  it("serializes concurrent migration and mutation without losing discussion data", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const content = "# Heading\n\nTarget paragraph.";
    const exact = exactAnchor(service, content, "Target paragraph.");
    writeJson(filePath, { annotations: [legacyRecord({ anchor: exact })] });

    await Promise.all([
      service.listAnnotations("project", "epic", "definition", content),
      service.updateAnnotation("project", "epic", "ann_legacy", ALICE, { body: "Concurrent edit" }),
    ]);
    const [annotation] = await service.listAnnotations("project", "epic", "definition", content);
    expect(annotation).toMatchObject({ body: "Concurrent edit", attachmentState: "attached" });
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toMatchObject({ version: 2 });
  });
});

describe("epic-global annotation identity", () => {
  it("rejects cross-document duplicate IDs before any first-file-wins read or mutation", async () => {
    const { root, filePath } = scaffold();
    const service = new CodaScopeAnnotationService(root);
    const annotation = await createRoot(service, ALICE);
    const duplicatePath = path.join(root, "project-dir", "epics", "epic", "annotations", "design-annotations.json");
    const duplicate = JSON.parse(readFileSync(filePath, "utf-8"));
    duplicate.annotations[0].documentId = "design";
    writeJson(duplicatePath, duplicate);
    const definitionBefore = bytes(filePath);
    const designBefore = bytes(duplicatePath);
    const definitionHash = createHash("sha256")
      .update("# Heading\n\nTarget paragraph.")
      .digest("hex")
      .slice(0, 16);

    const operations = [
      () => service.createAnnotation("project", "epic", "definition", ALICE, {
        anchor: annotation.anchor,
        body: "New comment",
      }),
      () => service.updateAnnotation("project", "epic", annotation.id, ALICE, { body: "First file wins" }),
      () => service.updateAnnotation("project", "epic", annotation.id, BOB, { status: "resolved" }),
      () => service.addReaction("project", "epic", annotation.id, ALICE, "👍"),
      () => service.removeReaction("project", "epic", annotation.id, ALICE, "👍"),
      () => service.deleteAnnotation("project", "epic", annotation.id, ALICE),
      () => service.reattachAnnotation(
        "project",
        "epic",
        "definition",
        annotation.id,
        definitionHash,
        annotation.anchor.blockId,
      ),
      () => service.listAnnotations("project", "epic", "definition", "# Heading\n\nTarget paragraph."),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: "persistence_corrupt" });
      expect(bytes(filePath)).toEqual(definitionBefore);
      expect(bytes(duplicatePath)).toEqual(designBefore);
    }
  });
});
