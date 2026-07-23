/* ── CodaScope: Version Service ──────────────────────────────────────
   Epic version snapshot management.
   Creates copy-on-version snapshots and provides line-by-line diffing.

   Responsibilities:
   - Create version snapshot (copies definition, scope, designs)
   - List versions
   - Read version snapshot content
   - Diff two versions (line-by-line markdown diff)
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EpicVersion } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  assertPositiveSafeInteger,
  assertSafePathSegment,
  assertStrictDescendant,
  assertVersionIndex,
} from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
  isPersistenceDomainError,
} from "./codaScopePersistence.js";
import {
  epicStorageMutationKey,
  readActiveEpicsIndex,
  readEpicMetadata,
} from "./codaScopeEpicStorage.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";

export interface CodaScopeVersionSnapshotFileSystem {
  mkdir(directory: string, options: { recursive?: boolean }): Promise<unknown>;
  writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void>;
  cp(source: string, target: string, options: { recursive: true; errorOnExist: true }): Promise<void>;
  rename(source: string, target: string): Promise<void>;
  rm(target: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
}

const versionSnapshotFileSystem: CodaScopeVersionSnapshotFileSystem = { mkdir, writeFile, cp, rename, rm };

/* ── Storage schema ───────────────────────────────────────────────── */

interface VersionsIndex {
  versions: EpicVersion[];
}

/* ── Diff types ───────────────────────────────────────────────────── */

export interface DiffLine {
  type: "add" | "remove" | "same";
  content: string;
  lineNumber?: number;
}

export interface FileDiff {
  filename: string;
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
}

export interface VersionDiff {
  from: number;
  to: number;
  files: FileDiff[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeVersionService {
  private root: string;

  constructor(
    root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
    private readonly snapshotFs: CodaScopeVersionSnapshotFileSystem = versionSnapshotFileSystem,
  ) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ─────────────────────────────────────────────────── */

  private projectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const data = JSON.parse(readFileSync(projectPath, "utf-8"));
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch { /* skip corrupted */ }
      }
    }
    return null;
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", assertSafePathSegment(epicId, "epic ID"));
  }

  private versionsDir(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "versions");
  }

  private indexPath(projectDir: string, epicId: string): string {
    return path.join(this.versionsDir(projectDir, epicId), "versions.json");
  }

  private versionDir(projectDir: string, epicId: string, version: number): string {
    const versionsRoot = this.versionsDir(projectDir, epicId);
    const safeVersion = assertPositiveSafeInteger(version, "epic version number");
    return assertStrictDescendant(
      versionsRoot,
      path.join(versionsRoot, `v${safeVersion}`),
      "epic version directory",
    );
  }

  /* ── Index helpers ────────────────────────────────────────────────── */

  private async readIndex(projectDir: string, epicId: string): Promise<VersionsIndex> {
    const p = this.indexPath(projectDir, epicId);
    const index = await this.persistence.readJson(p, {
      context: { storage: "epic_versions", epicId },
      missing: () => {
        const versionsDir = this.versionsDir(projectDir, epicId);
        const hasSnapshots = existsSync(versionsDir)
          && readdirSync(versionsDir, { withFileTypes: true })
            .some((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name));
        if (hasSnapshots) {
          throw new CodaScopePersistenceCorruptError({ storage: "epic_versions", epicId });
        }
        return { versions: [] };
      },
      validate: validateVersionsIndex,
    });
    this.assertSnapshotFiles(this.versionsDir(projectDir, epicId), epicId, index);
    return index;
  }

  private writeIndex(projectDir: string, epicId: string, index: VersionsIndex): Promise<void> {
    assertVersionIndex(index, "version", "epic version number");
    return this.persistence.writeJson(
      this.indexPath(projectDir, epicId),
      index,
      { storage: "epic_versions", epicId },
    );
  }

  /** Read the versions index directly from an epic dir (for getEpic assembly). */
  async readVersionsIndex(epicDir: string): Promise<EpicVersion[]> {
    const indexPath = path.join(epicDir, "versions", "versions.json");
    const epicId = path.basename(epicDir);
    const index = await this.persistence.readJson(indexPath, {
      context: { storage: "epic_versions", epicId },
      missing: () => {
        const versionsDir = path.dirname(indexPath);
        const hasSnapshots = existsSync(versionsDir)
          && readdirSync(versionsDir, { withFileTypes: true })
            .some((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name));
        if (hasSnapshots) throw new CodaScopePersistenceCorruptError({ storage: "epic_versions", epicId });
        return { versions: [] };
      },
      validate: validateVersionsIndex,
    });
    this.assertSnapshotFiles(path.dirname(indexPath), epicId, index);
    return index.versions;
  }

  private mutationKey(projectDir: string): string {
    return epicStorageMutationKey(projectDir, this.persistence);
  }

  private assertSnapshotFiles(versionsRoot: string, epicId: string, index: VersionsIndex): void {
    for (const version of index.versions) {
      const snapshotDir = assertStrictDescendant(
        versionsRoot,
        path.join(versionsRoot, `v${version.version}`),
        "epic version directory",
      );
      if (!existsSync(snapshotDir)
        || !existsSync(path.join(snapshotDir, "definition.md"))
        || !existsSync(path.join(snapshotDir, "scope.json"))) {
        throw new CodaScopePersistenceCorruptError({ storage: "epic_versions", epicId });
      }
      for (const docId of Object.keys(version.designDocHashes)) {
        const safeDocId = assertSafePathSegment(docId, "document ID");
        const designsDir = path.join(snapshotDir, "designs");
        const legacyPath = path.join(designsDir, `${safeDocId}.md`);
        const currentPath = path.join(designsDir, safeDocId, "content.md");
        if (!existsSync(legacyPath) && !existsSync(currentPath)) {
          throw new CodaScopePersistenceCorruptError({
            storage: "epic_versions",
            epicId,
            documentId: safeDocId,
          });
        }
      }
    }
  }

  private readRequiredFile(filePath: string, context: { storage: string; epicId: string }): string {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CodaScopePersistenceCorruptError(context);
      }
      throw new CodaScopePersistenceError(context);
    }
  }

  /* ── Hash helpers ─────────────────────────────────────────────────── */

  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private readSnapshotDesignDocs(designsDir: string): Array<{ id: string; filename: string; content: string }> {
    if (!existsSync(designsDir)) return [];
    const docs = new Map<string, { id: string; filename: string; content: string }>();
    for (const entry of readdirSync(designsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const id = assertSafePathSegment(entry.name.replace(/\.md$/, ""), "document ID");
        docs.set(id, { id, filename: entry.name, content: readFileSync(path.join(designsDir, entry.name), "utf-8") });
        continue;
      }
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = assertSafePathSegment(entry.name, "document ID");
      const contentPath = path.join(designsDir, id, "content.md");
      if (existsSync(contentPath)) {
        docs.set(id, { id, filename: `${id}/content.md`, content: readFileSync(contentPath, "utf-8") });
      }
    }
    return [...docs.values()];
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all versions for an epic. */
  async listVersions(projectId: string, epicId: string): Promise<EpicVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return (await this.readIndex(projectDir, epicId)).versions;
  }

  /** Create a version snapshot — copies definition, scope, and designs. */
  async createVersion(projectId: string, epicId: string, opts: {
    createdBy?: string;
    label?: string;
    note?: string;
  }): Promise<EpicVersion> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    return this.persistence.withMutation(this.mutationKey(projectDir), async () => {
      const epicIndex = await readActiveEpicsIndex(this.persistence, projectDir, projectId);
      if (!epicIndex.epics.some((epic) => epic.id === epicId)) throw new Error("Epic not found");
      const epicDirectory = this.epicDir(projectDir, epicId);

      const indexPath = this.indexPath(projectDir, epicId);
      const previousIndexBytes = existsSync(indexPath) ? readFileSync(indexPath) : null;
      const index = await this.readIndex(projectDir, epicId);
      const epicMetaPath = path.join(epicDirectory, "epic.json");
      const previousMeta = await readEpicMetadata(this.persistence, projectDir, projectId, epicId);
      const definitionPath = path.join(epicDirectory, "definition.md");
      const defContent = this.readRequiredFile(
        definitionPath,
        { storage: "epic_definition", epicId },
      );
      const designsIndexPath = path.join(epicDirectory, "designs", "designs.json");
      if (existsSync(designsIndexPath)) {
        await new CodaScopeDesignDocService(this.root, this.persistence).readDesignsIndex(epicDirectory);
      }

      let maxVersion = 0;
      for (const version of index.versions) maxVersion = Math.max(maxVersion, version.version);
      const nextVersion = assertPositiveSafeInteger(maxVersion + 1, "epic version number");
      for (const version of index.versions) {
        if (version.status === "draft" || version.status === "in-review") version.status = "superseded";
      }

      const versionsRoot = this.versionsDir(projectDir, epicId);
      const publishedDir = this.versionDir(projectDir, epicId, nextVersion);
      const stagingDir = assertStrictDescendant(
        versionsRoot,
        path.join(versionsRoot, `.v${nextVersion}.stage.${crypto.randomUUID()}`),
        "epic version staging directory",
      );
      try {
        await this.snapshotFs.mkdir(versionsRoot, { recursive: true });
        await this.snapshotFs.mkdir(stagingDir, {});
        const scopeContent = existsSync(path.join(epicDirectory, "scope.json"))
          ? readFileSync(path.join(epicDirectory, "scope.json"), "utf-8")
          : "{}";
        await this.snapshotFs.writeFile(path.join(stagingDir, "definition.md"), defContent, "utf-8");
        await this.snapshotFs.writeFile(path.join(stagingDir, "scope.json"), scopeContent, "utf-8");

        const designsSrc = path.join(epicDirectory, "designs");
        const designsDst = path.join(stagingDir, "designs");
        if (existsSync(designsSrc)) await this.snapshotFs.cp(designsSrc, designsDst, { recursive: true, errorOnExist: true });

        const designDocHashes: Record<string, string> = {};
        if (existsSync(designsDst)) {
          for (const doc of this.readSnapshotDesignDocs(designsDst)) {
            designDocHashes[doc.id] = this.hashContent(doc.content);
          }
        }

        const version: EpicVersion = {
          version: nextVersion,
          createdAt: new Date().toISOString(),
          createdBy: opts.createdBy ?? "user",
          label: opts.label,
          note: opts.note,
          definitionHash: this.hashContent(defContent),
          designDocHashes,
          scopeHash: this.hashContent(scopeContent),
          status: "draft",
        };

        await this.snapshotFs.rename(stagingDir, publishedDir);
        index.versions.push(version);
        try {
          await this.writeIndex(projectDir, epicId, index);
        } catch (error) {
          await this.snapshotFs.rm(publishedDir, { recursive: true, force: true });
          throw error;
        }

        const nextMeta = {
          ...previousMeta,
          currentVersion: nextVersion,
          updatedAt: new Date().toISOString(),
        };
        try {
          await this.persistence.writeJson(
            epicMetaPath,
            nextMeta,
            { storage: "epic_metadata", epicId },
          );
        } catch (error) {
          try {
            if (previousIndexBytes) {
              await this.persistence.writeFile(
                indexPath,
                previousIndexBytes,
                { storage: "epic_versions", epicId },
              );
            } else {
              await this.snapshotFs.rm(indexPath, { force: true });
            }
            await this.snapshotFs.rm(publishedDir, { recursive: true, force: true });
          } catch {
            throw new CodaScopePersistenceError({
              storage: "epic_versions",
              epicId,
              recovery: "operator_required",
            });
          }
          throw error;
        }

        return version;
      } catch (error) {
        try {
          await this.snapshotFs.rm(stagingDir, { recursive: true, force: true });
        } catch {
          throw new CodaScopePersistenceError({
            storage: "epic_version_snapshot",
            epicId,
            recovery: "operator_required",
          });
        }
        if (isPersistenceDomainError(error)) throw error;
        throw new CodaScopePersistenceError({ storage: "epic_version_snapshot", epicId });
      }
    });
  }

  /** Get a version snapshot's contents. */
  async getVersion(projectId: string, epicId: string, version: number): Promise<{
    version: EpicVersion;
    definition: string;
    scope: string;
    designDocs: Array<{ id: string; filename: string; content: string }>;
  } | null> {
    const safeVersion = assertPositiveSafeInteger(version, "epic version number");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, epicId);
    const versionMeta = index.versions.find((v) => v.version === safeVersion);
    if (!versionMeta) return null;

    const vDir = this.versionDir(projectDir, epicId, safeVersion);
    if (!existsSync(vDir)) {
      throw new CodaScopePersistenceCorruptError({ storage: "epic_versions", epicId });
    }

    const definition = this.readRequiredFile(
      path.join(vDir, "definition.md"),
      { storage: "epic_versions", epicId },
    );
    const scope = this.readRequiredFile(
      path.join(vDir, "scope.json"),
      { storage: "epic_versions", epicId },
    );

    const designDir = path.join(vDir, "designs");
    const designDocs = this.readSnapshotDesignDocs(designDir);

    return { version: versionMeta, definition, scope, designDocs };
  }

  /** Diff two versions. Returns line-by-line diffs for definition and each design doc. */
  async diffVersions(projectId: string, epicId: string, from: number, to: number): Promise<VersionDiff | null> {
    const safeFrom = assertPositiveSafeInteger(from, "epic version number");
    const safeTo = assertPositiveSafeInteger(to, "epic version number");
    const fromSnap = await this.getVersion(projectId, epicId, safeFrom);
    const toSnap = await this.getVersion(projectId, epicId, safeTo);
    if (!fromSnap || !toSnap) return null;

    const files: FileDiff[] = [];

    // Diff definition
    files.push(this.diffFile("definition.md", fromSnap.definition, toSnap.definition));

    // Collect all design doc IDs across both versions
    const allDocIds = new Set<string>();
    for (const doc of fromSnap.designDocs) allDocIds.add(doc.id);
    for (const doc of toSnap.designDocs) allDocIds.add(doc.id);

    for (const docId of allDocIds) {
      const fromDoc = fromSnap.designDocs.find((d) => d.id === docId);
      const toDoc = toSnap.designDocs.find((d) => d.id === docId);
      const filename = `designs/${docId}.md`;
      files.push(this.diffFile(filename, fromDoc?.content ?? "", toDoc?.content ?? ""));
    }

    // Filter out files with no changes
    const changedFiles = files.filter((f) => f.addedCount > 0 || f.removedCount > 0);

    return { from: safeFrom, to: safeTo, files: changedFiles };
  }

  /* ── Diff algorithm ───────────────────────────────────────────────── */

  /** Compute a line-by-line diff between two strings. */
  private diffFile(filename: string, oldContent: string, newContent: string): FileDiff {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diffLines = this.computeLCSDiff(oldLines, newLines);

    let addedCount = 0;
    let removedCount = 0;
    for (const line of diffLines) {
      if (line.type === "add") addedCount++;
      if (line.type === "remove") removedCount++;
    }

    return { filename, lines: diffLines, addedCount, removedCount };
  }

  /**
   * Minimal LCS-based diff. Produces a list of add/remove/same lines.
   * Uses O(n*m) space — acceptable for design documents (typically < 1000 lines).
   */
  private computeLCSDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const m = oldLines.length;
    const n = newLines.length;

    // Build LCS table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to produce diff
    const result: DiffLine[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: "same", content: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: "add", content: newLines[j - 1], lineNumber: j });
        j--;
      } else {
        result.unshift({ type: "remove", content: oldLines[i - 1], lineNumber: i });
        i--;
      }
    }

    return result;
  }
}

function validateVersionsIndex(value: unknown): VersionsIndex {
  assertVersionIndex(value, "version", "epic version number");
  if (!isRecord(value) || !Array.isArray(value.versions)) throw new Error("invalid epic version index");
  for (const version of value.versions) {
    if (!isRecord(version)
      || typeof version.createdAt !== "string"
      || typeof version.createdBy !== "string"
      || (version.label !== undefined && typeof version.label !== "string")
      || (version.note !== undefined && typeof version.note !== "string")
      || typeof version.definitionHash !== "string"
      || !isRecord(version.designDocHashes)
      || !Object.values(version.designDocHashes).every((hash) => typeof hash === "string")
      || typeof version.scopeHash !== "string"
      || !new Set(["draft", "in-review", "approved", "superseded"]).has(String(version.status))) {
      throw new Error("invalid epic version record");
    }
  }
  return value as unknown as VersionsIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
