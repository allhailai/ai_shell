import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { isCanonicalAssistantRecordId } from "../assistantConversationApi";
import type {
  AssistantChatMessage,
  AssistantScope,
  WorkspaceMessageContext,
  WorkspaceRetrievedSourceReference,
} from "../codaScopeTypes";
import {
  IconClock,
  IconCodeMap,
  IconLaunch,
  IconWiki,
} from "./CodaScopeIcons";

export const WORKSPACE_SOURCE_DISPLAY_LIMIT = 12;

interface WorkspaceSourceReferencesProps {
  scope: AssistantScope;
  message: AssistantChatMessage;
}

export function WorkspaceSourceReferences({
  scope,
  message,
}: WorkspaceSourceReferencesProps) {
  const { navigate } = useAppSubRoute("codascope");
  if (scope.kind !== "workspace"
    || message.role !== "assistant"
    || message.status !== "complete"
    || message.authoritativePersisted !== true
    || !isWorkspaceMessageContext(message.context)
    || !message.context.retrievedSources?.length) {
    return null;
  }

  const sources = message.context.retrievedSources;
  const visible = sources.slice(0, WORKSPACE_SOURCE_DISPLAY_LIMIT);
  const hiddenCount = sources.length - visible.length;

  return (
    <section
      className="codascope-workspace-sources"
      aria-label="Retrieved workspace sources"
    >
      <div className="codascope-workspace-sources-header">
        <span className="codascope-workspace-sources-title">
          Retrieved sources
        </span>
        <span className="codascope-workspace-sources-count">
          {sources.length}
        </span>
      </div>
      <ul className="codascope-workspace-sources-list">
        {visible.map((source) => {
          const route = workspaceSourceRoute(source);
          return (
            <li
              key={workspaceSourceIdentity(source)}
              className="codascope-workspace-source"
            >
              <span className="codascope-workspace-source-icon">
                {source.kind === "project_wiki"
                  ? <IconWiki size={14} />
                  : <IconCodeMap size={14} />}
              </span>
              <span className="codascope-workspace-source-copy">
                <span className="codascope-workspace-source-kind">
                  {source.kind === "project_wiki"
                    ? "Project wiki"
                    : "Code map"}
                </span>
                <span className="codascope-workspace-source-project">
                  {source.projectName}
                </span>
                <span className="codascope-workspace-source-label">
                  {source.kind === "project_wiki"
                    ? source.topicTitle
                    : `Code map ${source.codeMapId}`}
                </span>
                <span className="codascope-workspace-source-freshness">
                  <IconClock size={11} />
                  {source.kind === "project_wiki" ? (
                    <>
                      <span>Topic updated </span>
                      <SourceTime value={source.topicUpdatedAt} />
                    </>
                  ) : source.generatedAt ? (
                    <>
                      <span>Generated </span>
                      <SourceTime value={source.generatedAt} />
                    </>
                  ) : (
                    <span>Generation time unavailable</span>
                  )}
                </span>
                {source.lastWikiBuildAt && (
                  <span className="codascope-workspace-source-freshness">
                    <IconClock size={11} />
                    <span>Last successful wiki build </span>
                    <SourceTime value={source.lastWikiBuildAt} />
                  </span>
                )}
              </span>
              {route && (
                <button
                  className="codascope-workspace-source-open"
                  type="button"
                  onClick={() => navigate(route)}
                  aria-label={`Open source: ${
                    source.kind === "project_wiki"
                      ? source.topicTitle
                      : `Code map ${source.codeMapId}`
                  } in ${source.projectName}`}
                >
                  <IconLaunch size={13} />
                  <span>Open source</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <div className="codascope-workspace-sources-overflow">
          {hiddenCount} additional persisted source{hiddenCount === 1 ? "" : "s"}
        </div>
      )}
    </section>
  );
}

export function workspaceSourceRoute(
  source: WorkspaceRetrievedSourceReference,
): string | null {
  if (!isCanonicalAssistantRecordId(source.projectId)) return null;
  const projectId = encodeURIComponent(source.projectId);
  if (source.kind === "code_map") {
    if (!isCanonicalAssistantRecordId(source.codeMapId)) return null;
    return `project/${projectId}/dashboard`;
  }
  if (!isCanonicalAssistantRecordId(source.topicId)) return null;
  return `project/${projectId}/wiki/${encodeURIComponent(source.topicId)}`;
}

export function workspaceSourceIdentity(
  source: WorkspaceRetrievedSourceReference,
): string {
  return source.kind === "project_wiki"
    ? [
        source.kind,
        source.retrieval,
        source.projectId,
        source.topicId,
      ].join("\u0000")
    : [
        source.kind,
        source.retrieval,
        source.projectId,
        source.codeMapId,
      ].join("\u0000");
}

function SourceTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatSourceTime(value)}</time>;
}

function formatSourceTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function isWorkspaceMessageContext(
  value: AssistantChatMessage["context"],
): value is WorkspaceMessageContext {
  if (!value || typeof value !== "object" || !("assistantScope" in value)) {
    return false;
  }
  return value.assistantScope.kind === "workspace";
}
