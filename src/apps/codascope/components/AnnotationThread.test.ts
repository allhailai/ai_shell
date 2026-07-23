import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectAnnotationDescendants } from "../codaScopeTypes";
import type { Annotation } from "../codaScopeTypes";
import {
  AnnotationThread,
  annotationDisplayBody,
  annotationNeedsReview,
  annotationProvenance,
  canDeleteAnnotation,
} from "./AnnotationThread";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann",
    epicId: "epic",
    documentId: "doc",
    documentVersion: 0,
    anchor: { blockId: "block", sectionSlug: "root", anchorText: "Target", lineNumber: 1 },
    author: "alice",
    origin: "user",
    ownership: "owned",
    createdAt: "2026-01-01T00:00:00.000Z",
    body: "Comment",
    status: "open",
    reactions: [],
    attachmentState: "attached",
    ...overrides,
  };
}

describe("epic annotation presentation policy", () => {
  it("shows delete only to the owned annotation author", () => {
    expect(canDeleteAnnotation(annotation(), "alice")).toBe(true);
    expect(canDeleteAnnotation(annotation(), "bob")).toBe(false);
    expect(canDeleteAnnotation(annotation({ ownership: "legacy_unowned", author: "agent", origin: "agent" }), "agent")).toBe(false);
    expect(canDeleteAnnotation(annotation({ deletedAt: "2026-01-02T00:00:00.000Z", deletedBy: "alice" }), "alice")).toBe(false);
  });

  it("uses explicit provenance, detached state, and tombstone presentation", () => {
    expect(annotationProvenance(annotation({ author: "alice", origin: "agent" }))).toBe("agent");
    expect(annotationProvenance(annotation({ author: "service-account", origin: "user" }))).toBe("user");
    expect(annotationNeedsReview(annotation({ attachmentState: "needs_review" }))).toBe(true);
    expect(annotationNeedsReview(annotation({ attachmentState: "orphaned" }))).toBe(true);
    expect(annotationNeedsReview(annotation())).toBe(false);
    expect(annotationDisplayBody(annotation({ body: "secret", deletedAt: "2026-01-02T00:00:00.000Z", deletedBy: "alice" })))
      .toBe("Comment deleted");
  });

  it("renders every nested descendant in attached and detached recovery threads", () => {
    const root = annotation({ id: "root", body: "Root comment" });
    const reply = annotation({
      id: "reply",
      parentId: "root",
      body: "Reply comment",
      createdAt: "2026-01-01T00:01:00.000Z",
    });
    const grandchild = annotation({
      id: "grandchild",
      parentId: "reply",
      body: "Grandchild comment",
      createdAt: "2026-01-01T00:02:00.000Z",
    });
    expect(collectAnnotationDescendants([grandchild, root, reply], root.id).map((item) => item.id))
      .toEqual(["reply", "grandchild"]);
    const attached = renderToStaticMarkup(createElement(AnnotationThread, {
      annotation: root,
      replies: [reply, grandchild],
      projectId: "project",
      epicId: "epic",
      currentUsername: "alice",
      onUpdate: () => undefined,
    }));
    expect(attached).toContain("Reply comment");
    expect(attached).toContain("Grandchild comment");

    const detachedRoot = annotation({
      ...root,
      attachmentState: "orphaned",
      detachedReason: "block_missing_no_match",
      detachedAt: "2026-01-02T00:00:00.000Z",
    });
    const detached = renderToStaticMarkup(createElement(AnnotationThread, {
      annotation: detachedRoot,
      replies: [
        { ...reply, attachmentState: "orphaned", detachedReason: "block_missing_no_match", detachedAt: detachedRoot.detachedAt },
        { ...grandchild, attachmentState: "orphaned", detachedReason: "block_missing_no_match", detachedAt: detachedRoot.detachedAt },
      ],
      projectId: "project",
      epicId: "epic",
      currentUsername: "alice",
      reattachBlocks: [{ blockId: "current", sectionSlug: "root", lineStart: 1, lineEnd: 1, content: "Current" }],
      contentHash: "hash",
      onUpdate: () => undefined,
    }));
    expect(detached).toContain("Orphaned");
    expect(detached).toContain("Reattach");
    expect(detached).toContain("Grandchild comment");
  });
});
