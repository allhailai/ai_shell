/** Accepted package document kinds for PR 1 (Markdown or DOCX only). */
export type PackageFileKind = "markdown" | "docx";

/** Browser `accept` attribute for the hidden file input. */
export const PACKAGE_FILE_ACCEPT = ".md,.markdown,.docx";

const EXTENSION_KIND: Record<string, PackageFileKind> = {
  md: "markdown",
  markdown: "markdown",
  docx: "docx",
};

/** Lowercase extension without a leading dot, or null when none. */
export function getPackageFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function isAcceptedPackageFile(fileName: string): boolean {
  const ext = getPackageFileExtension(fileName);
  return ext !== null && ext in EXTENSION_KIND;
}

export function getPackageFileKind(fileName: string): PackageFileKind | null {
  const ext = getPackageFileExtension(fileName);
  if (!ext) return null;
  return EXTENSION_KIND[ext] ?? null;
}

/** User-facing rejection when an extension is not allowed. */
export function packageFileRejectionMessage(fileName: string): string {
  const ext = getPackageFileExtension(fileName);
  if (!ext) {
    return `"${fileName}" has no file extension. Use Markdown (.md) or Word (.docx).`;
  }
  return `"${fileName}" is not supported. Use Markdown (.md, .markdown) or Word (.docx) only.`;
}

/** Display label for stored package metadata. */
export function packageFileKindLabel(kind: PackageFileKind): string {
  return kind === "markdown" ? "Markdown" : "Word document";
}

/** Compact human-readable file size for UI metadata. */
export function formatPackageFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return Number.isInteger(kb) || kb >= 10
      ? `${Math.round(kb)} KB`
      : `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
