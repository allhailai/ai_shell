import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceNoteApi,
  parseWorkspaceNoteConflict,
} from "./workspaceNoteApi";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const canonicalNote = {
  stableId: "note-1",
  scope: "codascope",
  visibility: "private",
  path: "plans/Release notes.md",
  title: "Release notes",
  contentHash: hashA,
} as const;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("workspace note API response validation", () => {
  it("accepts the exact canonical stable-note DTO", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(canonicalNote),
    );
    const api = createWorkspaceNoteApi(fetchMock);

    await expect(api.read("note-1")).resolves.toEqual({
      status: "success",
      note: canonicalNote,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/codascope/workspace/notes/note-1",
      { method: "GET", signal: undefined },
    );
  });

  it.each([
    ["missing field", (() => {
      const { title: _title, ...rest } = canonicalNote;
      return rest;
    })()],
    ["extra field", { ...canonicalNote, ownerId: "mallory" }],
    ["wrong scope", { ...canonicalNote, scope: "project" }],
    ["wrong visibility", { ...canonicalNote, visibility: "public" }],
    ["absolute path", { ...canonicalNote, path: "/plans/note.md" }],
    ["traversal path", { ...canonicalNote, path: "plans/../note.md" }],
    ["reserved path", { ...canonicalNote, path: "_archive/note.md" }],
    ["non-Markdown path", { ...canonicalNote, path: "plans/note.txt" }],
    ["blank title", { ...canonicalNote, title: " " }],
    ["multiline title", { ...canonicalNote, title: "One\nTwo" }],
    ["oversized title", { ...canonicalNote, title: "x".repeat(301) }],
    ["malformed hash", { ...canonicalNote, contentHash: "not-a-hash" }],
  ])("rejects a DTO with %s", async (_label, value) => {
    const api = createWorkspaceNoteApi(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(value)),
    );
    await expect(api.read("note-1")).resolves.toEqual({
      status: "failure",
      message: "CodaScope returned an invalid note response.",
    });
  });

  it("rejects a response whose stable identity differs from the request", async () => {
    const api = createWorkspaceNoteApi(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        ...canonicalNote,
        stableId: "note-2",
      })),
    );
    await expect(api.read("note-1")).resolves.toMatchObject({
      status: "failure",
    });
  });

  it("rejects unsafe requested stable IDs before URL generation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = createWorkspaceNoteApi(fetchMock);
    await expect(api.read("../other-note")).resolves.toMatchObject({
      status: "failure",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes sanitized absence without consuming an error body", async () => {
    const api = createWorkspaceNoteApi(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(
        "operator filesystem details",
        { status: 404 },
      )),
    );
    await expect(api.read("note-1")).resolves.toEqual({ status: "absence" });
  });

  it("parses only the exact canonical conflict response", () => {
    expect(parseWorkspaceNoteConflict({
      error: "conflict",
      message: "Note was modified since you loaded it.",
      currentHash: hashB,
    })).toEqual({ status: "conflict", currentHash: hashB });
    expect(parseWorkspaceNoteConflict({
      error: "conflict",
      message: "Note was modified since you loaded it.",
      currentHash: "bad",
    })).toMatchObject({ status: "failure" });
    expect(parseWorkspaceNoteConflict({
      error: "conflict",
      message: "Note was modified since you loaded it.",
      currentHash: hashB,
      path: "/private/server/path",
    })).toMatchObject({ status: "failure" });
  });

  it("returns ordinary failures without exposing raw server details", async () => {
    const api = createWorkspaceNoteApi(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(
        "/secret/operator/path",
        { status: 500 },
      )),
    );
    await expect(api.read("note-1")).resolves.toEqual({
      status: "failure",
      message: "The note could not be loaded. Please try again.",
    });
  });
});

describe("workspace note API mutations", () => {
  it("sends title plus expected hash and accepts exact canonical readback", async () => {
    const responseNote = {
      ...canonicalNote,
      title: "Renamed",
      contentHash: hashB,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(responseNote),
    );
    const api = createWorkspaceNoteApi(fetchMock);

    await expect(
      api.updateTitle("note-1", "Renamed", hashA),
    ).resolves.toEqual({ status: "success", note: responseNote });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/codascope/workspace/notes/note-1/title",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed", expectedHash: hashA }),
      }),
    );
    expect(responseNote.path).toBe(canonicalNote.path);
  });

  it("sends only visibility plus expected hash and uses returned moved state", async () => {
    const responseNote = {
      ...canonicalNote,
      visibility: "shared" as const,
      path: "moved/Release notes.md",
      contentHash: hashB,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(responseNote),
    );
    const api = createWorkspaceNoteApi(fetchMock);

    await expect(
      api.updateVisibility("note-1", "shared", hashA),
    ).resolves.toEqual({ status: "success", note: responseNote });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      visibility: "shared",
      expectedHash: hashA,
    });
  });

  it("returns a canonical conflict without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        error: "conflict",
        message: "Note was modified since you loaded it.",
        currentHash: hashB,
      }, 409),
    );
    const api = createWorkspaceNoteApi(fetchMock);

    await expect(
      api.updateTitle("note-1", "Renamed", hashA),
    ).resolves.toEqual({ status: "conflict", currentHash: hashB });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed mutation inputs before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = createWorkspaceNoteApi(fetchMock);

    await expect(api.updateTitle("note-1", "One\nTwo", hashA))
      .resolves.toMatchObject({ status: "failure" });
    await expect(api.updateTitle("note-1", "Valid", "bad"))
      .resolves.toMatchObject({ status: "failure" });
    await expect(api.updateVisibility(
      "note-1",
      "public" as "private",
      hashA,
    )).resolves.toMatchObject({ status: "failure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
