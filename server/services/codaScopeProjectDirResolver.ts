/* ── CodaScope: Project Directory Resolver ────────────────────────────
   Centralized, cached resolution of projectId → filesystem path.
   Replaces the duplicated `projectDir()` method in every service.

   Features:
   - LRU-style cache with configurable TTL (default: 30s)
   - Automatic invalidation on setRoot()
   - Thread-safe (single JS thread, but prevents stale cache)
   - Shared singleton usable by all CodaScope services
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

/* ── Cache Entry ─────────────────────────────────────────────────── */

interface CacheEntry {
  path: string;
  resolvedAt: number;
}

/* ── Resolver ────────────────────────────────────────────────────── */

export class ProjectDirResolver {
  private root: string;
  private cache = new Map<string, CacheEntry>();

  /** Cache TTL in milliseconds. Default: 30 seconds. */
  private static readonly CACHE_TTL_MS = 30_000;

  /** Max cache entries to prevent unbounded growth. */
  private static readonly MAX_ENTRIES = 200;

  constructor(root: string) {
    this.root = root;
  }

  /** Update the projects root. Clears the cache. */
  setRoot(root: string): void {
    if (this.root !== root) {
      this.root = root;
      this.cache.clear();
    }
  }

  /** Get the current root. */
  getRoot(): string {
    return this.root;
  }

  /**
   * Resolve a projectId to a filesystem directory path.
   * Returns null if the project is not found.
   * Uses cached results within the TTL window.
   */
  resolve(projectId: string): string | null {
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(projectId);
    if (cached && (now - cached.resolvedAt) < ProjectDirResolver.CACHE_TTL_MS) {
      // Verify the path still exists (cheap stat check)
      if (existsSync(cached.path)) {
        return cached.path;
      }
      // Path vanished — remove stale entry
      this.cache.delete(projectId);
    }

    // Cache miss or expired — scan the root directory
    if (!existsSync(this.root)) return null;

    try {
      const entries = readdirSync(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const projectPath = path.join(this.root, entry.name, "project.json");
        if (existsSync(projectPath)) {
          try {
            const data = JSON.parse(readFileSync(projectPath, "utf-8"));
            if (data.id === projectId) {
              const resolved = path.join(this.root, entry.name);
              this.cacheResult(projectId, resolved, now);
              return resolved;
            }
          } catch {
            /* skip corrupted project.json */
          }
        }
      }
    } catch {
      /* root directory unreadable */
    }

    return null;
  }

  /** Manually invalidate a specific project's cache entry. */
  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  /** Clear all cached entries. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get cache statistics (for debugging/monitoring). */
  cacheStats(): { size: number; ttlMs: number } {
    return {
      size: this.cache.size,
      ttlMs: ProjectDirResolver.CACHE_TTL_MS,
    };
  }

  /* ── Internal ──────────────────────────────────────────────────── */

  private cacheResult(projectId: string, resolvedPath: string, now: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= ProjectDirResolver.MAX_ENTRIES) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].resolvedAt - b[1].resolvedAt)
        .slice(0, Math.floor(ProjectDirResolver.MAX_ENTRIES / 4));
      for (const [key] of oldest) {
        this.cache.delete(key);
      }
    }

    this.cache.set(projectId, {
      path: resolvedPath,
      resolvedAt: now,
    });
  }
}
