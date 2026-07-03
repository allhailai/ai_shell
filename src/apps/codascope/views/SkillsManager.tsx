/* ── CodaScope: SkillsManager View ────────────────────────────────────
   Displays framework skills (read-only) and project skills (CRUD).
   Runs skills via SSE streaming from the agent service.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { useCodaScopeStore, type SkillInfo } from "../useCodaScopeStore";
import { ModelPicker } from "../components/ModelPicker";
import { IconSkills } from "../components/CodaScopeIcons";
import { connectToSseStream } from "../codaScopeSseClient";

export function SkillsManager() {
  const {
    activeProjectId,
    skills,
    setSkills,
    agentRunning,
    selectedModel,
    setSelectedModel,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: "", description: "", category: "analysis" });
  const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const outputEndRef = useRef<HTMLDivElement | null>(null);

  // ── Fetch skills ──────────────────────────────────────────────────

  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/skills`);
        if (res.ok) {
          const data = await res.json();
          setSkills(data.skills ?? []);
        }
      } catch {
        // Silently fail
      }
    })();
  }, [activeProjectId, setSkills]);

  // ── Run skill via SSE ─────────────────────────────────────────────

  const handleRunSkill = useCallback(async (skill: SkillInfo) => {
    if (agentRunning || !activeProjectId || !selectedModel) return;

    if (skill.lockType === "write") {
      setAgentRunning(true);
      setAgentStatus(`Running ${skill.name}…`);
    }
    setRunningSkillId(skill.id);
    setRunOutput("");
    setRunError("");

    try {
      await new Promise<void>((resolve, reject) => {
        connectToSseStream(
          {
            url: `/api/codascope/projects/${activeProjectId}/skills/${skill.id}/run`,
            method: "POST",
            body: { modelId: selectedModel },
          },
          {
            onText: (text) => setRunOutput((prev) => prev + text),
            onDone: () => resolve(),
            onError: (error) => reject(new Error(error)),
          },
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setRunError(message);
    } finally {
      setRunningSkillId(null);
      if (skill.lockType === "write") {
        setAgentRunning(false);
        setAgentStatus("");
      }
    }
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus]);

  // ── Auto-scroll output ────────────────────────────────────────────

  useEffect(() => {
    if (outputEndRef.current && runOutput) {
      outputEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [runOutput]);

  // ── Create skill ──────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!activeProjectId || !newSkill.name.trim()) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSkill.name.trim(),
          description: newSkill.description.trim(),
          category: newSkill.category,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkills([...skills, data.skill]);
        setNewSkill({ name: "", description: "", category: "analysis" });
        setShowCreate(false);
      }
    } catch {
      // Silently fail
    }
  }, [activeProjectId, newSkill, skills, setSkills]);

  if (!activeProjectId) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon"><IconSkills size={32} /></div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project to manage its skills.
        </div>
      </div>
    );
  }

  const frameworkSkills = skills.filter((s) => s.tier === "framework");
  const projectSkills = skills.filter((s) => s.tier === "project");

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">Skills</div>
          <div className="codascope-page-subtitle">
            {frameworkSkills.length} framework • {projectSkills.length} project skills
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <ModelPicker value={selectedModel} onChange={setSelectedModel} compact />
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            + New Skill
          </button>
        </div>
      </div>

      {/* Run output panel */}
      {(runOutput || runError) && (
        <div className="codascope-build-log" style={{ marginBottom: "var(--space-4)" }}>
          <div className="codascope-build-log-header">
            <span>
              {runningSkillId ? "⟳ Skill Running…" : runError ? "✗ Error" : "✓ Complete"}
            </span>
            {!runningSkillId && (
              <button
                className="codascope-btn codascope-btn-ghost"
                style={{ fontSize: "var(--text-xs)", padding: "2px 6px" }}
                onClick={() => { setRunOutput(""); setRunError(""); }}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <pre className="codascope-build-log-content">
            {runError && (
              <span className="codascope-error-text">{runError}</span>
            )}
            {runOutput}
            <div ref={outputEndRef} />
          </pre>
        </div>
      )}

      {/* Create skill form */}
      {showCreate && (
        <div style={{
          padding: "var(--space-5)",
          marginBottom: "var(--space-4)",
          borderRadius: "var(--radius-xl)",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
        }}>
          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="skill-name">Skill Name</label>
            <input
              className="codascope-form-input"
              id="skill-name"
              type="text"
              placeholder="Analyze Ecto Schemas"
              value={newSkill.name}
              onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
            />
          </div>
          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="skill-desc">Description</label>
            <input
              className="codascope-form-input"
              id="skill-desc"
              type="text"
              placeholder="Map all Ecto schemas and document relationships"
              value={newSkill.description}
              onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })}
            />
          </div>
          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="skill-category">Category</label>
            <select
              className="codascope-form-input"
              id="skill-category"
              value={newSkill.category}
              onChange={(e) => setNewSkill({ ...newSkill, category: e.target.value })}
            >
              <option value="analysis">Analysis</option>
              <option value="documentation">Documentation</option>
              <option value="review">Review</option>
              <option value="exploration">Exploration</option>
              <option value="planning">Planning</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="codascope-form-actions">
            <button className="codascope-btn codascope-btn-primary" onClick={handleCreate} type="button">
              Create Skill
            </button>
            <button className="codascope-btn codascope-btn-ghost" onClick={() => setShowCreate(false)} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Framework skills */}
      {frameworkSkills.length > 0 && (
        <>
          <div style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-tertiary)",
            marginBottom: "var(--space-3)",
          }}>
            Framework Skills
          </div>
          <div className="codascope-skills-grid" style={{ marginBottom: "var(--space-6)" }}>
            {frameworkSkills.map((skill) => (
              <div key={skill.id} className="codascope-skill-card">
                <div className="codascope-skill-card-header">
                  <span className="codascope-skill-card-name">{skill.name}</span>
                  <span className="codascope-skill-card-badge codascope-skill-card-badge--framework">
                    Framework
                  </span>
                </div>
                <div className="codascope-skill-card-desc">{skill.description}</div>
                <div className="codascope-skill-card-tags">
                  {skill.tags.map((tag) => (
                    <span key={tag} className="codascope-skill-tag">{tag}</span>
                  ))}
                </div>
                <div style={{ marginTop: "var(--space-3)" }}>
                  <button
                    className="codascope-btn codascope-btn-secondary"
                    style={{ fontSize: "var(--text-xs)", padding: "2px 10px" }}
                    onClick={() => handleRunSkill(skill)}
                    disabled={runningSkillId === skill.id || (agentRunning && skill.lockType === "write") || !selectedModel}
                    type="button"
                  >
                    {runningSkillId === skill.id ? "Running…" : "▶ Run"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Project skills */}
      <div style={{
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-tertiary)",
        marginBottom: "var(--space-3)",
      }}>
        Project Skills
      </div>
      {projectSkills.length === 0 ? (
        <div style={{
          padding: "var(--space-5)",
          textAlign: "center",
          color: "var(--color-text-tertiary)",
          fontSize: "var(--text-sm)",
          background: "var(--color-bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border-primary)",
        }}>
          No project skills yet. Create one to add custom agentic prompts for your codebase.
        </div>
      ) : (
        <div className="codascope-skills-grid">
          {projectSkills.map((skill) => (
            <div key={skill.id} className="codascope-skill-card">
              <div className="codascope-skill-card-header">
                <span className="codascope-skill-card-name">{skill.name}</span>
                <span className="codascope-skill-card-badge codascope-skill-card-badge--project">
                  Project
                </span>
              </div>
              <div className="codascope-skill-card-desc">{skill.description}</div>
              <div className="codascope-skill-card-tags">
                <span className="codascope-skill-tag">{skill.category}</span>
                {skill.tags.map((tag) => (
                  <span key={tag} className="codascope-skill-tag">{tag}</span>
                ))}
              </div>
              <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
                <button
                  className="codascope-btn codascope-btn-secondary"
                  style={{ fontSize: "var(--text-xs)", padding: "2px 10px" }}
                  onClick={() => handleRunSkill(skill)}
                  disabled={runningSkillId === skill.id || (agentRunning && skill.lockType === "write") || !selectedModel}
                  type="button"
                >
                  {runningSkillId === skill.id ? "Running…" : "▶ Run"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
