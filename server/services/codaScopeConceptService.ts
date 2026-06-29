/* ── CodaScope: Concept Service ───────────────────────────────────────
   CRUD operations on concepts.json — domain concepts, patterns, and
   abstractions extracted from source code by the Code Map agent.

   Concepts can be:
   - "extracted" — discovered by AI during Code Map build
   - "manual" — created by the user through the UI

   Storage: <projectDir>/concepts.json
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface Concept {
  id: string;
  name: string;
  description: string;
  category: string;
  relatedConcepts: string[];
  relatedFiles: string[];
  wikiTopicId: string | null;
  source: "extracted" | "manual";
  createdAt: string;
  updatedAt?: string;
}

export type ConceptCategory =
  | "architecture"
  | "backend"
  | "frontend"
  | "data"
  | "devops"
  | "cross-cutting"
  | "features"
  | "other";

export interface ConceptCreateInput {
  name: string;
  description: string;
  category: string;
  relatedConcepts?: string[];
  relatedFiles?: string[];
  wikiTopicId?: string | null;
}

export interface ConceptUpdateInput {
  name?: string;
  description?: string;
  category?: string;
  relatedConcepts?: string[];
  relatedFiles?: string[];
  wikiTopicId?: string | null;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeConceptService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path Helpers ─────────────────────────────────────────────────── */

  private conceptsPath(projectId: string): string {
    return path.join(this.root, projectId, "concepts.json");
  }

  /* ── Read/Write ───────────────────────────────────────────────────── */

  private readConcepts(projectId: string): Concept[] {
    const filePath = this.conceptsPath(projectId);
    if (!existsSync(filePath)) return [];
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      // Handle both array format and {concepts: []} format
      return Array.isArray(parsed) ? parsed : (parsed.concepts ?? []);
    } catch {
      return [];
    }
  }

  private writeConcepts(projectId: string, concepts: Concept[]): void {
    const dir = path.join(this.root, projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.conceptsPath(projectId), JSON.stringify(concepts, null, 2), "utf-8");
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all concepts, optionally filtered by category. */
  listConcepts(projectId: string, category?: string): Concept[] {
    const concepts = this.readConcepts(projectId);
    if (category) {
      return concepts.filter((c) => c.category === category);
    }
    return concepts;
  }

  /** Get a single concept by ID. */
  getConcept(projectId: string, conceptId: string): Concept | null {
    const concepts = this.readConcepts(projectId);
    return concepts.find((c) => c.id === conceptId) ?? null;
  }

  /** Create a new manual concept. */
  createConcept(projectId: string, input: ConceptCreateInput): Concept {
    const concepts = this.readConcepts(projectId);
    const concept: Concept = {
      id: `concept-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description,
      category: input.category || "other",
      relatedConcepts: input.relatedConcepts ?? [],
      relatedFiles: input.relatedFiles ?? [],
      wikiTopicId: input.wikiTopicId ?? null,
      source: "manual",
      createdAt: new Date().toISOString(),
    };
    concepts.push(concept);
    this.writeConcepts(projectId, concepts);
    return concept;
  }

  /** Update an existing concept. */
  updateConcept(projectId: string, conceptId: string, input: ConceptUpdateInput): Concept | null {
    const concepts = this.readConcepts(projectId);
    const idx = concepts.findIndex((c) => c.id === conceptId);
    if (idx === -1) return null;

    const existing = concepts[idx];
    const updated: Concept = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      category: input.category ?? existing.category,
      relatedConcepts: input.relatedConcepts ?? existing.relatedConcepts,
      relatedFiles: input.relatedFiles ?? existing.relatedFiles,
      wikiTopicId: input.wikiTopicId !== undefined ? input.wikiTopicId : existing.wikiTopicId,
      updatedAt: new Date().toISOString(),
    };
    concepts[idx] = updated;
    this.writeConcepts(projectId, concepts);
    return updated;
  }

  /** Delete a concept by ID. */
  deleteConcept(projectId: string, conceptId: string): boolean {
    const concepts = this.readConcepts(projectId);
    const idx = concepts.findIndex((c) => c.id === conceptId);
    if (idx === -1) return false;

    concepts.splice(idx, 1);

    // Also remove from relatedConcepts in other concepts
    for (const c of concepts) {
      c.relatedConcepts = c.relatedConcepts.filter((id) => id !== conceptId);
    }

    this.writeConcepts(projectId, concepts);
    return true;
  }

  /** Get the count of concepts for a project (for dashboard stat cards). */
  getConceptCount(projectId: string): number {
    return this.readConcepts(projectId).length;
  }

  /** Get distinct categories present in the concepts. */
  getCategories(projectId: string): string[] {
    const concepts = this.readConcepts(projectId);
    const cats = new Set(concepts.map((c) => c.category));
    return [...cats].sort();
  }

  /** Link a concept to a wiki topic. */
  linkToWiki(projectId: string, conceptId: string, wikiTopicId: string): boolean {
    return this.updateConcept(projectId, conceptId, { wikiTopicId }) !== null;
  }

  /** Unlink a concept from a wiki topic. */
  unlinkFromWiki(projectId: string, conceptId: string): boolean {
    return this.updateConcept(projectId, conceptId, { wikiTopicId: null }) !== null;
  }
}
