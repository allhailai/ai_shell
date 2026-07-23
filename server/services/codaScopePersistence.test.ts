import { afterEach, describe, expect, it } from "vitest";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  type CodaScopePersistenceFileSystem,
} from "./codaScopePersistence.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codascope-persistence-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface Faults {
  write?: boolean;
  fileSync?: boolean;
  close?: boolean;
  rename?: boolean;
  directorySync?: boolean;
  directorySyncCount?: number;
}

function injectedFileSystem(faults: Faults): CodaScopePersistenceFileSystem {
  const once = (name: keyof Pick<Faults, "write" | "fileSync" | "close" | "rename" | "directorySync">): boolean => {
    if (!faults[name]) return false;
    faults[name] = false;
    return true;
  };
  return {
    readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
    mkdir: (directory, options) => fs.mkdir(directory, options),
    open: async (filePath, flags, mode) => {
      const handle = await fs.open(filePath, flags, mode);
      const isDirectory = flags === "r" && (await handle.stat()).isDirectory();
      return {
        writeFile: async (data, options) => {
          if (!isDirectory && once("write")) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
          await handle.writeFile(data, options);
        },
        sync: async () => {
          if (isDirectory) {
            faults.directorySyncCount = (faults.directorySyncCount ?? 0) + 1;
            if (once("directorySync")) throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" });
          } else if (once("fileSync")) {
            throw Object.assign(new Error("injected file sync failure"), { code: "EIO" });
          }
          await handle.sync();
        },
        close: async () => {
          if (!isDirectory && once("close")) throw Object.assign(new Error("injected close failure"), { code: "EIO" });
          await handle.close();
        },
      };
    },
    rename: async (source, target) => {
      if (source.includes(".tmp.") && once("rename")) {
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      }
      await fs.rename(source, target);
    },
    unlink: (filePath) => fs.unlink(filePath),
    link: (existingPath, newPath) => fs.link(existingPath, newPath),
    copyFile: (source, target, mode) => fs.copyFile(source, target, mode ?? fsConstants.COPYFILE_EXCL),
  };
}

async function expectNoArtifacts(directory: string): Promise<void> {
  const entries = await fs.readdir(directory);
  expect(entries.filter((entry) => entry.includes(".tmp.") || entry.includes(".bak."))).toEqual([]);
}

describe("CodaScopePersistence", () => {
  it("writes a new JSON file and atomically replaces it", async () => {
    const root = await tempRoot();
    const target = path.join(root, "state.json");
    const persistence = new CodaScopePersistence();
    await persistence.writeJson(target, { value: 1 }, { storage: "test" });
    expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({ value: 1 });
    await persistence.writeJson(target, { value: 2 }, { storage: "test" });
    expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({ value: 2 });
    await expectNoArtifacts(root);
  });

  it("distinguishes a missing-file default from malformed and invalid JSON", async () => {
    const root = await tempRoot();
    const target = path.join(root, "state.json");
    const persistence = new CodaScopePersistence();
    const options = {
      context: { storage: "test" },
      missing: () => ({ values: [] as string[] }),
      validate: (value: unknown) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { values?: unknown }).values)) {
          throw new Error("invalid");
        }
        return value as { values: string[] };
      },
    };
    await expect(persistence.readJson(target, options)).resolves.toEqual({ values: [] });
    await fs.writeFile(target, "{bad-json", "utf-8");
    await expect(persistence.readJson(target, options)).rejects.toBeInstanceOf(CodaScopePersistenceCorruptError);
    await fs.writeFile(target, JSON.stringify({ values: "wrong" }), "utf-8");
    await expect(persistence.readJson(target, options)).rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it.each([
    ["write", { write: true }],
    ["file flush", { fileSync: true }],
    ["close", { close: true }],
    ["rename", { rename: true }],
    ["parent-directory flush", { directorySync: true }],
  ])("preserves previous bytes and cleans artifacts after an injected %s failure", async (_name, fault) => {
    const root = await tempRoot();
    const target = path.join(root, "state.json");
    const previous = "{\"preserve\":true}\n";
    await fs.writeFile(target, previous, "utf-8");
    const persistence = new CodaScopePersistence(injectedFileSystem(fault));
    await expect(persistence.writeJson(target, { preserve: false }, { storage: "test" }))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(await fs.readFile(target, "utf-8")).toBe(previous);
    await expectNoArtifacts(root);
  });

  it("flushes the parent directory when the platform supports it", async () => {
    const root = await tempRoot();
    const faults: Faults = {};
    const persistence = new CodaScopePersistence(injectedFileSystem(faults));
    await persistence.writeJson(path.join(root, "state.json"), { ok: true }, { storage: "test" });
    expect(faults.directorySyncCount).toBeGreaterThan(0);
  });

  it("removes an unpublished first-write target after a post-rename failure", async () => {
    const root = await tempRoot();
    const target = path.join(root, "state.json");
    const persistence = new CodaScopePersistence(injectedFileSystem({ directorySync: true }));
    await expect(persistence.writeJson(target, { value: 1 }, { storage: "test" }))
      .rejects.toMatchObject({ code: "persistence_failed" });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expectNoArtifacts(root);
  });

  it("continues a key queue after a failed mutation", async () => {
    const persistence = new CodaScopePersistence();
    const events: string[] = [];
    await expect(persistence.withMutation("same", async () => {
      events.push("failed");
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await persistence.withMutation("same", async () => { events.push("continued"); });
    expect(events).toEqual(["failed", "continued"]);
  });

  it("does not block independent keys", async () => {
    const persistence = new CodaScopePersistence();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = persistence.withMutation("first", async () => gate);
    let secondFinished = false;
    await persistence.withMutation("second", async () => { secondFinished = true; });
    expect(secondFinished).toBe(true);
    release();
    await first;
  });

  it("allows same-key nested service operations without deadlock", async () => {
    const persistence = new CodaScopePersistence();
    const result = await persistence.withMutation("nested", async () => (
      persistence.withMutation("nested", async () => "done")
    ));
    expect(result).toBe("done");
  });
});
