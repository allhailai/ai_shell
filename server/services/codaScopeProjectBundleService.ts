/* ── CodaScope: Portable Project Bundle Service ───────────────────────────
   Creates and imports versioned, shared-artifacts-only project ZIPs.

   The bundle is intentionally an allowlist, not a copy of the project
   directory. Actor-custodied data, local repository paths, active locks,
   build logs, and temporary exports never enter the archive.
   ──────────────────────────────────────────────────────────────────── */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import {
  assertAvailableSpace,
  extractValidatedZipFile,
  openValidatedZipFile,
  PROJECT_ARCHIVE_LIMITS,
  readZipEntry,
  type ZipArchiveLimits,
} from "./codaScopeZipArchiveService.js";

export const PROJECT_BUNDLE_FORMAT = "codascope-project" as const;
export const PROJECT_BUNDLE_VERSION = 1 as const;
export const PROJECT_BUNDLE_MANIFEST = "codascope-project-manifest.json";
const PAYLOAD_PREFIX = "project/";
const MANIFEST_MAX_BYTES = 1024 * 1024;

interface PortableRepository {
  id: string;
  name: string;
  path: "";
  branch?: string;
}

interface StoredRepository extends Omit<PortableRepository, "path"> {
  path: string;
}

interface PortableProject {
  id: string;
  name: string;
  description: string;
  repositories: PortableRepository[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

interface StoredProject extends Omit<PortableProject, "repositories"> {
  repositories: StoredRepository[];
}

export interface ProjectBundleManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ProjectBundleManifest {
  format: typeof PROJECT_BUNDLE_FORMAT;
  formatVersion: typeof PROJECT_BUNDLE_VERSION;
  exportedAt: string;
  source: { projectId: string };
  includes: {
    sharedArtifacts: true;
    conversations: false;
    conversationImages: false;
    privateNotes: false;
    userPreferences: false;
    actorOwnedExports: false;
    buildLogs: false;
    activeLocks: false;
    repositoryPaths: false;
  };
  entries: ProjectBundleManifestEntry[];
}

export interface ProjectBundleExport {
  archive: ZipArchive;
  filename: string;
  manifest: ProjectBundleManifest;
}

export interface ProjectBundleImportResult {
  project: PortableProject;
  needsRepoMapping: boolean;
  unmappedRepos: Array<{ id: string; name: string; path: string }>;
}

interface PreparedEntry extends ProjectBundleManifestEntry {
  sourcePath?: string;
  content?: Buffer;
}

export class ProjectBundleValidationError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(message: string, code = "invalid_project_bundle") {
    super(message);
    this.name = "ProjectBundleValidationError";
    this.code = code;
  }
}

export class CodaScopeProjectBundleService {
  constructor(
    private readonly projectSvc: CodaScopeProjectService,
    private readonly limits: ZipArchiveLimits = PROJECT_ARCHIVE_LIMITS,
  ) {}

  /** Build a bounded ZIP containing only explicitly portable shared artifacts. */
  async createExport(projectId: string): Promise<ProjectBundleExport | null> {
    const projectDir = this.projectSvc.getProjectDir(projectId);
    if (!projectDir) return null;
    const project = readPortableProject(path.join(projectDir, "project.json"));
    if (!project || project.id !== projectId) {
      throw new Error("Project metadata is corrupted.");
    }

    const sanitizedProject = sanitizeProject(project);
    const sensitivePaths = [
      projectDir,
      this.projectSvc.getRoot(),
      ...project.repositories.map((repo) => repo.path).filter(Boolean),
    ];
    const entries: PreparedEntry[] = [];
    const projectJson = Buffer.from(JSON.stringify(sanitizedProject, null, 2));
    entries.push(preparedBufferEntry(`${PAYLOAD_PREFIX}project.json`, projectJson));

    for (const file of collectAllowlistedFiles(projectDir)) {
      const relativePath = toZipPath(path.relative(projectDir, file));
      if (relativePath === "project.json") continue;
      const archivePath = `${PAYLOAD_PREFIX}${relativePath}`;
      const fileInfo = statSync(file);
      if (fileInfo.size > this.limits.maxEntryUncompressedBytes) {
        throw new Error(`Project artifact exceeds the per-entry bundle limit: "${relativePath}"`);
      }
      if (isTextArtifact(relativePath)) {
        const content = sanitizePortableText(readFileSync(file), sensitivePaths, relativePath);
        entries.push(preparedBufferEntry(archivePath, content));
      } else {
        entries.push({
          path: archivePath,
          size: fileInfo.size,
          sha256: await sha256File(file),
          sourcePath: file,
        });
      }
    }

    entries.sort((left, right) => left.path.localeCompare(right.path));
    assertExportLimits(entries, this.limits);
    const manifest: ProjectBundleManifest = {
      format: PROJECT_BUNDLE_FORMAT,
      formatVersion: PROJECT_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      source: { projectId },
      includes: {
        sharedArtifacts: true,
        conversations: false,
        conversationImages: false,
        privateNotes: false,
        userPreferences: false,
        actorOwnedExports: false,
        buildLogs: false,
        activeLocks: false,
        repositoryPaths: false,
      },
      entries: entries.map(({ path: entryPath, size, sha256 }) => ({ path: entryPath, size, sha256 })),
    };
    const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2));
    if (
      manifestContent.length > MANIFEST_MAX_BYTES ||
      manifestContent.length > this.limits.maxEntryUncompressedBytes
    ) {
      throw new Error("Project bundle manifest exceeds its size limit.");
    }
    const payloadBytes = entries.reduce((total, entry) => total + entry.size, 0);
    if (payloadBytes + manifestContent.length > this.limits.maxTotalUncompressedBytes) {
      throw new Error("Project bundle exceeds the expanded-content limit.");
    }

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.append(manifestContent, { name: PROJECT_BUNDLE_MANIFEST });
    for (const entry of entries) {
      if (entry.content) archive.append(entry.content, { name: entry.path });
      else archive.file(entry.sourcePath!, { name: entry.path });
    }

    return {
      archive,
      filename: `codascope_project_${safeFilename(sanitizedProject.name || projectId)}.zip`,
      manifest,
    };
  }

  /** Validate completely in staging, then atomically publish one imported project. */
  async importProject(zipPath: string): Promise<ProjectBundleImportResult> {
    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "codascope-project-import-"));
    let hiddenTarget: string | null = null;
    try {
      const opened = await openValidatedZipFile(zipPath, this.limits);
      const manifestEntry = opened.entries.get(PROJECT_BUNDLE_MANIFEST);
      if (!manifestEntry) {
        throw new ProjectBundleValidationError(
          "Unsupported project bundle format. Legacy raw project exports are not accepted.",
          "unsupported_project_bundle",
        );
      }
      const manifest = parseManifest(await readZipEntry(manifestEntry, MANIFEST_MAX_BYTES));
      validateArchiveEntries(opened.entries, manifest);

      const extractedDir = path.join(stagingRoot, "extracted");
      await extractValidatedZipFile(zipPath, extractedDir, this.limits);
      await verifyExtractedEntries(extractedDir, manifest);

      const sourceProjectDir = path.join(extractedDir, "project");
      const projectPath = path.join(sourceProjectDir, "project.json");
      const sourceProject = readPortableProject(projectPath);
      if (!sourceProject || sourceProject.id !== manifest.source.projectId) {
        throw new ProjectBundleValidationError("Invalid project bundle: manifest and project metadata do not match.");
      }
      if (sourceProject.repositories.some((repo) => repo.path !== "")) {
        throw new ProjectBundleValidationError("Invalid project bundle: repository paths must be remapped after import.");
      }

      const newId = randomUUID();
      const baseName = sourceProject.name || "Imported Project";
      const projectsRoot = this.projectSvc.getRoot();
      await this.projectSvc.ensureRootExists();
      const { targetDir, collision } = uniqueTargetDirectory(projectsRoot, baseName, newId);
      hiddenTarget = path.join(projectsRoot, `.codascope-import-${newId}`);
      const now = new Date().toISOString();
      const importedProject: PortableProject = {
        ...sanitizeProject(sourceProject),
        id: newId,
        name: collision ? `${baseName} (imported)` : baseName,
        updatedAt: now,
      };
      writeFileSync(projectPath, JSON.stringify(importedProject, null, 2), "utf-8");
      rebaseImportedProjectIdentifiers(sourceProjectDir, manifest.source.projectId, newId);

      await assertAvailableSpace(hiddenTarget, opened.totalUncompressedBytes);
      await cp(sourceProjectDir, hiddenTarget, { recursive: true, errorOnExist: true });
      await rename(hiddenTarget, targetDir);
      hiddenTarget = null;

      return {
        project: importedProject,
        needsRepoMapping: importedProject.repositories.length > 0,
        unmappedRepos: importedProject.repositories.map(({ id, name }) => ({ id, name, path: "" })),
      };
    } catch (error) {
      if (error instanceof ProjectBundleValidationError) throw error;
      if (isLikelyArchiveValidationError(error)) {
        throw new ProjectBundleValidationError(error instanceof Error ? error.message : "Invalid project bundle.");
      }
      throw error;
    } finally {
      if (hiddenTarget) await rm(hiddenTarget, { recursive: true, force: true });
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

function collectAllowlistedFiles(projectDir: string): string[] {
  const files: string[] = [];
  const visit = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = toZipPath(path.relative(projectDir, absolutePath));
      if (entry.isSymbolicLink()) {
        if (isAllowlistedProjectArtifact(relativePath)) {
          throw new Error(`Portable project bundles do not support symbolic links: "${relativePath}"`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (directoryCanContainSharedArtifacts(relativePath)) visit(absolutePath);
      } else if (entry.isFile() && isAllowlistedProjectArtifact(relativePath)) {
        files.push(absolutePath);
      }
    }
  };
  visit(projectDir);
  return files;
}

/** Explicit shared-artifact allowlist used by both export and import. */
export function isAllowlistedProjectArtifact(relativePath: string): boolean {
  if (relativePath === "project.json") return true;
  if (relativePath === "wiki-state.json") return true;
  if (/^code_map_[^/]+\.(?:md|meta\.json)$/.test(relativePath)) return true;
  if (/^(?:wiki|quality|skills|versions)\/.+/.test(relativePath)) return true;
  if (/^_notes\/shared\/.+/.test(relativePath)) return true;
  if (relativePath === "epics/epics.json") return true;

  const activeEpic = relativePath.match(/^epics\/([^/]+)\/(.+)$/);
  const archivedEpic = relativePath.match(/^epics\/_archive\/([^/]+)\/(.+)$/);
  const match = archivedEpic ?? activeEpic;
  if (!match || match[1].startsWith("_") || match[1].startsWith(".")) return false;
  const epicRelative = match[2];
  if (["epic.json", "definition.md", "scope.json"].includes(epicRelative)) return true;
  return /^(?:designs|annotations|directives|artifacts|versions|knowledge|curation)\/.+/.test(epicRelative)
    || /^_notes\/shared\/.+/.test(epicRelative);
}

function directoryCanContainSharedArtifacts(relativePath: string): boolean {
  const topLevel = relativePath.split("/")[0];
  if (!["wiki", "quality", "skills", "versions", "_notes", "epics"].includes(topLevel)) return false;
  if (relativePath === "_notes") return true;
  if (relativePath.startsWith("_notes/")) {
    return relativePath === "_notes/shared" || relativePath.startsWith("_notes/shared/");
  }
  if (relativePath.includes("/_notes/")) {
    const prefix = relativePath.slice(0, relativePath.indexOf("/_notes/") + 8);
    return relativePath === `${prefix}shared` || relativePath.startsWith(`${prefix}shared/`);
  }
  return true;
}

function parseManifest(content: Buffer): ProjectBundleManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf-8"));
  } catch {
    throw new ProjectBundleValidationError("Invalid project bundle manifest.");
  }
  if (!isRecord(parsed) || parsed.format !== PROJECT_BUNDLE_FORMAT) {
    throw new ProjectBundleValidationError("Unsupported project bundle format.", "unsupported_project_bundle");
  }
  if (parsed.formatVersion !== PROJECT_BUNDLE_VERSION) {
    throw new ProjectBundleValidationError(
      `Unsupported project bundle version: ${String(parsed.formatVersion)}.`,
      "unsupported_project_bundle_version",
    );
  }
  if (!isRecord(parsed.source)
    || typeof parsed.source.projectId !== "string"
    || !isRecord(parsed.includes)
    || parsed.includes.sharedArtifacts !== true
    || parsed.includes.conversations !== false
    || parsed.includes.conversationImages !== false
    || parsed.includes.privateNotes !== false
    || parsed.includes.userPreferences !== false
    || parsed.includes.actorOwnedExports !== false
    || parsed.includes.buildLogs !== false
    || parsed.includes.activeLocks !== false
    || parsed.includes.repositoryPaths !== false
    || !Array.isArray(parsed.entries)) {
    throw new ProjectBundleValidationError("Invalid project bundle manifest.");
  }
  const entries: ProjectBundleManifestEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed.entries) {
    if (!isRecord(candidate)
      || typeof candidate.path !== "string"
      || !Number.isSafeInteger(candidate.size)
      || Number(candidate.size) < 0
      || typeof candidate.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
      throw new ProjectBundleValidationError("Invalid project bundle manifest entry.");
    }
    if (!candidate.path.startsWith(PAYLOAD_PREFIX)) {
      throw new ProjectBundleValidationError(`Disallowed project bundle entry: "${candidate.path}"`);
    }
    const relativePath = candidate.path.slice(PAYLOAD_PREFIX.length);
    if (!isAllowlistedProjectArtifact(relativePath) || seen.has(candidate.path)) {
      throw new ProjectBundleValidationError(`Disallowed or duplicate project bundle entry: "${candidate.path}"`);
    }
    seen.add(candidate.path);
    entries.push(candidate as unknown as ProjectBundleManifestEntry);
  }
  if (!seen.has(`${PAYLOAD_PREFIX}project.json`)) {
    throw new ProjectBundleValidationError("Invalid project bundle: project/project.json is required.");
  }
  return { ...(parsed as unknown as ProjectBundleManifest), entries };
}

function validateArchiveEntries(entries: Map<string, unknown>, manifest: ProjectBundleManifest): void {
  const declared = new Set(manifest.entries.map((entry) => entry.path));
  for (const entryPath of entries.keys()) {
    if (entryPath === PROJECT_BUNDLE_MANIFEST) continue;
    if (!declared.has(entryPath)) {
      throw new ProjectBundleValidationError(`Unexpected project bundle entry: "${entryPath}"`);
    }
  }
  if (entries.size !== declared.size + 1) {
    const missing = [...declared].find((entryPath) => !entries.has(entryPath));
    throw new ProjectBundleValidationError(`Project bundle is missing declared entry: "${missing ?? "unknown"}"`);
  }
}

async function verifyExtractedEntries(extractedDir: string, manifest: ProjectBundleManifest): Promise<void> {
  for (const entry of manifest.entries) {
    const filePath = path.join(extractedDir, ...entry.path.split("/"));
    if (!existsSync(filePath)) {
      throw new ProjectBundleValidationError(`Project bundle is missing declared entry: "${entry.path}"`);
    }
    const info = statSync(filePath);
    if (!info.isFile() || info.size !== entry.size || await sha256File(filePath) !== entry.sha256) {
      throw new ProjectBundleValidationError(`Project bundle entry failed integrity validation: "${entry.path}"`);
    }
  }
}

function readPortableProject(projectPath: string): StoredProject | null {
  try {
    const parsed = JSON.parse(readFileSync(projectPath, "utf-8"));
    if (!isRecord(parsed)
      || typeof parsed.id !== "string"
      || typeof parsed.name !== "string"
      || typeof parsed.description !== "string"
      || typeof parsed.createdAt !== "string"
      || typeof parsed.updatedAt !== "string"
      || (parsed.archived !== undefined && typeof parsed.archived !== "boolean")
      || !Array.isArray(parsed.repositories)) return null;
    for (const repo of parsed.repositories) {
      if (!isRecord(repo)
        || typeof repo.id !== "string"
        || typeof repo.name !== "string"
        || typeof repo.path !== "string"
        || (repo.branch !== undefined && typeof repo.branch !== "string")) return null;
    }
    return parsed as unknown as StoredProject;
  } catch {
    return null;
  }
}

function sanitizeProject(project: StoredProject): PortableProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    repositories: project.repositories.map(({ id, name, branch }) => ({ id, name, path: "", ...(branch ? { branch } : {}) })),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...(project.archived !== undefined ? { archived: project.archived } : {}),
  };
}

function rebaseImportedProjectIdentifiers(projectDir: string, sourceProjectId: string, destinationProjectId: string): void {
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      const relativePath = toZipPath(path.relative(projectDir, entryPath));
      if (!entry.isFile() || !entry.name.endsWith(".json") || /\/knowledge\/sources\/[^/]+\/original\.json$/.test(`/${relativePath}`)) continue;
      try {
        const value = JSON.parse(readFileSync(entryPath, "utf-8"));
        if (rewriteProjectIds(value, sourceProjectId, destinationProjectId)) {
          writeFileSync(entryPath, JSON.stringify(value, null, 2), "utf-8");
        }
      } catch {
        throw new ProjectBundleValidationError(`Invalid CodaScope JSON metadata: "project/${relativePath}"`);
      }
    }
  };
  visit(projectDir);
}

function rewriteProjectIds(value: unknown, sourceProjectId: string, destinationProjectId: string): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (const item of value) changed = rewriteProjectIds(item, sourceProjectId, destinationProjectId) || changed;
    return changed;
  }
  if (!isRecord(value)) return false;
  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "projectId" && child === sourceProjectId) {
      value[key] = destinationProjectId;
      changed = true;
    } else {
      changed = rewriteProjectIds(child, sourceProjectId, destinationProjectId) || changed;
    }
  }
  return changed;
}

function preparedBufferEntry(entryPath: string, content: Buffer): PreparedEntry {
  return { path: entryPath, content, size: content.length, sha256: sha256Buffer(content) };
}

function sanitizePortableText(content: Buffer, sensitivePaths: string[], relativePath: string): Buffer {
  let text = content.toString("utf-8");
  for (const sensitivePath of [...new Set(sensitivePaths.filter((value) => path.isAbsolute(value)))].sort((a, b) => b.length - a.length)) {
    const replacements = new Set([sensitivePath, sensitivePath.split(path.sep).join("/"), sensitivePath.split(path.sep).join("\\\\")]);
    for (const value of replacements) text = text.split(value).join("[local-path-removed]");
  }
  if (relativePath.endsWith(".json") && !/\/knowledge\/sources\/[^/]+\/original\.json$/.test(`/${relativePath}`)) {
    try {
      const parsed = JSON.parse(text);
      clearConversationReferences(parsed);
      text = JSON.stringify(parsed, null, 2);
    } catch {
      // Import validation will reject malformed CodaScope metadata before any
      // destination project is installed.
    }
  }
  return Buffer.from(text, "utf-8");
}

function clearConversationReferences(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) clearConversationReferences(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "conversationId") value[key] = null;
    else clearConversationReferences(child);
  }
}

function isTextArtifact(relativePath: string): boolean {
  return /\.(?:md|json|txt|html|css|js|ts|tsx|jsx|yaml|yml|xml|svg|csv)$/i.test(relativePath);
}

function assertExportLimits(entries: PreparedEntry[], limits: ZipArchiveLimits): void {
  if (entries.length + 1 > limits.maxEntryCount) {
    throw new Error(`Project bundle exceeds the ${limits.maxEntryCount}-entry limit.`);
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.size > limits.maxEntryUncompressedBytes) {
      throw new Error(`Project bundle entry exceeds its size limit: "${entry.path}"`);
    }
    total += entry.size;
    if (total > limits.maxTotalUncompressedBytes) {
      throw new Error("Project bundle exceeds the expanded-content limit.");
    }
  }
}

function uniqueTargetDirectory(projectsRoot: string, projectName: string, fallback: string): { targetDir: string; collision: boolean } {
  const baseSlug = safeFilename(projectName) || fallback;
  let slug = baseSlug;
  let targetDir = path.join(projectsRoot, slug);
  let counter = 2;
  let collision = false;
  while (existsSync(targetDir)) {
    collision = true;
    slug = `${baseSlug}-${counter++}`;
    targetDir = path.join(projectsRoot, slug);
  }
  return { targetDir, collision };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function toZipPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLikelyArchiveValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return /ZIP|archive|bundle|entry|project\.json|metadata/i.test(error.message);
}
