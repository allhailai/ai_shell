#!/usr/bin/env npx tsx
/* ── CodaScope: Notes Model Migration Script ─────────────────────────
   Migrates the old NoteLevel directory layout to the new
   NoteScope + NoteVisibility structure.

   Old layout:
     <root>/_notes/<username>/           → personal notes
     <root>/_notes/_public_notes/        → public notes
     <project>/_notes/                   → project notes (undifferentiated)
     <project>/epics/<id>/_notes/        → epic notes (undifferentiated)

   New layout:
     <root>/_notes/shared/               → codascope shared notes
     <root>/_notes/private/<username>/   → codascope private notes
     <project>/_notes/shared/            → project shared notes
     <project>/_notes/private/<username>/→ project private notes
     <project>/epics/<id>/_notes/shared/ → epic shared notes
     <project>/epics/<id>/_notes/private/<username>/ → epic private notes

   Also:
     - Adds id (UUID) and owner fields to note frontmatter
     - Regenerates _notes-index.json files
     - Moves annotation sidecar files to match new paths
     - Creates _archive/ directories
     - Logs a summary

   Idempotent: safe to run multiple times.

   Usage:
     npx tsx server/scripts/migrateNotesModel.ts <projectsRoot>
   ──────────────────────────────────────────────────────────────────── */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── Config ──────────────────────────────────────────────────────────── */

const projectsRoot = process.argv[2];
if (!projectsRoot) {
  console.error("Usage: npx tsx server/scripts/migrateNotesModel.ts <projectsRoot>");
  process.exit(1);
}

const resolvedRoot = path.resolve(projectsRoot);
if (!fs.existsSync(resolvedRoot)) {
  console.error(`Projects root does not exist: ${resolvedRoot}`);
  process.exit(1);
}

/* ── Counters ────────────────────────────────────────────────────────── */

let notesMigrated = 0;
let idsAssigned = 0;
let foldersCreated = 0;
let annotationsMoved = 0;
let skipped = 0;
const errors: string[] = [];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    foldersCreated++;
  }
}

function moveFileOrDir(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) {
    // Already migrated — skip
    skipped++;
    return false;
  }
  ensureDir(path.dirname(dest));
  fs.renameSync(src, dest);
  return true;
}

/**
 * Copies all contents of srcDir into destDir (merging).
 * Does not delete srcDir — caller handles that after verification.
 */
function mergeDir(srcDir: string, destDir: string): void {
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      mergeDir(srcPath, destPath);
    } else {
      if (fs.existsSync(destPath)) {
        skipped++;
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
      notesMigrated++;
    }
  }
}

/* ── Frontmatter manipulation ────────────────────────────────────────── */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function ensureFrontmatterFields(filePath: string, owner: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = FRONTMATTER_RE.exec(content);
    if (!match) return; // Not a note with frontmatter

    let fm = match[1];
    let changed = false;

    // Add id if missing
    if (!/^id:\s/m.test(fm)) {
      const uuid = crypto.randomUUID();
      fm = `id: ${uuid}\n${fm}`;
      changed = true;
      idsAssigned++;
    }

    // Add owner if missing
    if (!/^owner:\s/m.test(fm)) {
      fm = `${fm}\nowner: ${owner}`;
      changed = true;
    }

    if (changed) {
      const updated = content.replace(FRONTMATTER_RE, `---\n${fm}\n---\n`);
      fs.writeFileSync(filePath, updated, "utf-8");
    }
  } catch (err) {
    errors.push(`Failed to update frontmatter in ${filePath}: ${err}`);
  }
}

/**
 * Walk a directory and call `ensureFrontmatterFields` on every .md file.
 */
function addFrontmatterToDir(dirPath: string, owner: string): void {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      addFrontmatterToDir(full, owner);
    } else if (entry.name.endsWith(".md")) {
      ensureFrontmatterFields(full, owner);
    }
  }
}

/* ── Index regeneration ──────────────────────────────────────────────── */

interface IndexEntry {
  path: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  wordCount: number;
}

function regenerateIndex(notesDir: string): void {
  if (!fs.existsSync(notesDir)) return;
  const entries: IndexEntry[] = [];
  collectNotes(notesDir, notesDir, entries);

  const indexPath = path.join(notesDir, "_notes-index.json");
  fs.writeFileSync(indexPath, JSON.stringify({ notes: entries, generatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

function collectNotes(baseDir: string, currentDir: string, entries: IndexEntry[]): void {
  const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of dirEntries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.endsWith(".assets")) {
      collectNotes(baseDir, full, entries);
    } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
      try {
        const content = fs.readFileSync(full, "utf-8");
        const relPath = path.relative(baseDir, full);
        const match = FRONTMATTER_RE.exec(content);
        let title = path.basename(entry.name, ".md");
        let tags: string[] = [];
        let created = "";
        let updated = "";

        if (match) {
          const titleMatch = /^title:\s*(.+)$/m.exec(match[1]);
          if (titleMatch) title = titleMatch[1].trim();
          const tagsMatch = /^tags:\s*\[([^\]]*)\]/m.exec(match[1]);
          if (tagsMatch) tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean);
          const createdMatch = /^created:\s*(.+)$/m.exec(match[1]);
          if (createdMatch) created = createdMatch[1].trim();
          const updatedMatch = /^updated:\s*(.+)$/m.exec(match[1]);
          if (updatedMatch) updated = updatedMatch[1].trim();
        }

        const body = content.replace(FRONTMATTER_RE, "").trim();
        const wordCount = body ? body.split(/\s+/).length : 0;

        entries.push({ path: relPath, title, tags, created, updated, wordCount });
      } catch (err) {
        errors.push(`Failed to index ${full}: ${err}`);
      }
    }
  }
}

/* ── Annotation sidecar migration ────────────────────────────────────── */

function moveAnnotationSidecars(oldNotesDir: string, newNotesDir: string): void {
  // Annotation sidecars are stored alongside notes as <note>.annotations.json
  if (!fs.existsSync(oldNotesDir)) return;
  const entries = fs.readdirSync(oldNotesDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(oldNotesDir, entry.name);
    if (entry.isDirectory()) {
      moveAnnotationSidecars(full, path.join(newNotesDir, entry.name));
    } else if (entry.name.endsWith(".annotations.json")) {
      const dest = path.join(newNotesDir, entry.name);
      if (!fs.existsSync(dest) && fs.existsSync(full)) {
        ensureDir(path.dirname(dest));
        fs.copyFileSync(full, dest);
        annotationsMoved++;
      }
    }
  }
}

/* ── Main migration logic ────────────────────────────────────────────── */

function migrateRootNotes(): void {
  const notesDir = path.join(resolvedRoot, "_notes");
  if (!fs.existsSync(notesDir)) {
    console.log("  No root _notes/ directory found, skipping.");
    return;
  }

  // Check if already migrated (shared/ dir exists)
  const sharedDir = path.join(notesDir, "shared");
  const privateDir = path.join(notesDir, "private");

  // Migrate _public_notes/ → shared/
  const publicDir = path.join(notesDir, "_public_notes");
  if (fs.existsSync(publicDir) && !fs.existsSync(sharedDir)) {
    console.log("  Migrating _public_notes/ → shared/");
    moveFileOrDir(publicDir, sharedDir);
    notesMigrated++;
  }

  // Migrate per-user directories → private/<username>/
  const rootEntries = fs.readdirSync(notesDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (["shared", "private", "_public_notes", "_archive"].includes(entry.name)) continue;
    if (entry.name.startsWith("_")) continue;

    // This is a username directory: _notes/<username>/ → _notes/private/<username>/
    const srcUserDir = path.join(notesDir, entry.name);
    const destUserDir = path.join(privateDir, entry.name);

    if (!fs.existsSync(destUserDir)) {
      console.log(`  Migrating user dir ${entry.name}/ → private/${entry.name}/`);
      moveFileOrDir(srcUserDir, destUserDir);
      notesMigrated++;
    } else {
      skipped++;
    }
  }

  // Ensure directories exist
  ensureDir(sharedDir);
  ensureDir(privateDir);
  ensureDir(path.join(notesDir, "_archive"));

  // Add frontmatter fields
  addFrontmatterToDir(sharedDir, "system");

  const privateSubs = fs.existsSync(privateDir) ? fs.readdirSync(privateDir, { withFileTypes: true }) : [];
  for (const sub of privateSubs) {
    if (sub.isDirectory()) {
      addFrontmatterToDir(path.join(privateDir, sub.name), sub.name);
    }
  }

  // Regenerate indexes
  regenerateIndex(sharedDir);
  for (const sub of privateSubs) {
    if (sub.isDirectory()) {
      regenerateIndex(path.join(privateDir, sub.name));
    }
  }
}

function migrateProjectNotes(projectDir: string, projectName: string): void {
  const notesDir = path.join(projectDir, "_notes");
  if (!fs.existsSync(notesDir)) return;

  const sharedDir = path.join(notesDir, "shared");
  const privateDir = path.join(notesDir, "private");

  // If shared/ already exists, this project is already migrated
  if (fs.existsSync(sharedDir)) {
    console.log(`  Project "${projectName}" notes already migrated, skipping.`);
    skipped++;
  } else {
    // Move existing notes into shared/ (existing project notes become shared)
    console.log(`  Migrating project "${projectName}" notes → shared/`);

    // Gather all current note files/dirs (excluding _archive, _notes-index.json)
    const entries = fs.readdirSync(notesDir, { withFileTypes: true });
    const toMove = entries.filter((e) =>
      !["shared", "private", "_archive"].includes(e.name) &&
      e.name !== "_notes-index.json",
    );

    if (toMove.length > 0) {
      ensureDir(sharedDir);
      for (const entry of toMove) {
        const src = path.join(notesDir, entry.name);
        const dest = path.join(sharedDir, entry.name);
        if (!fs.existsSync(dest)) {
          fs.renameSync(src, dest);
          notesMigrated++;
        }
      }
    }
  }

  ensureDir(sharedDir);
  ensureDir(privateDir);
  ensureDir(path.join(notesDir, "_archive"));

  // Add frontmatter
  addFrontmatterToDir(sharedDir, "system");

  // Regenerate index
  regenerateIndex(sharedDir);

  // Migrate epic notes within this project
  const epicsDir = path.join(projectDir, "epics");
  if (fs.existsSync(epicsDir)) {
    const epicEntries = fs.readdirSync(epicsDir, { withFileTypes: true });
    for (const epicEntry of epicEntries) {
      if (!epicEntry.isDirectory() || epicEntry.name === "_archive") continue;
      migrateEpicNotes(path.join(epicsDir, epicEntry.name), epicEntry.name, projectName);
    }
  }
}

function migrateEpicNotes(epicDir: string, epicId: string, projectName: string): void {
  const notesDir = path.join(epicDir, "_notes");
  if (!fs.existsSync(notesDir)) return;

  const sharedDir = path.join(notesDir, "shared");
  const privateDir = path.join(notesDir, "private");

  if (fs.existsSync(sharedDir)) {
    skipped++;
    return;
  }

  // Move existing epic notes into shared/
  console.log(`  Migrating epic "${epicId}" in "${projectName}" notes → shared/`);
  const entries = fs.readdirSync(notesDir, { withFileTypes: true });
  const toMove = entries.filter((e) =>
    !["shared", "private", "_archive"].includes(e.name) &&
    e.name !== "_notes-index.json",
  );

  if (toMove.length > 0) {
    ensureDir(sharedDir);
    for (const entry of toMove) {
      const src = path.join(notesDir, entry.name);
      const dest = path.join(sharedDir, entry.name);
      if (!fs.existsSync(dest)) {
        fs.renameSync(src, dest);
        notesMigrated++;
      }
    }
  }

  ensureDir(sharedDir);
  ensureDir(privateDir);
  ensureDir(path.join(notesDir, "_archive"));

  addFrontmatterToDir(sharedDir, "system");
  regenerateIndex(sharedDir);
}

/* ── Run ─────────────────────────────────────────────────────────────── */

console.log(`\n── CodaScope Notes Migration ─────────────────────────────`);
console.log(`Projects root: ${resolvedRoot}\n`);

// 1. Root-level notes (_notes/ under projects root)
console.log("Step 1: Root-level notes");
migrateRootNotes();

// 2. Per-project notes
console.log("\nStep 2: Project notes");
const projectDirs = fs.readdirSync(resolvedRoot, { withFileTypes: true });
for (const entry of projectDirs) {
  if (!entry.isDirectory()) continue;
  if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

  const projDir = path.join(resolvedRoot, entry.name);
  const projectJsonPath = path.join(projDir, "project.json");
  if (!fs.existsSync(projectJsonPath)) continue; // Not a project directory

  try {
    const projectData = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
    const projectName = projectData.name ?? entry.name;
    migrateProjectNotes(projDir, projectName);
  } catch (err) {
    errors.push(`Failed to process project ${entry.name}: ${err}`);
  }
}

// 3. Summary
console.log(`\n── Migration Summary ─────────────────────────────────────`);
console.log(`  Notes migrated:       ${notesMigrated}`);
console.log(`  IDs assigned:         ${idsAssigned}`);
console.log(`  Folders created:      ${foldersCreated}`);
console.log(`  Annotations moved:    ${annotationsMoved}`);
console.log(`  Already migrated:     ${skipped}`);

if (errors.length > 0) {
  console.log(`\n  Errors (${errors.length}):`);
  for (const err of errors) {
    console.log(`    - ${err}`);
  }
}

console.log(`\n── Done ──────────────────────────────────────────────────\n`);
