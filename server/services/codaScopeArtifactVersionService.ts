/* ── CodaScope: Artifact Version Service ─────────────────────────────
   Per-artifact build version history.

   Responsibilities:
   - Snapshot current build before overwriting (copy index.html to .versions/)
   - List versions with metadata (version number, timestamp, size)
   - Revert to any previous version (copy snapshot back)
   - Revert to latest

   Storage layout:
   <artifactId>/builds/.versions/
   ├── v001_<timestamp>/
   │   └── index.html
   └── v002_<timestamp>/
       └── index.html
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";
import type { ArtifactBuildVersion } from "../../src/apps/codascope/codaScopeTypes.js";

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
    return path.join(projectDir, "epics", epicId, "artifacts", artifactId, "builds");
  }

  private versionsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), ".versions");
  }

  private indexHtmlPath(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), "index.html");
  }

  /* ── Snapshot ─────────────────────────────────────────────────────── */

  /**
   * Create a snapshot of the current build.
   * Returns the version metadata, or null if no index.html exists.
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

    return {
      version: nextVersion,
      timestamp: new Date().toISOString(),
      dirName,
      sizeBytes,
    };
  }

  /* ── List ─────────────────────────────────────────────────────────── */

  /** List all version snapshots for an artifact. */
  async listVersions(projectId: string, epicId: string, artifactId: string): Promise<ArtifactBuildVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    return this.listVersionsFromDisk(vDir);
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
   * Copies the snapshot's index.html back to the builds directory.
   */
  async revertToVersion(projectId: string, epicId: string, artifactId: string, dirName: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const vDir = this.versionsDir(projectDir, epicId, artifactId);
    const snapshotHtml = path.join(vDir, dirName, "index.html");
    if (!existsSync(snapshotHtml)) return false;

    // Snapshot current state before reverting (so revert is itself revertible)
    await this.snapshotCurrentBuild(projectId, epicId, artifactId);

    // Copy snapshot to current
    const targetPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    const content = readFileSync(snapshotHtml, "utf-8");
    writeFileSync(targetPath, content, "utf-8");

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
    return this.revertToVersion(projectId, epicId, artifactId, latest.dirName);
  }
}
