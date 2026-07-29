import type { CanonicalProjectNoteRangeTarget } from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";

export interface ProjectNoteRangeGrantReservation {
  target: CanonicalProjectNoteRangeTarget;
  commit(): void;
  release(): void;
}

/** Stable per-pool holder whose current grant is replaced for every run. */
export class ProjectNoteRangeGrantHolder {
  private target: CanonicalProjectNoteRangeTarget | null = null;
  private consumed = false;
  private reserved = false;

  replace(target: CanonicalProjectNoteRangeTarget | null): void {
    this.clear();
    if (target) this.target = Object.freeze({ ...target });
  }

  clear(): void {
    this.target = null;
    this.consumed = false;
    this.reserved = false;
  }

  hasActiveTarget(): boolean {
    return this.target !== null;
  }

  reserve(): ProjectNoteRangeGrantReservation | null {
    if (!this.target || this.consumed || this.reserved) return null;
    const target = this.target;
    this.reserved = true;
    let open = true;
    return {
      target,
      commit: () => {
        if (!open) return;
        open = false;
        this.reserved = false;
        this.consumed = true;
      },
      release: () => {
        if (!open) return;
        open = false;
        this.reserved = false;
      },
    };
  }
}
