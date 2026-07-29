import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  normalizeCanonicalProjectNoteRangeAction,
  PROJECT_NOTE_RANGE_OPERATION,
} from "../../src/apps/codascope/projectNoteRangeMutationActionValidation.js";
import type { CanonicalProjectNoteRangeTarget } from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";
import type { ProjectNoteRangeMutationResult } from "./codaScopeProjectNoteRangeService.js";

export interface ProjectNoteRangeActionReservation {
  commit(
    note: ProjectNoteRangeMutationResult,
    target: CanonicalProjectNoteRangeTarget,
  ): void;
  release(): void;
}

export class ProjectNoteRangeActionCollector {
  private action: CodaScopeAction | null = null;
  private reserved = false;

  reserve(): ProjectNoteRangeActionReservation | null {
    if (this.action || this.reserved) return null;
    this.reserved = true;
    let open = true;
    return {
      commit: (note, target) => {
        if (!open) throw new Error("Project note-range action reservation is closed.");
        open = false;
        this.reserved = false;
        const candidate: CodaScopeAction = {
          type: "operation_completed",
          attributes: {
            operation: PROJECT_NOTE_RANGE_OPERATION,
            stableId: note.stableId,
            scope: note.scope,
            visibility: note.visibility,
            projectId: note.projectId,
            ...(note.scope === "epic" ? { epicId: note.epicId! } : {}),
            path: note.path,
            title: note.title,
            contentHash: note.contentHash,
            startLine: String(target.startLine),
            endLine: String(target.endLine),
          },
          description:
            `Replaced selected lines ${target.startLine}-${target.endLine} `
            + `in note "${note.title}".`,
        };
        const canonical = normalizeCanonicalProjectNoteRangeAction(candidate);
        if (!canonical) {
          throw new Error("Invalid project note-range completion action.");
        }
        this.action = canonical;
      },
      release: () => {
        if (!open) return;
        open = false;
        this.reserved = false;
      },
    };
  }

  drain(): CodaScopeAction[] {
    const result = this.action ? [this.action] : [];
    this.clear();
    return result;
  }

  clear(): void {
    this.action = null;
    this.reserved = false;
  }
}

export class ProjectNoteRangeActionCollectorHolder {
  current = new ProjectNoteRangeActionCollector();

  reserve(): ProjectNoteRangeActionReservation | null {
    return this.current.reserve();
  }

  clear(): void {
    this.current.clear();
    this.current = new ProjectNoteRangeActionCollector();
  }
}
