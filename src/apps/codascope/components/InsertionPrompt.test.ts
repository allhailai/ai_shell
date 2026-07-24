import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InsertionDirective } from "../codaScopeTypes";
import {
  activateInsertionPromptHeaderControl,
  cleanupGeneratedInsertionDirective,
  deleteInsertionDirective,
  InsertionPrompt,
} from "./InsertionPrompt";

function directive(
  status: InsertionDirective["status"],
  overrides: Partial<InsertionDirective> = {},
): InsertionDirective {
  return {
    id: "dir",
    epicId: "epic",
    documentId: "doc",
    type: "insert",
    afterLine: 1,
    instruction: "Insert generated content",
    author: "alice",
    createdAt: "2026-07-23T00:00:00.000Z",
    status,
    ...overrides,
  };
}

function render(existingDirective: InsertionDirective): string {
  return renderToStaticMarkup(createElement(InsertionPrompt, {
    projectId: "project",
    epicId: "epic",
    documentId: "doc",
    afterLine: 1,
    existingDirective,
    onUpdate: () => undefined,
    onClose: () => undefined,
  }));
}

describe("InsertionPrompt directive lifecycle controls", () => {
  it("renders Close and Undo without deletion for an applied directive", () => {
    const markup = render(directive("applied", {
      generatedContent: "Generated",
      preApplySnapshot: "Original",
      appliedContentHash: "0".repeat(64),
      appliedAt: "2026-07-23T00:01:00.000Z",
    }));

    expect(markup).toContain('title="Close"');
    expect(markup).toContain("Undo");
    expect(markup).not.toContain("Delete directive");
  });

  it.each(["pending", "rejected"] as const)(
    "retains deletion for a %s directive",
    (status) => {
      expect(render(directive(status))).toContain('title="Delete directive"');
    },
  );

  it("closes an applied header without issuing a delete request", async () => {
    const onClose = vi.fn();
    const fetchRequest = vi.fn();
    const onDelete = vi.fn(async () => {
      await fetchRequest("/directive", { method: "DELETE" });
    });

    await activateInsertionPromptHeaderControl(
      directive("applied", { generatedContent: "Generated" }),
      onClose,
      onDelete,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("does not close or update after a failed delete response", async () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const fetchRequest = vi.fn(async () => new Response(
      JSON.stringify({ code: "conflict" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));

    await expect(deleteInsertionDirective(
      "/api/codascope/directives/dir",
      onUpdate,
      onClose,
      fetchRequest,
    )).resolves.toBe(false);
    expect(fetchRequest).toHaveBeenCalledWith(
      "/api/codascope/directives/dir",
      { method: "DELETE" },
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the prompt open when automatic cleanup receives a conflict", async () => {
    const setGenerating = vi.fn();
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const fetchRequest = vi.fn(async () => new Response(
      JSON.stringify({ code: "conflict" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));

    await expect(cleanupGeneratedInsertionDirective(
      "/api/codascope/directives/dir",
      setGenerating,
      onUpdate,
      onClose,
      fetchRequest,
    )).resolves.toBe(false);
    expect(setGenerating).toHaveBeenCalledWith(false);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the prompt open when automatic cleanup cannot reach the server", async () => {
    const setGenerating = vi.fn();
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const fetchRequest = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    await expect(cleanupGeneratedInsertionDirective(
      "/api/codascope/directives/dir",
      setGenerating,
      onUpdate,
      onClose,
      fetchRequest,
    )).resolves.toBe(false);
    expect(setGenerating).toHaveBeenCalledWith(false);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
