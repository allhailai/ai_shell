/* ── CodaScope: Quality Dashboard ────────────────────────────────────
   Three-level drill-down quality view:
   Level 1: Overview (score gauge, category cards)
   Level 2: Category detail (issue list)
   Level 3: Issue detail (inline expansion)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, type ComponentType } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import {
  IconFolder,
  IconRefresh,
  IconLock,
  IconArchitecture,
  IconFlask,
  IconClipboard,
  IconClock,
  IconQuality,
  IconCheck,
  IconRules,
} from "../components/CodaScopeIcons";

interface QualityIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  suggestion: string;
  goldenRuleId: string | null;
}

interface QualityCategory {
  score: number;
  issueCount: number;
  bySeverity: { critical: number; warning: number; info: number };
  issues: QualityIssue[];
}

interface QualitySummary {
  overallScore: number;
  totalIssues: number;
  bySeverity: { critical: number; warning: number; info: number };
  goldenRuleViolations: number;
}

interface LatestReport {
  summary: QualitySummary;
  scanId: string;
  timestamp: string;
  scanScope: string;
}

interface FullReport {
  scanId: string;
  timestamp: string;
  modelId: string;
  repositoryPaths: string[];
  scanScope: string;
  summary: QualitySummary;
  categories: Record<string, QualityCategory>;
}

const CATEGORY_META: Record<string, { label: string; icon: ComponentType<{ size?: number }> }> = {
  dead_code: { label: "Dead Code", icon: IconFolder },
  complexity: { label: "Complexity", icon: IconRefresh },
  security: { label: "Security", icon: IconLock },
  architecture: { label: "Architecture", icon: IconArchitecture },
  data: { label: "Data", icon: IconQuality },
  testing: { label: "Testing", icon: IconFlask },
  duplication: { label: "Duplication", icon: IconClipboard },
};

function scoreColor(score: number): string {
  if (score >= 90) return "var(--color-success, #22c55e)";
  if (score >= 70) return "var(--color-info, #3b82f6)";
  if (score >= 50) return "var(--color-warning, #f59e0b)";
  return "var(--color-danger, #ef4444)";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Needs Work";
}

export function QualityDashboard() {
  const { activeProjectId: activeProject } = useCodaScopeStore();
  const { segments, navigate } = useAppSubRoute("codascope");
  const [latestReport, setLatestReport] = useState<LatestReport | null>(null);
  const [fullReport, setFullReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  // Parse sub-route: /quality or /quality/category/:categoryId
  const categoryView = segments.length >= 5 && segments[3] === "category" ? segments[4] : null;

  const fetchLatest = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/codascope/projects/${activeProject}/quality/latest`);
      if (res.ok) {
        const data = await res.json();
        setLatestReport(data.report);

        // If we have a report, fetch the full report for category drill-down
        if (data.report?.scanId) {
          const fullRes = await fetch(
            `/api/codascope/projects/${activeProject}/quality/scans/${data.report.scanId}`,
          );
          if (fullRes.ok) {
            const fullData = await fullRes.json();
            setFullReport(fullData.report);
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => { fetchLatest(); }, [fetchLatest]);

  if (loading) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconClock size={32} /></div>
          <div className="codascope-empty-state-text">Loading quality data…</div>
        </div>
      </div>
    );
  }

  // Empty state — no scans yet
  if (!latestReport) {
    return (
      <div className="codascope-page">
        <div className="codascope-page-header">
          <div className="codascope-page-title">Quality Dashboard</div>
        </div>
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconQuality size={32} /></div>
          <div className="codascope-empty-state-title">No quality scans yet</div>
          <div className="codascope-empty-state-text">
            Run an analysis with Quality enabled to see your codebase health.
            Go to the Dashboard and click "Analyze Codebase" with Quality toggled on.
          </div>
        </div>
      </div>
    );
  }

  // Level 2: Category detail view
  if (categoryView && fullReport) {
    const categoryData = fullReport.categories[categoryView];
    const meta = CATEGORY_META[categoryView] ?? { label: categoryView, icon: IconFolder };

    return (
      <div className="codascope-page">
        <div className="codascope-page-header">
          <div>
            <button
              className="codascope-breadcrumb-back"
              onClick={() => navigate(`project/${activeProject}/quality`)}
            >
              ← Quality Overview
            </button>
            <div className="codascope-page-title"><meta.icon size={18} /> {meta.label}</div>
            {categoryData && (
              <div className="codascope-page-subtitle">
                Score: {categoryData.score}/100 · {categoryData.issueCount} issue{categoryData.issueCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {!categoryData ? (
          <div className="codascope-empty-state">
            <div className="codascope-empty-state-text">No data for this category.</div>
          </div>
        ) : categoryData.issues.length === 0 ? (
          <div className="codascope-empty-state">
            <div className="codascope-empty-state-icon"><IconCheck size={32} /></div>
            <div className="codascope-empty-state-title">No issues found</div>
            <div className="codascope-empty-state-text">
              This category scored {categoryData.score}/100 with no issues detected.
            </div>
          </div>
        ) : (
          <div className="codascope-quality-issues">
            {categoryData.issues.map((issue) => (
              <div
                key={issue.id}
                className={`codascope-quality-issue ${expandedIssue === issue.id ? "codascope-quality-issue--expanded" : ""}`}
                onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}
              >
                <div className="codascope-quality-issue-header">
                  <span className={`codascope-severity-badge codascope-severity-badge--${issue.severity}`}>
                    {issue.severity}
                  </span>
                  <span className="codascope-quality-issue-title">{issue.title}</span>
                  <code className="codascope-quality-issue-file">{issue.file}:{issue.line}</code>
                  {issue.goldenRuleId && (
                    <span className="codascope-quality-golden-badge" title="Golden Rule Violation"><IconRules size={12} /></span>
                  )}
                </div>

                {expandedIssue === issue.id && (
                  <div className="codascope-quality-issue-detail">
                    <div className="codascope-quality-issue-desc">{issue.description}</div>
                    <div className="codascope-quality-issue-meta">
                      <strong>File:</strong> <code>{issue.file}</code>
                      {issue.endLine
                        ? <> (lines {issue.line}–{issue.endLine})</>
                        : <> (line {issue.line})</>
                      }
                    </div>
                    <div className="codascope-quality-issue-suggestion">
                      <strong>Suggestion:</strong> {issue.suggestion}
                    </div>
                    {issue.goldenRuleId && (
                      <div className="codascope-quality-issue-rule">
                        <IconRules size={12} /> Golden Rule violation: {issue.goldenRuleId}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Level 1: Overview
  const { summary } = latestReport;
  const scanTime = new Date(latestReport.timestamp).toLocaleString();

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">Quality Dashboard</div>
          <div className="codascope-page-subtitle">
            Last scanned: {scanTime} · Scope: {latestReport.scanScope}
          </div>
        </div>
      </div>

      {/* Score Gauge */}
      <div className="codascope-quality-score-section">
        <div className="codascope-quality-score-gauge">
          <svg viewBox="0 0 120 120" className="codascope-quality-score-svg">
            {/* Background arc */}
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-border-primary)" strokeWidth="10" strokeDasharray="235 79" strokeLinecap="round" transform="rotate(135 60 60)" />
            {/* Score arc */}
            <circle cx="60" cy="60" r="50" fill="none" stroke={scoreColor(summary.overallScore)} strokeWidth="10" strokeDasharray={`${(summary.overallScore / 100) * 235} 314`} strokeLinecap="round" transform="rotate(135 60 60)" style={{ transition: "stroke-dasharray 0.6s ease" }} />
          </svg>
          <div className="codascope-quality-score-value">
            <span className="codascope-quality-score-number" style={{ color: scoreColor(summary.overallScore) }}>
              {summary.overallScore}
            </span>
            <span className="codascope-quality-score-label">{scoreLabel(summary.overallScore)}</span>
          </div>
        </div>

        {/* Severity Summary */}
        <div className="codascope-quality-severity-summary">
          <div className="codascope-quality-severity-item codascope-quality-severity--critical">
            <span className="codascope-quality-severity-count">{summary.bySeverity.critical}</span>
            <span className="codascope-quality-severity-label">Critical</span>
          </div>
          <div className="codascope-quality-severity-item codascope-quality-severity--warning">
            <span className="codascope-quality-severity-count">{summary.bySeverity.warning}</span>
            <span className="codascope-quality-severity-label">Warning</span>
          </div>
          <div className="codascope-quality-severity-item codascope-quality-severity--info">
            <span className="codascope-quality-severity-count">{summary.bySeverity.info}</span>
            <span className="codascope-quality-severity-label">Info</span>
          </div>
          {summary.goldenRuleViolations > 0 && (
            <div className="codascope-quality-severity-item codascope-quality-severity--golden">
              <span className="codascope-quality-severity-count">{summary.goldenRuleViolations}</span>
              <span className="codascope-quality-severity-label"><IconRules size={12} /> Rule Violations</span>
            </div>
          )}
        </div>
      </div>

      {/* Category Cards */}
      {fullReport && (
        <div className="codascope-quality-categories">
          {Object.entries(fullReport.categories).map(([key, cat]) => {
            const meta = CATEGORY_META[key] ?? { label: key, icon: IconFolder };
            return (
              <div
                key={key}
                className="codascope-quality-category-card"
                onClick={() => navigate(`project/${activeProject}/quality/category/${key}`)}
              >
                <div className="codascope-quality-category-icon"><meta.icon size={20} /></div>
                <div className="codascope-quality-category-name">{meta.label}</div>
                <div className="codascope-quality-category-score" style={{ color: scoreColor(cat.score) }}>
                  {cat.score}
                </div>
                <div className="codascope-quality-category-bar">
                  <div
                    className="codascope-quality-category-bar-fill"
                    style={{ width: `${cat.score}%`, background: scoreColor(cat.score) }}
                  />
                </div>
                <div className="codascope-quality-category-issues">
                  {cat.issueCount} issue{cat.issueCount !== 1 ? "s" : ""}
                  {cat.bySeverity.critical > 0 && (
                    <span className="codascope-quality-dot codascope-quality-dot--critical" title={`${cat.bySeverity.critical} critical`} />
                  )}
                  {cat.bySeverity.warning > 0 && (
                    <span className="codascope-quality-dot codascope-quality-dot--warning" title={`${cat.bySeverity.warning} warning`} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
