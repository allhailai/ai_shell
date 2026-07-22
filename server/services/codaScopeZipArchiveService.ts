/* ── CodaScope: Safe ZIP Archive Service ───────────────────────────────
   Validates and stages portable CodaScope ZIP archives without retaining the
   upload or expanded archive in process memory.
   ──────────────────────────────────────────────────────────────────── */

import { createWriteStream } from "node:fs";
import { mkdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as unzipper from "unzipper";
import { assertStrictDescendant } from "./codaScopePathSafety.js";

export interface ZipArchiveLimits {
  maxCompressedBytes: number;
  maxEntryCount: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
}

export interface ValidatedZipArchive {
  entries: Map<string, unzipper.File>;
  compressedBytes: number;
  totalUncompressedBytes: number;
}

export const PROJECT_ARCHIVE_LIMITS: ZipArchiveLimits = {
  maxCompressedBytes: 200 * 1024 * 1024,
  maxEntryCount: 10_000,
  maxEntryUncompressedBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
};

export const NOTE_ARCHIVE_LIMITS: ZipArchiveLimits = {
  maxCompressedBytes: 200 * 1024 * 1024,
  maxEntryCount: 5_000,
  maxEntryUncompressedBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
};

/** Read and validate a disk-backed ZIP archive's table of contents. */
export async function openValidatedZipFile(
  zipPath: string,
  limits: ZipArchiveLimits,
): Promise<ValidatedZipArchive> {
  const fileInfo = await stat(zipPath);
  if (!fileInfo.isFile()) throw new Error("Uploaded archive is not a file.");
  if (fileInfo.size > limits.maxCompressedBytes) {
    throw new Error(`ZIP file exceeds the ${formatMiB(limits.maxCompressedBytes)} MB compressed-size limit.`);
  }
  const directory = await unzipper.Open.file(zipPath);
  return validateDirectory(directory.files, fileInfo.size, limits);
}

/** Buffer support remains useful for focused service tests; HTTP imports use files. */
export async function openValidatedZipBuffer(
  zipBuffer: Buffer,
  limits: ZipArchiveLimits,
): Promise<ValidatedZipArchive> {
  if (zipBuffer.length > limits.maxCompressedBytes) {
    throw new Error(`ZIP file exceeds the ${formatMiB(limits.maxCompressedBytes)} MB compressed-size limit.`);
  }
  const directory = await unzipper.Open.buffer(zipBuffer);
  return validateDirectory(directory.files, zipBuffer.length, limits);
}

/** Read one validated ZIP entry with a runtime expanded-size guard. */
export async function readZipEntry(file: unzipper.File, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of file.stream()) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error(`ZIP entry exceeds the permitted expanded-content limit: "${file.path}"`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Extract a validated archive into a newly-created staging directory. The
 * destination is never partially trusted: every entry is path-checked and
 * byte-limited while streaming to disk.
 */
export async function extractValidatedZipFile(
  zipPath: string,
  destination: string,
  limits: ZipArchiveLimits,
): Promise<ValidatedZipArchive> {
  const archive = await openValidatedZipFile(zipPath, limits);
  await assertAvailableSpace(destination, archive.totalUncompressedBytes);
  await mkdir(destination, { recursive: true, mode: 0o700 });

  const root = path.resolve(destination);
  let extractedBytes = 0;
  for (const [entryPath, file] of archive.entries) {
    const outputPath = resolveArchivePath(root, entryPath);
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });

    let entryBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        entryBytes += size;
        extractedBytes += size;
        if (entryBytes > limits.maxEntryUncompressedBytes) {
          callback(new Error(`ZIP entry exceeds the permitted expanded-content limit: "${entryPath}"`));
          return;
        }
        if (extractedBytes > limits.maxTotalUncompressedBytes) {
          callback(new Error(`ZIP expanded content exceeds the ${formatMiB(limits.maxTotalUncompressedBytes)} MB limit.`));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(file.stream(), limiter, createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  }

  return archive;
}

/** Verify that the staging or destination filesystem has room for the archive. */
export async function assertAvailableSpace(destination: string, requiredBytes: number): Promise<void> {
  try {
    const fs = await statfs(path.dirname(path.resolve(destination)));
    const available = BigInt(fs.bavail) * BigInt(fs.bsize);
    const required = BigInt(Math.max(0, Math.ceil(requiredBytes)));
    if (available < required) {
      throw new Error("Insufficient disk space to safely import this archive.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Insufficient disk space")) throw error;
    // Some platforms/filesystems do not expose statfs. Streaming byte limits
    // still prevent archive expansion beyond the configured safety cap.
  }
}

function validateDirectory(
  files: unzipper.File[],
  compressedBytes: number,
  limits: ZipArchiveLimits,
): ValidatedZipArchive {
  const entries = new Map<string, unzipper.File>();
  let entryCount = 0;
  let totalUncompressedBytes = 0;

  for (const file of files) {
    entryCount++;
    if (entryCount > limits.maxEntryCount) {
      throw new Error(`ZIP contains more than ${limits.maxEntryCount} entries.`);
    }

    if (file.type === "Directory") continue;

    const entryPath = normalizeArchivePath(file.path);
    if (file.type !== "File") {
      throw new Error(`Unsupported ZIP entry type: "${file.path}"`);
    }
    if (entries.has(entryPath)) {
      throw new Error(`ZIP contains duplicate entry paths: "${entryPath}"`);
    }

    const declaredSize = Number(file.uncompressedSize);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      throw new Error(`ZIP entry has an invalid size: "${entryPath}"`);
    }
    if (declaredSize > limits.maxEntryUncompressedBytes) {
      throw new Error(`ZIP entry exceeds the ${formatMiB(limits.maxEntryUncompressedBytes)} MB limit: "${entryPath}"`);
    }
    if (totalUncompressedBytes + declaredSize > limits.maxTotalUncompressedBytes) {
      throw new Error(`ZIP expanded content exceeds the ${formatMiB(limits.maxTotalUncompressedBytes)} MB limit.`);
    }

    totalUncompressedBytes += declaredSize;
    entries.set(entryPath, file);
  }

  return { entries, compressedBytes, totalUncompressedBytes };
}

function normalizeArchivePath(entryPath: string): string {
  if (!entryPath || entryPath.includes("\\") || entryPath.startsWith("/")) {
    throw new Error(`Unsafe ZIP entry path: "${entryPath}"`);
  }
  const segments = entryPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe ZIP entry path: "${entryPath}"`);
  }
  const normalized = path.posix.normalize(entryPath);
  if (normalized !== entryPath || normalized.startsWith("../")) {
    throw new Error(`Unsafe ZIP entry path: "${entryPath}"`);
  }
  return normalized;
}

function resolveArchivePath(root: string, entryPath: string): string {
  const candidate = path.resolve(root, ...entryPath.split("/"));
  return assertStrictDescendant(root, candidate, "ZIP entry path");
}

function formatMiB(bytes: number): string {
  return String(Math.round(bytes / 1024 / 1024));
}
