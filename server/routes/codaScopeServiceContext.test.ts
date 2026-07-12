import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { principal, type HttpErrorFn } from "./codaScopeServiceContext.js";

const httpError: HttpErrorFn = (message, status, code) =>
  Object.assign(new Error(message), { status, code });

describe("CodaScope route principal", () => {
  it("derives the actor solely from authenticated middleware state", () => {
    const req = {
      user: {
        username: "alice",
        is_admin: false,
        is_system: false,
        firstname: "",
        lastname: "",
        created_at: "",
        updated_at: "",
      },
      headers: { "x-auth-user": "mallory" },
    } as unknown as Request;

    expect(principal(req, httpError)).toEqual({ username: "alice", isAdmin: false });
  });

  it("rejects requests that did not pass through authentication middleware", () => {
    expect(() => principal({} as Request, httpError)).toThrow("Authentication required.");
  });
});
