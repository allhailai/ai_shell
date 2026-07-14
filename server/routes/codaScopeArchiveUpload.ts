/* ── CodaScope: Archive Upload Middleware ──────────────────────────────
   Disk-backed upload handling for portable CodaScope archives.

   Archive imports can be substantially larger than images or other ordinary
   form uploads. Keep them out of process memory and let the ZIP validation
   layer account for their expanded size before any project data is changed.
   ──────────────────────────────────────────────────────────────────── */

import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import multer from "multer";

/** Maximum accepted compressed archive size. Expanded content is capped separately. */
export const ARCHIVE_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

const UPLOAD_DIRECTORY = path.join(os.tmpdir(), "codascope-archive-uploads");

function ensureUploadDirectory(): string {
  mkdirSync(UPLOAD_DIRECTORY, { recursive: true, mode: 0o700 });
  return UPLOAD_DIRECTORY;
}

/**
 * Archive uploads intentionally use disk storage. Callers must remove the
 * uploaded file in a finally block after it has been validated and consumed.
 */
export const archiveUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, ensureUploadDirectory()),
    filename: (_req, _file, callback) => callback(null, `archive-${randomUUID()}.zip`),
  }),
  limits: { fileSize: ARCHIVE_UPLOAD_MAX_BYTES },
});

export async function removeUploadedArchive(file: Pick<Express.Multer.File, "path"> | undefined): Promise<void> {
  if (!file?.path) return;
  try {
    await rm(file.path, { force: true });
  } catch {
    // Best-effort cleanup of a temporary upload must not mask the real result.
  }
}
