/* ── CodaScope: Filesystem Path Safety ────────────────────────────────
   Shared validation for user-controlled path components used by
   filesystem-backed CodaScope services.
   ──────────────────────────────────────────────────────────────────── */

import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const ENCODED_SEPARATOR_RE = /%(?:25)*(?:2f|5c)/i;
const WINDOWS_DRIVE_RE = /^[a-z]:/i;

/** Stable domain error used by services, tools, imports, and HTTP routes. */
export class CodaScopePathValidationError extends Error {
  readonly status = 400;
  readonly code = "invalid_input";
  readonly label: string;

  constructor(label: string) {
    super(`Invalid ${label}.`);
    this.name = "CodaScopePathValidationError";
    this.label = label;
  }
}

export function isPathValidationError(error: unknown): error is CodaScopePathValidationError {
  return error instanceof CodaScopePathValidationError;
}

const PATH_IDENTIFIER_FIELDS: Readonly<Record<string, string>> = {
  epicId: "epic ID",
  docId: "document ID",
  documentId: "document ID",
  artifactId: "artifact ID",
  sourceId: "source ID",
  pageId: "wiki page ID",
  versionId: "version ID",
  dirName: "version ID",
  currentDirName: "version ID",
  curationId: "curation ID",
  runId: "run ID",
  skillId: "skill ID",
};

function invalid(label: string): never {
  throw new CodaScopePathValidationError(label);
}

/** Whether a value can safely occupy exactly one filesystem path segment. */
export function isSafePathSegment(value: string): boolean {
  return Boolean(
    value
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !ENCODED_SEPARATOR_RE.test(value)
    && !WINDOWS_DRIVE_RE.test(value)
    && !path.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && path.basename(value) === value,
  );
}

/** Reject a value that must occupy exactly one filesystem path segment. */
export function assertSafePathSegment(value: string, label: string): string {
  if (!isSafePathSegment(value)) {
    invalid(label);
  }
  return value;
}

/** Validate a numeric identifier that is rendered into a version path. */
export function assertPositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalid(label);
  }
  return value;
}

/** Validate path-backed identifier fields in imported JSON metadata. */
export function assertSafeImportedPathIdentifierFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeImportedPathIdentifierFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const label = PATH_IDENTIFIER_FIELDS[key];
    if (label && typeof child === "string") assertSafePathSegment(child, `imported ${label}`);
    assertSafeImportedPathIdentifierFields(child);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Validate a version index and reject ambiguous duplicate path identifiers. */
export function assertVersionIndex(
  value: unknown,
  field: "number" | "version",
  label: string,
): void {
  const versions = record(value)?.versions;
  if (!Array.isArray(versions)) invalid(label);
  const seen = new Set<number>();
  for (const item of versions) {
    const version = assertPositiveSafeInteger(record(item)?.[field], label);
    if (seen.has(version)) invalid(label);
    seen.add(version);
  }
}

function assertCollectionIds(value: unknown, key: string, label: string): void {
  const collection = record(value)?.[key];
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    const id = record(item)?.id;
    if (typeof id === "string") assertSafePathSegment(id, `imported ${label}`);
  }
}

/** Format-aware checks for path-backed IDs that are stored under generic `id` keys. */
export function assertSafeImportedPathMetadata(
  value: unknown,
  relativePath: string,
  bundleKind: "project" | "epic" = "project",
): void {
  assertSafeImportedPathIdentifierFields(value);
  const normalized = relativePath.split(path.sep).join("/");
  if (/(?:^|\/)designs\/[^/]+\/versions\/versions\.json$/.test(normalized)) {
    assertVersionIndex(value, "number", "imported design version number");
  }
  if (
    (bundleKind === "epic" && normalized === "versions/versions.json")
    || /(?:^|\/)epics\/(?:_archive\/)?[^/]+\/versions\/versions\.json$/.test(normalized)
  ) {
    assertVersionIndex(value, "version", "imported epic version number");
  }
  const data = record(value);
  if (!data) return;

  if (normalized === "epics/epics.json") assertCollectionIds(data, "epics", "epic ID");
  if ((normalized === "epic.json" || normalized.endsWith("/epic.json")) && typeof data.id === "string") {
    assertSafePathSegment(data.id, "imported epic ID");
  }
  if (normalized === "designs/designs.json" || normalized.endsWith("/designs/designs.json")) {
    assertCollectionIds(data, "docs", "document ID");
  }
  if (normalized === "artifacts/artifacts.json" || normalized.endsWith("/artifacts/artifacts.json")) {
    assertCollectionIds(data, "artifacts", "artifact ID");
  }
  if (normalized === "knowledge/sources/manifest.json" || normalized.endsWith("/knowledge/sources/manifest.json")) {
    assertCollectionIds(data, "sources", "source ID");
  }
  if (/\/knowledge\/sources\/[^/]+\/meta\.json$/.test(`/${normalized}`) && typeof data.id === "string") {
    assertSafePathSegment(data.id, "imported source ID");
  }
  if (/\/knowledge\/wiki\/[^/]+\.meta\.json$/.test(`/${normalized}`) && typeof data.id === "string") {
    assertSafePathSegment(data.id, "imported wiki page ID");
  }
  if (/\/skills\/[^/]+\/skill\.json$/.test(`/${normalized}`) && typeof data.id === "string") {
    assertSafePathSegment(data.id, "imported skill ID");
  }
  if (normalized.endsWith(".assets/documents/index.json") && Array.isArray(data.documents)) {
    for (const item of data.documents) {
      const document = record(item);
      if (!document || typeof document.id !== "string") continue;
      const id = assertSafePathSegment(document.id, "imported document ID");
      if (document.storedPath !== `documents/${id}/blob`) invalid("imported document path");
    }
  }
}

/** Validate staged bundle paths and JSON metadata before any publication. */
export function assertSafeImportedPathTree(root: string, bundleKind: "project" | "epic"): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      assertSafePathSegment(entry.name, "imported path segment");
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const relativePath = path.relative(root, entryPath);
      if (/\/knowledge\/sources\/[^/]+\/original\.json$/.test(`/${relativePath.split(path.sep).join("/")}`)) {
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(entryPath, "utf-8"));
      } catch {
        invalid("imported JSON metadata");
      }
      assertSafeImportedPathMetadata(value, relativePath, bundleKind);
    }
  };
  visit(root);
}

/**
 * Assert lexical containment for a target that will be deleted, moved,
 * replaced, or published. Equality with the expected root is deliberately
 * rejected: destructive operations must always target one strict child.
 */
export function isSameOrDescendantPath(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function assertStrictDescendant(root: string, target: string, label = "path"): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || !isSameOrDescendantPath(resolvedRoot, resolvedTarget)) {
    invalid(label);
  }
  return resolvedTarget;
}

/**
 * Resolve a relative path under a fixed root. `startsWith(root)` is not a
 * containment check: sibling paths that merely share a string prefix pass it.
 */
export function resolveContainedRelativePath(root: string, relativePath: string, label = "path"): string {
  if (
    !relativePath
    || relativePath.includes("\0")
    || relativePath.includes("\\")
    || ENCODED_SEPARATOR_RE.test(relativePath)
    || WINDOWS_DRIVE_RE.test(relativePath)
    || path.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    invalid(label);
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot) invalid(label);
  return assertStrictDescendant(resolvedRoot, resolvedPath, label);
}

/** Backwards-compatible name for intentionally nested, contained paths. */
export function resolveWithin(root: string, relativePath: string, label = "path"): string {
  return resolveContainedRelativePath(root, relativePath, label);
}
