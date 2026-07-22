/* ── CodaScope: Skill Service ─────────────────────────────────────────
   Manages framework commands (Tier 1) and project-level skills (Tier 2).
   Merges both tiers into a unified list, handles override resolution,
   and validates skill manifests.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  tier: "framework" | "project";
  lockType: "read" | "write";
}

// ── Framework commands (Tier 1, compiled into the app) ──────────────

const FRAMEWORK_SKILLS: SkillInfo[] = [
  { id: "do_explore", name: "Explore Codebase", description: "Full codebase exploration — discover concepts, architecture, modules", category: "exploration", tags: ["discovery", "architecture"], tier: "framework", lockType: "write" },
  { id: "do_build_wiki_page", name: "Build Wiki Page", description: "Build or update a single wiki topic page with Mermaid diagrams", category: "documentation", tags: ["wiki", "mermaid"], tier: "framework", lockType: "write" },
  { id: "do_build_full_wiki", name: "Build Full Wiki", description: "Orchestrate building the complete wiki from codebase analysis", category: "documentation", tags: ["wiki", "full-build"], tier: "framework", lockType: "write" },
  { id: "do_chat", name: "Codebase Q&A", description: "Answer a user's question using wiki and code context", category: "exploration", tags: ["chat", "qa"], tier: "framework", lockType: "read" },
  { id: "do_diff_analysis", name: "Diff Analysis", description: "Analyze changes since last version", category: "analysis", tags: ["diff", "changes"], tier: "framework", lockType: "read" },
  { id: "do_git_insights", name: "Git Insights", description: "Analyze git history for hot files, churn, contributors", category: "analysis", tags: ["git", "churn", "hot-files"], tier: "framework", lockType: "write" },
];

export class CodaScopeSkillService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  // ── Find project directory ────────────────────────────────────────

  private findProjectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw);
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch {
          // Skip
        }
      }
    }
    return null;
  }

  // ── List all skills (merged framework + project) ──────────────────

  async listSkills(projectId: string): Promise<SkillInfo[]> {
    const projectDir = this.findProjectDir(projectId);
    const projectSkills = projectDir ? this.loadProjectSkills(projectDir) : [];

    // Project skills override framework skills with the same ID
    const projectSkillIds = new Set(projectSkills.map((s) => s.id));
    const frameworkNotOverridden = FRAMEWORK_SKILLS.filter((s) => !projectSkillIds.has(s.id));

    return [...frameworkNotOverridden, ...projectSkills];
  }

  // ── Load project-level skills ─────────────────────────────────────

  private loadProjectSkills(projectDir: string): SkillInfo[] {
    const skillsDir = path.join(projectDir, "skills");
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(skillsDir, entry.name, "skill.json");
      if (existsSync(manifestPath)) {
        try {
          const raw = readFileSync(manifestPath, "utf-8");
          const data = JSON.parse(raw);
          skills.push({
            id: data.id ?? entry.name,
            name: data.name ?? entry.name,
            description: data.description ?? "",
            category: data.category ?? "custom",
            tags: data.tags ?? [],
            tier: "project",
            lockType: data.lockType ?? "write",
          });
        } catch {
          // Skip malformed
        }
      }
    }

    return skills;
  }

  // ── Create project skill ──────────────────────────────────────────

  async createSkill(projectId: string, skill: { name: string; description: string; category: string }): Promise<SkillInfo> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const skillId = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
    const skillDir = path.join(projectDir, "skills", assertSafePathSegment(skillId, "skill ID"));
    mkdirSync(skillDir, { recursive: true });

    const manifest = {
      id: skillId,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      icon: "custom",
      createdBy: "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputs: [],
      outputs: { type: "wiki_page", target: `wiki/${skillId}.md` },
      prerequisites: [],
      lockType: "write",
      tags: [skill.category],
    };

    writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(skillDir, "prompt.md"), `# ${skill.name}\n\n${skill.description}\n\n<!-- Write your agent prompt here -->\n`);

    return {
      id: skillId,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: [skill.category],
      tier: "project",
      lockType: "write",
    };
  }

  // ── Run a skill ───────────────────────────────────────────────────

  async runSkill(projectId: string, skillId: string, _model?: string): Promise<{ message: string }> {
    // TODO: Integrate with Cursor SDK agent via CodaScopeAgentService
    console.log(`[codascope] Skill run requested: ${skillId} for project ${projectId}`);
    return { message: `Skill "${skillId}" execution started. (Agent integration pending)` };
  }
}
