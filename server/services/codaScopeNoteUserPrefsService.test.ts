import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `note-prefs-test-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("CodaScopeNoteUserPrefsService", () => {
  let root: string;
  let svc: CodaScopeNoteUserPrefsService;

  beforeEach(() => {
    root = tmpDir();
    svc = new CodaScopeNoteUserPrefsService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("stores read tracking beneath the configured root", () => {
    svc.markRead("alan", "550e8400-e29b-41d4-a716-446655440000");

    expect(existsSync(path.join(root, "_notes", "_read-tracking", "550e8400-e29b-41d4-a716-446655440000.json"))).toBe(true);
    expect(svc.getReadStatus("alan", ["550e8400-e29b-41d4-a716-446655440000"])).toEqual({
      "550e8400-e29b-41d4-a716-446655440000": expect.any(String),
    });
  });

  it("rejects traversal in user and note IDs", () => {
    expect(() => svc.getStarred("../other-user")).toThrow("Invalid user ID");
    expect(() => svc.markRead("alan", "../../outside")).toThrow("Invalid note ID");
    expect(existsSync(path.join(root, "outside.json"))).toBe(false);
  });
});
