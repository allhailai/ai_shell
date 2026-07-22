/* ── CodaScope: Artifact Version Service ─────────────────────────────
   Per-artifact build version history.

   Responsibilities:
   - Snapshot current build before overwriting (copy index.html to .versions/)
   - List versions with metadata (version number, timestamp, size)
   - Revert to any previous version (switch current pointer, no new snapshot)
   - Revert to latest
   - Track which version is currently active via current.json

   Storage layout:
   <artifactId>/builds/.versions/
   ├── current.json           ← { "currentDirName": "v001_..." }
   ├── v001_<timestamp>/
   │   └── index.html
   └── v002_<timestamp>/
       └── index.html
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";
import type { ArtifactBuildVersion } from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment, assertStrictDescendant } from "./codaScopePathSafety.js";

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeArtifactVersionService {
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

  private buildsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(
      projectDir,
      "epics",
      assertSafePathSegment(epicId, "epic ID"),
      "artifacts",
      assertSafePathSegment(artifactId, "artifact ID"),
      "builds",
    );
  }

  private versionsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), ".versions");
  }

  private indexHtmlPath(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), "index.html");
  }

  private currentJsonPath(vDir: string): string {
    return path.join(vDir, "current.json");
  }

  /* ── Current version pointer ─────────────────────────────────────── */

  /** Read which dirName is currently active. Returns null if not set. */
  private readCurrentPointer(vDir: string): string | null {
    const jsonPath = this.currentJsonPath(vDir);
    if (!existsSync(jsonPath)) return null;
    let currentDirName: unknown;
    try {
      const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
      currentDirName = data.currentDirName;
    } catch {
      return null;
    }
    if (currentDirName == null) return null;
    if (typeof currentDirName !== "string") return null;
    return assertSafePathSegment(currentDirName, "artifact version ID");
  }

  /** Write the current version pointer. */
  private writeCurrentPointer(vDir: string, dirName: string): void {
    const safeDirName = assertSafePathSegment(dirName, "artifact version ID");
    writeFileSync(
      this.currentJsonPath(vDir),
      JSON.stringify({ currentDirName: safeDirName }),
      "utf-8",
    );
  }

  /* ── Snapshot ─────────────────────────────────────────────────────── */

  /**
   * Create a snapshot of the current build.
   * Returns the version metadata, or null if no index.html exists.
   * After snapshotting, the new version becomes current.
   */
  async snapshotCurrentBuild(projectId: string, epicId: string, artifactId: string): Promise<ArtifactBuildVersion | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const htmlPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    if (!existsSync(htmlPath)) return null;

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true });

    // Determine next version number
    const existing = this.listVersionsFromDisk(vDir);
    const nextVersion = existing.length > 0
      ? Math.max(...existing.map((v) => v.version)) + 1
      : 1;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dirName = `v${String(nextVersion).padStart(3, "0")}_${timestamp}`;
    const snapshotDir = path.join(vDir, dirName);
    mkdirSync(snapshotDir, { recursive: true });

    // Copy current index.html to snapshot
    const content = readFileSync(htmlPath, "utf-8");
    writeFileSync(path.join(snapshotDir, "index.html"), content, "utf-8");

    const sizeBytes = statSync(htmlPath).size;

    // Mark the new version as current
    this.writeCurrentPointer(vDir, dirName);

    return {
      version: nextVersion,
      timestamp: new Date().toISOString(),
      dirName,
      sizeBytes,
    };
  }

  /* ── List ─────────────────────────────────────────────────────────── */

  /** List all version snapshots for an artifact, with isCurrent annotated. */
  async listVersions(projectId: string, epicId: string, artifactId: string): Promise<ArtifactBuildVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    const versions = this.listVersionsFromDisk(vDir);

    // Annotate current version
    const currentDirName = this.readCurrentPointer(vDir);
    // If no pointer set, the latest version is current
    const effectiveCurrent = currentDirName ?? (versions.length > 0 ? versions[versions.length - 1].dirName : null);

    for (const v of versions) {
      v.isCurrent = v.dirName === effectiveCurrent;
    }

    return versions;
  }

  /** Read version entries from disk. */
  private listVersionsFromDisk(vDir: string): ArtifactBuildVersion[] {
    if (!existsSync(vDir)) return [];

    const entries = readdirSync(vDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("v"))
      .sort((a, b) => a.name.localeCompare(b.name));

    const versions: ArtifactBuildVersion[] = [];

    for (const entry of entries) {
      const versionMatch = entry.name.match(/^v(\d+)_(.+)$/);
      if (!versionMatch) continue;

      const version = parseInt(versionMatch[1], 10);
      const htmlPath = path.join(vDir, entry.name, "index.html");
      const sizeBytes = existsSync(htmlPath) ? statSync(htmlPath).size : 0;

      // Parse timestamp from directory name — reconstruct ISO format
      const rawTs = versionMatch[2];
      const timestamp = rawTs.replace(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/,
        "$1-$2-$3T$4:$5:$6.$7Z",
      );

      versions.push({
        version,
        timestamp: timestamp || rawTs,
        dirName: entry.name,
        sizeBytes,
      });
    }

    return versions;
  }

  /* ── Revert ──────────────────────────────────────────────────────── */

  /**
   * Revert to a specific version by its directory name.
   * Copies the snapshot's index.html back to the builds directory
   * and updates the current pointer. Does NOT create a new version.
   */
  async revertToVersion(projectId: string, epicId: string, artifactId: string, dirName: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    const safeDirName = assertSafePathSegment(dirName, "artifact version ID");
    const snapshotHtml = assertStrictDescendant(
      vDir,
      path.join(vDir, safeDirName, "index.html"),
      "artifact version source",
    );
    if (!existsSync(snapshotHtml)) return false;

    // Copy snapshot to current build — no new snapshot created
    const targetPath = assertStrictDescendant(
      this.buildsDir(projectDir, epicId, artifactId),
      this.indexHtmlPath(projectDir, epicId, artifactId),
      "artifact version target",
    );
    const content = readFileSync(snapshotHtml, "utf-8");
    writeFileSync(targetPath, content, "utf-8");

    // Update current pointer
    this.writeCurrentPointer(vDir, safeDirName);

    return true;
  }

  /**
   * Revert to the latest (most recent) version snapshot.
   */
  async revertToLatest(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    const versions = this.listVersionsFromDisk(vDir);
    if (versions.length === 0) return false;

    const latest = versions[versions.length - 1];

    // Copy latest snapshot to current build
    const snapshotHtml = assertStrictDescendant(
      vDir,
      path.join(vDir, assertSafePathSegment(latest.dirName, "artifact version ID"), "index.html"),
      "artifact version source",
    );
    if (!existsSync(snapshotHtml)) return false;

    const targetPath = assertStrictDescendant(
      this.buildsDir(projectDir, epicId, artifactId),
      this.indexHtmlPath(projectDir, epicId, artifactId),
      "artifact version target",
    );
    const content = readFileSync(snapshotHtml, "utf-8");
    writeFileSync(targetPath, content, "utf-8");

    // Update current pointer to latest
    this.writeCurrentPointer(vDir, latest.dirName);

    return true;
  }
}
