import { describe, expect, it } from "vitest";
import {
  formatPackageFileSize,
  getPackageFileExtension,
  getPackageFileKind,
  isAcceptedPackageFile,
  PACKAGE_FILE_ACCEPT,
  packageFileKindLabel,
  packageFileRejectionMessage,
} from "./packageFile";

describe("getPackageFileExtension", () => {
  it("returns lowercase extension without dot", () => {
    expect(getPackageFileExtension("brief.MD")).toBe("md");
    expect(getPackageFileExtension("package.markdown")).toBe("markdown");
    expect(getPackageFileExtension("report.docx")).toBe("docx");
  });

  it("returns null for missing or trailing dot", () => {
    expect(getPackageFileExtension("README")).toBeNull();
    expect(getPackageFileExtension("file.")).toBeNull();
  });
});

describe("isAcceptedPackageFile", () => {
  it("accepts markdown and docx extensions", () => {
    expect(isAcceptedPackageFile("brief.md")).toBe(true);
    expect(isAcceptedPackageFile("brief.markdown")).toBe(true);
    expect(isAcceptedPackageFile("brief.docx")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isAcceptedPackageFile("brief.pdf")).toBe(false);
    expect(isAcceptedPackageFile("brief.doc")).toBe(false);
    expect(isAcceptedPackageFile("brief.txt")).toBe(false);
    expect(isAcceptedPackageFile("README")).toBe(false);
  });
});

describe("getPackageFileKind", () => {
  it("maps extensions to kind", () => {
    expect(getPackageFileKind("a.md")).toBe("markdown");
    expect(getPackageFileKind("a.markdown")).toBe("markdown");
    expect(getPackageFileKind("a.docx")).toBe("docx");
    expect(getPackageFileKind("Brief.MD")).toBe("markdown");
  });

  it("returns null for unsupported or extensionless files", () => {
    expect(getPackageFileKind("a.pdf")).toBeNull();
    expect(getPackageFileKind("a.doc")).toBeNull();
    expect(getPackageFileKind("a.txt")).toBeNull();
    expect(getPackageFileKind("README")).toBeNull();
  });
});

describe("PACKAGE_FILE_ACCEPT", () => {
  it("lists PR 1 package extensions for the file input", () => {
    expect(PACKAGE_FILE_ACCEPT).toBe(".md,.markdown,.docx");
  });
});

describe("packageFileRejectionMessage", () => {
  it("mentions supported types", () => {
    expect(packageFileRejectionMessage("x.pdf")).toMatch(/not supported/i);
    expect(packageFileRejectionMessage("README")).toMatch(/no file extension/i);
  });
});

describe("packageFileKindLabel", () => {
  it("maps kinds to display labels", () => {
    expect(packageFileKindLabel("markdown")).toBe("Markdown");
    expect(packageFileKindLabel("docx")).toBe("Word document");
  });
});

describe("formatPackageFileSize", () => {
  it("formats bytes and larger units", () => {
    expect(formatPackageFileSize(512)).toBe("512 B");
    expect(formatPackageFileSize(2048)).toBe("2 KB");
    expect(formatPackageFileSize(1_572_864)).toBe("1.5 MB");
  });
});
