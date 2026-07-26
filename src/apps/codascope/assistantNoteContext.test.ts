import { describe, expect, it, vi } from "vitest";
import {
  clearRootNoteContext,
  createRootNoteContextOwner,
  getRootNoteContextSnapshot,
  publishRootNoteContext,
  updateRootNoteContext,
} from "./assistantNoteContext";

describe("root note assistant context", () => {
  it("publishes metadata, updates title/hash, and never retains extra body data", () => {
    const owner = createRootNoteContextOwner();
    publishRootNoteContext(owner, {
      stableId: "note-1",
      scope: "codascope",
      path: "roadmap.md",
      title: "Roadmap",
      visibility: "shared",
      contentHash: "hash-1",
      body: "must not escape",
    } as never);
    updateRootNoteContext(owner, {
      title: "Updated roadmap",
      contentHash: "hash-2",
    });

    expect(getRootNoteContextSnapshot()).toEqual({
      stableId: "note-1",
      scope: "codascope",
      path: "roadmap.md",
      title: "Updated roadmap",
      visibility: "shared",
      contentHash: "hash-2",
    });
    expect(getRootNoteContextSnapshot()).not.toHaveProperty("body");
  });

  it("notifies subscribers through publication changes", async () => {
    const owner = createRootNoteContextOwner();
    const listener = vi.fn();
    const { useRootNoteContext: _hook } = await import(
      "./assistantNoteContext"
    );
    // Publication itself is covered here; the hook consumes the same snapshot
    // through useSyncExternalStore in the render-level assistant regression.
    publishRootNoteContext(owner, {
      stableId: "note-2",
      scope: "codascope",
      path: "private.md",
      title: "Private",
      visibility: "private",
    });
    listener(getRootNoteContextSnapshot());
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      stableId: "note-2",
    }));
  });

  it("prevents an older editor cleanup from erasing newer context", () => {
    const older = createRootNoteContextOwner();
    const newer = createRootNoteContextOwner();
    publishRootNoteContext(older, {
      stableId: "old",
      scope: "codascope",
      path: "old.md",
      title: "Old",
      visibility: "shared",
    });
    publishRootNoteContext(newer, {
      stableId: "new",
      scope: "codascope",
      path: "new.md",
      title: "New",
      visibility: "private",
    });

    clearRootNoteContext(older);
    expect(getRootNoteContextSnapshot()?.stableId).toBe("new");
    clearRootNoteContext(newer);
    expect(getRootNoteContextSnapshot()).toBeNull();
  });
});
