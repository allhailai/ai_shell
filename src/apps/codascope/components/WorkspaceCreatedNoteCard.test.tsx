import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CodaScopeAction } from "../codaScopeTypes";
import {
  buildWorkspaceNoteSubRoute,
  claimLiveTurnNavigation,
  distinctWorkspaceCreatedNoteActions,
  navigateSingleLiveCreatedNote,
  selectSingleCreatedNoteStableId,
} from "../workspaceCreatedNote";
import type { WorkspaceNoteApi } from "../workspaceNoteApi";
import {
  isWorkspaceNoteRequestCurrent,
  validateWorkspaceDisplayTitle,
  WorkspaceCreatedNoteCard,
} from "./WorkspaceCreatedNoteCard";

vi.mock("../../../shell/useAppSubRoute", () => ({
  useAppSubRoute: () => ({ navigate: vi.fn() }),
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

function noteApiWithRead(
  read: ReturnType<typeof vi.fn>,
): WorkspaceNoteApi {
  return {
    read,
    updateTitle: vi.fn(),
    updateVisibility: vi.fn(),
  } as unknown as WorkspaceNoteApi;
}
