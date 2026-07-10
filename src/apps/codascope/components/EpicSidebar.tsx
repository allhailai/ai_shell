/* ── CodaScope: EpicSidebar Component ───────────────────────────────
   Collapsible, resizable left panel for Epic Detail view. Handles
   section navigation (Define, Scope, Knowledge→Wiki/Sources/Blocked,
   Design, History) and contextual sub-item listing.

   Design section shows a unified "Documents" list with:
   - Type filter (Both | MD | HTML)
   - Pin/archive hover actions
   - Pinned items sorted first, then by updatedAt desc
   - Collapsible archived section at the bottom
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo, useRef, type ComponentType } from "react";
import {
  IconFile,
  IconSearch,
  IconKnowledge,
  IconWiki,
  IconUpload,
  IconWarning,
  IconPaintbrush,
  IconClock,
  IconArtifact,
  IconPin,
  IconArchive,
  IconNotes,
} from "./CodaScopeIcons";
import { CurateButton } from "./CurateButton";
import type {
  EpicDesignDetail,
  EpicDesignDoc,
  EpicKnowledgeSource,
  EpicWikiPage,
  BlockedDownload,
  EpicStatus,
  CurationReason,
  ArtifactSpec,
} from "../codaScopeTypes";

/* ── Constants ───────────────────────────────────────────────────────── */

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 220;
const COLLAPSED_WIDTH = 44;
const WIDTH_STORAGE_KEY = "codascope:epicSidebarWidth";

function getStoredWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

function storeWidth(w: number): void {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(w)); } catch { /* ignore */ }
}

/* ── Types ───────────────────────────────────────────────────────────── */

type DocFilterType = "both" | "md" | "html";

/** Unified document item for the merged list. */
interface UnifiedDocItem {
  type: "md" | "html";
  id: string;          // raw id (doc.id or art.id)
  navId: string;       // id used for navigation (doc.id or "artifact:<art.id>")
  title: string;
  updatedAt: string;
  pinnedAt?: string;
  archivedAt?: string;
  status?: string;     // artifact build status
}

interface EpicSidebarProps {
  epic: EpicDesignDetail;
  activeSection: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  // Sub-item data
  wikiPages: EpicWikiPage[];
  allDesignDocs: EpicDesignDoc[];      // ALL design docs including archived
  allArtifacts: ArtifactSpec[];         // ALL artifacts including archived
  sources: EpicKnowledgeSource[];       // non-error sources only
  errorSources: EpicKnowledgeSource[];  // error-status sources
  blockedItems: BlockedDownload[];
  activeSubItemId: string | null;
  onNavigate: (section: string, subItemId?: string) => void;
  // Pin/archive callbacks
  onPin: (type: "md" | "html", id: string) => void;
  onUnpin: (type: "md" | "html", id: string) => void;
  onArchive: (type: "md" | "html", id: string) => void;
  onUnarchive: (type: "md" | "html", id: string) => void;
  // Curation
  curationReasons: CurationReason[];
  isCurating: boolean;
  onStartCuration: () => void;
  onShowReasons: () => void;
  // Knowledge expand state
  knowledgeExpanded: boolean;
  onToggleKnowledge: () => void;
}

/* ── Status badge ────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<EpicStatus, string> = {
  defining: "Defining",
  curating: "Curating",
  designing: "Designing",
  "in-review": "In Review",
  approved: "Approved",
  archived: "Archived",
};

/* ── Section nav config ──────────────────────────────────────────────── */

interface SectionItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  hasChildren?: boolean;
}

const SECTIONS: SectionItem[] = [
  { id: "define", label: "Define", icon: IconFile },
  { id: "scope", label: "Scope", icon: IconSearch },
  { id: "knowledge", label: "Knowledge", icon: IconKnowledge, hasChildren: true },
  { id: "design", label: "Design", icon: IconPaintbrush },
  { id: "notes", label: "Notes", icon: IconNotes },
  { id: "history", label: "History", icon: IconClock },
];

const KNOWLEDGE_CHILDREN = [
  { id: "knowledge/wiki", label: "Wiki", icon: IconWiki },
  { id: "knowledge/sources", label: "Source Data", icon: IconUpload },
  { id: "knowledge/failed", label: "Failed Sources", icon: IconWarning },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicSidebar({
  epic,
  activeSection,
  collapsed,
  onToggleCollapse,
  wikiPages,
  allDesignDocs,
  allArtifacts,
  sources,
  errorSources,
  blockedItems,
  activeSubItemId,
  onNavigate,
  onPin,
  onUnpin,
  onArchive,
  onUnarchive,
  curationReasons,
  isCurating,
  onStartCuration,
  onShowReasons,
  knowledgeExpanded,
  onToggleKnowledge,
}: EpicSidebarProps) {
  /* ── Resize state ─────────────────────────────────────────────────── */
  const [width, setWidth] = useState(getStoredWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [collapsed, width],
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      // Dragging right = increase width (opposite of right panel)
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    },
    [],
  );

  const handleResizePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      storeWidth(width);
    },
    [width],
  );

  /* ── Nav section collapsed state ──────────────────────────────────── */
  const [navCollapsed, setNavCollapsed] = useState(false);

  /* ── Design filter and archived expand state ──────────────────────── */
  const [docFilter, setDocFilter] = useState<DocFilterType>("both");
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  /* ── Helpers ──────────────────────────────────────────────────────── */

  const isActive = useCallback(
    (sectionId: string) => activeSection === sectionId,
    [activeSection],
  );

  const isKnowledgeActive = activeSection.startsWith("knowledge");

  const handleSectionClick = useCallback(
    (sectionId: string, hasChildren?: boolean) => {
      if (collapsed) {
        onToggleCollapse();
      }
      if (hasChildren) {
        onToggleKnowledge();
      } else {
        onNavigate(sectionId);
      }
    },
    [collapsed, onToggleCollapse, onToggleKnowledge, onNavigate],
  );

  /* ── Build unified document list ──────────────────────────────────── */

  const unifiedDocs = useMemo<UnifiedDocItem[]>(() => {
    const items: UnifiedDocItem[] = [];

    for (const doc of allDesignDocs) {
      items.push({
        type: "md",
        id: doc.id,
        navId: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        pinnedAt: doc.pinnedAt,
        archivedAt: doc.archivedAt,
      });
    }

    for (const art of allArtifacts) {
      items.push({
        type: "html",
        id: art.id,
        navId: `artifact:${art.id}`,
        title: art.title,
        updatedAt: art.updatedAt,
        pinnedAt: art.pinnedAt,
        archivedAt: art.archivedAt,
        status: art.status,
      });
    }

    return items;
  }, [allDesignDocs, allArtifacts]);

  // Apply type filter
  const filteredDocs = useMemo(() => {
    if (docFilter === "both") return unifiedDocs;
    return unifiedDocs.filter((d) => d.type === docFilter);
  }, [unifiedDocs, docFilter]);

  // Split active vs archived
  const activeDocs = useMemo(() =>
    filteredDocs
      .filter((d) => !d.archivedAt)
      .sort((a, b) => {
        // Pinned first
        if (a.pinnedAt && !b.pinnedAt) return -1;
        if (!a.pinnedAt && b.pinnedAt) return 1;
        // Within same pin group: most recently modified first
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [filteredDocs],
  );

  const archivedDocs = useMemo(() =>
    filteredDocs
      .filter((d) => !!d.archivedAt)
      .sort((a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime()),
    [filteredDocs],
  );

  /* ── Determine what sub-items to show ─────────────────────────────── */

  const showWikiSubItems = activeSection === "knowledge/wiki";
  const showSourceSubItems = activeSection === "knowledge/sources";
  const showFailedSubItems = activeSection === "knowledge/failed";
  const showDesignSubItems = activeSection === "design";
  const showSubItems = showWikiSubItems || showSourceSubItems || showFailedSubItems || showDesignSubItems;

  const failedCount = errorSources.length + blockedItems.length;

  /* ── Render ─────────────────────────────────────────────────────────── */

  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : width;

  const renderDocItem = (item: UnifiedDocItem, showUnarchive?: boolean) => {
    const isItemActive = activeSubItemId === item.navId;
    const dotModifier = item.type === "html"
      ? (item.status === "built" ? "codascope-epic-sidebar-artifact-dot--built"
        : item.status === "building" ? "codascope-epic-sidebar-artifact-dot--building"
        : "codascope-epic-sidebar-artifact-dot--pending")
      : null;

    return (
      <div
        key={item.navId}
        className={`codascope-epic-sidebar-doc-item ${
          isItemActive ? "codascope-epic-sidebar-doc-item--active" : ""
        } ${item.pinnedAt ? "codascope-epic-sidebar-doc-item--pinned" : ""}`}
      >
        <button
          className="codascope-epic-sidebar-doc-item-btn"
          onClick={() => onNavigate("design", item.navId)}
          type="button"
        >
          <span className="codascope-epic-sidebar-wiki-item-icon">
            {item.type === "md" ? <IconPaintbrush size={12} /> : <IconArtifact size={12} />}
          </span>
          <span className="codascope-epic-sidebar-wiki-item-title">
            {item.title}
          </span>
          {dotModifier && (
            <span
              className={`codascope-epic-sidebar-artifact-dot ${dotModifier}`}
              title={item.status}
            />
          )}
        </button>
        {/* Action buttons: archive (left) then pin (right) — pin stays in stable position */}
        <div className={`codascope-epic-sidebar-item-actions ${
          item.pinnedAt && !showUnarchive ? "codascope-epic-sidebar-item-actions--pinned" : ""
        }`}>
          {showUnarchive ? (
            <button
              className="codascope-epic-sidebar-action-btn"
              onClick={(e) => { e.stopPropagation(); onUnarchive(item.type, item.id); }}
              type="button"
              title="Unarchive"
            >
              <IconArchive size={11} />
            </button>
          ) : (
            <>
              <button
                className="codascope-epic-sidebar-action-btn codascope-epic-sidebar-action-btn--archive"
                onClick={(e) => { e.stopPropagation(); onArchive(item.type, item.id); }}
                type="button"
                title="Archive"
              >
                <IconArchive size={11} />
              </button>
              <button
                className={`codascope-epic-sidebar-action-btn ${item.pinnedAt ? "codascope-epic-sidebar-action-btn--active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.pinnedAt) onUnpin(item.type, item.id);
                  else onPin(item.type, item.id);
                }}
                type="button"
                title={item.pinnedAt ? "Unpin" : "Pin"}
              >
                <IconPin size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`codascope-epic-sidebar ${collapsed ? "codascope-epic-sidebar--collapsed" : ""}`}
      style={{ width: sidebarWidth, position: "relative" }}
    >
      {/* ── Header: Epic title + collapse ─────────────────────────────── */}
      <div className="codascope-epic-sidebar-header">
        <div className="codascope-epic-sidebar-back-row">
          {!collapsed && (
            <span className="codascope-epic-sidebar-title" title={epic.title}>
              {epic.title}
            </span>
          )}
          <button
            className="codascope-epic-sidebar-collapse-btn"
            onClick={onToggleCollapse}
            type="button"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "▶" : "◀"}
          </button>
        </div>
        {!collapsed && (
          <div className="codascope-epic-sidebar-title-row">
            <span
              className={`codascope-epic-status-badge codascope-epic-status-badge--${epic.status}`}
            >
              {STATUS_LABELS[epic.status]}
            </span>
            <CurateButton
              epicId={epic.id}
              reasonCount={curationReasons.length}
              onCurate={onStartCuration}
              onShowReasons={onShowReasons}
              curating={isCurating}
            />
          </div>
        )}
      </div>

      {/* ── Section Navigation ────────────────────────────────────────── */}
      <div className="codascope-epic-sidebar-nav">
        {/* Collapsible nav header */}
        {!collapsed && (
          <button
            className="codascope-epic-sidebar-nav-toggle"
            onClick={() => setNavCollapsed((p) => !p)}
            type="button"
            title={navCollapsed ? "Show sections" : "Hide sections"}
          >
            <span className="codascope-epic-sidebar-nav-toggle-label">Sections</span>
            <svg className="codascope-epic-sidebar-nav-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {navCollapsed ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="6 9 12 15 18 9" />
              )}
            </svg>
          </button>
        )}

        {!navCollapsed && SECTIONS.map((section) => (
          <div key={section.id}>
            <button
              className={`codascope-epic-sidebar-nav-item ${
                section.hasChildren
                  ? isKnowledgeActive
                    ? "codascope-epic-sidebar-nav-item--active"
                    : ""
                  : isActive(section.id)
                    ? "codascope-epic-sidebar-nav-item--active"
                    : ""
              }`}
              onClick={() => handleSectionClick(section.id, section.hasChildren)}
              type="button"
              title={collapsed ? section.label : undefined}
            >
              <span className="codascope-epic-sidebar-nav-icon">
                <section.icon size={16} />
              </span>
              <span className="codascope-epic-sidebar-nav-label">
                {section.label}
              </span>
              {section.hasChildren && (
                <span className="codascope-epic-sidebar-chevron">
                  {knowledgeExpanded ? "▾" : "▸"}
                </span>
              )}
            </button>

            {/* Knowledge sub-group */}
            {section.hasChildren && knowledgeExpanded && (
              <div className="codascope-epic-sidebar-subgroup">
                {KNOWLEDGE_CHILDREN.map((child) => {
                  const badge =
                    child.id === "knowledge/failed" && failedCount > 0
                      ? failedCount
                      : null;

                  return (
                    <button
                      key={child.id}
                      className={`codascope-epic-sidebar-subgroup-item ${
                        isActive(child.id)
                          ? "codascope-epic-sidebar-subgroup-item--active"
                          : ""
                      }`}
                      onClick={() => onNavigate(child.id)}
                      type="button"
                    >
                      <span className="codascope-epic-sidebar-subgroup-icon">
                        <child.icon size={13} />
                      </span>
                      {child.label}
                      {badge !== null && (
                        <span className="codascope-epic-sidebar-badge">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Sub-Item List ──────────────────────────────────────────────── */}
      {showSubItems && !collapsed && (
        <div className="codascope-epic-sidebar-subitems">
          {/* Wiki pages */}
          {showWikiSubItems && (
            <>
              <div className="codascope-epic-sidebar-subitems-header">
                <span>Wiki Pages</span>
                <span className="codascope-epic-sidebar-subitems-count">
                  {wikiPages.length}
                </span>
              </div>
              <div className="codascope-epic-sidebar-subitems-list">
                {wikiPages.length === 0 && (
                  <div className="codascope-epic-sidebar-empty-msg">
                    No wiki pages yet
                  </div>
                )}
                {wikiPages.map((page) => (
                  <button
                    key={page.id}
                    className={`codascope-epic-sidebar-wiki-item ${
                      activeSubItemId === page.id
                        ? "codascope-epic-sidebar-wiki-item--active"
                        : ""
                    }`}
                    onClick={() => onNavigate("knowledge/wiki", page.id)}
                    type="button"
                  >
                    <span className="codascope-epic-sidebar-wiki-item-icon">
                      <IconFile size={12} />
                    </span>
                    <span className="codascope-epic-sidebar-wiki-item-title">
                      {page.title}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Source data */}
          {showSourceSubItems && (
            <>
              <div className="codascope-epic-sidebar-subitems-header">
                <span>Sources</span>
                <span className="codascope-epic-sidebar-subitems-count">
                  {sources.length}
                </span>
              </div>
              <div className="codascope-epic-sidebar-subitems-list">
                {sources.length === 0 && (
                  <div className="codascope-epic-sidebar-empty-msg">
                    No sources yet
                  </div>
                )}
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className={`codascope-epic-sidebar-source-card ${
                      activeSubItemId === source.id
                        ? "codascope-epic-sidebar-source-card--active"
                        : ""
                    }`}
                    onClick={() => onNavigate("knowledge/sources", source.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onNavigate("knowledge/sources", source.id);
                      }
                    }}
                  >
                    <span className="codascope-epic-sidebar-source-card-title">
                      {source.title}
                    </span>
                    <div className="codascope-epic-sidebar-source-card-meta">
                      <span
                        className={`codascope-knowledge-source-type codascope-knowledge-source-type-${source.type}`}
                      >
                        {source.type === "machine" ? "Machine" : "Human"}
                      </span>
                      <span
                        className={`codascope-knowledge-source-status codascope-knowledge-source-status-${source.status}`}
                      >
                        {source.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Failed sources (error sources + blocked downloads) */}
          {showFailedSubItems && (
            <>
              <div className="codascope-epic-sidebar-subitems-header">
                <span>Failed Sources</span>
                <span className="codascope-epic-sidebar-subitems-count">
                  {failedCount}
                </span>
              </div>
              <div className="codascope-epic-sidebar-subitems-list">
                {failedCount === 0 && (
                  <div className="codascope-epic-sidebar-empty-msg">
                    No failed sources
                  </div>
                )}
                {/* Error sources */}
                {errorSources.map((source) => (
                  <div
                    key={source.id}
                    className={`codascope-epic-sidebar-source-card ${
                      activeSubItemId === source.id
                        ? "codascope-epic-sidebar-source-card--active"
                        : ""
                    }`}
                    onClick={() => onNavigate("knowledge/failed", `source:${source.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onNavigate("knowledge/failed", `source:${source.id}`);
                      }
                    }}
                  >
                    <span className="codascope-epic-sidebar-source-card-title">
                      {source.title}
                    </span>
                    <div className="codascope-epic-sidebar-source-card-meta">
                      <span
                        className={`codascope-knowledge-source-type codascope-knowledge-source-type-${source.type}`}
                      >
                        {source.type === "machine" ? "Machine" : "Human"}
                      </span>
                      <span className="codascope-knowledge-source-status codascope-knowledge-source-status-error">
                        Error
                      </span>
                    </div>
                  </div>
                ))}
                {/* Blocked downloads */}
                {blockedItems.map((item) => (
                  <div
                    key={item.id}
                    className="codascope-epic-sidebar-blocked-item"
                    onClick={() => onNavigate("knowledge/failed", `blocked:${item.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onNavigate("knowledge/failed", `blocked:${item.id}`);
                      }
                    }}
                  >
                    <span className="codascope-epic-sidebar-blocked-item-url">
                      {item.url}
                    </span>
                    <span className="codascope-epic-sidebar-blocked-reason">
                      {item.reason}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Unified Documents (Design Docs + Visual Artifacts) ──── */}
          {showDesignSubItems && (
            <>
              <div className="codascope-epic-sidebar-subitems-header">
                <span>Documents</span>
                <div className="codascope-design-filter">
                  {(["both", "md", "html"] as DocFilterType[]).map((opt) => (
                    <button
                      key={opt}
                      className={`codascope-design-filter-option ${
                        docFilter === opt ? "codascope-design-filter-option--active" : ""
                      }`}
                      onClick={() => setDocFilter(opt)}
                      type="button"
                    >
                      {opt === "both" ? "All" : opt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="codascope-epic-sidebar-subitems-list">
                {activeDocs.length === 0 && archivedDocs.length === 0 && (
                  <div className="codascope-epic-sidebar-empty-msg">
                    No documents yet
                  </div>
                )}
                {activeDocs.length === 0 && archivedDocs.length > 0 && (
                  <div className="codascope-epic-sidebar-empty-msg">
                    No active documents
                  </div>
                )}
                {activeDocs.map((item) => renderDocItem(item))}

                {/* Archived section */}
                {archivedDocs.length > 0 && (
                  <div className="codascope-sidebar-archived-section">
                    <button
                      className="codascope-sidebar-archived-toggle"
                      onClick={() => setArchivedExpanded((p) => !p)}
                      type="button"
                    >
                      <span className="codascope-sidebar-archived-toggle-chevron">
                        {archivedExpanded ? "▾" : "▸"}
                      </span>
                      <span>Archived</span>
                      <span className="codascope-sidebar-archived-toggle-count">
                        {archivedDocs.length}
                      </span>
                    </button>
                    {archivedExpanded && (
                      <div className="codascope-sidebar-archived-list">
                        {archivedDocs.map((item) => renderDocItem(item, true))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Resize handle (right edge) ────────────────────────────────── */}
      {!collapsed && (
        <div
          className="codascope-epic-sidebar-resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          title="Drag to resize"
        />
      )}
    </div>
  );
}
