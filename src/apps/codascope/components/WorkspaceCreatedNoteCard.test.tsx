import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CodaScopeAction } from "../codaScopeTypes";
import type {
  CanonicalWorkspaceNoteState,
} from "../workspaceMutationActionValidation";
import {
  buildWorkspaceNoteSubRoute,
  claimLiveTurnNavigation,
  distinctWorkspaceCreatedNoteActions,
  navigateSingleLiveCreatedNote,
  selectSingleCreatedNoteStableId,
} from "../workspaceCreatedNote";
import type { WorkspaceNoteApi } from "../workspaceNoteApi";
import {
  PRIVATE_TO_SHARED_WARNING,
  SHARED_TO_PRIVATE_WARNING,
  WorkspaceCreatedNoteCardController,
  isWorkspaceNoteRequestCurrent,
  validateWorkspaceDisplayTitle,
  visibilityConfirmationMessage,
} from "../workspaceCreatedNoteCardController";
import {
  WorkspaceCreatedNoteCard,
} from "./WorkspaceCreatedNoteCard";

const { appNavigate } = vi.hoisted(() => ({ appNavigate: vi.fn() }));

vi.mock("../../../shell/useAppSubRoute", () => ({
  useAppSubRoute: () => ({ navigate: appNavigate }),
}));

const hash = "a".repeat(64);
const createdAction: CodaScopeAction = {
  type: "note_created",
  attributes: {
    stableId: "note-1",
    scope: "codascope",
    visibility: "private",
    path: "historical/Old name.md",
    title: "Historical title",
    contentHash: hash,
  },
  description: "Created a CodaScope note.",
};

describe("workspace created-note action selection", () => {
  it("selects exactly one distinct validated creation", () => {
    expect(selectSingleCreatedNoteStableId([createdAction])).toBe("note-1");
    expect(distinctWorkspaceCreatedNoteActions([
      createdAction,
      createdAction,
    ])).toHaveLength(1);
  });

  it("does not select zero, multiple, or malformed creations", () => {
    expect(selectSingleCreatedNoteStableId([])).toBeNull();
    expect(selectSingleCreatedNoteStableId([
      createdAction,
      {
        ...createdAction,
        attributes: { ...createdAction.attributes, stableId: "note-2" },
      },
    ])).toBeNull();
    expect(selectSingleCreatedNoteStableId([{
      ...createdAction,
      attributes: { ...createdAction.attributes, path: "../escape.md" },
    }])).toBeNull();
  });

  it("claims a live turn once without scanning historical messages", () => {
    const claimed = new Set<number>();
    expect(claimLiveTurnNavigation(claimed, 7)).toBe(true);
    expect(claimLiveTurnNavigation(claimed, 7)).toBe(false);
    expect(claimLiveTurnNavigation(claimed, 8)).toBe(true);
  });
});

describe("workspace created-note navigation and race helpers", () => {
  it("builds a nested URL sub-route by encoding individual path segments", () => {
    expect(buildWorkspaceNoteSubRoute({
      stableId: "note-1",
      scope: "codascope",
      visibility: "shared",
      path: "Plans & Specs/API #1.md",
      title: "API",
      contentHash: hash,
    })).toBe("notes/shared/Plans%20%26%20Specs/API%20%231");
  });

  it("removes only the final .md suffix", () => {
    expect(buildWorkspaceNoteSubRoute({
      stableId: "note-1",
      scope: "codascope",
      visibility: "private",
      path: "draft.md/Release.md",
      title: "Release",
      contentHash: hash,
    })).toBe("notes/private/draft.md/Release");
  });

  it("suppresses stale and aborted responses", () => {
    const current = new AbortController();
    expect(isWorkspaceNoteRequestCurrent(3, 3, current.signal)).toBe(true);
    expect(isWorkspaceNoteRequestCurrent(2, 3, current.signal)).toBe(false);
    current.abort();
    expect(isWorkspaceNoteRequestCurrent(3, 3, current.signal)).toBe(false);
  });

  it("freshly resolves and navigates one confirmed live creation", async () => {
    const navigate = vi.fn();
    const api = noteApiWithRead(vi.fn().mockResolvedValue({
      status: "success",
      note: {
        stableId: "note-1",
        scope: "codascope",
        visibility: "shared",
        path: "Current location.md",
        title: "Current title",
        contentHash: "b".repeat(64),
      },
    }));

    await expect(navigateSingleLiveCreatedNote(
      [createdAction],
      api,
      () => true,
      navigate,
    )).resolves.toBe(true);
    expect(api.read).toHaveBeenCalledWith("note-1");
    expect(navigate).toHaveBeenCalledWith(
      "notes/shared/Current%20location",
    );
  });

  it("navigates exactly one authoritative live creation once per turn", async () => {
    const claimed = new Set<number>();
    const navigate = vi.fn();
    const api = noteApiWithRead(vi.fn().mockResolvedValue(
      success(note({ path: "Live/Created.md" })),
    ));

    if (claimLiveTurnNavigation(claimed, 42)) {
      await navigateSingleLiveCreatedNote(
        [createdAction],
        api,
        () => true,
        navigate,
      );
    }
    if (claimLiveTurnNavigation(claimed, 42)) {
      await navigateSingleLiveCreatedNote(
        [createdAction],
        api,
        () => true,
        navigate,
      );
    }

    expect(api.read).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("notes/private/Live/Created");
  });

  it("does not navigate for multiple, unavailable, or stale live results", async () => {
    const navigate = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({ status: "absence" })
      .mockResolvedValueOnce({
        status: "success",
        note: {
          stableId: "note-1",
          scope: "codascope",
          visibility: "private",
          path: "one.md",
          title: "One",
          contentHash: hash,
        },
      });
    const api = noteApiWithRead(read);
    const second = {
      ...createdAction,
      attributes: { ...createdAction.attributes, stableId: "note-2" },
    };

    await expect(navigateSingleLiveCreatedNote(
      [createdAction, second],
      api,
      () => true,
      navigate,
    )).resolves.toBe(false);
    await expect(navigateSingleLiveCreatedNote(
      [createdAction],
      api,
      () => true,
      navigate,
    )).resolves.toBe(false);
    const current = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await expect(navigateSingleLiveCreatedNote(
      [createdAction],
      api,
      current,
      navigate,
    )).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("workspace created-note title and receipt rendering", () => {
  it("uses the shared 300-character single-line title contract", () => {
    expect(validateWorkspaceDisplayTitle("")).toBe("Enter a display title.");
    expect(validateWorkspaceDisplayTitle("x".repeat(301))).toContain("300");
    expect(validateWorkspaceDisplayTitle("One\nTwo")).toContain("one line");
    expect(validateWorkspaceDisplayTitle(" Valid ")).toBeNull();
  });

  it("renders the dedicated completed card but not stale receipt attributes", () => {
    appNavigate.mockClear();
    const html = renderToStaticMarkup(createElement(
      WorkspaceCreatedNoteCard,
      { action: createdAction },
    ));
    expect(html).toContain("Note created");
    expect(html).toContain("CodaScope Notes");
    expect(html).toContain("Completed");
    expect(html).toContain("Loading current note details");
    expect(html).not.toContain("Historical title");
    expect(html).not.toContain("historical/Old name.md");
    expect(appNavigate).not.toHaveBeenCalled();
  });

  it("fails closed for a malformed receipt", () => {
    const html = renderToStaticMarkup(createElement(
      WorkspaceCreatedNoteCard,
      {
        action: {
          ...createdAction,
          attributes: {
            ...createdAction.attributes,
            visibility: "project",
          },
        },
      },
    ));
    expect(html).toBe("");
  });
});

describe("workspace created-note controller rehydration", () => {
  it("loads canonical state by stable ID without operational receipt fields", async () => {
    const canonical = note({
      visibility: "shared",
      path: "Current/Canonical.md",
      title: "Canonical title",
    });
    const api = noteApiWithRead(vi.fn().mockResolvedValue({
      status: "success",
      note: canonical,
    }));
    const controller = new WorkspaceCreatedNoteCardController(
      createdAction.attributes.stableId,
      api,
      vi.fn(),
    );

    await controller.load();

    expect(api.read).toHaveBeenCalledWith("note-1", {
      signal: expect.any(AbortSignal),
    });
    expect(controller.getState()).toMatchObject({
      phase: "ready",
      note: canonical,
      titleDraft: "Canonical title",
    });
    expect(controller.getState().note).not.toMatchObject({
      path: createdAction.attributes.path,
      title: createdAction.attributes.title,
      visibility: createdAction.attributes.visibility,
    });
  });

  it("distinguishes absence and retries a recoverable failure", async () => {
    const absent = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(vi.fn().mockResolvedValue({ status: "absence" })),
      vi.fn(),
    );
    await absent.load();
    expect(absent.getState()).toMatchObject({
      phase: "unavailable",
      note: null,
    });

    const read = vi.fn()
      .mockResolvedValueOnce({
        status: "failure",
        message: "unsafe /server/path",
      })
      .mockResolvedValueOnce({ status: "success", note: note() });
    const retry = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(read),
      vi.fn(),
    );
    await retry.load();
    expect(retry.getState().phase).toBe("error");
    expect(retry.getState().statusText).not.toContain("/server/path");
    await retry.retry();
    expect(retry.getState()).toMatchObject({
      phase: "ready",
      note: note(),
    });
  });

  it("suppresses stale, aborted, disposed, and identity-obsolete reads", async () => {
    const first = deferred<ReturnType<typeof success>>();
    const second = deferred<ReturnType<typeof success>>();
    const read = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(read),
      vi.fn(),
    );
    const published = vi.fn();
    controller.subscribe(published);

    const staleLoad = controller.load();
    const currentLoad = controller.retry();
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    second.resolve(success(note({ title: "Current" })));
    await currentLoad;
    first.resolve(success(note({ title: "Stale" })));
    await staleLoad;
    expect(controller.getState().note?.title).toBe("Current");

    const disposedRead = deferred<ReturnType<typeof success>>();
    read.mockReturnValueOnce(disposedRead.promise);
    const obsoleteLoad = controller.load();
    const publicationCount = published.mock.calls.length;
    controller.dispose();
    expect(read.mock.calls[2][1].signal.aborted).toBe(true);
    disposedRead.resolve(success(note({ title: "Obsolete identity" })));
    await obsoleteLoad;
    expect(published).toHaveBeenCalledTimes(publicationCount);
    expect(controller.getState().note?.title).toBe("Current");
  });
});

describe("workspace created-note controller title editing", () => {
  it("sends normalized title and current hash, then applies the returned DTO", async () => {
    const original = note({
      path: "Immutable/File name.md",
      title: "Original",
      contentHash: "a".repeat(64),
    });
    const returned = note({
      path: "Server/Canonical location.md",
      title: "Renamed",
      contentHash: "b".repeat(64),
    });
    const api = noteApiWithRead(
      vi.fn().mockResolvedValue(success(original)),
    );
    vi.mocked(api.updateTitle).mockResolvedValue(success(returned));
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();

    controller.beginTitleEdit();
    controller.setTitleDraft("  Renamed  ");
    await controller.saveTitle();

    expect(api.updateTitle).toHaveBeenCalledWith(
      "note-1",
      "Renamed",
      "a".repeat(64),
      { signal: expect.any(AbortSignal) },
    );
    expect(controller.getState()).toMatchObject({
      note: returned,
      editing: false,
      statusText: "Display title saved.",
    });
    expect(controller.getState().note?.path).toBe(
      "Server/Canonical location.md",
    );
  });

  it.each([
    ["blank", "   "],
    ["multiline", "One\nTwo"],
    ["oversized", "x".repeat(301)],
    ["invalid", "Null\u0000title"],
  ])("does not request an update for a %s title", async (_label, draft) => {
    const api = noteApiWithRead(
      vi.fn().mockResolvedValue(success(note())),
    );
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();
    controller.beginTitleEdit();
    controller.setTitleDraft(draft);

    await controller.saveTitle();

    expect(api.updateTitle).not.toHaveBeenCalled();
    expect(controller.getState().titleError).toBeTruthy();
  });

  it("re-reads exactly once on conflict without repeating the mutation", async () => {
    const latest = note({
      path: "Other/Current.md",
      title: "Changed elsewhere",
      contentHash: "c".repeat(64),
    });
    const read = vi.fn()
      .mockResolvedValueOnce(success(note()))
      .mockResolvedValueOnce(success(latest));
    const api = noteApiWithRead(read);
    vi.mocked(api.updateTitle).mockResolvedValue({
      status: "conflict",
      currentHash: latest.contentHash,
    });
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();
    controller.beginTitleEdit();
    controller.setTitleDraft("Attempted title");

    await controller.saveTitle();

    expect(api.updateTitle).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      note: latest,
      pending: null,
      editing: false,
      statusText: expect.stringContaining("Review the latest"),
    });
  });

  it("keeps an ordinary failure recoverable and path-free", async () => {
    const original = note({ path: "Private/Secret.md" });
    const api = noteApiWithRead(
      vi.fn().mockResolvedValue(success(original)),
    );
    vi.mocked(api.updateTitle).mockResolvedValue({
      status: "failure",
      message: "Failed at /private/notes/Private/Secret.md",
    });
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();
    controller.beginTitleEdit();
    controller.setTitleDraft("Retry me");
    await controller.saveTitle();

    expect(controller.getState()).toMatchObject({
      phase: "ready",
      note: original,
      editing: true,
      pending: null,
    });
    expect(controller.getState().statusText).not.toContain("Private/Secret");
  });
});

describe("workspace created-note controller visibility", () => {
  it("confirms Private to Shared, sends the current hash, and applies the DTO", async () => {
    const original = note({
      visibility: "private",
      contentHash: "a".repeat(64),
    });
    const returned = note({
      visibility: "shared",
      path: "Moved/By server.md",
      title: "Shared canonical",
      contentHash: "b".repeat(64),
    });
    const api = noteApiWithRead(
      vi.fn().mockResolvedValue(success(original)),
    );
    vi.mocked(api.updateVisibility).mockResolvedValue(success(returned));
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();

    controller.selectVisibility("shared");
    expect(controller.getState().confirmation).toBe("shared");
    expect(visibilityConfirmationMessage("shared")).toBe(
      PRIVATE_TO_SHARED_WARNING,
    );
    expect(api.updateVisibility).not.toHaveBeenCalled();
    controller.cancelVisibility();
    expect(controller.getState().confirmation).toBeNull();
    expect(api.updateVisibility).not.toHaveBeenCalled();

    controller.selectVisibility("shared");
    await controller.confirmVisibility();
    expect(api.updateVisibility).toHaveBeenCalledWith(
      "note-1",
      "shared",
      "a".repeat(64),
      { signal: expect.any(AbortSignal) },
    );
    expect(controller.getState().note).toEqual(returned);
    expect(controller.getState().confirmation).toBeNull();
  });

  it("warns Shared to Private, cancels, and clears an obsolete choice", async () => {
    const api = noteApiWithRead(vi.fn().mockResolvedValue(
      success(note({ visibility: "shared" })),
    ));
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();
    controller.selectVisibility("private");
    expect(visibilityConfirmationMessage("private")).toBe(
      SHARED_TO_PRIVATE_WARNING,
    );
    controller.cancelVisibility();
    expect(api.updateVisibility).not.toHaveBeenCalled();

    controller.selectVisibility("private");
    expect(controller.getState().confirmation).toBe("private");
    controller.selectVisibility("shared");
    expect(controller.getState().confirmation).toBeNull();
    expect(api.updateVisibility).not.toHaveBeenCalled();
  });

  it("re-reads on conflict and never repeats the visibility transfer", async () => {
    const latest = note({
      visibility: "shared",
      contentHash: "c".repeat(64),
    });
    const read = vi.fn()
      .mockResolvedValueOnce(success(note()))
      .mockResolvedValueOnce(success(latest));
    const api = noteApiWithRead(read);
    vi.mocked(api.updateVisibility).mockResolvedValue({
      status: "conflict",
      currentHash: latest.contentHash,
    });
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      api,
      vi.fn(),
    );
    await controller.load();
    controller.selectVisibility("shared");
    await controller.confirmVisibility();

    expect(api.updateVisibility).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      note: latest,
      confirmation: null,
      statusText: expect.stringContaining("Review the latest"),
    });
  });
});

describe("workspace created-note controller Open", () => {
  it("freshly reads and navigates the returned encoded canonical route", async () => {
    const loaded = note({
      visibility: "private",
      path: "Historical/Old.md",
    });
    const current = note({
      visibility: "shared",
      path: "Plans & Specs/draft.md/Release #1.md",
      contentHash: "b".repeat(64),
    });
    const read = vi.fn()
      .mockResolvedValueOnce(success(loaded))
      .mockResolvedValueOnce(success(current));
    const navigate = vi.fn();
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(read),
      navigate,
    );
    await controller.load();

    await controller.open();

    expect(read).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(
      "notes/shared/Plans%20%26%20Specs/draft.md/Release%20%231",
    );
    expect(controller.getState().note).toEqual(current);
  });

  it.each([
    { status: "absence" } as const,
    { status: "failure", message: "unsafe /note/path" } as const,
  ])("does not navigate when the fresh read is $status", async (result) => {
    const read = vi.fn()
      .mockResolvedValueOnce(success(note()))
      .mockResolvedValueOnce(result);
    const navigate = vi.fn();
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(read),
      navigate,
    );
    await controller.load();
    await controller.open();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not navigate after component or scope invalidation", async () => {
    const fresh = deferred<ReturnType<typeof success>>();
    const read = vi.fn()
      .mockResolvedValueOnce(success(note()))
      .mockReturnValueOnce(fresh.promise);
    const navigate = vi.fn();
    const controller = new WorkspaceCreatedNoteCardController(
      "note-1",
      noteApiWithRead(read),
      navigate,
    );
    await controller.load();
    const opening = controller.open();
    controller.dispose();
    fresh.resolve(success(note({
      visibility: "shared",
      path: "Obsolete.md",
    })));
    await opening;
    expect(navigate).not.toHaveBeenCalled();
  });
});

function noteApiWithRead(
  read: ReturnType<typeof vi.fn>,
): WorkspaceNoteApi {
  return {
    read,
    updateTitle: vi.fn(),
    updateVisibility: vi.fn(),
  } as unknown as WorkspaceNoteApi;
}

function note(
  overrides: Partial<CanonicalWorkspaceNoteState> = {},
): CanonicalWorkspaceNoteState {
  return { ...baseNote(), ...overrides };
}

function baseNote(): CanonicalWorkspaceNoteState {
  return {
    stableId: "note-1",
    scope: "codascope",
    visibility: "private",
    path: "Canonical/Note.md",
    title: "Canonical note",
    contentHash: hash,
  };
}

function success(value: CanonicalWorkspaceNoteState) {
  return { status: "success" as const, note: value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
