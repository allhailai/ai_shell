/* ── CodaScope: Filesystem Path Safety ────────────────────────────────
   Shared validation for user-controlled path components used by
   filesystem-backed CodaScope services.
   ──────────────────────────────────────────────────────────────────── */

import path from "node:path";

/** Whether a value can safely occupy exactly one filesystem path segment. */
export function isSafePathSegment(value: string): boolean {
  return Boolean(
    value
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && path.basename(value) === value,
  );
}

/** Reject a value that must occupy exactly one filesystem path segment. */
export function assertSafePathSegment(value: string, label: string): string {
  if (!isSafePathSegment(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/**
 * Resolve a relative path under a fixed root. `startsWith(root)` is not a
 * containment check: sibling paths that merely share a string prefix pass it.
 */
export function resolveWithin(root: string, relativePath: string, label = "path"): string {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error(`Invalid ${label}.`);
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`Path traversal detected for ${label}.`);
  }

  return resolvedPath;
}
