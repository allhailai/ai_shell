import { describe, expect, it, vi } from "vitest";
import {
  buildCanonicalNoteRangeTarget,
  createSerializedTaskQueue,
  NOTE_RANGE_REMOVED_STATUS_MESSAGE,
  NOTE_RANGE_STAGED_STATUS_MESSAGE,
  saveAndPrepareNoteRangeTarget,
  statusAfterClearedNoteRangeHandoff,
  type CapturedNoteRangeState,
  type NoteSaveResult,
} from "./noteRangeEditorPreparation";

const selectedText = "  🧭 do this  ";
const content = `Intro\n${selectedText}\nDone`;
const selectionStart = content.indexOf(selectedText);
const selectionEnd = selectionStart + selectedText.length;
const savedHash = "b".repeat(64);

function captured(
  scope: "codascope" | "project" | "epic" = "codascope",
): CapturedNoteRangeState {
  const projectScope = scope !== "codascope";
  return {
    identity: `${scope}-identity`,
    revision: 7,
    stableId: `${scope}-note`,
    scope,
    visibility: scope === "epic" ? "shared" : "private",
    path: `notes/${scope}.md`,
    assistantScope: projectScope
      ? { kind: "project", projectId: "alpha" }
      : { kind: "workspace" },
    ...(projectScope ? { projectId: "alpha" } : {}),
    ...(scope === "epic" ? { epicId: "epic-1" } : {}),
    snapshot: {
      content,
      title: `${scope} title`,
      tags: ["one", "two"],
      status: "draft",
    },
    selection: {
      from: selectionStart,
      to: selectionEnd,
      text: selectedText,
      startLine: 2,
      endLine: 2,
    },
  };
}

function currentFor(state: CapturedNoteRangeState) {
  return {
    identity: state.identity,
    revision: state.revision,
    stableId: state.stableId,
    snapshot: {
      ...state.snapshot,
      tags: [...state.snapshot.tags],
    },
  };
}

describe("note range target preparation", () => {
  it("replaces only a stale staged announcement when its handoff is cleared", () => {
    expect(statusAfterClearedNoteRangeHandoff({
      kind: "status",
      message: NOTE_RANGE_STAGED_STATUS_MESSAGE,
    })).toEqual({
      kind: "status",
      message: NOTE_RANGE_REMOVED_STATUS_MESSAGE,
    });

    const invalidated = {
      kind: "status" as const,
      message: "The selected range was cleared because the note changed.",
    };
    expect(statusAfterClearedNoteRangeHandoff(invalidated))
      .toBe(invalidated);
    expect(statusAfterClearedNoteRangeHandoff(null)).toBeNull();
  });

  it.each([
    ["codascope", "workspace", undefined],
    ["project", "project", undefined],
    ["epic", "project", "epic-1"],
  ] as const)(
    "constructs an exact %s target for the %s assistant",
    (scope, _assistant, expectedEpicId) => {
      const target = buildCanonicalNoteRangeTarget(captured(scope), savedHash);

      expect(target).toMatchObject({
        kind: "note-range",
        scope,
        stableId: `${scope}-note`,
        path: `notes/${scope}.md`,
        selectionStart,
        selectionEnd,
        selectedText,
        startLine: 2,
        endLine: 2,
        expectedHash: savedHash,
        ...(scope === "codascope" ? {} : { projectId: "alpha" }),
        ...(expectedEpicId ? { epicId: expectedEpicId } : {}),
      });
      if (!target) throw new Error("Expected a canonical target.");
      expect(target?.selectedText).toBe("  🧭 do this  ");
      expect(target.selectionEnd - target.selectionStart)
        .toBe(selectedText.length);
    },
  );

  it("rejects missing identity authority, bad hashes, wrong custody, and inexact text", () => {
    const base = captured();
    expect(buildCanonicalNoteRangeTarget(
      { ...base, stableId: "" },
      savedHash,
    )).toBeNull();
    expect(buildCanonicalNoteRangeTarget(base, "not-a-hash")).toBeNull();
    expect(buildCanonicalNoteRangeTarget({
      ...base,
      assistantScope: { kind: "project", projectId: "alpha" },
    }, savedHash)).toBeNull();
    expect(buildCanonicalNoteRangeTarget({
      ...base,
      selection: { ...base.selection, text: selectedText.trim() },
    }, savedHash)).toBeNull();

    const epic = captured("epic");
    expect(buildCanonicalNoteRangeTarget({
      ...epic,
      visibility: "private",
    }, savedHash)).toBeNull();
  });

  it("waits for the exact snapshot to save before returning a staged target", async () => {
    const state = captured("project");
    const events: string[] = [];
    const result = await saveAndPrepareNoteRangeTarget({
      captured: state,
      save: async (snapshot): Promise<NoteSaveResult> => {
        events.push(`save:${snapshot.content}`);
        return { ok: true, hash: savedHash, snapshot };
      },
      readCurrent: () => {
        events.push("verify");
        return currentFor(state);
      },
    });

    expect(events).toEqual([`save:${content}`, "verify"]);
    expect(result).toMatchObject({
      ok: true,
      target: { expectedHash: savedHash, selectedText },
    });
  });

  it.each([
    ["conflict", { ok: false, reason: "conflict" } as const, "conflict"],
    ["save failure", { ok: false, reason: "error" } as const, "save"],
  ])("aborts on %s without reading a current state", async (
    _label,
    saveResult,
    expectedReason,
  ) => {
    const state = captured();
    const readCurrent = vi.fn(() => currentFor(state));
    const result = await saveAndPrepareNoteRangeTarget({
      captured: state,
      save: vi.fn(async () => saveResult),
      readCurrent,
    });

    expect(result).toEqual({ ok: false, reason: expectedReason });
    expect(readCurrent).not.toHaveBeenCalled();
  });

  it("aborts when body, metadata, identity, revision, or stable ID changes", async () => {
    const state = captured();
    const variants = [
      { ...currentFor(state), identity: "other-note" },
      { ...currentFor(state), revision: 8 },
      { ...currentFor(state), stableId: "other-id" },
      {
        ...currentFor(state),
        snapshot: { ...state.snapshot, content: `${content}!` },
      },
      {
        ...currentFor(state),
        snapshot: { ...state.snapshot, tags: ["changed"] },
      },
    ];

    for (const current of variants) {
      const result = await saveAndPrepareNoteRangeTarget({
        captured: state,
        save: async (snapshot) => ({ ok: true, hash: savedHash, snapshot }),
        readCurrent: () => current,
      });
      expect(result).toEqual({ ok: false, reason: "changed" });
    }
  });
});

describe("serialized note save queue", () => {
  it("does not start a later save while an earlier save is in flight", async () => {
    const queue = createSerializedTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return "first";
    });
    const second = queue.enqueue(async () => {
      events.push("second:start");
      return "second";
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    await queue.drain();
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("continues after a failed task without overlapping later work", async () => {
    const queue = createSerializedTaskQueue();
    const failed = queue.enqueue(async () => {
      throw new Error("save failed");
    });
    const next = queue.enqueue(async () => "saved");

    await expect(failed).rejects.toThrow("save failed");
    await expect(next).resolves.toBe("saved");
  });
});
