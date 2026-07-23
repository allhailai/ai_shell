/* ── CodaScope: Epic Bundle Service ────────────────────────────────────
   Creates and imports portable, fork-only epic ZIP archives.

   A bundle contains the epic directory and a versioned manifest, but never
   project-wide conversations or ephemeral edit locks. Import always assigns a
   fresh epic ID and attaches one new index entry to the destination project.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import type { EpicDesign } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import {
  assertAvailableSpace,
  extractValidatedZipFile,
  PROJECT_ARCHIVE_LIMITS,
} from "./codaScopeZipArchiveService.js";
import {
  assertSafeImportedPathTree,
  assertSafePathSegment,
  assertStrictDescendant,
} from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  codaScopePersistence,
} from "./codaScopePersistence.js";
import {
  epicStorageMutationKey,
  readActiveEpicsIndex,
  validateEpicsIndex,
} from "./codaScopeEpicStorage.js";
import { validateEpicAnnotationsFile } from "./codaScopeAnnotationService.js";

const MANIFEST_FILENAME = "codascope-epic-manifest.json";
const PAYLOAD_DIRECTORY = "epic";

interface EpicBundleManifest {
  format: "codascope-epic";
  formatVersion: 1;
  exportedAt: string;
  source: {
    projectId: string;
    epicId: string;
  };
  includes: {
    conversations: false;
    locks: false;
  };
}

interface EpicMetadata extends EpicDesign {
  conversationId?: string | null;
}

interface EpicsIndex {
  epics: EpicDesign[];
}

export interface EpicBundleImportResult {
  epic: EpicDesign;
  unresolvedScopeEntries: Array<{ topicId: string; topicTitle: string }>;
}

export interface EpicBundleExport {
  archive: ZipArchive;
  filename: string;
}

export class CodaScopeEpicBundleService {
  constructor(
    private projectSvc: CodaScopeProjectService,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {}

  /** Build a ZIP stream for one active epic, excluding locks and chat history. */
  createExport(projectId: string, epicId: string): EpicBundleExport | null {
    const projectDir = this.projectSvc.getProjectDir(projectId);
    if (!projectDir) return null;
    const epicsRoot = path.join(projectDir, "epics");
    const epicDir = assertStrictDescendant(
      epicsRoot,
      path.join(epicsRoot, assertSafePathSegment(epicId, "epic ID")),
      "epic export source",
    );
    const metadataPath = path.join(epicDir, "epic.json");
    if (!existsSync(metadataPath)) return null;

    const metadata = this.readMetadata(metadataPath);
    if (!metadata || metadata.id !== epicId) return null;

    const manifest: EpicBundleManifest = {
      format: "codascope-epic",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      source: { projectId, epicId },
      includes: { conversations: false, locks: false },
    };
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_FILENAME });
    this.appendEpicPayload(archive, epicDir);

    return {
      archive,
      filename: `codascope_epic_${safeFilename(metadata.title || epicId)}.zip`,
    };
  }

  /**
   * Import one epic archive into an existing project. The archive is extracted
   * only into a temporary staging directory, then moved into the project once
   * validation and identifier rebasing have completed.
   */
  async importEpic(projectId: string, zipPath: string): Promise<EpicBundleImportResult> {
    const projectDir = this.projectSvc.getProjectDir(projectId);
    if (!projectDir) throw new Error("Destination project not found.");

    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "codascope-epic-import-"));
    try {
      const extractedDir = path.join(stagingRoot, "extracted");
      const archive = await extractValidatedZipFile(zipPath, extractedDir, PROJECT_ARCHIVE_LIMITS);
      const manifest = this.readManifest(path.join(extractedDir, MANIFEST_FILENAME));
      const sourceEpicDir = path.join(extractedDir, PAYLOAD_DIRECTORY);
      const sourceMetadataPath = path.join(sourceEpicDir, "epic.json");
      if (!existsSync(sourceMetadataPath)) {
        throw new Error("Invalid epic archive: epic/epic.json not found.");
      }

      const sourceMetadata = this.readMetadata(sourceMetadataPath);
      if (!sourceMetadata || sourceMetadata.id !== manifest.source.epicId) {
        throw new Error("Invalid epic archive: manifest and epic metadata do not match.");
      }
      if (sourceMetadata.projectId !== manifest.source.projectId) {
        throw new Error("Invalid epic archive: source project identity does not match epic metadata.");
      }

      return await this.persistence.withMutation(epicStorageMutationKey(projectDir, this.persistence), async () => {
        const index = await this.readIndex(projectDir, projectId);
        const newEpicId = this.newEpicId(projectDir);
        this.rebasePayloadIdentifiers(
          sourceEpicDir,
          manifest.source.projectId,
          manifest.source.epicId,
          projectId,
          newEpicId,
        );
        this.validateAnnotationPayload(sourceEpicDir, newEpicId);
        const importedMetadata = this.readMetadata(sourceMetadataPath);
        if (!importedMetadata) throw new Error("Invalid epic archive: rebased metadata could not be read.");
        const importedAt = new Date().toISOString();
        importedMetadata.id = newEpicId;
        importedMetadata.projectId = projectId;
        importedMetadata.conversationId = null;
        importedMetadata.createdAt = importedAt;
        importedMetadata.updatedAt = importedAt;
        await writeFile(sourceMetadataPath, JSON.stringify(importedMetadata, null, 2), "utf-8");
        assertSafeImportedPathTree(sourceEpicDir, "epic");

        const epicsDir = path.join(projectDir, "epics");
        await mkdir(epicsDir, { recursive: true });
        await assertAvailableSpace(projectDir, archive.totalUncompressedBytes);
        const targetEpicDir = assertStrictDescendant(
          epicsDir,
          path.join(epicsDir, assertSafePathSegment(newEpicId, "epic ID")),
          "epic import target",
        );
        await moveDirectory(sourceEpicDir, targetEpicDir);

        try {
        const { conversationId: _conversationId, ...epic } = importedMetadata;
        index.epics.push(epic);
        await this.writeIndex(projectDir, index);
        return {
          epic,
          unresolvedScopeEntries: this.getUnresolvedScopeEntries(projectDir, targetEpicDir),
        };
        } catch (error) {
          await rm(targetEpicDir, { recursive: true, force: true });
          throw error;
        }
      });
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private appendEpicPayload(archive: ZipArchive, epicDir: string, currentDir = epicDir): void {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(epicDir, entryPath);
      if (entry.isDirectory()) {
        this.appendEpicPayload(archive, epicDir, entryPath);
        continue;
      }
      if (!entry.isFile() || relativePath === "locks.json") continue;

      const archivePath = `${PAYLOAD_DIRECTORY}/${toZipPath(relativePath)}`;
      if (relativePath === "epic.json") {
        const metadata = this.readMetadata(entryPath);
        if (!metadata) throw new Error("Epic metadata is corrupted.");
        archive.append(JSON.stringify({ ...metadata, conversationId: null }, null, 2), { name: archivePath });
      } else {
        archive.file(entryPath, { name: archivePath });
      }
    }
  }

  private newEpicId(projectDir: string): string {
    const epicsDir = path.join(projectDir, "epics");
    let epicId = "";
    do {
      epicId = `epic_${randomBytes(6).toString("hex")}`;
    } while (existsSync(path.join(epicsDir, epicId)));
    return epicId;
  }

  private readManifest(manifestPath: string): EpicBundleManifest {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      throw new Error(`Invalid epic archive: ${MANIFEST_FILENAME} not found or malformed.`);
    }
    if (!isRecord(parsed)
      || parsed.format !== "codascope-epic"
      || parsed.formatVersion !== 1
      || !isRecord(parsed.source)
      || typeof parsed.source.projectId !== "string"
      || typeof parsed.source.epicId !== "string") {
      throw new Error("Invalid epic archive manifest.");
    }
    return parsed as unknown as EpicBundleManifest;
  }

  private readMetadata(metadataPath: string): EpicMetadata | null {
    try {
      const parsed = JSON.parse(readFileSync(metadataPath, "utf-8"));
      if (!isRecord(parsed)
        || typeof parsed.id !== "string"
        || typeof parsed.projectId !== "string"
        || typeof parsed.title !== "string"
        || typeof parsed.status !== "string"
        || !Array.isArray(parsed.collaborators)) return null;
      return parsed as unknown as EpicMetadata;
    } catch {
      return null;
    }
  }

  private readIndex(projectDir: string, projectId: string): Promise<EpicsIndex> {
    return readActiveEpicsIndex(this.persistence, projectDir, projectId);
  }

  private async writeIndex(projectDir: string, index: EpicsIndex): Promise<void> {
    const indexPath = path.join(projectDir, "epics", "epics.json");
    validateEpicsIndex(index);
    await this.persistence.writeJson(indexPath, index, { storage: "epic_index" });
  }

  /** Rewrite only values that explicitly refer to the source project or epic. */
  private rebasePayloadIdentifiers(
    epicDir: string,
    sourceProjectId: string,
    sourceEpicId: string,
    destinationProjectId: string,
    destinationEpicId: string,
  ): void {
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(readFileSync(entryPath, "utf-8"));
          if (rewriteIdentifierReferences(parsed, sourceProjectId, sourceEpicId, destinationProjectId, destinationEpicId)) {
            // Sync write is bounded by one JSON metadata file and keeps the
            // staging transformation complete before the directory is moved.
            writeFileSync(entryPath, JSON.stringify(parsed, null, 2), "utf-8");
          }
        } catch {
          // Preserve unrelated or malformed JSON source material as-is.
        }
      }
    };
    visit(epicDir);
  }

  private getUnresolvedScopeEntries(
    projectDir: string,
    epicDir: string,
  ): Array<{ topicId: string; topicTitle: string }> {
    const scopePath = path.join(epicDir, "scope.json");
    if (!existsSync(scopePath)) return [];

    try {
      const scope = JSON.parse(readFileSync(scopePath, "utf-8"));
      if (!isRecord(scope) || !Array.isArray(scope.entries)) return [];
      const wikiDir = path.join(projectDir, "wiki");
      const availableTopicIds = existsSync(wikiDir)
        ? new Set(readdirSync(wikiDir)
          .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
          .map((name) => name.replace(/\.md$/, "")))
        : new Set<string>();

      return scope.entries.flatMap((entry) => {
        if (!isRecord(entry)
          || entry.type !== "existing-wiki"
          || typeof entry.topicId !== "string"
          || availableTopicIds.has(entry.topicId)) return [];
        return [{
          topicId: entry.topicId,
          topicTitle: typeof entry.topicTitle === "string" ? entry.topicTitle : entry.topicId,
        }];
      });
    } catch {
      return [];
    }
  }

  private validateAnnotationPayload(epicDir: string, epicId: string): void {
    const annotationsDir = path.join(epicDir, "annotations");
    if (!existsSync(annotationsDir)) return;
    const annotationIds = new Set<string>();
    for (const filename of readdirSync(annotationsDir).sort()) {
      if (!filename.endsWith("-annotations.json")) continue;
      const documentId = filename.slice(0, -"-annotations.json".length);
      assertSafePathSegment(documentId, "document ID");
      const filePath = path.join(annotationsDir, filename);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8"));
        const validated = validateEpicAnnotationsFile(parsed, epicId, documentId);
        for (const annotation of validated.annotations) {
          if (annotationIds.has(annotation.id)) {
            throw new Error(`duplicate epic annotation ID: ${annotation.id}`);
          }
          annotationIds.add(annotation.id);
        }
      } catch {
        throw new Error(`Invalid epic archive: annotation file "${filename}" is malformed or unsupported.`);
      }
    }
  }
}

async function moveDirectory(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(source, target, { recursive: true, errorOnExist: true });
    await rm(source, { recursive: true, force: true });
  }
}

function rewriteIdentifierReferences(
  value: unknown,
  sourceProjectId: string,
  sourceEpicId: string,
  destinationProjectId: string,
  destinationEpicId: string,
): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (const item of value) {
      changed = rewriteIdentifierReferences(item, sourceProjectId, sourceEpicId, destinationProjectId, destinationEpicId) || changed;
    }
    return changed;
  }
  if (!isRecord(value)) return false;

  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "projectId" && child === sourceProjectId) {
      value[key] = destinationProjectId;
      changed = true;
      continue;
    }
    if (key === "epicId" && child === sourceEpicId) {
      value[key] = destinationEpicId;
      changed = true;
      continue;
    }
    changed = rewriteIdentifierReferences(child, sourceProjectId, sourceEpicId, destinationProjectId, destinationEpicId) || changed;
  }
  return changed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "epic";
}

function toZipPath(value: string): string {
  return value.split(path.sep).join("/");
}
