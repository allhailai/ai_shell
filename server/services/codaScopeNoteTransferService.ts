/* ── CodaScope: Note Transfer Service ────────────────────────────────
   The sole orchestration point for moving notes or folder trees.

   A note move is more than a markdown rename: it delegates the managed file
   bundle to CodaScopeNoteBundleService, then updates references, indexes, and
   audit state. UI routes, drag-and-drop, dialogs, and bulk operations call
   here.
   ──────────────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  CodaScopeNoteService,
  NoteFolderMoveOpts,
  NoteMoveOpts,
  NoteResolveOpts,
} from "./codaScopeNoteService.js";
import type { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
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
    private bundleSvc: CodaScopeNoteBundleService,
    private userPrefsSvc: CodaScopeNoteUserPrefsService,
    private linkIndexSvc: CodaScopeNoteLinkIndexService,
    private auditSvc: CodaScopeNoteAuditService,
  ) {}

  setServices(
    noteSvc: CodaScopeNoteService,
    bundleSvc: CodaScopeNoteBundleService,
    userPrefsSvc: CodaScopeNoteUserPrefsService,
    linkIndexSvc: CodaScopeNoteLinkIndexService,
    auditSvc: CodaScopeNoteAuditService,
  ): void {
    this.noteSvc = noteSvc;
    this.bundleSvc = bundleSvc;
    this.userPrefsSvc = userPrefsSvc;
    this.linkIndexSvc = linkIndexSvc;
    this.auditSvc = auditSvc;
  }

  /** Move one complete note bundle and update the owning note-library state. */
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

    const moved = await this.bundleSvc.moveFile({ ...options, fromPath, toPath });
    if (!moved) return { moved: false, noteIds: [], correlationId };

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

    const moved = await this.bundleSvc.moveFolder(options);
    if (!moved) return { moved: false, noteIds: [], correlationId };

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
