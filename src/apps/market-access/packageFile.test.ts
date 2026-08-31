import { describe, expect, it } from "vitest";
import {
  formatPackageFileSize,
  getPackageFileExtension,
  getPackageFormat,
  isAcceptedPackageFile,
  isPackageFileTooLarge,
  isProductNameTooLong,
  MAX_PACKAGE_FILE_SIZE_BYTES,
  MAX_PRODUCT_NAME_LENGTH,
  PACKAGE_FILE_ACCEPT,
  packageFileRejectionMessage,
  packageFormatLabel,
} from "./packageFile";

describe("getPackageFileExtension", () => {
  it("returns lowercase extension without dot", () => {
    expect(getPackageFileExtension("brief.MD")).toBe("md");
    expect(getPackageFileExtension("package.markdown")).toBe("markdown");
    expect(getPackageFileExtension("report.docx")).toBe("docx");
    expect(getPackageFileExtension("slides.PPTX")).toBe("pptx");
  });

  it("returns null for missing or trailing dot", () => {
    expect(getPackageFileExtension("README")).toBeNull();
    expect(getPackageFileExtension("file.")).toBeNull();
  });
});

describe("isAcceptedPackageFile", () => {
  it("accepts markdown, docx, and pptx extensions", () => {
    expect(isAcceptedPackageFile("brief.md")).toBe(true);
    expect(isAcceptedPackageFile("brief.markdown")).toBe(true);
    expect(isAcceptedPackageFile("brief.docx")).toBe(true);
    expect(isAcceptedPackageFile("brief.pptx")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isAcceptedPackageFile("brief.ppt")).toBe(false);
    expect(isAcceptedPackageFile("brief.pdf")).toBe(false);
    expect(isAcceptedPackageFile("brief.doc")).toBe(false);
    expect(isAcceptedPackageFile("brief.txt")).toBe(false);
    expect(isAcceptedPackageFile("README")).toBe(false);
  });
});

describe("getPackageFormat", () => {
  it("maps extensions to format", () => {
    expect(getPackageFormat("a.md")).toBe("markdown");
    expect(getPackageFormat("a.markdown")).toBe("markdown");
    expect(getPackageFormat("a.docx")).toBe("docx");
    expect(getPackageFormat("a.pptx")).toBe("pptx");
    expect(getPackageFormat("Brief.MD")).toBe("markdown");
    expect(getPackageFormat("Deck.PPTX")).toBe("pptx");
  });

  it("returns null for unsupported or extensionless files", () => {
    expect(getPackageFormat("a.ppt")).toBeNull();
    expect(getPackageFormat("a.pdf")).toBeNull();
    expect(getPackageFormat("a.doc")).toBeNull();
    expect(getPackageFormat("a.txt")).toBeNull();
    expect(getPackageFormat("README")).toBeNull();
  });
});

describe("PACKAGE_FILE_ACCEPT", () => {
  it("lists accepted package extensions for the file input", () => {
    expect(PACKAGE_FILE_ACCEPT).toBe(".md,.markdown,.docx,.pptx");
  });
});

describe("packageFileRejectionMessage", () => {
  it("mentions supported types", () => {
    expect(packageFileRejectionMessage("x.pdf")).toMatch(/not supported/i);
    expect(packageFileRejectionMessage("x.ppt")).toMatch(/PowerPoint/i);
    expect(packageFileRejectionMessage("README")).toMatch(/no file extension/i);
  });
});

describe("packageFormatLabel", () => {
  it("maps formats to display labels", () => {
    expect(packageFormatLabel("markdown")).toBe("Markdown");
    expect(packageFormatLabel("docx")).toBe("Word document");
    expect(packageFormatLabel("pptx")).toBe("PowerPoint");
  });
});

describe("isProductNameTooLong", () => {
  it("allows names up to the character cap", () => {
    expect(isProductNameTooLong("a".repeat(MAX_PRODUCT_NAME_LENGTH))).toBe(
      false,
    );
  });

  it("rejects names over the character cap", () => {
    expect(isProductNameTooLong("a".repeat(MAX_PRODUCT_NAME_LENGTH + 1))).toBe(
      true,
    );
  });
});

describe("isPackageFileTooLarge", () => {
  it("allows files at the 20 MiB cap", () => {
    expect(isPackageFileTooLarge(MAX_PACKAGE_FILE_SIZE_BYTES)).toBe(false);
  });

  it("rejects files over the 20 MiB cap", () => {
    expect(isPackageFileTooLarge(MAX_PACKAGE_FILE_SIZE_BYTES + 1)).toBe(true);
  });
});

describe("formatPackageFileSize", () => {
  it("formats bytes and larger units", () => {
    expect(formatPackageFileSize(512)).toBe("512 B");
    expect(formatPackageFileSize(2048)).toBe("2 KB");
    expect(formatPackageFileSize(1_572_864)).toBe("1.5 MB");
  });
});
