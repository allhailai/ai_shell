import { describe, expect, it } from "vitest";
import {
  canDispatchCommand,
  COMMANDS,
  getFilteredCommands,
  type CommandContext,
} from "./commandRegistry";

const workspaceContext: CommandContext = {
  assistantScope: "workspace",
  currentView: "notes",
  hasProject: false,
  isEpicView: false,
  epicId: null,
  hasWiki: false,
  hasCodeMap: false,
};

const projectContext: CommandContext = {
  assistantScope: "project",
  currentView: "dashboard",
  hasProject: true,
  isEpicView: false,
  epicId: null,
  hasWiki: true,
  hasCodeMap: true,
};

describe("assistant command capabilities", () => {
  it("declares explicit scope and capability metadata on every command", () => {
    for (const command of COMMANDS) {
      expect(command.assistantScopes.length).toBeGreaterThan(0);
      expect(command.capability).toBeTruthy();
    }
  });

  it("shows only explicitly workspace-safe help commands in workspace scope", () => {
    const { relevant, other } = getFilteredCommands("", workspaceContext);
    const commands = [...relevant, ...other];
    expect(commands.map((command) => command.id).sort())
      .toEqual(["commands", "help", "shortcuts"]);
    expect(commands.every((command) =>
      command.capability === "help"
      || command.capability === "read-only-chat")).toBe(true);
  });

  it("retains project commands in project scope", () => {
    const { relevant, other } = getFilteredCommands("", projectContext);
    const ids = [...relevant, ...other].map((command) => command.id);
    expect(ids).toContain("build-wiki");
    expect(ids).toContain("goto-dashboard");
    expect(ids).toContain("help");
  });

  it("defensively rejects a crafted project command in workspace scope", () => {
    const command = COMMANDS.find((candidate) =>
      candidate.id === "build-wiki");
    expect(command).toBeDefined();
    expect(canDispatchCommand(command!, workspaceContext)).toBe(false);
  });
});
