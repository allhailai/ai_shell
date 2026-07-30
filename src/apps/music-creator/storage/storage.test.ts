import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject, createEmptyStoreEnvelope } from "../project/createProject";
import { STORE_SCHEMA_VERSION } from "../types";
import { loadStore, resetStore, saveStore, STORE_KEY } from "./storage";

function createLocalStorageMock() {
  const data = new Map<string, string>();

  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => Array.from(data.keys())[index] ?? null,
      get length() {
        return data.size;
      },
    },
  };
}

describe("loadStore", () => {
  let mock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    mock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: mock.storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty envelope when the key is missing", () => {
    const result = loadStore();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.envelope).toEqual(createEmptyStoreEnvelope());
      expect(result.data.warnings).toEqual([]);
    }
  });

  it("returns parse_error for malformed JSON", () => {
    mock.data.set(STORE_KEY, "{not json");

    const result = loadStore();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("parse_error");
    }
  });

  it("returns invalid_envelope when the root shape is wrong", () => {
    mock.data.set(STORE_KEY, JSON.stringify({ schemaVersion: 1 }));

    const result = loadStore();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_envelope");
    }
  });

  it("returns unsupported_version for a future schema", () => {
    mock.data.set(
      STORE_KEY,
      JSON.stringify({
        schemaVersion: STORE_SCHEMA_VERSION + 1,
        projects: {},
      }),
    );

    const result = loadStore();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_version");
    }
  });

  it("omits invalid projects with warnings and does not rewrite disk", () => {
    const valid = createEmptyProject("valid-id", {
      now: "2026-07-24T12:00:00.000Z",
    });
    const onDisk = {
      schemaVersion: STORE_SCHEMA_VERSION,
      projects: {
        "valid-id": valid,
        "bad-id": { name: "missing required fields" },
      },
    };
    const raw = JSON.stringify(onDisk);
    mock.data.set(STORE_KEY, raw);

    const result = loadStore();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data.envelope.projects)).toEqual(["valid-id"]);
      expect(result.data.envelope.projects["valid-id"]).toEqual(valid);
      expect(result.data.warnings).toHaveLength(1);
      expect(result.data.warnings[0]?.projectId).toBe("bad-id");
    }

    expect(mock.data.get(STORE_KEY)).toBe(raw);
  });
});

describe("saveStore", () => {
  let mock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    mock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: mock.storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a valid envelope under the store key", () => {
    const project = createEmptyProject("saved-id", {
      now: "2026-07-24T12:00:00.000Z",
    });
    const envelope = {
      schemaVersion: STORE_SCHEMA_VERSION,
      projects: { "saved-id": project },
    };

    const saveResult = saveStore(envelope);
    expect(saveResult.ok).toBe(true);

    const loadResult = loadStore();
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.data.envelope.projects["saved-id"]).toEqual(project);
      expect(loadResult.data.warnings).toEqual([]);
    }
  });

  it("returns quota_exceeded when setItem throws QuotaExceededError", () => {
    const quotaError = new DOMException("quota", "QuotaExceededError");
    vi.stubGlobal("window", {
      localStorage: {
        ...mock.storage,
        setItem: () => {
          throw quotaError;
        },
      },
    });

    const result = saveStore(createEmptyStoreEnvelope());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("quota_exceeded");
    }
  });
});

describe("resetStore", () => {
  beforeEach(() => {
    const mock = createLocalStorageMock();
    mock.data.set(STORE_KEY, JSON.stringify({ corrupt: true }));
    vi.stubGlobal("window", { localStorage: mock.storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes an empty envelope", () => {
    const result = resetStore();

    expect(result.ok).toBe(true);

    const loaded = loadStore();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.data.envelope).toEqual(createEmptyStoreEnvelope());
    }
  });
});
