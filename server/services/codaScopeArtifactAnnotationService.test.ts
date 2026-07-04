/* ── CodaScope: Artifact Annotation Service Tests ────────────────────
   Unit tests for CodaScopeArtifactAnnotationService.
   Exercises CRUD, soft cap enforcement, status lifecycle
   (pending → applied/failed, toggle, retry), and write-lock
   serialization.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeArtifactAnnotationService } from "./codaScopeArtifactAnnotationService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `art-ann-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
}

function scaffoldProject(root: string, projectId: string, epicId: string, artifactId: string): string {
  const projectDir = path.join(root, `project-${projectId}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: "Test Project" }),
    "utf-8",
  );

  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });

  // Create the artifact builds directory
  const buildsDir = path.join(epicDir, "artifacts", artifactId, "builds");
  mkdirSync(buildsDir, { recursive: true });

  return projectDir;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeArtifactAnnotationService", () => {
  let root: string;
  let svc: CodaScopeArtifactAnnotationService;
  const projectId = "proj1";
  const epicId = "epic1";
  const artifactId = "art1";

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeArtifactAnnotationService(root);
    scaffoldProject(root, projectId, epicId, artifactId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── addAnnotation ─────────────────────────────────────────────

  describe("addAnnotation", () => {
    it("creates an annotation with correct defaults", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero Section",
        instruction: "Make the title larger",
      });

      expect(ann.id).toBeTruthy();
      expect(ann.sectionId).toBe("hero");
      expect(ann.sectionTitle).toBe("Hero Section");
      expect(ann.instruction).toBe("Make the title larger");
      expect(ann.status).toBe("pending");
      expect(ann.previouslyApplied).toBe(false);
      expect(ann.type).toBe("modify");
      expect(ann.elementContext).toBeNull();
    });

    it("stores element context when provided", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "data_matrix",
        sectionTitle: "Data Matrix",
        instruction: "Add a column for revenue",
        elementContext: {
          elementTag: "table",
          cssPath: "#data_matrix > table",
          elementText: "Cell 1",
        },
      });

      expect(ann.elementContext).not.toBeNull();
      expect(ann.elementContext!.elementTag).toBe("table");
      expect(ann.elementContext!.cssPath).toBe("#data_matrix > table");
    });

    it("supports add_section type with afterSectionId", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "new_section",
        sectionTitle: "New Section",
        instruction: "Add a metrics dashboard section",
        type: "add_section",
        afterSectionId: "hero",
      });

      expect(ann.type).toBe("add_section");
      expect(ann.afterSectionId).toBe("hero");
    });
  });

  // ── Soft cap ──────────────────────────────────────────────────

  describe("soft cap enforcement", () => {
    it("rejects the 21st pending annotation", async () => {
      // Add 20 annotations (the soft cap)
      for (let i = 0; i < 20; i++) {
        await svc.addAnnotation(projectId, epicId, artifactId, {
          sectionId: "hero",
          sectionTitle: "Hero",
          instruction: `Change #${i + 1}`,
        });
      }

      // The 21st should be rejected
      await expect(
        svc.addAnnotation(projectId, epicId, artifactId, {
          sectionId: "hero",
          sectionTitle: "Hero",
          instruction: "One too many",
        }),
      ).rejects.toThrow("Annotation limit reached");
    });

    it("allows adding after some are applied (not pending)", async () => {
      // Add 20 pending
      const annotations = [];
      for (let i = 0; i < 20; i++) {
        annotations.push(
          await svc.addAnnotation(projectId, epicId, artifactId, {
            sectionId: "hero",
            sectionTitle: "Hero",
            instruction: `Change #${i + 1}`,
          }),
        );
      }

      // Mark first 5 as applied
      await svc.markApplied(projectId, epicId, artifactId, annotations.slice(0, 5).map((a) => a.id));

      // Now adding should succeed (only 15 pending)
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "This should work",
      });
      expect(ann.status).toBe("pending");
    });
  });

  // ── listAnnotations ──────────────────────────────────────────

  describe("listAnnotations", () => {
    it("lists all annotations for an artifact", async () => {
      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "s1",
        sectionTitle: "S1",
        instruction: "First",
      });
      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "s2",
        sectionTitle: "S2",
        instruction: "Second",
      });

      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      expect(list).toHaveLength(2);
    });

    it("returns empty array for artifact with no annotations", async () => {
      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      expect(list).toEqual([]);
    });
  });

  // ── updateAnnotation ──────────────────────────────────────────

  describe("updateAnnotation", () => {
    it("updates instruction text", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Original",
      });

      const updated = await svc.updateAnnotation(projectId, epicId, artifactId, ann.id, {
        instruction: "Updated instruction",
      });

      expect(updated).not.toBeNull();
      expect(updated!.instruction).toBe("Updated instruction");
    });

    it("updates element context", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Test",
      });

      const updated = await svc.updateAnnotation(projectId, epicId, artifactId, ann.id, {
        elementContext: { elementTag: "div", cssPath: ".hero-content" },
      });

      expect(updated!.elementContext).not.toBeNull();
      expect(updated!.elementContext!.elementTag).toBe("div");
    });

    it("returns null for nonexistent annotation", async () => {
      const result = await svc.updateAnnotation(projectId, epicId, artifactId, "nonexistent", {
        instruction: "Test",
      });
      expect(result).toBeNull();
    });
  });

  // ── deleteAnnotation ──────────────────────────────────────────

  describe("deleteAnnotation", () => {
    it("deletes an annotation", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Delete me",
      });

      const deleted = await svc.deleteAnnotation(projectId, epicId, artifactId, ann.id);
      expect(deleted).toBe(true);

      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      expect(list).toHaveLength(0);
    });

    it("returns false for nonexistent annotation", async () => {
      const result = await svc.deleteAnnotation(projectId, epicId, artifactId, "nonexistent");
      expect(result).toBe(false);
    });
  });

  // ── Status lifecycle ──────────────────────────────────────────

  describe("status lifecycle", () => {
    it("toggles pending → inactive", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Toggle me",
      });

      const toggled = await svc.toggleAnnotation(projectId, epicId, artifactId, ann.id);
      expect(toggled!.status).toBe("inactive");
    });

    it("toggles inactive → pending", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Toggle back",
      });

      await svc.toggleAnnotation(projectId, epicId, artifactId, ann.id); // → inactive
      const toggled = await svc.toggleAnnotation(projectId, epicId, artifactId, ann.id); // → pending
      expect(toggled!.status).toBe("pending");
    });

    it("toggles applied → pending and sets previouslyApplied", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Reactivate",
      });

      await svc.markApplied(projectId, epicId, artifactId, [ann.id]);
      const toggled = await svc.toggleAnnotation(projectId, epicId, artifactId, ann.id);
      expect(toggled!.status).toBe("pending");
      expect(toggled!.previouslyApplied).toBe(true);
    });

    it("retryFailed resets failed → pending", async () => {
      const ann1 = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "s1",
        sectionTitle: "S1",
        instruction: "Fail 1",
      });
      const ann2 = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "s2",
        sectionTitle: "S2",
        instruction: "Fail 2",
      });

      await svc.markFailed(projectId, epicId, artifactId, [ann1.id, ann2.id]);

      const count = await svc.retryFailed(projectId, epicId, artifactId);
      expect(count).toBe(2);

      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      expect(list.every((a) => a.status === "pending")).toBe(true);
    });

    it("markApplied sets status and previouslyApplied", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Apply me",
      });

      await svc.markApplied(projectId, epicId, artifactId, [ann.id]);

      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      const applied = list.find((a) => a.id === ann.id);
      expect(applied!.status).toBe("applied");
      expect(applied!.previouslyApplied).toBe(true);
    });

    it("markFailed sets status to failed", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Fail me",
      });

      await svc.markFailed(projectId, epicId, artifactId, [ann.id]);

      const list = await svc.listAnnotations(projectId, epicId, artifactId);
      const failed = list.find((a) => a.id === ann.id);
      expect(failed!.status).toBe("failed");
    });
  });

  // ── getPendingBySection ──────────────────────────────────────

  describe("getPendingBySection", () => {
    it("groups pending annotations by sectionId", async () => {
      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Hero change 1",
      });
      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Hero change 2",
      });
      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "data",
        sectionTitle: "Data",
        instruction: "Data change 1",
      });

      const grouped = await svc.getPendingBySection(projectId, epicId, artifactId);
      expect(grouped).toHaveLength(2);

      const heroGroup = grouped.find((g) => g.sectionId === "hero");
      expect(heroGroup!.annotations).toHaveLength(2);

      const dataGroup = grouped.find((g) => g.sectionId === "data");
      expect(dataGroup!.annotations).toHaveLength(1);
    });

    it("excludes non-pending annotations", async () => {
      const ann = await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Applied",
      });
      await svc.markApplied(projectId, epicId, artifactId, [ann.id]);

      await svc.addAnnotation(projectId, epicId, artifactId, {
        sectionId: "hero",
        sectionTitle: "Hero",
        instruction: "Pending",
      });

      const grouped = await svc.getPendingBySection(projectId, epicId, artifactId);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].annotations).toHaveLength(1);
      expect(grouped[0].annotations[0].instruction).toBe("Pending");
    });
  });
});
