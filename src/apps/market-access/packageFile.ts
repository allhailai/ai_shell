/** Accepted package document formats. Extensions map to these values — do not store raw extensions or MIME types. */
export type PackageFormat = "markdown" | "docx" | "pptx";

/** Browser `accept` attribute for the hidden file input. */
export const PACKAGE_FILE_ACCEPT = ".md,.markdown,.docx,.pptx";

/** Product name character cap (client UX; server will enforce the same). */
export const MAX_PRODUCT_NAME_LENGTH = 200;

/** Package file size cap in bytes (20 MiB). */
export const MAX_PACKAGE_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const EXTENSION_FORMAT: Record<string, PackageFormat> = {
  md: "markdown",
  markdown: "markdown",
  docx: "docx",
  pptx: "pptx",
};

/** Lowercase extension without a leading dot, or null when none. */
export function getPackageFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function isAcceptedPackageFile(fileName: string): boolean {
  const ext = getPackageFileExtension(fileName);
  return ext !== null && ext in EXTENSION_FORMAT;
}

export function getPackageFormat(fileName: string): PackageFormat | null {
  const ext = getPackageFileExtension(fileName);
  if (!ext) return null;
  return EXTENSION_FORMAT[ext] ?? null;
}

export function isProductNameTooLong(name: string): boolean {
  return name.length > MAX_PRODUCT_NAME_LENGTH;
}

export function isPackageFileTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_PACKAGE_FILE_SIZE_BYTES;
}

/** User-facing rejection when an extension is not allowed. */
export function packageFileRejectionMessage(fileName: string): string {
  const ext = getPackageFileExtension(fileName);
  if (!ext) {
    return `"${fileName}" has no file extension. Use Markdown (.md), Word (.docx), or PowerPoint (.pptx).`;
  }
  return `"${fileName}" is not supported. Use Markdown (.md, .markdown), Word (.docx), or PowerPoint (.pptx) only.`;
}

/** Display label for stored package metadata. */
export function packageFormatLabel(format: PackageFormat): string {
  switch (format) {
    case "markdown":
      return "Markdown";
    case "docx":
      return "Word document";
    case "pptx":
      return "PowerPoint";
  }
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
