/* ── Filesystem Browser Routes ────────────────────────────────────────
   Provides directory listing endpoints for the shared folder/file
   picker UI component.

   Security considerations:
   - Only lists directories and files — never reads file content.
   - Respects OS permissions (Node.js will throw EACCES for unreadable dirs).
   - Hidden files (dotfiles) are included but marked as hidden.
   - Symlinks are resolved to determine their actual type.
   ──────────────────────────────────────────────────────────────────── */

import { Router, type Express } from "express";
import {
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { homedir } from "node:os";

interface FilesystemRouteDeps {
  authMiddleware: Record<string, unknown>;
  httpError: (message: string, status: number, code: string) => Error;
}

export function registerFilesystemRoutes(
  app: Express,
  deps: FilesystemRouteDeps,
): void {
  const router = Router();

  /**
   * GET /api/filesystem/browse
   *
   * Query params:
   *   path       — absolute path to list (defaults to home directory)
   *   showFiles  — "true" to include files, default is directories only
   *   showHidden — "true" to include dotfiles/dotdirs
   *
   * Response:
   *   {
   *     path: string,              // resolved absolute path
   *     parent: string | null,     // parent directory (null if at root)
   *     separator: string,         // OS path separator
   *     entries: Array<{
   *       name: string,
   *       path: string,            // full absolute path
   *       type: "directory" | "file" | "symlink",
   *       size?: number,           // bytes (files only)
   *       hidden: boolean,
   *       readable: boolean,
   *     }>
   *   }
   */
  router.get("/browse", (req, res) => {
    try {
      const rawPath = (req.query.path as string) || homedir();
      const showFiles = req.query.showFiles === "true";
      const showHidden = req.query.showHidden === "true";

      // Resolve to absolute path
      const targetPath = resolve(rawPath);

      if (!existsSync(targetPath)) {
        res.status(404).json({
          error: `Path does not exist: ${targetPath}`,
          code: "path_not_found",
        });
        return;
      }

      // Verify it's a directory
      let stat;
      try {
        stat = statSync(targetPath);
      } catch {
        res.status(403).json({
          error: `Cannot access path: ${targetPath}`,
          code: "access_denied",
        });
        return;
      }

      if (!stat.isDirectory()) {
        res.status(400).json({
          error: `Path is not a directory: ${targetPath}`,
          code: "not_a_directory",
        });
        return;
      }

      // Read directory contents
      let rawEntries;
      try {
        rawEntries = readdirSync(targetPath, { withFileTypes: true });
      } catch {
        res.status(403).json({
          error: `Cannot read directory: ${targetPath}`,
          code: "access_denied",
        });
        return;
      }

      const entries = rawEntries
        .filter((entry) => {
          // Filter hidden files
          if (!showHidden && entry.name.startsWith(".")) return false;
          return true;
        })
        .map((entry) => {
          const fullPath = join(targetPath, entry.name);
          const hidden = entry.name.startsWith(".");
          let type: "directory" | "file" | "symlink" = "file";
          let size: number | undefined;
          let readable = true;

          try {
            if (entry.isSymbolicLink()) {
              // Resolve symlink to determine its actual type
              try {
                const realPath = realpathSync(fullPath);
                const realStat = statSync(realPath);
                type = realStat.isDirectory() ? "directory" : "file";
                if (!realStat.isDirectory()) size = realStat.size;
              } catch {
                type = "symlink";
                readable = false;
              }
            } else if (entry.isDirectory()) {
              type = "directory";
              // Check if the directory is readable
              try {
                readdirSync(fullPath);
              } catch {
                readable = false;
              }
            } else {
              type = "file";
              try {
                const fileStat = statSync(fullPath);
                size = fileStat.size;
              } catch {
                readable = false;
              }
            }
          } catch {
            readable = false;
          }

          return { name: entry.name, path: fullPath, type, size, hidden, readable };
        })
        .filter((entry) => {
          // Filter files if showFiles is false
          if (!showFiles && entry.type === "file") return false;
          return true;
        })
        // Sort: directories first, then alphabetically (case-insensitive)
        .sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });

      // Compute parent
      const parent = dirname(targetPath);
      const hasParent = parent !== targetPath; // false at root (/ or C:\)

      res.json({
        path: targetPath,
        parent: hasParent ? parent : null,
        separator: sep,
        entries,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message, code: "internal_error" });
    }
  });

  /**
   * GET /api/filesystem/roots
   *
   * Returns common starting points for browsing (home, root, common dirs).
   */
  router.get("/roots", (_req, res) => {
    const home = homedir();
    const roots: Array<{ label: string; path: string; icon: string }> = [
      { label: "Home", path: home, icon: "🏠" },
      { label: "Root", path: sep, icon: "💻" },
    ];

    // Add common development directories if they exist
    const devDirs = [
      { label: "Desktop", path: join(home, "Desktop"), icon: "🖥️" },
      { label: "Documents", path: join(home, "Documents"), icon: "📄" },
      { label: "Projects", path: join(home, "Projects"), icon: "📁" },
      { label: "Developer", path: join(home, "Developer"), icon: "👨‍💻" },
      { label: "Code", path: join(home, "code"), icon: "💻" },
      { label: "Workspace", path: join(home, "workspace"), icon: "📂" },
      { label: "/opt", path: "/opt", icon: "📦" },
    ];

    for (const dir of devDirs) {
      if (existsSync(dir.path)) {
        roots.push(dir);
      }
    }

    res.json({ roots });
  });

  /**
   * POST /api/filesystem/validate
   *
   * Body: { path: string }
   * Validates that a path exists and is a directory.
   */
  router.post("/validate", (req, res) => {
    const { path: rawPath } = req.body as { path?: string };
    if (!rawPath || typeof rawPath !== "string") {
      res.status(400).json({ valid: false, error: "Path is required" });
      return;
    }

    const absPath = resolve(rawPath.trim());
    if (!existsSync(absPath)) {
      res.json({ valid: false, error: "Path does not exist", resolvedPath: absPath });
      return;
    }

    try {
      const stat = statSync(absPath);
      if (!stat.isDirectory()) {
        res.json({ valid: false, error: "Path is not a directory", resolvedPath: absPath });
        return;
      }
      res.json({ valid: true, resolvedPath: absPath });
    } catch {
      res.json({ valid: false, error: "Cannot access path", resolvedPath: absPath });
    }
  });

  app.use("/api/filesystem", router);
}
