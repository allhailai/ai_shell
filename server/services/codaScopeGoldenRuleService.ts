/* ── CodaScope: Golden Rule Service ──────────────────────────────────
   CRUD for user-curated coding and architectural standards.
   Rules persist in golden-rules.json per project and are injected
   into quality scan agent prompts.

   Storage: <projectDir>/golden-rules.json
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface GoldenRule {
  id: string;
  name: string;
  description: string;
  category: GoldenRuleCategory;
  severity: GoldenRuleSeverity;
  enabled: boolean;
  appliesTo: GoldenRuleScope[];
  codePatterns: string[];
  createdAt: string;
  updatedAt: string;
}

export type GoldenRuleCategory =
  | "security"
  | "architecture"
  | "data"
  | "testing"
  | "style"
  | "performance";

export type GoldenRuleSeverity = "critical" | "warning" | "info";

export type GoldenRuleScope = "frontend" | "backend" | "all";

export interface GoldenRuleCreateInput {
  name: string;
  description: string;
  category: GoldenRuleCategory;
  severity: GoldenRuleSeverity;
  appliesTo?: GoldenRuleScope[];
  codePatterns?: string[];
}

export interface GoldenRuleUpdateInput {
  name?: string;
  description?: string;
  category?: GoldenRuleCategory;
  severity?: GoldenRuleSeverity;
  appliesTo?: GoldenRuleScope[];
  codePatterns?: string[];
}

interface GoldenRulesFile {
  rules: GoldenRule[];
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeGoldenRuleService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path Helpers ─────────────────────────────────────────────────── */

  private rulesPath(projectId: string): string {
    return path.join(this.root, projectId, "golden-rules.json");
  }

  /* ── Read/Write ───────────────────────────────────────────────────── */

  private readRules(projectId: string): GoldenRule[] {
    const filePath = this.rulesPath(projectId);
    if (!existsSync(filePath)) return [];
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed: GoldenRulesFile = JSON.parse(raw);
      return parsed.rules ?? [];
    } catch {
      return [];
    }
  }

  private writeRules(projectId: string, rules: GoldenRule[]): void {
    const dir = path.join(this.root, projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const file: GoldenRulesFile = { rules };
    writeFileSync(this.rulesPath(projectId), JSON.stringify(file, null, 2), "utf-8");
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all rules, optionally filtered. */
  listRules(projectId: string, filters?: {
    category?: string;
    severity?: string;
    enabled?: boolean;
  }): GoldenRule[] {
    let rules = this.readRules(projectId);

    if (filters?.category) {
      rules = rules.filter((r) => r.category === filters.category);
    }
    if (filters?.severity) {
      rules = rules.filter((r) => r.severity === filters.severity);
    }
    if (filters?.enabled !== undefined) {
      rules = rules.filter((r) => r.enabled === filters.enabled);
    }

    return rules;
  }

  /** Get a single rule by ID. */
  getRule(projectId: string, ruleId: string): GoldenRule | null {
    const rules = this.readRules(projectId);
    return rules.find((r) => r.id === ruleId) ?? null;
  }

  /** Create a new golden rule. */
  createRule(projectId: string, input: GoldenRuleCreateInput): GoldenRule {
    const rules = this.readRules(projectId);
    const now = new Date().toISOString();
    const rule: GoldenRule = {
      id: `rule-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description,
      category: input.category,
      severity: input.severity,
      enabled: true,
      appliesTo: input.appliesTo ?? ["all"],
      codePatterns: input.codePatterns ?? [],
      createdAt: now,
      updatedAt: now,
    };
    rules.push(rule);
    this.writeRules(projectId, rules);
    return rule;
  }

  /** Update an existing rule. */
  updateRule(projectId: string, ruleId: string, input: GoldenRuleUpdateInput): GoldenRule | null {
    const rules = this.readRules(projectId);
    const idx = rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return null;

    const existing = rules[idx];
    const updated: GoldenRule = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      category: input.category ?? existing.category,
      severity: input.severity ?? existing.severity,
      appliesTo: input.appliesTo ?? existing.appliesTo,
      codePatterns: input.codePatterns ?? existing.codePatterns,
      updatedAt: new Date().toISOString(),
    };
    rules[idx] = updated;
    this.writeRules(projectId, rules);
    return updated;
  }

  /** Delete a rule by ID. */
  deleteRule(projectId: string, ruleId: string): boolean {
    const rules = this.readRules(projectId);
    const idx = rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    this.writeRules(projectId, rules);
    return true;
  }

  /** Toggle a rule's enabled/disabled state. */
  toggleRule(projectId: string, ruleId: string): GoldenRule | null {
    const rules = this.readRules(projectId);
    const idx = rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return null;

    rules[idx].enabled = !rules[idx].enabled;
    rules[idx].updatedAt = new Date().toISOString();
    this.writeRules(projectId, rules);
    return rules[idx];
  }

  /* ── Prompt Export ────────────────────────────────────────────────── */

  /**
   * Export active (enabled) golden rules as a formatted prompt fragment
   * for injection into quality scan agent prompts via {{GOLDEN_RULES}}.
   */
  exportActiveRulesAsPrompt(projectId: string): string {
    const rules = this.readRules(projectId).filter((r) => r.enabled);

    if (rules.length === 0) {
      return "(No golden rules defined. Skip golden rule evaluation.)";
    }

    const lines: string[] = [
      `The following ${rules.length} Golden Rule${rules.length !== 1 ? "s" : ""} must be evaluated:`,
      "",
    ];

    // Group by category
    const byCategory = new Map<string, GoldenRule[]>();
    for (const rule of rules) {
      const list = byCategory.get(rule.category) ?? [];
      list.push(rule);
      byCategory.set(rule.category, list);
    }

    for (const [category, categoryRules] of byCategory) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)} Rules`);
      lines.push("");
      for (const rule of categoryRules) {
        lines.push(`- **[${rule.severity.toUpperCase()}]** ${rule.name} (ID: ${rule.id})`);
        lines.push(`  ${rule.description}`);
        if (rule.appliesTo.length > 0 && !rule.appliesTo.includes("all")) {
          lines.push(`  Applies to: ${rule.appliesTo.join(", ")}`);
        }
        if (rule.codePatterns.length > 0) {
          lines.push(`  Look for patterns: ${rule.codePatterns.join(", ")}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /** Count of active (enabled) rules. */
  getActiveRuleCount(projectId: string): number {
    return this.readRules(projectId).filter((r) => r.enabled).length;
  }

  /** Total count of all rules. */
  getTotalRuleCount(projectId: string): number {
    return this.readRules(projectId).length;
  }
}
