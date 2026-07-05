/* ── CodaScope: Guide Modal ───────────────────────────────────────────
   Full guide modal with 5 tabs: Overview, Chat Agent, Projects & Wiki,
   Epics & Design, Shortcuts & Tips.

   Replaces the old ChatHelpModal with a richer, tabbed help system.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  IconSearch,
  IconWiki,
  IconEpic,
  IconCodeMap,
  IconBook,
  IconMap,

  IconPlan,
  IconArrowRight,
} from "./CodaScopeIcons";

// ── Types ───────────────────────────────────────────────────────────

interface CodaScopeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: GuideTab;
}

type GuideTab = "overview" | "chat-agent" | "projects" | "epics" | "shortcuts";

const TABS: { id: GuideTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "chat-agent", label: "Chat Agent" },
  { id: "projects", label: "Projects & Wiki" },
  { id: "epics", label: "Epics & Design" },
  { id: "shortcuts", label: "Shortcuts" },
];

// ── Expandable Section ──────────────────────────────────────────────

function ExpandableSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="codascope-guide-expandable">
      <button
        className={`codascope-guide-expandable-trigger${open ? " codascope-guide-expandable-trigger--open" : ""}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="codascope-guide-expandable-arrow">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={open ? "2,3 5,6 8,3" : "3,2 6,5 3,8"} />
          </svg>
        </span>
        {title}
      </button>
      {open && <div className="codascope-guide-expandable-content">{children}</div>}
    </div>
  );
}

// ── Intent Card ─────────────────────────────────────────────────────

interface IntentCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  example?: string;
  slashCommands?: string[];
  children?: React.ReactNode;
}

function IntentCard({ icon, title, description, example, slashCommands, children }: IntentCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="codascope-guide-intent-card">
      <button
        className="codascope-guide-intent-card-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="codascope-guide-intent-card-icon">{icon}</span>
        <div className="codascope-guide-intent-card-info">
          <span className="codascope-guide-intent-card-title">{title}</span>
          <span className="codascope-guide-intent-card-desc">{description}</span>
        </div>
        <span className={`codascope-guide-intent-card-toggle${expanded ? " codascope-guide-intent-card-toggle--open" : ""}`}>
          <IconArrowRight size={12} />
        </span>
      </button>
      {expanded && (
        <div className="codascope-guide-intent-card-body">
          {example && (
            <div className="codascope-guide-intent-card-example">
              <span className="codascope-guide-intent-card-example-label">Example:</span>
              <em>{example}</em>
            </div>
          )}
          {slashCommands && slashCommands.length > 0 && (
            <div className="codascope-guide-intent-card-slash">
              {slashCommands.map((cmd) => (
                <kbd key={cmd}>{cmd}</kbd>
              ))}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ── Tab Content: Overview ───────────────────────────────────────────

function TabOverview() {
  return (
    <div className="codascope-guide-tab-content">
      {/* Pipeline Diagram */}
      <div className="codascope-guide-pipeline">
        <div className="codascope-guide-pipeline-row">
          <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--primary">
            <IconCodeMap size={16} />
            <span>Your Code</span>
          </div>
          <div className="codascope-guide-pipeline-arrow">→</div>
          <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--primary">
            <IconMap size={16} />
            <span>Code Map</span>
          </div>
          <div className="codascope-guide-pipeline-arrow">→</div>
          <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--primary">
            <IconWiki size={16} />
            <span>Wiki</span>
          </div>
        </div>
        <div className="codascope-guide-pipeline-branch">
          <div className="codascope-guide-pipeline-branch-line" />
          <div className="codascope-guide-pipeline-row codascope-guide-pipeline-row--secondary">
            <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--secondary">
              <IconEpic size={16} />
              <span>Epics</span>
            </div>
            <div className="codascope-guide-pipeline-arrow">→</div>
            <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--secondary">
              <IconSearch size={16} />
              <span>Research</span>
            </div>
            <div className="codascope-guide-pipeline-arrow">→</div>
            <div className="codascope-guide-pipeline-node codascope-guide-pipeline-node--secondary">
              <IconBook size={16} />
              <span>Design Docs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mental Model Bullets */}
      <div className="codascope-guide-bullets">
        <ExpandableSection title="Point CodaScope at your repos and it maps the structure">
          <p>
            CodaScope scans your source code repositories and builds a "code map" — a structural
            overview of modules, classes, functions, and their relationships. This map is the
            foundation for everything else.
          </p>
        </ExpandableSection>
        <ExpandableSection title="Generate wiki documentation from the code map">
          <p>
            The code map feeds into an AI-powered wiki builder that generates topic-based
            documentation. You control the depth: outline, developed, or deep. Pages can be
            rebuilt individually or all at once.
          </p>
        </ExpandableSection>

        <ExpandableSection title="Create Epics to plan features, research patterns, and design solutions">
          <p>
            Epics are planning workspaces. Define what you want to build, scope the relevant
            code areas, research patterns from the web, curate knowledge into wiki pages,
            and write design documents — all grounded in your actual codebase.
          </p>
        </ExpandableSection>
      </div>
    </div>
  );
}

// ── Tab Content: Chat Agent ─────────────────────────────────────────

function TabChatAgent() {
  return (
    <div className="codascope-guide-tab-content">
      <div className="codascope-guide-intent-cards">
        <IntentCard
          icon={<IconSearch size={18} />}
          title="Understand Your Code"
          description="Ask about any part of the codebase"
          example="How does the authentication flow work?"
          slashCommands={["/explore"]}
        />
        <IntentCard
          icon={<IconBook size={18} />}
          title="Build Documentation"
          description="Generate and update wiki pages"
          example="Build a wiki page for the auth module"
          slashCommands={["/build wiki", "/build wiki-page", "/scan delta"]}
        />

        <IntentCard
          icon={<IconPlan size={18} />}
          title="Plan Features"
          description="Create epics, define scope, research"
          example="Help me define this epic"
          slashCommands={["/epic create", "/epic define"]}
        />
        <IntentCard
          icon={<IconEpic size={18} />}
          title="Design Solutions"
          description="Create and review design documents"
          example="Create a design doc about the event store"
          slashCommands={["/design create", "/design review"]}
        />
        <IntentCard
          icon={<IconWiki size={18} />}
          title="Context Injection"
          description="@-mentions for grounded responses"
        >
          <div className="codascope-guide-mentions-grid">
            <kbd>@wiki/</kbd><span>Reference a wiki page</span>
            <kbd>@source/</kbd><span>Reference a research source</span>
            <kbd>@design/</kbd><span>Reference a design document</span>
            <kbd>@code/</kbd><span>Reference a code repository</span>
            <kbd>@def</kbd><span>Reference the epic definition</span>
          </div>
        </IntentCard>
      </div>
    </div>
  );
}

// ── Tab Content: Projects & Wiki ────────────────────────────────────

function TabProjects() {
  return (
    <div className="codascope-guide-tab-content">
      <section className="codascope-guide-section">
        <h4>Setting Up a Project</h4>
        <ol className="codascope-guide-steps">
          <li>Click <strong>Projects</strong> in the left nav</li>
          <li>Create a new project and give it a name</li>
          <li>Add one or more source code repositories (local paths)</li>
          <li>Run <kbd>/explore</kbd> to scan the codebase and build the code map</li>
          <li>Run <kbd>/build wiki</kbd> to generate documentation</li>
        </ol>
      </section>

      <section className="codascope-guide-section">
        <h4>Wiki Depth Levels</h4>
        <div className="codascope-guide-depth-scale">
          <div className="codascope-guide-depth-level">
            <span className="codascope-guide-depth-bar codascope-guide-depth-bar--outline" />
            <div>
              <strong>Outline</strong>
              <p>High-level structure, key classes and functions. Good for orientation.</p>
            </div>
          </div>
          <div className="codascope-guide-depth-level">
            <span className="codascope-guide-depth-bar codascope-guide-depth-bar--developed" />
            <div>
              <strong>Developed</strong>
              <p>Detailed explanations with code references and cross-linking. Default level.</p>
            </div>
          </div>
          <div className="codascope-guide-depth-level">
            <span className="codascope-guide-depth-bar codascope-guide-depth-bar--deep" />
            <div>
              <strong>Deep</strong>
              <p>Comprehensive documentation including implementation details and edge cases.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Keeping Docs Current</h4>
        <p className="codascope-guide-text">
          Use <kbd>/scan delta</kbd> to detect which wiki pages are out of date relative to
          the current code. CodaScope compares code map changes against the last build and
          surfaces stale pages you can selectively rebuild.
        </p>
      </section>


    </div>
  );
}

// ── Tab Content: Epics & Design ─────────────────────────────────────

function TabEpics() {
  return (
    <div className="codascope-guide-tab-content">
      <section className="codascope-guide-section">
        <h4>Epic Lifecycle</h4>
        <div className="codascope-guide-lifecycle">
          <div className="codascope-guide-lifecycle-step codascope-guide-lifecycle-step--active">defining</div>
          <div className="codascope-guide-lifecycle-arrow">→</div>
          <div className="codascope-guide-lifecycle-step">curating</div>
          <div className="codascope-guide-lifecycle-arrow">→</div>
          <div className="codascope-guide-lifecycle-step">designing</div>
          <div className="codascope-guide-lifecycle-arrow">→</div>
          <div className="codascope-guide-lifecycle-step">in-review</div>
          <div className="codascope-guide-lifecycle-arrow">→</div>
          <div className="codascope-guide-lifecycle-step">approved</div>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Epic Tabs</h4>
        <div className="codascope-guide-tab-list">
          <ExpandableSection title="Define — Describe what you want to build">
            <p>
              Write a natural-language description of the feature. The agent interviews you
              to refine scope and identify key requirements.
            </p>
          </ExpandableSection>
          <ExpandableSection title="Scope — Select relevant code topics">
            <p>
              Link wiki topics to the epic so the agent knows which parts of the codebase
              are relevant. Control wiki depth per topic for targeted knowledge.
            </p>
          </ExpandableSection>
          <ExpandableSection title="Knowledge — Research and curate">
            <p>
              Download web resources, upload documents, and curate knowledge into
              epic-scoped wiki pages. The curation pipeline synthesizes research into
              structured documentation.
            </p>
          </ExpandableSection>
          <ExpandableSection title="Design — Create design documents">
            <p>
              Write design documents grounded in your research and code knowledge.
              Use templates (API spec, data model, system design, user flow) or go freeform.
              Annotate with targeted feedback for iterative refinement.
            </p>
          </ExpandableSection>
          <ExpandableSection title="History — Track changes and versions">
            <p>
              View the history of design document changes, compare versions, and revert
              if needed. Every save creates a versioned snapshot.
            </p>
          </ExpandableSection>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Annotations & Directives</h4>
        <p className="codascope-guide-text">
          Select text in a design document to annotate it with feedback. The agent can
          also review and annotate your designs. Directives (insert, rewrite, expand)
          let you ask the agent to modify specific sections of a document.
        </p>
      </section>
    </div>
  );
}

// ── Tab Content: Shortcuts & Tips ───────────────────────────────────

function TabShortcuts() {
  return (
    <div className="codascope-guide-tab-content">
      <section className="codascope-guide-section">
        <h4>@ Mentions — Add Context</h4>
        <p className="codascope-guide-desc">
          Type <code>@</code> in the chat input to reference context from your project.
        </p>
        <div className="codascope-guide-shortcuts">
          <div className="codascope-guide-shortcut"><kbd>@wiki/</kbd><span>Reference a wiki page</span></div>
          <div className="codascope-guide-shortcut"><kbd>@source/</kbd><span>Reference a research source</span></div>
          <div className="codascope-guide-shortcut"><kbd>@design/</kbd><span>Reference a design document</span></div>
          <div className="codascope-guide-shortcut"><kbd>@code/</kbd><span>Reference a code repository</span></div>
          <div className="codascope-guide-shortcut"><kbd>@def</kbd><span>Reference the epic definition</span></div>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Keyboard Shortcuts</h4>
        <div className="codascope-guide-shortcuts">
          <div className="codascope-guide-shortcut"><kbd>Enter</kbd><span>Send message</span></div>
          <div className="codascope-guide-shortcut"><kbd>Shift + Enter</kbd><span>New line</span></div>
          <div className="codascope-guide-shortcut"><kbd>Escape</kbd><span>Clear attachments / close picker</span></div>
          <div className="codascope-guide-shortcut"><kbd>↑ ↓</kbd><span>Navigate @ picker or / palette</span></div>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Slash Commands</h4>
        <p className="codascope-guide-desc">
          Type <code>/</code> in an empty chat input to open the command palette.
          Filter by typing after the slash. Use arrow keys to navigate and Enter to select.
        </p>
        <div className="codascope-guide-shortcuts">
          <div className="codascope-guide-shortcut"><kbd>/build wiki</kbd><span>Generate full wiki</span></div>
          <div className="codascope-guide-shortcut"><kbd>/explore</kbd><span>Explore codebase</span></div>
          <div className="codascope-guide-shortcut"><kbd>/goto ...</kbd><span>Navigate to a view</span></div>
          <div className="codascope-guide-shortcut"><kbd>/help</kbd><span>Open this guide</span></div>
        </div>
      </section>

      <section className="codascope-guide-section">
        <h4>Attachments</h4>
        <ul className="codascope-guide-list">
          <li><strong>Paste images</strong> — Cmd/Ctrl+V to paste from clipboard</li>
          <li><strong>Drag & drop</strong> — Drag image files into the chat input</li>
          <li>Supported formats: PNG, JPEG, GIF, WebP (max 5MB)</li>
        </ul>
      </section>

      <section className="codascope-guide-section">
        <h4>Wikilinks</h4>
        <p className="codascope-guide-desc">
          Use <code>[[topic-id]]</code> syntax in chat messages. The agent will render
          them as clickable links to the wiki topic page.
        </p>
      </section>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function CodaScopeGuideModal({ isOpen, onClose, initialTab = "overview" }: CodaScopeGuideModalProps) {
  const [activeTab, setActiveTab] = useState<GuideTab>(initialTab);
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Drag state ──────────────────────────────────────────────────
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // ── Resize state ────────────────────────────────────────────────
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Reset tab when opened with a specific initial tab
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // ── Drag handlers ───────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag from the header itself, not buttons inside it
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();

    const modal = modalRef.current;
    if (!modal) return;

    const rect = modal.getBoundingClientRect();
    const currentX = position?.x ?? rect.left;
    const currentY = position?.y ?? rect.top;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: currentX,
      origY: currentY,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [position]);

  // ── Resize handlers ─────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const modal = modalRef.current;
    if (!modal) return;

    const rect = modal.getBoundingClientRect();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: size?.w ?? rect.width,
      origH: size?.h ?? rect.height,
    };

    // Also pin position if not already pinned
    if (!position) {
      setPosition({ x: rect.left, y: rect.top });
    }

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dw = ev.clientX - resizeRef.current.startX;
      const dh = ev.clientY - resizeRef.current.startY;
      setSize({
        w: Math.max(400, resizeRef.current.origW + dw),
        h: Math.max(300, resizeRef.current.origH + dh),
      });
    };

    const handleUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [size, position]);

  // Reset position/size when modal is closed
  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      setSize(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const renderTab = () => {
    switch (activeTab) {
      case "overview": return <TabOverview />;
      case "chat-agent": return <TabChatAgent />;
      case "projects": return <TabProjects />;
      case "epics": return <TabEpics />;
      case "shortcuts": return <TabShortcuts />;
    }
  };

  // Build inline styles for positioned/resized modal
  const modalStyle: React.CSSProperties = {};
  if (position) {
    modalStyle.position = "fixed";
    modalStyle.left = position.x;
    modalStyle.top = position.y;
    modalStyle.transform = "none";
    modalStyle.margin = 0;
  }
  if (size) {
    modalStyle.width = size.w;
    modalStyle.height = size.h;
    modalStyle.maxWidth = "none";
    modalStyle.maxHeight = "none";
  }

  return createPortal(
    <div className="codascope-guide-modal" ref={modalRef} style={modalStyle}>
      {/* Header — draggable */}
      <div
        className="codascope-guide-modal-header"
        onMouseDown={handleDragStart}
        style={{ cursor: "grab" }}
      >
        <h2>CodaScope Guide</h2>
        <button
          className="codascope-guide-modal-close"
          onClick={onClose}
          type="button"
          aria-label="Close guide"
        >
          ×
        </button>
      </div>

      {/* Tab Bar */}
      <div className="codascope-guide-modal-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`codascope-guide-modal-tab${activeTab === tab.id ? " codascope-guide-modal-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="codascope-guide-modal-content">
        {renderTab()}
      </div>

      {/* Resize Handle */}
      <div
        className="codascope-guide-modal-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>,
    document.body,
  );
}
