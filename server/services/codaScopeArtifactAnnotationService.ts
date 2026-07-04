/* ── CodaScope: Artifact Annotation Service ──────────────────────────
   CRUD for visual artifact annotations (DOM-level feedback).

   Ported from KissAI's annotationService.js with TypeScript typing,
   class-based structure, and CodaScope conventions.

   Responsibilities:
   - Write-lock serialization per artifact (prevents TOCTOU races)
   - Annotation CRUD (add, update, delete, list)
   - Soft cap enforcement (max 20 pending annotations)
   - Status lifecycle: pending → applied | failed | inactive
   - Toggle (active ↔ inactive), retry (failed → pending), batch apply
   - Element context storage (cssPath, elementTag, elementId, etc.)

   Storage:
   <builds>/.artifact-annotations.json
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ArtifactAnnotation, ArtifactElementContext } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Constants ────────────────────────────────────────────────────── */

const ANNOTATIONS_FILE = ".artifact-annotations.json";
const SOFT_CAP = 20;

/* ── Per-artifact write lock ──────────────────────────────────────── */

const writeLocks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  writeLocks.set(key, next);
  try {
    await prev;
    return await fn();
  } finally {
    release!();
  }
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeArtifactAnnotationService {
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

  private annotationsPath(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(projectDir, "epics", epicId, "artifacts", artifactId, "builds", ANNOTATIONS_FILE);
  }

  private lockKey(projectId: string, epicId: string, artifactId: string): string {
    return `${projectId}:${epicId}:${artifactId}`;
  }

  /* ── File I/O helpers ────────────────────────────────────────────── */

  private readAnnotations(projectDir: string, epicId: string, artifactId: string): ArtifactAnnotation[] {
    const p = this.annotationsPath(projectDir, epicId, artifactId);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return [];
    }
  }

  private writeAnnotations(projectDir: string, epicId: string, artifactId: string, annotations: ArtifactAnnotation[]): void {
    const filePath = this.annotationsPath(projectDir, epicId, artifactId);
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(annotations, null, 2), "utf-8");
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all annotations for an artifact. */
  async listAnnotations(projectId: string, epicId: string, artifactId: string): Promise<ArtifactAnnotation[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readAnnotations(projectDir, epicId, artifactId);
  }

  /**
   * Add a new annotation.
   * Enforces the soft cap: rejects if >= 20 pending annotations exist.
   */
  async addAnnotation(projectId: string, epicId: string, artifactId: string, data: {
    sectionId: string;
    sectionTitle: string;
    instruction: string;
    elementContext?: ArtifactElementContext | null;
    type?: "modify" | "add_section";
    afterSectionId?: string | null;
  }): Promise<ArtifactAnnotation> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const pendingCount = annotations.filter((a) => a.status === "pending").length;

      if (pendingCount >= SOFT_CAP) {
        throw new Error(
          `Annotation limit reached (${SOFT_CAP}). Regenerate or remove existing annotations before adding more.`,
        );
      }

      const now = new Date().toISOString();
      const annotation: ArtifactAnnotation = {
        id: crypto.randomBytes(8).toString("hex"),
        sectionId: data.sectionId,
        sectionTitle: data.sectionTitle,
        instruction: data.instruction,
        elementContext: data.elementContext ?? null,
        status: "pending",
        previouslyApplied: false,
        type: data.type ?? "modify",
        createdAt: now,
        updatedAt: now,
      };

      // Support add_section type
      if (annotation.type === "add_section") {
        annotation.afterSectionId = data.afterSectionId ?? null;
      }

      annotations.push(annotation);
      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
      return annotation;
    });
  }

  /** Update an existing annotation's instruction and/or elementContext. */
  async updateAnnotation(projectId: string, epicId: string, artifactId: string, annotationId: string, updates: {
    instruction?: string;
    elementContext?: ArtifactElementContext | null;
  }): Promise<ArtifactAnnotation | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const annotation = annotations.find((a) => a.id === annotationId);
      if (!annotation) return null;

      if (updates.instruction !== undefined) annotation.instruction = updates.instruction;
      if (updates.elementContext !== undefined) annotation.elementContext = updates.elementContext ?? null;
      annotation.updatedAt = new Date().toISOString();

      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
      return annotation;
    });
  }

  /** Delete an annotation by ID. */
  async deleteAnnotation(projectId: string, epicId: string, artifactId: string, annotationId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const idx = annotations.findIndex((a) => a.id === annotationId);
      if (idx === -1) return false;

      annotations.splice(idx, 1);
      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
      return true;
    });
  }

  /* ── Status lifecycle ──────────────────────────────────────────── */

  /**
   * Toggle annotation status:
   *   pending → inactive (deactivated, removed from regen queue)
   *   applied/failed/inactive → pending (re-queued)
   */
  async toggleAnnotation(projectId: string, epicId: string, artifactId: string, annotationId: string): Promise<ArtifactAnnotation | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const annotation = annotations.find((a) => a.id === annotationId);
      if (!annotation) return null;

      if (annotation.status === "pending") {
        annotation.status = "inactive";
      } else {
        const wasApplied = annotation.status === "applied";
        annotation.status = "pending";
        annotation.previouslyApplied = wasApplied || annotation.previouslyApplied;
      }
      annotation.updatedAt = new Date().toISOString();

      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
      return annotation;
    });
  }

  /** Reset all failed annotations back to pending. */
  async retryFailed(projectId: string, epicId: string, artifactId: string): Promise<number> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return 0;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const now = new Date().toISOString();
      let count = 0;

      for (const a of annotations) {
        if (a.status === "failed") {
          a.status = "pending";
          a.updatedAt = now;
          count++;
        }
      }

      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
      return count;
    });
  }

  /**
   * Mark specific annotations as applied.
   * Called after successful section regeneration.
   */
  async markApplied(projectId: string, epicId: string, artifactId: string, annotationIds: string[]): Promise<void> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const now = new Date().toISOString();

      for (const a of annotations) {
        if (annotationIds.includes(a.id)) {
          a.status = "applied";
          a.previouslyApplied = true;
          a.updatedAt = now;
        }
      }

      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
    });
  }

  /**
   * Mark specific annotations as failed.
   * Called when section regeneration fails for those annotations.
   */
  async markFailed(projectId: string, epicId: string, artifactId: string, annotationIds: string[]): Promise<void> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return;

    return withLock(this.lockKey(projectId, epicId, artifactId), async () => {
      const annotations = this.readAnnotations(projectDir, epicId, artifactId);
      const now = new Date().toISOString();

      for (const a of annotations) {
        if (annotationIds.includes(a.id)) {
          a.status = "failed";
          a.updatedAt = now;
        }
      }

      this.writeAnnotations(projectDir, epicId, artifactId, annotations);
    });
  }

  /** Get pending annotations grouped by sectionId (for batch regeneration). */
  async getPendingBySection(projectId: string, epicId: string, artifactId: string): Promise<Array<{ sectionId: string; annotations: ArtifactAnnotation[] }>> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const annotations = this.readAnnotations(projectDir, epicId, artifactId);
    const pending = annotations.filter((a) => a.status === "pending");

    const grouped = new Map<string, ArtifactAnnotation[]>();
    for (const a of pending) {
      if (!grouped.has(a.sectionId)) grouped.set(a.sectionId, []);
      grouped.get(a.sectionId)!.push(a);
    }

    return Array.from(grouped.entries()).map(([sectionId, anns]) => ({
      sectionId,
      annotations: anns,
    }));
  }
}
