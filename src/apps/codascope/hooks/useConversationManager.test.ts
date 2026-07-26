import { describe, expect, it } from "vitest";
import {
  isConversationRequestCurrent,
  resolveConversationRestorePlan,
} from "./useConversationManager";
import type { ConversationSummary } from "../codaScopeTypes";

function summary(
  id: string,
  updatedAt: string,
): ConversationSummary {
  return {
    id,
    title: id,
    summary: "",
    modelId: null,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
  };
}

const older = summary("older", "2026-07-25T10:00:00.000Z");
const newer = summary("newer", "2026-07-26T10:00:00.000Z");

describe("conversation restoration", () => {
  it("prefers a valid URL conversation in the current scope", () => {
    expect(resolveConversationRestorePlan(
      [newer, older],
      "older",
      "newer",
    )).toEqual({
      conversationId: "older",
      clearUrlConversation: false,
    });
  });

  it("clears an invalid or cross-scope URL conversation and uses scoped local state", () => {
    expect(resolveConversationRestorePlan(
      [newer, older],
      "workspace-conversation-not-in-project-list",
      "older",
    )).toEqual({
      conversationId: "older",
      clearUrlConversation: true,
    });
  });

  it("falls back to the current scope's most recent conversation", () => {
    expect(resolveConversationRestorePlan(
      [older, newer],
      null,
      "missing",
    )).toEqual({
      conversationId: "newer",
      clearUrlConversation: false,
    });
  });

  it("clears an invalid URL when the current scope has no conversations", () => {
    expect(resolveConversationRestorePlan([], "other-scope", null)).toEqual({
      conversationId: null,
      clearUrlConversation: true,
    });
  });
});

describe("conversation scope epochs", () => {
  it("discards stale list and read responses after scope transitions", () => {
    const workspaceRequest = { scopeKey: "workspace", version: 3 };
    expect(isConversationRequestCurrent(
      workspaceRequest,
      { scopeKey: "workspace", version: 3 },
    )).toBe(true);
    expect(isConversationRequestCurrent(
      workspaceRequest,
      { scopeKey: "project:alpha", version: 4 },
    )).toBe(false);
    expect(isConversationRequestCurrent(
      workspaceRequest,
      { scopeKey: "workspace", version: 4 },
    )).toBe(false);
  });
});
