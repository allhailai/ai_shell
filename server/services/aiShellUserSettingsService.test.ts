import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  AiShellUserSettingsService,
  UserSettingsError,
  createPortableKeybindingExport,
  validateKeybindingProfile,
} from "./aiShellUserSettingsService.js";

const roots: string[] = [];
function root(): string {
  const value = path.join(os.tmpdir(), `aishell-user-settings-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(value, { recursive: true });
  roots.push(value);
  return value;
}

const profile = { schemaVersion: 1 as const, bindings: { "markdown.addCursorAbove": { mode: "custom" as const, shortcuts: [{ strokes: ["Mod-Alt-ArrowUp"] }] } } };

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("AiShellUserSettingsService", () => {
  it("isolates users and rejects stale revisions", async () => {
    const service = new AiShellUserSettingsService(root());
    const first = await service.get("alice");
    const saved = await service.save("alice", profile, first.revision);
    const bob = await service.get("bob");
    expect(bob.profile.bindings).toEqual({});
    await expect(service.save("alice", profile, first.revision)).rejects.toMatchObject({ code: "revision_conflict", status: 409 });
    expect((await service.get("alice")).revision).toBe(saved.revision);
  });

  it("recovers defaults from malformed on-disk data without destroying it", async () => {
    const dataDir = root();
    const directory = path.join(dataDir, "user-settings");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "alice.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(file, "{ broken", "utf8"));
    const service = new AiShellUserSettingsService(dataDir);
    const result = await service.get("alice");
    expect(result.profile.bindings).toEqual({});
    expect(result.recoverableError).toBeTruthy();
    await service.save("alice", profile, result.revision);
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(directory).some((entry) => entry.startsWith("alice.json.malformed."))).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("markdown.addCursorAbove");
    expect(existsSync(directory) && readFileSync(file, "utf8")).toBeTruthy();
  });

  it("leaves an existing profile intact when the atomic temporary write fails", async () => {
    const dataDir = root();
    const stable = new AiShellUserSettingsService(dataDir);
    const current = await stable.get("alice");
    await stable.save("alice", profile, current.revision);
    const revision = (await stable.get("alice")).revision;
    const failWrite = (async () => { throw new Error("disk full"); }) as typeof import("node:fs/promises").writeFile;
    const failing = new AiShellUserSettingsService(dataDir, { writeFile: failWrite });
    await expect(failing.save("alice", { schemaVersion: 1, bindings: { "markdown.exitMultipleSelections": { mode: "disabled" } } }, revision)).rejects.toThrow("disk full");
    expect((await stable.get("alice")).profile).toEqual(profile);
  });

  it("validates portable-safe data and retains valid unknown commands for round trips", () => {
    const withUnknown = validateKeybindingProfile({ schemaVersion: 1, bindings: { "future.editor.command": { mode: "disabled" } } });
    const exported = createPortableKeybindingExport(withUnknown, "2026-07-13T00:00:00.000Z");
    expect(JSON.stringify(exported)).not.toMatch(/alice|\/Users|AISHELL_DATA_DIR/);
    expect(exported.bindings["future.editor.command"]).toEqual({ mode: "disabled" });
    expect(() => validateKeybindingProfile({ schemaVersion: 1, bindings: { invalid: { mode: "disabled" } } })).toThrow(UserSettingsError);
    expect(() => validateKeybindingProfile({ schemaVersion: 1, bindings: { "markdown.addCursorAbove": { mode: "custom", shortcuts: [{ strokes: ["Alt-Mod-d"] }] } } })).toThrow(UserSettingsError);
  });

  it("previews merge without writing invalid or unavailable entries away", async () => {
    const service = new AiShellUserSettingsService(root());
    const current = await service.get("alice");
    await service.save("alice", profile, current.revision);
    const preview = await service.previewImport("alice", {
      format: "aishell.keybindings", version: 1, exportedAt: "2026-07-13T00:00:00.000Z",
      bindings: {
        "markdown.exitMultipleSelections": { mode: "disabled" },
        "future.editor.command": { mode: "disabled" },
      },
    }, "merge");
    expect(preview.added).toContain("markdown.exitMultipleSelections");
    expect(preview.unavailable).toEqual(["future.editor.command"]);
    expect((await service.get("alice")).profile).toEqual(profile);
  });
});
