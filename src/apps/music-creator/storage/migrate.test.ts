import { describe, expect, it } from "vitest";
import { STORE_SCHEMA_VERSION } from "../types";
import { migrateStore } from "./migrate";

describe("migrateStore", () => {
  it("passes through the current schema version unchanged", () => {
    const envelope = {
      schemaVersion: STORE_SCHEMA_VERSION,
      projects: {},
    };

    const result = migrateStore(envelope);

    expect(result).toEqual({ ok: true, data: envelope });
  });

  it("rejects a future schema version", () => {
    const envelope = {
      schemaVersion: STORE_SCHEMA_VERSION + 1,
      projects: {},
    };

    const result = migrateStore(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_version");
    }
  });

  it("returns migration_failed when no path exists for an older version", () => {
    const envelope = {
      schemaVersion: 0,
      projects: {},
    };

    const result = migrateStore(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("migration_failed");
    }
  });
});
