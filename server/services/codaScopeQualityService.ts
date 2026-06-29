/* ── CodaScope: Quality Service ───────────────────────────────────────
   Reads, queries, and aggregates quality scan reports produced by the
   quality scan agent. Reports are stored as JSON files in
   <projectDir>/quality/.

   Storage layout:
     <projectDir>/quality/
       scan-<timestamp>.json  — individual scan report
       latest.json            — copy of the most recent scan
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface QualityIssue {
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

export interface QualityCategory {
  score: number;
  issueCount: number;
  bySeverity: { critical: number; warning: number; info: number };
  issues: QualityIssue[];
}

export interface QualitySummary {
  overallScore: number;
  totalIssues: number;
  bySeverity: { critical: number; warning: number; info: number };
  goldenRuleViolations: number;
}

export interface QualityReport {
  scanId: string;
  timestamp: string;
  modelId: string;
  repositoryPaths: string[];
  scanScope: string;
  duration?: string;
  summary: QualitySummary;
  categories: Record<string, QualityCategory>;
}

export interface ScanHistoryEntry {
  scanId: string;
  timestamp: string;
  modelId: string;
  scanScope: string;
  summary: QualitySummary;
}

export interface TrendDataPoint {
  scanId: string;
  timestamp: string;
  overallScore: number;
  categoryScores: Record<string, number>;
}

export type QualityCategoryKey =
  | "dead_code"
  | "complexity"
  | "security"
  | "architecture"
  | "data"
  | "testing"
  | "duplication";

export const CATEGORY_LABELS: Record<string, string> = {
  dead_code: "Dead Code",
  complexity: "Complexity",
  security: "Security",
  architecture: "Architecture",
  data: "Data",
  testing: "Testing",
  duplication: "Duplication",
};

export const CATEGORY_ICONS: Record<string, string> = {
  dead_code: "🗑️",
  complexity: "🔄",
  security: "🔒",
  architecture: "🏗️",
  data: "💾",
  testing: "🧪",
  duplication: "📋",
};

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeQualityService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path Helpers ─────────────────────────────────────────────────── */

  private qualityDir(projectId: string): string {
    return path.join(this.root, projectId, "quality");
  }

  private latestPath(projectId: string): string {
    return path.join(this.qualityDir(projectId), "latest.json");
  }

  /* ── Read Reports ─────────────────────────────────────────────────── */

  private readReport(filePath: string): QualityReport | null {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Get the latest quality report for a project. */
  getLatestReport(projectId: string): QualityReport | null {
    return this.readReport(this.latestPath(projectId));
  }

  /** Get the latest summary only (cheaper than full report). */
  getLatestSummary(projectId: string): {
    summary: QualitySummary;
    scanId: string;
    timestamp: string;
    scanScope: string;
  } | null {
    const report = this.getLatestReport(projectId);
    if (!report) return null;
    return {
      summary: report.summary,
      scanId: report.scanId,
      timestamp: report.timestamp,
      scanScope: report.scanScope,
    };
  }

  /** Get the overall quality score (for dashboard stat card). */
  getOverallScore(projectId: string): number | null {
    const report = this.getLatestReport(projectId);
    return report?.summary?.overallScore ?? null;
  }

  /** Get a specific scan report by ID. */
  getScanReport(projectId: string, scanId: string): QualityReport | null {
    const dir = this.qualityDir(projectId);
    const filePath = path.join(dir, `${scanId}.json`);
    return this.readReport(filePath);
  }

  /** Get all issues for a specific category from a scan. */
  getCategoryIssues(
    projectId: string,
    scanId: string,
    category: string,
  ): QualityCategory | null {
    const report = scanId === "latest"
      ? this.getLatestReport(projectId)
      : this.getScanReport(projectId, scanId);

    if (!report) return null;
    return report.categories[category] ?? null;
  }

  /* ── Scan History ─────────────────────────────────────────────────── */

  /** List scan history (summary only, most recent first). */
  listScans(projectId: string, limit = 20): ScanHistoryEntry[] {
    const dir = this.qualityDir(projectId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir)
      .filter((f) => f.startsWith("scan-") && f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = statSync(fullPath);
        return { file: f, path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    const entries: ScanHistoryEntry[] = [];
    for (const f of files) {
      try {
        const report: QualityReport = JSON.parse(readFileSync(f.path, "utf-8"));
        entries.push({
          scanId: report.scanId,
          timestamp: report.timestamp,
          modelId: report.modelId,
          scanScope: report.scanScope,
          summary: report.summary,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return entries;
  }

  /* ── Trend Data ───────────────────────────────────────────────────── */

  /** Get score trends across all scans (for sparkline chart). */
  getTrends(projectId: string, limit = 20): TrendDataPoint[] {
    const dir = this.qualityDir(projectId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir)
      .filter((f) => f.startsWith("scan-") && f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = statSync(fullPath);
        return { file: f, path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime) // Oldest first for trend line
      .slice(-limit); // Take the most recent N

    const points: TrendDataPoint[] = [];
    for (const f of files) {
      try {
        const report: QualityReport = JSON.parse(readFileSync(f.path, "utf-8"));
        const categoryScores: Record<string, number> = {};
        for (const [key, cat] of Object.entries(report.categories)) {
          categoryScores[key] = cat.score;
        }
        points.push({
          scanId: report.scanId,
          timestamp: report.timestamp,
          overallScore: report.summary.overallScore,
          categoryScores,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return points;
  }

  /** Check if any scans exist for a project. */
  hasScans(projectId: string): boolean {
    const dir = this.qualityDir(projectId);
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.startsWith("scan-") && f.endsWith(".json"));
  }
}
