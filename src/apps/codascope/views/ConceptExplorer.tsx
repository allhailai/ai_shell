/* ── CodaScope: Concept Explorer ─────────────────────────────────────
   Browsable, filterable view of domain concepts extracted from code.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, type ComponentType } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import {
  IconSearch,
  IconArchitecture,
  IconSettings,
  IconQuality,
  IconLaunch,
  IconLink,
  IconSparkle,
  IconPackage,
  IconClock,
  IconConcepts,
} from "../components/CodaScopeIcons";

interface Concept {
  id: string;
  name: string;
  description: string;
  category: string;
  relatedConcepts: string[];
  relatedFiles: string[];
  wikiTopicId: string | null;
  source: "extracted" | "manual";
  createdAt: string;
}

const CATEGORIES: { key: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { key: "all", label: "All", icon: IconSearch },
  { key: "architecture", label: "Architecture", icon: IconArchitecture },
  { key: "backend", label: "Backend", icon: IconSettings },
  { key: "frontend", label: "Frontend", icon: IconQuality },
  { key: "data", label: "Data", icon: IconQuality },
  { key: "devops", label: "DevOps", icon: IconLaunch },
  { key: "cross-cutting", label: "Cross-Cutting", icon: IconLink },
  { key: "features", label: "Features", icon: IconSparkle },
  { key: "other", label: "Other", icon: IconPackage },
];

export function ConceptExplorer() {
  const { activeProjectId: activeProject } = useCodaScopeStore();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchConcepts = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/codascope/projects/${activeProject}/concepts`);
      if (res.ok) {
        const data = await res.json();
        setConcepts(data.concepts ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => { fetchConcepts(); }, [fetchConcepts]);

  const filteredConcepts = concepts
    .filter((c) => activeCategory === "all" || c.category === activeCategory)
    .filter((c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase()),
    );

  const handleDelete = async (conceptId: string) => {
    if (!activeProject) return;
    try {
      await fetch(`/api/codascope/projects/${activeProject}/concepts/${conceptId}`, { method: "DELETE" });
      setConcepts((prev) => prev.filter((c) => c.id !== conceptId));
    } catch { /* ignore */ }
  };

  const handleAdd = async (name: string, description: string, category: string) => {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProject}/concepts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, category }),
      });
      if (res.ok) {
        const data = await res.json();
        setConcepts((prev) => [...prev, data.concept]);
        setShowAddModal(false);
      }
    } catch { /* ignore */ }
  };

  const categoryCounts = concepts.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconClock size={32} /></div>
          <div className="codascope-empty-state-text">Loading concepts…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">Concept Explorer</div>
          <div className="codascope-page-subtitle">
            {concepts.length} concept{concepts.length !== 1 ? "s" : ""} discovered
          </div>
        </div>
        <button className="codascope-btn codascope-btn--primary" onClick={() => setShowAddModal(true)}>
          + Add Concept
        </button>
      </div>

      {/* Category Tabs */}
      <div className="codascope-concept-tabs">
        {CATEGORIES.map((cat) => {
          const count = cat.key === "all" ? concepts.length : (categoryCounts[cat.key] ?? 0);
          if (cat.key !== "all" && count === 0) return null;
          return (
            <button
              key={cat.key}
              className={`codascope-concept-tab ${activeCategory === cat.key ? "codascope-concept-tab--active" : ""}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              <span><cat.icon size={14} /></span>
              <span>{cat.label}</span>
              <span className="codascope-concept-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <input
        type="text"
        className="codascope-concept-search"
        placeholder="Search concepts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Concept Cards */}
      {filteredConcepts.length === 0 ? (
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconConcepts size={32} /></div>
          <div className="codascope-empty-state-title">
            {concepts.length === 0 ? "No concepts yet" : "No matching concepts"}
          </div>
          <div className="codascope-empty-state-text">
            {concepts.length === 0
              ? "Run an analysis to extract concepts from your codebase."
              : "Try a different search or category."}
          </div>
        </div>
      ) : (
        <div className="codascope-concept-grid">
          {filteredConcepts.map((concept) => (
            <div
              key={concept.id}
              className={`codascope-concept-card ${expandedId === concept.id ? "codascope-concept-card--expanded" : ""}`}
              onClick={() => setExpandedId(expandedId === concept.id ? null : concept.id)}
            >
              <div className="codascope-concept-card-header">
                <div className="codascope-concept-card-name">{concept.name}</div>
                <div className="codascope-concept-card-badges">
                  <span className={`codascope-concept-badge codascope-concept-badge--${concept.category}`}>
                    {concept.category}
                  </span>
                  <span className={`codascope-concept-badge codascope-concept-badge--source-${concept.source}`}>
                    {concept.source === "extracted" ? "🤖" : "✍️"} {concept.source}
                  </span>
                </div>
              </div>
              <div className="codascope-concept-card-desc">{concept.description}</div>

              {expandedId === concept.id && (
                <div className="codascope-concept-card-detail">
                  {concept.relatedFiles.length > 0 && (
                    <div className="codascope-concept-detail-section">
                      <div className="codascope-concept-detail-label">Related Files</div>
                      <div className="codascope-concept-detail-files">
                        {concept.relatedFiles.map((f) => (
                          <code key={f} className="codascope-concept-file">{f}</code>
                        ))}
                      </div>
                    </div>
                  )}
                  {concept.wikiTopicId && (
                    <div className="codascope-concept-detail-section">
                      <div className="codascope-concept-detail-label">Wiki Topic</div>
                      <span className="codascope-concept-wiki-link">{concept.wikiTopicId}</span>
                    </div>
                  )}
                  <div className="codascope-concept-card-actions">
                    <button
                      className="codascope-btn codascope-btn--sm codascope-btn--danger"
                      onClick={(e) => { e.stopPropagation(); handleDelete(concept.id); }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Concept Modal */}
      {showAddModal && (
        <AddConceptModal onClose={() => setShowAddModal(false)} onAdd={handleAdd} />
      )}
    </div>
  );
}

function AddConceptModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, description: string, category: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");

  return (
    <div className="codascope-modal-overlay" onClick={onClose}>
      <div className="codascope-modal" onClick={(e) => e.stopPropagation()}>
        <div className="codascope-modal-header">
          <div className="codascope-modal-title">Add Concept</div>
          <button className="codascope-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="codascope-modal-body">
          <label className="codascope-form-label">
            Name
            <input
              className="codascope-form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Task Scheduling"
              autoFocus
            />
          </label>
          <label className="codascope-form-label">
            Description
            <textarea
              className="codascope-form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the concept…"
              rows={3}
            />
          </label>
          <label className="codascope-form-label">
            Category
            <select
              className="codascope-form-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.filter((c) => c.key !== "all").map((c) => (
                <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="codascope-modal-footer">
          <button className="codascope-btn" onClick={onClose}>Cancel</button>
          <button
            className="codascope-btn codascope-btn--primary"
            disabled={!name.trim()}
            onClick={() => onAdd(name.trim(), description.trim(), category)}
          >
            Add Concept
          </button>
        </div>
      </div>
    </div>
  );
}
