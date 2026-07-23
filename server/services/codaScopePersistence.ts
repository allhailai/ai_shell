/* ── CodaScope: Shared Persistence Contract ───────────────────────────
   Strict JSON reads, crash-safe atomic replacement, and keyed in-process
   serialization for CodaScope's authoritative filesystem state.

   The coordinator is intentionally process-local. Direct external writers
   and multiple AIShell server processes remain unsupported.
   ──────────────────────────────────────────────────────────────────── */

import { AsyncLocalStorage } from "node:async_hooks";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type PersistenceContext = Readonly<Record<string, string>>;

export class CodaScopePersistenceCorruptError extends Error {
  readonly status = 500;
  readonly code = "persistence_corrupt";
  readonly context: PersistenceContext;

  constructor(context: PersistenceContext = {}) {
    super("Persisted CodaScope data is corrupt. Repair or restore it and retry.");
    this.name = "CodaScopePersistenceCorruptError";
    this.context = context;
  }
}

export class CodaScopePersistenceError extends Error {
  readonly status = 500;
  readonly code = "persistence_failed";
  readonly context: PersistenceContext;

  constructor(context: PersistenceContext = {}) {
    super("CodaScope could not persist the requested change. Retry after checking storage health.");
    this.name = "CodaScopePersistenceError";
    this.context = context;
  }
}

export type CodaScopePersistenceDomainError =
  | CodaScopePersistenceCorruptError
  | CodaScopePersistenceError;

export function isPersistenceDomainError(error: unknown): error is CodaScopePersistenceDomainError {
  return error instanceof CodaScopePersistenceCorruptError
    || error instanceof CodaScopePersistenceError;
}

interface AtomicFileHandle {
  writeFile(data: string | Uint8Array, options?: { encoding?: BufferEncoding }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface CodaScopePersistenceFileSystem {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
  open(filePath: string, flags: string, mode?: number): Promise<AtomicFileHandle>;
  rename(source: string, target: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  copyFile(source: string, target: string, mode: number): Promise<void>;
}

const nodeFileSystem: CodaScopePersistenceFileSystem = {
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  mkdir: (directory, options) => fs.mkdir(directory, options),
  open: (filePath, flags, mode) => fs.open(filePath, flags, mode),
  rename: (source, target) => fs.rename(source, target),
  unlink: (filePath) => fs.unlink(filePath),
  link: (existingPath, newPath) => fs.link(existingPath, newPath),
  copyFile: (source, target, mode) => fs.copyFile(source, target, mode),
};

export interface StrictJsonReadOptions<T> {
  context: PersistenceContext;
  missing?: () => T;
  validate: (value: unknown) => T;
}

export class CodaScopePersistence {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly heldKeys = new AsyncLocalStorage<ReadonlySet<string>>();

  constructor(private readonly fileSystem: CodaScopePersistenceFileSystem = nodeFileSystem) {}

  canonicalKey(kind: string, storageRoot: string): string {
    return `${kind}:${path.resolve(storageRoot)}`;
  }

  async withMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const held = this.heldKeys.getStore();
    if (held?.has(key)) return operation();

    const previous = this.queues.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(() => {
      const nextHeld = new Set(held ?? []);
      nextHeld.add(key);
      return this.heldKeys.run(nextHeld, operation);
    });
    this.queues.set(key, queued);

    try {
      return await queued;
    } finally {
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }

  async readJson<T>(filePath: string, options: StrictJsonReadOptions<T>): Promise<T> {
    let raw: string;
    try {
      raw = await this.fileSystem.readFile(filePath, "utf-8");
    } catch (error) {
      if (errorCode(error) === "ENOENT" && options.missing) return options.missing();
      if (errorCode(error) === "ENOENT") throw new CodaScopePersistenceCorruptError(options.context);
      throw new CodaScopePersistenceError(options.context);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CodaScopePersistenceCorruptError(options.context);
    }

    try {
      return options.validate(parsed);
    } catch (error) {
      if (isPersistenceDomainError(error)) throw error;
      throw new CodaScopePersistenceCorruptError(options.context);
    }
  }

  async writeJson(filePath: string, value: unknown, context: PersistenceContext): Promise<void> {
    await this.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, context);
  }

  /**
   * Replace one file without exposing a partial target. A temporary hard-link
   * (or exclusive copy fallback) preserves the previous inode until the new
   * target and its parent-directory entry have both been flushed. This lets an
   * injected post-rename failure roll back to the exact previous bytes.
   */
  async writeFile(
    filePath: string,
    data: string | Uint8Array,
    context: PersistenceContext,
  ): Promise<void> {
    const directory = path.dirname(filePath);
    const suffix = `${process.pid}.${randomUUID()}`;
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.tmp.${suffix}`);
    const backupPath = path.join(directory, `.${path.basename(filePath)}.bak.${suffix}`);
    let handle: AtomicFileHandle | null = null;
    let backupCreated = false;
    let published = false;

    try {
      await this.fileSystem.mkdir(directory, { recursive: true });
      handle = await this.fileSystem.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(data, typeof data === "string" ? { encoding: "utf-8" } : undefined);
      await handle.sync();
      await handle.close();
      handle = null;

      try {
        await this.fileSystem.link(filePath, backupPath);
        backupCreated = true;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          await this.fileSystem.copyFile(filePath, backupPath, fsConstants.COPYFILE_EXCL);
          backupCreated = true;
        }
      }

      await this.fileSystem.rename(temporaryPath, filePath);
      published = true;
      await this.flushDirectory(directory);

      if (backupCreated) {
        await this.fileSystem.unlink(backupPath);
        backupCreated = false;
      }
    } catch {
      if (handle) {
        try { await handle.close(); } catch { /* cleanup continues */ }
      }

      let rollbackFailed = false;
      if (published) {
        try {
          if (backupCreated) {
            await this.fileSystem.rename(backupPath, filePath);
            backupCreated = false;
          } else {
            await this.fileSystem.unlink(filePath);
          }
          await this.flushDirectory(directory);
        } catch {
          rollbackFailed = true;
        }
      }

      await this.cleanupFile(temporaryPath);
      if (backupCreated) await this.cleanupFile(backupPath);
      throw new CodaScopePersistenceError({
        ...context,
        ...(rollbackFailed ? { recovery: "operator_required" } : {}),
      });
    }
  }

  private async flushDirectory(directory: string): Promise<void> {
    let handle: AtomicFileHandle | null = null;
    try {
      handle = await this.fileSystem.open(directory, "r");
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedDirectoryFlush(error)) throw error;
    } finally {
      if (handle) await handle.close();
    }
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        // Cleanup is best-effort here; the typed failure already prevents a
        // caller from treating the write as committed.
      }
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isUnsupportedDirectoryFlush(error: unknown): boolean {
  return new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EBADF"]).has(errorCode(error) ?? "");
}

export const codaScopePersistence = new CodaScopePersistence();
