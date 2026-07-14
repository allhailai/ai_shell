import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { CodaScopeNoteTagSuggestionService } from "./codaScopeNoteTagSuggestionService.js";

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `note-tag-test-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("CodaScopeNoteTagSuggestionService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("hides a tag from shared suggestions without touching source tags and supports restore", () => {
    const root = tmpDir();
    roots.push(root);
    const svc = new CodaScopeNoteTagSuggestionService(root);
    const tags = [{ tag: "decision", count: 3 }, { tag: "research", count: 1 }];

    expect(svc.hide("Decision")).toBe(true);
    expect(svc.filter(tags)).toEqual([{ tag: "research", count: 1 }]);
    expect(svc.restore("decision")).toBe(true);
    expect(svc.filter(tags)).toEqual(tags);
  });
});
