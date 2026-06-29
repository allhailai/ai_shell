/* ── CodaScope: Golden Rules Manager ─────────────────────────────────
   CRUD UI for user-curated coding and architectural standards.
   Rules are evaluated during quality scans.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";

interface GoldenRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: boolean;
  appliesTo: string[];
  codePatterns: string[];
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { key: "security", label: "Security", icon: "🔒" },
  { key: "architecture", label: "Architecture", icon: "🏗️" },
  { key: "data", label: "Data", icon: "💾" },
  { key: "testing", label: "Testing", icon: "🧪" },
  { key: "style", label: "Style", icon: "🎨" },
  { key: "performance", label: "Performance", icon: "⚡" },
];

const SEVERITIES = [
  { key: "critical", label: "Critical", color: "var(--color-danger, #ef4444)" },
  { key: "warning", label: "Warning", color: "var(--color-warning, #f59e0b)" },
  { key: "info", label: "Info", color: "var(--color-info, #3b82f6)" },
];

export function GoldenRules() {
  const { activeProject } = useCodaScopeStore();
  const [rules, setRules] = useState<GoldenRule[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set("category", filterCategory);
      if (filterSeverity) params.set("severity", filterSeverity);
      const res = await fetch(`/api/codascope/projects/${activeProject}/golden-rules?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules ?? []);
        setActiveCount(data.activeCount ?? 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeProject, filterCategory, filterSeverity]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleToggle = async (ruleId: string) => {
    if (!activeProject) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProject}/golden-rules/${ruleId}/toggle`,
        { method: "PATCH" },
      );
      if (res.ok) {
        const data = await res.json();
        setRules((prev) => prev.map((r) => r.id === ruleId ? data.rule : r));
        setActiveCount((prev) => data.rule.enabled ? prev + 1 : prev - 1);
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (ruleId: string) => {
    if (!activeProject) return;
    try {
      await fetch(`/api/codascope/projects/${activeProject}/golden-rules/${ruleId}`, { method: "DELETE" });
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      fetchRules();
    } catch { /* ignore */ }
  };

  const handleAdd = async (rule: {
    name: string; description: string; category: string;
    severity: string; appliesTo: string[]; codePatterns: string[];
  }) => {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProject}/golden-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        setShowAddModal(false);
        fetchRules();
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon">⏳</div>
          <div className="codascope-empty-state-text">Loading rules…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">Golden Rules</div>
          <div className="codascope-page-subtitle">
            {activeCount} active rule{activeCount !== 1 ? "s" : ""} evaluated during quality scans
          </div>
        </div>
        <button className="codascope-btn codascope-btn--primary" onClick={() => setShowAddModal(true)}>
          + Add Rule
        </button>
      </div>

      {/* Filters */}
      <div className="codascope-rules-filters">
        <select
          className="codascope-form-select codascope-form-select--sm"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
          ))}
        </select>
        <select
          className="codascope-form-select codascope-form-select--sm"
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
        >
          <option value="">All Severities</option>
          {SEVERITIES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon">📜</div>
          <div className="codascope-empty-state-title">No golden rules yet</div>
          <div className="codascope-empty-state-text">
            Add rules to define coding standards evaluated during quality scans.
          </div>
        </div>
      ) : (
        <div className="codascope-rules-list">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`codascope-rule-card ${!rule.enabled ? "codascope-rule-card--disabled" : ""}`}
            >
              <div className="codascope-rule-card-main" onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}>
                <label className="codascope-rule-toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => handleToggle(rule.id)}
                  />
                  <span className="codascope-rule-toggle-track" />
                </label>
                <div className="codascope-rule-card-content">
                  <div className="codascope-rule-card-title">{rule.name}</div>
                  <div className="codascope-rule-card-badges">
                    <span className={`codascope-severity-badge codascope-severity-badge--${rule.severity}`}>
                      {rule.severity}
                    </span>
                    <span className="codascope-category-badge">
                      {CATEGORIES.find((c) => c.key === rule.category)?.icon} {rule.category}
                    </span>
                  </div>
                </div>
                <span className="codascope-rule-expand">{expandedId === rule.id ? "▾" : "▸"}</span>
              </div>

              {expandedId === rule.id && (
                <div className="codascope-rule-card-detail">
                  <div className="codascope-rule-description">{rule.description}</div>
                  {rule.appliesTo.length > 0 && (
                    <div className="codascope-rule-meta">
                      <strong>Applies to:</strong> {rule.appliesTo.join(", ")}
                    </div>
                  )}
                  {rule.codePatterns.length > 0 && (
                    <div className="codascope-rule-meta">
                      <strong>Patterns:</strong> {rule.codePatterns.map((p) => (
                        <code key={p} className="codascope-rule-pattern">{p}</code>
                      ))}
                    </div>
                  )}
                  <div className="codascope-rule-card-actions">
                    <button
                      className="codascope-btn codascope-btn--sm codascope-btn--danger"
                      onClick={() => handleDelete(rule.id)}
                    >
                      Delete Rule
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddRuleModal onClose={() => setShowAddModal(false)} onAdd={handleAdd} />
      )}
    </div>
  );
}

function AddRuleModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (rule: {
    name: string; description: string; category: string;
    severity: string; appliesTo: string[]; codePatterns: string[];
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("architecture");
  const [severity, setSeverity] = useState("warning");
  const [appliesTo, setAppliesTo] = useState<string[]>(["all"]);
  const [patterns, setPatterns] = useState("");

  return (
    <div className="codascope-modal-overlay" onClick={onClose}>
      <div className="codascope-modal codascope-modal--lg" onClick={(e) => e.stopPropagation()}>
        <div className="codascope-modal-header">
          <div className="codascope-modal-title">Add Golden Rule</div>
          <button className="codascope-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="codascope-modal-body">
          <label className="codascope-form-label">
            Rule Name
            <input
              className="codascope-form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. All API endpoints require authentication"
              autoFocus
            />
          </label>
          <label className="codascope-form-label">
            Description
            <textarea
              className="codascope-form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description of what the rule enforces…"
              rows={3}
            />
          </label>
          <div className="codascope-form-row">
            <label className="codascope-form-label">
              Category
              <select className="codascope-form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                ))}
              </select>
            </label>
            <label className="codascope-form-label">
              Severity
              <select className="codascope-form-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="codascope-form-label">
            Applies To
            <div className="codascope-form-checkbox-group">
              {["all", "backend", "frontend"].map((scope) => (
                <label key={scope} className="codascope-form-checkbox">
                  <input
                    type="checkbox"
                    checked={appliesTo.includes(scope)}
                    onChange={(e) => {
                      if (e.target.checked) setAppliesTo([...appliesTo, scope]);
                      else setAppliesTo(appliesTo.filter((s) => s !== scope));
                    }}
                  />
                  {scope}
                </label>
              ))}
            </div>
          </label>
          <label className="codascope-form-label">
            Code Patterns (comma-separated)
            <input
              className="codascope-form-input"
              value={patterns}
              onChange={(e) => setPatterns(e.target.value)}
              placeholder="e.g. router.ex, plug, authenticate"
            />
          </label>
        </div>
        <div className="codascope-modal-footer">
          <button className="codascope-btn" onClick={onClose}>Cancel</button>
          <button
            className="codascope-btn codascope-btn--primary"
            disabled={!name.trim()}
            onClick={() => onAdd({
              name: name.trim(),
              description: description.trim(),
              category,
              severity,
              appliesTo,
              codePatterns: patterns.split(",").map((p) => p.trim()).filter(Boolean),
            })}
          >
            Add Rule
          </button>
        </div>
      </div>
    </div>
  );
}
