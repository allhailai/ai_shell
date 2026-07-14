import { describe, expect, it } from "vitest";
import { isInsideInstallDirectory } from "./codaScopeServiceContext.js";

describe("isInsideInstallDirectory", () => {
  it("rejects the AIShell checkout and paths below it while allowing external project storage", () => {
    const install = "/opt/aishell";
    expect(isInsideInstallDirectory(install, install)).toBe(true);
    expect(isInsideInstallDirectory("/opt/aishell/codascope_projects", install)).toBe(true);
    expect(isInsideInstallDirectory("/var/lib/aishell/projects", install)).toBe(false);
    expect(isInsideInstallDirectory("/opt/aishell-backup/projects", install)).toBe(false);
  });
});
