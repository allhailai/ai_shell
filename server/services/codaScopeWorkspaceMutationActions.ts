/* ── CodaScope: Trusted Workspace Mutation Actions ──────────────────
   Typed server-only completion records. Model-authored action XML never
   enters this collector. Capacity is reserved before a mutation starts.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  normalizeCanonicalWorkspaceMutationAction,
  normalizeCanonicalWorkspaceMutationActions,
  WORKSPACE_NOTE_MAX_ACTIONS,
} from "../../src/apps/codascope/workspaceMutationActionValidation.js";
import type { WorkspaceNoteMutationOperation } from "../../src/apps/codascope/workspaceMutationActionValidation.js";
import type { CanonicalWorkspaceNoteRangeTarget } from "../../src/apps/codascope/workspaceNoteRangeTargetValidation.js";
import type { WorkspaceNoteDto } from "./codaScopeWorkspaceNoteService.js";

export interface WorkspaceMutationActionReservation {
  commitNoteCreated(note: WorkspaceNoteDto): void;
  commitNoteMutation(
    operation: WorkspaceNoteMutationOperation,
    note: WorkspaceNoteDto,
    description: string,
  ): void;
  commitNoteRangeMutation(
    note: WorkspaceNoteDto,
    target: CanonicalWorkspaceNoteRangeTarget,
    description: string,
  ): void;
  release(): void;
  abandon(): void;
}

export class WorkspaceMutationActionCollector {
  private readonly actions = new Map<number, CodaScopeAction>();
  private readonly delivered = new Set<string>();
  private readonly abandoned = new Set<number>();
  private activeReservations = 0;
  private nextOrder = 0;

  reserve(): WorkspaceMutationActionReservation | null {
    if (this.actions.size + this.abandoned.size + this.activeReservations
      >= WORKSPACE_NOTE_MAX_ACTIONS) {
      return null;
    }
    const order = this.nextOrder++;
    this.activeReservations += 1;
    let pending = true;

    const commit = (action: CodaScopeAction): void => {
      if (!pending) throw new Error("Workspace mutation receipt reservation is closed.");
      const canonical = validateWorkspaceMutationAction(action);
      pending = false;
      this.activeReservations -= 1;
      const key = deliveryKey(canonical);
      if (this.delivered.has(key)) return;
      this.delivered.add(key);
      this.actions.set(order, canonical);
    };

    return {
      commitNoteCreated: (note) => commit(canonicalAction(
        "note_created",
        note,
        `Created CodaScope note "${note.title}".`,
      )),
      commitNoteMutation: (operation, note, description) => commit(
        canonicalAction("operation_completed", note, description, { operation }),
      ),
      commitNoteRangeMutation: (note, target, description) => commit(
        canonicalAction("operation_completed", note, description, {
          operation: "replace_codascope_note_range",
          startLine: String(target.startLine),
          endLine: String(target.endLine),
        }),
      ),
      release: () => {
        if (!pending) return;
        pending = false;
        this.activeReservations -= 1;
      },
      abandon: () => {
        if (!pending) return;
        pending = false;
        this.activeReservations -= 1;
        this.abandoned.add(order);
      },
    };
  }

  drain(): CodaScopeAction[] {
    const result = [...this.actions.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, action]) => action);
    this.actions.clear();
    this.delivered.clear();
    this.abandoned.clear();
    this.activeReservations = 0;
    this.nextOrder = 0;
    return result;
  }

  clear(): void {
    this.actions.clear();
    this.delivered.clear();
    this.abandoned.clear();
    this.activeReservations = 0;
    this.nextOrder = 0;
  }
}

export class WorkspaceMutationActionCollectorHolder {
  current = new WorkspaceMutationActionCollector();

  reserve(): WorkspaceMutationActionReservation | null {
    return this.current.reserve();
  }

  clear(): void {
    this.current.clear();
    this.current = new WorkspaceMutationActionCollector();
  }
}

export function validateWorkspaceMutationActions(
  value: unknown,
): CodaScopeAction[] {
  const actions = normalizeCanonicalWorkspaceMutationActions(value);
  if (!actions) throw new Error("Invalid workspace mutation actions.");
  return actions;
}

export function validateWorkspaceMutationAction(
  value: unknown,
): CodaScopeAction {
  const action = normalizeCanonicalWorkspaceMutationAction(value);
  if (!action) throw new Error("Invalid workspace mutation action.");
  return action;
}

function canonicalAction(
  type: "note_created" | "operation_completed",
  note: WorkspaceNoteDto,
  description: string,
  extra: Record<string, string> = {},
): CodaScopeAction {
  return {
    type,
    attributes: {
      ...extra,
      stableId: note.stableId,
      scope: "codascope",
      visibility: note.visibility,
      path: note.path,
      title: note.title,
      contentHash: note.contentHash,
    },
    description,
  };
}

function deliveryKey(action: CodaScopeAction): string {
  return [
    action.type,
    action.attributes.operation ?? "",
    action.attributes.stableId,
    action.attributes.contentHash,
    action.description,
  ].join("\u0000");
}
