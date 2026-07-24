import type { NoteEntry } from "./codaScopeTypes";

export type NoteStarredResolver = (entry: NoteEntry) => boolean;

/**
 * Shared note-browser priority:
 * pinned folders, pinned files, unpinned folders, then unpinned files.
 * Stars and recency only break ties between files in the same pin group.
 */
export function compareNoteEntriesByPriority(
  left: NoteEntry,
  right: NoteEntry,
  isStarred: NoteStarredResolver = (entry) => Boolean(entry.starred),
): number {
  const leftPinned = Boolean(left.pinned);
  const rightPinned = Boolean(right.pinned);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

  const leftFolder = Boolean(left.isFolder);
  const rightFolder = Boolean(right.isFolder);
  if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
  if (leftFolder && rightFolder) return left.title.localeCompare(right.title);

  const leftStarred = isStarred(left);
  const rightStarred = isStarred(right);
  if (leftStarred !== rightStarred) return leftStarred ? -1 : 1;

  return (right.updated || "").localeCompare(left.updated || "");
}
