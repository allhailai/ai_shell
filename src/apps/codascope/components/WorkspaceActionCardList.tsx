import type { CodaScopeAction } from "../codaScopeTypes";
import {
  normalizeCanonicalWorkspaceMutationActions,
} from "../workspaceMutationActionValidation";
import {
  distinctWorkspaceCreatedNoteActions,
} from "../workspaceCreatedNote";
import { IconCheck } from "./CodaScopeIcons";
import { WorkspaceCreatedNoteCard } from "./WorkspaceCreatedNoteCard";

export function WorkspaceActionCardList({
  actions: value,
}: {
  actions: unknown;
}) {
  const actions = normalizeCanonicalWorkspaceMutationActions(value);
  if (!actions || actions.length === 0) return null;
  const created = distinctWorkspaceCreatedNoteActions(actions);
  const completed = actions.filter((action) =>
    action.type === "operation_completed");
  return (
    <div className="codascope-action-cards">
      {created.map((action) => (
        <WorkspaceCreatedNoteCard
          key={action.attributes.stableId}
          action={action}
        />
      ))}
      {completed.map((action) => (
        <WorkspaceCompletedOperationCard
          key={workspaceOperationKey(action)}
          action={action}
        />
      ))}
    </div>
  );
}

function WorkspaceCompletedOperationCard({
  action,
}: {
  action: CodaScopeAction;
}) {
  return (
    <article className="codascope-action-card codascope-action-card-success">
      <div className="codascope-action-card-header">
        <span className="codascope-action-icon">
          <IconCheck size={14} />
        </span>
        <span className="codascope-action-card-label">Completed</span>
        <span className="codascope-action-card-badge codascope-action-card-badge-success">
          <IconCheck size={12} /> Completed
        </span>
      </div>
      <p className="codascope-action-card-desc">{action.description}</p>
    </article>
  );
}

function workspaceOperationKey(action: CodaScopeAction): string {
  return JSON.stringify([
    action.attributes.operation,
    action.attributes.stableId,
    action.attributes.contentHash,
    action.description,
  ]);
}
