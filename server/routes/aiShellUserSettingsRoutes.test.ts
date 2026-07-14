import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { authenticatedUsername } from "./aiShellUserSettingsRoutes.js";

const httpError = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });

describe("AIShell user-settings route principal", () => {
  it("uses the authenticated request user and ignores caller-controlled identity", () => {
    const req = {
      user: { username: "alice", firstname: "", lastname: "", is_admin: false, is_system: false, created_at: "", updated_at: "" },
      body: { username: "mallory" },
      headers: { "x-auth-user": "mallory" },
    } as unknown as Request;
    expect(authenticatedUsername(req, httpError)).toBe("alice");
  });

  it("rejects requests that did not pass through authentication middleware", () => {
    expect(() => authenticatedUsername({} as Request, httpError)).toThrow("Authentication required.");
  });
});
