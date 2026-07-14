import { describe, it, expect, afterEach } from "vitest";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import { extractValidatedZipFile, openValidatedZipFile, type ZipArchiveLimits } from "./codaScopeZipArchiveService.js";

const roots: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codascope-zip-test-"));
  roots.push(dir);
  return dir;
}

async function createZip(zipPath: string, append: (archive: ZipArchive) => void): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(zipPath);
  const finished = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  append(archive);
  archive.pipe(output);
  await archive.finalize();
  await finished;
}

const limits: ZipArchiveLimits = {
  maxCompressedBytes: 1024 * 1024,
  maxEntryCount: 10,
  maxEntryUncompressedBytes: 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024,
};

describe("CodaScope ZIP archive service", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("accepts ZIP directory records and extracts files through the staged path", async () => {
    const root = tmpDir();
    const zipPath = path.join(root, "bundle.zip");
    await createZip(zipPath, (archive) => {
      archive.append("portable epic", { name: "epic/definition.md" });
    });

    const destination = path.join(root, "staged");
    await mkdir(destination, { recursive: true });
    await extractValidatedZipFile(zipPath, destination, limits);

    const definitionPath = path.join(destination, "epic", "definition.md");
    expect(existsSync(definitionPath)).toBe(true);
    expect(readFileSync(definitionPath, "utf-8")).toBe("portable epic");
  });

  it("rejects entries that exceed the declared expanded-size limit", async () => {
    const root = tmpDir();
    const zipPath = path.join(root, "too-large.zip");
    await createZip(zipPath, (archive) => {
      archive.append(Buffer.alloc(1024 * 1024 + 1), { name: "epic/large.bin" });
    });

    await expect(openValidatedZipFile(zipPath, limits)).rejects.toThrow("entry exceeds the 1 MB limit");
  });
});
