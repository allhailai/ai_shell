import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconCheck,
  IconFolder,
  IconRefresh,
  IconSearch,
} from "./CodaScopeIcons";
import {
  isWorkspaceCatalogRequestCurrent,
  loadWorkspaceProjectCatalog,
  type WorkspaceProjectCatalog,
  type WorkspaceProjectReference,
} from "../workspaceProjectCatalogApi";

export const WORKSPACE_PROJECT_REFERENCE_MAX = 25;

interface WorkspaceProjectReferencePickerProps {
  scopeKey: string;
  selectedProjectIds: readonly string[];
  onSelect: (project: WorkspaceProjectReference) => void;
  onClose: () => void;
}

export function WorkspaceProjectReferencePicker({
  scopeKey,
  selectedProjectIds,
  onSelect,
  onClose,
}: WorkspaceProjectReferencePickerProps) {
  const [catalog, setCatalog] = useState<WorkspaceProjectCatalog | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestEpochRef = useRef(0);
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  const selected = useMemo(
    () => new Set(selectedProjectIds),
    [selectedProjectIds],
  );
  const atLimit = selected.size >= WORKSPACE_PROJECT_REFERENCE_MAX;
  const availableProjects = useMemo(() => {
    return filterWorkspaceProjectReferences(
      catalog?.projects ?? [],
      selectedProjectIds,
      query,
    );
  }, [catalog, query, selectedProjectIds]);

  useEffect(() => {
    const controller = new AbortController();
    const request = {
      scopeKey,
      epoch: ++requestEpochRef.current,
    };
    setStatus("loading");
    setCatalog(null);
    void loadWorkspaceProjectCatalog(fetch, controller.signal)
      .then((nextCatalog) => {
        if (controller.signal.aborted
          || !isWorkspaceCatalogRequestCurrent(request, {
            scopeKey: currentScopeKeyRef.current,
            epoch: requestEpochRef.current,
          })) {
          return;
        }
        setCatalog(nextCatalog);
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted
          || !isWorkspaceCatalogRequestCurrent(request, {
            scopeKey: currentScopeKeyRef.current,
            epoch: requestEpochRef.current,
          })) {
          return;
        }
        setStatus("error");
      });
    return () => controller.abort();
  }, [retryEpoch, scopeKey]);

  useEffect(() => {
    searchRef.current?.focus();
  }, [status]);

  useEffect(() => {
    setActiveIndex(0);
  }, [availableProjects.length, query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current
        && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const selectActiveProject = useCallback(() => {
    if (atLimit) return;
    const project = availableProjects[activeIndex];
    if (project) onSelect(project);
  }, [activeIndex, atLimit, availableProjects, onSelect]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (status !== "ready" || availableProjects.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => moveWorkspaceProjectPickerIndex(
        current,
        availableProjects.length,
        1,
      ));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => moveWorkspaceProjectPickerIndex(
        current,
        availableProjects.length,
        -1,
      ));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectActiveProject();
    }
  }, [
    availableProjects.length,
    onClose,
    selectActiveProject,
    status,
  ]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const emptyMessage = catalog?.projects.length === 0
    ? "No active projects are available."
    : selected.size > 0 && availableProjects.length === 0 && !query.trim()
      ? "All available projects are already referenced."
      : `No active project matches “${query.trim()}”.`;

  return (
    <div
      ref={containerRef}
      className="codascope-workspace-project-picker"
      role="dialog"
      aria-label="Reference an active project"
    >
      <div className="codascope-workspace-project-picker-header">
        <span className="codascope-workspace-project-picker-header-icon">
          <IconFolder size={15} />
        </span>
        <span className="codascope-workspace-project-picker-header-label">
          Active projects
        </span>
        <span className="codascope-workspace-project-picker-count">
          {selected.size}/{WORKSPACE_PROJECT_REFERENCE_MAX}
        </span>
      </div>

      <div className="codascope-workspace-project-picker-search">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          className="codascope-workspace-project-picker-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search active projects"
          aria-label="Search active projects"
          disabled={status !== "ready"}
        />
      </div>

      {atLimit && (
        <div
          className="codascope-workspace-project-picker-limit"
          role="status"
        >
          The 25-project reference limit has been reached.
        </div>
      )}

      <div
        className="codascope-workspace-project-picker-list"
        role="listbox"
        aria-label="Active project results"
      >
        {status === "loading" ? (
          <div
            className="codascope-workspace-project-picker-state"
            role="status"
          >
            <IconRefresh size={16} />
            <span>Loading active projects…</span>
          </div>
        ) : status === "error" ? (
          <div
            className="codascope-workspace-project-picker-state"
            role="alert"
          >
            <span>Active projects could not be loaded.</span>
            <button
              className="codascope-workspace-project-picker-retry"
              type="button"
              onClick={() => setRetryEpoch((current) => current + 1)}
            >
              <IconRefresh size={13} />
              Retry
            </button>
          </div>
        ) : availableProjects.length === 0 ? (
          <div className="codascope-workspace-project-picker-state">
            <IconFolder size={16} />
            <span>{emptyMessage}</span>
          </div>
        ) : (
          availableProjects.map((project, index) => (
            <button
              key={project.projectId}
              className={`codascope-workspace-project-picker-item${
                index === activeIndex
                  ? " codascope-workspace-project-picker-item-focused"
                  : ""
              }`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              disabled={atLimit}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(project)}
            >
              <span className="codascope-workspace-project-picker-item-icon">
                {index === activeIndex
                  ? <IconCheck size={14} />
                  : <IconFolder size={14} />}
              </span>
              <span className="codascope-workspace-project-picker-item-copy">
                <span className="codascope-workspace-project-picker-item-name">
                  {project.name}
                </span>
                {project.description && (
                  <span className="codascope-workspace-project-picker-item-description">
                    {project.description}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>

      {catalog?.truncated && (
        <div className="codascope-workspace-project-picker-truncated">
          Showing the first {catalog.limit} active projects.
        </div>
      )}
    </div>
  );
}

export function filterWorkspaceProjectReferences(
  projects: readonly WorkspaceProjectReference[],
  selectedProjectIds: readonly string[],
  query: string,
): WorkspaceProjectReference[] {
  const selected = new Set(selectedProjectIds);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return projects.filter((project) => (
    !selected.has(project.projectId)
    && (!normalizedQuery
      || project.name.toLocaleLowerCase().includes(normalizedQuery))
  ));
}

export function moveWorkspaceProjectPickerIndex(
  currentIndex: number,
  itemCount: number,
  direction: -1 | 1,
): number {
  if (itemCount <= 0) return 0;
  const next = currentIndex + direction;
  if (next < 0) return itemCount - 1;
  if (next >= itemCount) return 0;
  return next;
}

export function appendWorkspaceProjectReference(
  current: readonly WorkspaceProjectReference[],
  project: WorkspaceProjectReference,
): WorkspaceProjectReference[] {
  if (current.length >= WORKSPACE_PROJECT_REFERENCE_MAX
    || current.some((candidate) => candidate.projectId === project.projectId)) {
    return [...current];
  }
  return [...current, project];
}

export function removeWorkspaceProjectReference(
  current: readonly WorkspaceProjectReference[],
  projectId: string,
): WorkspaceProjectReference[] {
  return current.filter((project) => project.projectId !== projectId);
}
