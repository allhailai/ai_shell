/* ── CodaScope: Version Service ──────────────────────────────────────
   Epic version snapshot management.
   Creates copy-on-version snapshots and provides line-by-line diffing.

   Responsibilities:
   - Create version snapshot (copies definition, scope, designs)
   - List versions
   - Read version snapshot content
   - Diff two versions (line-by-line markdown diff)
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { EpicVersion } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  assertPositiveSafeInteger,
  assertSafePathSegment,
  assertStrictDescendant,
  assertVersionIndex,
} from "./codaScopePathSafety.js";

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

  constructor(root: string) {
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

  private readIndex(projectDir: string, epicId: string): VersionsIndex {
    const p = this.indexPath(projectDir, epicId);
    if (!existsSync(p)) return { versions: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { versions: [] };
    }
    assertVersionIndex(parsed, "version", "epic version number");
    return parsed as VersionsIndex;
  }

  private writeIndex(projectDir: string, epicId: string, index: VersionsIndex): void {
    assertVersionIndex(index, "version", "epic version number");
    const dir = this.versionsDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.indexPath(projectDir, epicId), JSON.stringify(index, null, 2), "utf-8");
  }

  /** Read the versions index directly from an epic dir (for getEpic assembly). */
  readVersionsIndex(epicDir: string): EpicVersion[] {
    const indexPath = path.join(epicDir, "versions", "versions.json");
    if (!existsSync(indexPath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch {
      return [];
    }
    assertVersionIndex(parsed, "version", "epic version number");
    return (parsed as VersionsIndex).versions;
  }

  /* ── Hash helpers ─────────────────────────────────────────────────── */

  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all versions for an epic. */
  async listVersions(projectId: string, epicId: string): Promise<EpicVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readIndex(projectDir, epicId).versions;
  }

  /** Create a version snapshot — copies definition, scope, and designs. */
  async createVersion(projectId: string, epicId: string, opts: {
    createdBy?: string;
    label?: string;
    note?: string;
  }): Promise<EpicVersion> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) throw new Error("Epic not found");

    // Determine next version number
    const index = this.readIndex(projectDir, epicId);
    let maxVersion = 0;
    for (const version of index.versions) maxVersion = Math.max(maxVersion, version.version);
    const nextVersion = assertPositiveSafeInteger(maxVersion + 1, "epic version number");

    // Mark previous versions as superseded
    for (const v of index.versions) {
      if (v.status === "draft" || v.status === "in-review") {
        v.status = "superseded";
      }
    }

    // Create version directory
    const vDir = this.versionDir(projectDir, epicId, nextVersion);
    mkdirSync(vDir, { recursive: true });

    // Copy definition.md
    const defSrc = path.join(epicDirectory, "definition.md");
    const defDst = path.join(vDir, "definition.md");
    const defContent = existsSync(defSrc) ? readFileSync(defSrc, "utf-8") : "";
    writeFileSync(defDst, defContent, "utf-8");

    // Copy scope.json
    const scopeSrc = path.join(epicDirectory, "scope.json");
    const scopeDst = path.join(vDir, "scope.json");
    const scopeContent = existsSync(scopeSrc) ? readFileSync(scopeSrc, "utf-8") : "{}";
    writeFileSync(scopeDst, scopeContent, "utf-8");

    // Copy designs directory
    const designsSrc = path.join(epicDirectory, "designs");
    const designsDst = path.join(vDir, "designs");
    if (existsSync(designsSrc)) {
      cpSync(designsSrc, designsDst, { recursive: true });
    }

    // Compute hashes
    const definitionHash = this.hashContent(defContent);
    const scopeHash = this.hashContent(scopeContent);
    const designDocHashes: Record<string, string> = {};

    if (existsSync(designsDst)) {
      const designFiles = readdirSync(designsDst).filter((f) => f.endsWith(".md"));
      for (const file of designFiles) {
        const docContent = readFileSync(path.join(designsDst, file), "utf-8");
        const docId = file.replace(/\.md$/, "");
        designDocHashes[docId] = this.hashContent(docContent);
      }
    }

    const version: EpicVersion = {
      version: nextVersion,
      createdAt: new Date().toISOString(),
      createdBy: opts.createdBy ?? "user",
      label: opts.label,
      note: opts.note,
      definitionHash,
      designDocHashes,
      scopeHash,
      status: "draft",
    };

    index.versions.push(version);
    this.writeIndex(projectDir, epicId, index);

    // Update epic's currentVersion
    const epicMetaPath = path.join(epicDirectory, "epic.json");
    if (existsSync(epicMetaPath)) {
      try {
        const meta = JSON.parse(readFileSync(epicMetaPath, "utf-8"));
        meta.currentVersion = nextVersion;
        meta.updatedAt = new Date().toISOString();
        writeFileSync(epicMetaPath, JSON.stringify(meta, null, 2), "utf-8");
      } catch { /* ignore */ }
    }

    return version;
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

    const index = this.readIndex(projectDir, epicId);
    const versionMeta = index.versions.find((v) => v.version === safeVersion);
    if (!versionMeta) return null;

    const vDir = this.versionDir(projectDir, epicId, safeVersion);
    if (!existsSync(vDir)) return null;

    const defPath = path.join(vDir, "definition.md");
    const definition = existsSync(defPath) ? readFileSync(defPath, "utf-8") : "";

    const scopePath = path.join(vDir, "scope.json");
    const scope = existsSync(scopePath) ? readFileSync(scopePath, "utf-8") : "{}";

    const designDocs: Array<{ id: string; filename: string; content: string }> = [];
    const designDir = path.join(vDir, "designs");
    if (existsSync(designDir)) {
      const files = readdirSync(designDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        designDocs.push({
          id: file.replace(/\.md$/, ""),
          filename: file,
          content: readFileSync(path.join(designDir, file), "utf-8"),
        });
      }
    }

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
