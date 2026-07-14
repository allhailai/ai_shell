/* ── CodaScope: Note Transfer Service ────────────────────────────────
   The sole orchestration point for moving notes or folder trees.

   A note move is more than a markdown rename: it carries the managed file
   bundle, annotation sidecar, user references, link indexes, and audit trail.
   UI routes, drag-and-drop, dialogs, and bulk operations all call here.
   ──────────────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  CodaScopeNoteService,
  NoteFolderMoveOpts,
  NoteMoveOpts,
  NoteResolveOpts,
} from "./codaScopeNoteService.js";
import type { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import type { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import type { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";

export interface NoteTransferOptions extends NoteMoveOpts {
  correlationId?: string;
}

export interface NoteFolderTransferOptions extends NoteFolderMoveOpts {
  correlationId?: string;
}

export interface NoteTransferResult {
  moved: boolean;
  noteIds: string[];
  correlationId: string;
}

interface TransferRecord {
  noteId: string;
  title: string;
  fromPath: string;
  toPath: string;
}

export class CodaScopeNoteTransferService {
  constructor(
    private noteSvc: CodaScopeNoteService,
    private annotationSvc: CodaScopeNoteAnnotationService,
    private userPrefsSvc: CodaScopeNoteUserPrefsService,
    private linkIndexSvc: CodaScopeNoteLinkIndexService,
    private auditSvc: CodaScopeNoteAuditService,
  ) {}

  setServices(
    noteSvc: CodaScopeNoteService,
    annotationSvc: CodaScopeNoteAnnotationService,
    userPrefsSvc: CodaScopeNoteUserPrefsService,
    linkIndexSvc: CodaScopeNoteLinkIndexService,
    auditSvc: CodaScopeNoteAuditService,
  ): void {
    this.noteSvc = noteSvc;
    this.annotationSvc = annotationSvc;
    this.userPrefsSvc = userPrefsSvc;
    this.linkIndexSvc = linkIndexSvc;
    this.auditSvc = auditSvc;
  }

  /** Move one complete note bundle and all logical sidecars. */
  async moveFile(options: NoteTransferOptions): Promise<NoteTransferResult> {
    const correlationId = options.correlationId ?? randomUUID();
    const fromPath = this.notePath(options.fromPath);
    const toPath = this.notePath(options.toPath);
    const source = await this.noteSvc.readNote(
      options.fromScope,
      options.fromVisibility,
      options.fromOpts,
      fromPath,
    );
    if (!source) return { moved: false, noteIds: [], correlationId };

    // Materialize legacy sidecars before the physical bundle rename. Once
    // bundled, Markdown and its thread sidecar move as a single unit.
    this.annotationSvc.ensurePhysicalSidecar(
      options.fromScope, options.fromVisibility, options.fromOpts, fromPath,
    );
    this.annotationSvc.assertCanRelocate(
      options.fromScope, options.fromVisibility, options.fromOpts, fromPath,
      options.toScope, options.toVisibility, options.toOpts, toPath,
    );

    let noteMoved = false;
    let annotationsMoved = false;
    try {
      noteMoved = await this.noteSvc.moveNote({ ...options, fromPath, toPath });
      if (!noteMoved) return { moved: false, noteIds: [], correlationId };
      annotationsMoved = this.annotationSvc.relocateAnnotations(
        options.fromScope, options.fromVisibility, options.fromOpts, fromPath,
        options.toScope, options.toVisibility, options.toOpts, toPath,
      );
      // Markdown markers travel in the note bundle. Verify the relocated
      // sidecar against that exact content instead of trusting path metadata.
      await this.annotationSvc.reconcileAfterNoteWrite(
        options.toScope, options.toVisibility, options.toOpts, toPath,
      );
    } catch (error) {
      if (annotationsMoved) {
        try {
          this.annotationSvc.relocateAnnotations(
            options.toScope, options.toVisibility, options.toOpts, toPath,
            options.fromScope, options.fromVisibility, options.fromOpts, fromPath,
          );
        } catch { /* best effort during rollback */ }
      }
      if (noteMoved) {
        try {
          await this.noteSvc.moveNote({
            fromScope: options.toScope,
            fromVisibility: options.toVisibility,
            fromOpts: options.toOpts,
            fromPath: toPath,
            toScope: options.fromScope,
            toVisibility: options.fromVisibility,
            toOpts: options.fromOpts,
            toPath: fromPath,
          });
        } catch { /* best effort during rollback */ }
      }
      throw error;
    }

    const record: TransferRecord = {
      noteId: source.frontmatter.id,
      title: source.frontmatter.title,
      fromPath,
      toPath,
    };
    await this.finalizeTransfer([record], options, correlationId);
    return { moved: true, noteIds: [record.noteId], correlationId };
  }

  /** Move a folder tree while retaining empty folders and every note bundle inside it. */
  async moveFolder(options: NoteFolderTransferOptions): Promise<NoteTransferResult> {
    const correlationId = options.correlationId ?? randomUUID();
    const records = await this.collectFolderRecords(
      options.fromScope,
      options.fromVisibility,
      options.fromOpts,
      options.fromFolder,
      options.toFolder,
    );

    for (const record of records) {
      this.annotationSvc.ensurePhysicalSidecar(
        options.fromScope, options.fromVisibility, options.fromOpts, record.fromPath,
      );
      this.annotationSvc.assertCanRelocate(
        options.fromScope, options.fromVisibility, options.fromOpts, record.fromPath,
        options.toScope, options.toVisibility, options.toOpts, record.toPath,
      );
    }

    let folderMoved = false;
    const movedAnnotations: TransferRecord[] = [];
    try {
      folderMoved = await this.noteSvc.moveFolder(options);
      if (!folderMoved) return { moved: false, noteIds: [], correlationId };

      for (const record of records) {
        if (this.annotationSvc.relocateAnnotations(
          options.fromScope, options.fromVisibility, options.fromOpts, record.fromPath,
          options.toScope, options.toVisibility, options.toOpts, record.toPath,
        )) {
          movedAnnotations.push(record);
        }
        await this.annotationSvc.reconcileAfterNoteWrite(
          options.toScope, options.toVisibility, options.toOpts, record.toPath,
        );
      }
    } catch (error) {
      for (const record of movedAnnotations.reverse()) {
        try {
          this.annotationSvc.relocateAnnotations(
            options.toScope, options.toVisibility, options.toOpts, record.toPath,
            options.fromScope, options.fromVisibility, options.fromOpts, record.fromPath,
          );
        } catch { /* best effort during rollback */ }
      }
      if (folderMoved) {
        try {
          await this.noteSvc.moveFolder({
            fromScope: options.toScope,
            fromVisibility: options.toVisibility,
            fromOpts: options.toOpts,
            fromFolder: options.toFolder,
            toScope: options.fromScope,
            toVisibility: options.fromVisibility,
            toOpts: options.fromOpts,
            toFolder: options.fromFolder,
          });
        } catch { /* best effort during rollback */ }
      }
      throw error;
    }

    await this.finalizeTransfer(records, options, correlationId, true);
    return { moved: true, noteIds: records.map((record) => record.noteId), correlationId };
  }

  private async collectFolderRecords(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    sourceFolder: string,
    destinationFolder: string,
  ): Promise<TransferRecord[]> {
    const records: TransferRecord[] = [];

    const collect = async (folderPath: string): Promise<void> => {
      const entries = await this.noteSvc.listNotes(scope, visibility, opts, folderPath);
      for (const entry of entries) {
        // listNotes always returns paths relative to the note library root,
        // even when a nested folder is being listed.
        const entryPath = entry.path;
        if (entry.isFolder) {
          await collect(entryPath);
          continue;
        }

        const source = await this.noteSvc.readNote(scope, visibility, opts, entryPath);
        if (!source) continue;
        const relativePath = entryPath.slice(sourceFolder.length).replace(/^\//, "");
        records.push({
          noteId: source.frontmatter.id,
          title: source.frontmatter.title,
          fromPath: this.notePath(entryPath),
          toPath: this.notePath(`${destinationFolder}/${relativePath}`),
        });
      }
    };

    await collect(sourceFolder);
    return records;
  }

  private async finalizeTransfer(
    records: TransferRecord[],
    options: Pick<NoteMoveOpts, "fromScope" | "fromVisibility" | "fromOpts" | "toScope" | "toVisibility" | "toOpts">,
    correlationId: string,
    isFolderMove = false,
  ): Promise<void> {
    const actor = options.toOpts.userId ?? options.fromOpts.userId ?? "default";
    for (const record of records) {
      try {
        this.userPrefsSvc.relocateNoteRefs(record.noteId, {
          scope: options.toScope,
          visibility: options.toVisibility,
          path: record.toPath,
        }, options.toOpts.userId ?? actor);
      } catch { /* preference references are non-critical derived state */ }

      this.auditSvc.log({
        event: "note.moved",
        timestamp: new Date().toISOString(),
        actor,
        noteId: record.noteId,
        scope: options.toScope,
        visibility: options.toVisibility,
        path: record.toPath,
        correlationId,
        metadata: {
          fromScope: options.fromScope,
          fromVisibility: options.fromVisibility,
          fromPath: record.fromPath,
          toScope: options.toScope,
          toVisibility: options.toVisibility,
          toPath: record.toPath,
          folderMove: isFolderMove || undefined,
        },
      });
      if (options.fromVisibility !== options.toVisibility) {
        this.auditSvc.log({
          event: "note.visibility_changed",
          timestamp: new Date().toISOString(),
          actor,
          noteId: record.noteId,
          scope: options.toScope,
          visibility: options.toVisibility,
          path: record.toPath,
          correlationId,
          metadata: { fromVisibility: options.fromVisibility, toVisibility: options.toVisibility },
        });
      }
    }

    if (isFolderMove) {
      this.auditSvc.log({
        event: "folder.moved",
        timestamp: new Date().toISOString(),
        actor,
        noteId: "",
        scope: options.toScope,
        visibility: options.toVisibility,
        path: "",
        correlationId,
        metadata: { noteCount: records.length },
      });
    }

    // Backlinks are derived from note IDs. A single rebuild per source and
    // destination keeps cross-scope/visibility moves correct without trying
    // to mutate the index incrementally in every caller.
    try {
      await this.linkIndexSvc.rebuildIndex(options.fromScope, options.fromVisibility, options.fromOpts);
      if (options.fromScope !== options.toScope || options.fromVisibility !== options.toVisibility || options.fromOpts.projectId !== options.toOpts.projectId || options.fromOpts.epicId !== options.toOpts.epicId) {
        await this.linkIndexSvc.rebuildIndex(options.toScope, options.toVisibility, options.toOpts);
      }
    } catch { /* index is rebuilt on the next note save if this best effort fails */ }
  }

  private notePath(value: string): string {
    return value.endsWith(".md") ? value : `${value}.md`;
  }
}
