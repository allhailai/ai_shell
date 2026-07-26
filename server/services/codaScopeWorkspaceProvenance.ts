/* ── CodaScope: Workspace Retrieval Provenance ──────────────────────
   Per-run, model-independent source references for successful workspace
   retrievals. Tool closures capture a stable holder whose collector is
   replaced before every agent send.
   ──────────────────────────────────────────────────────────────────── */

const MAX_RETRIEVED_SOURCES = 50;
const MAX_SOURCE_TEXT = 500;

export type WorkspaceRetrievedSourceReference =
  | {
      kind: "project_wiki";
      retrieval: "direct" | "search";
      projectId: string;
      projectName: string;
      topicId: string;
      topicTitle: string;
      topicUpdatedAt: string;
      lastWikiBuildAt: string | null;
    }
  | {
      kind: "code_map";
      retrieval: "direct";
      projectId: string;
      projectName: string;
      codeMapId: string;
      generatedAt: string | null;
      lastWikiBuildAt: string | null;
    };

export class WorkspaceProvenanceCollector {
  private readonly references = new Map<string, WorkspaceRetrievedSourceReference>();

  collect(reference: WorkspaceRetrievedSourceReference): void {
    const normalized = normalizeReference(reference);
    const key = sourceKey(normalized);
    if (!this.references.has(key) && this.references.size < MAX_RETRIEVED_SOURCES) {
      this.references.set(key, normalized);
    }
  }

  drain(): WorkspaceRetrievedSourceReference[] {
    const result = [...this.references.values()].sort((a, b) =>
      sourceKey(a).localeCompare(sourceKey(b)),
    );
    this.references.clear();
    return result;
  }

  clear(): void {
    this.references.clear();
  }
}

export class WorkspaceProvenanceCollectorHolder {
  current = new WorkspaceProvenanceCollector();

  collect(reference: WorkspaceRetrievedSourceReference): void {
    this.current.collect(reference);
  }
}

export function validateWorkspaceRetrievedSources(
  value: unknown,
): WorkspaceRetrievedSourceReference[] {
  if (!Array.isArray(value) || value.length > MAX_RETRIEVED_SOURCES) {
    throw new Error("Invalid workspace retrieved sources");
  }
  const keys = new Set<string>();
  const result = value.map((candidate) => validateReference(candidate));
  for (const reference of result) {
    const key = sourceKey(reference);
    if (keys.has(key)) throw new Error("Duplicate workspace retrieved source");
    keys.add(key);
  }
  return result.sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
}

function validateReference(value: unknown): WorkspaceRetrievedSourceReference {
  if (!isRecord(value)) throw new Error("Invalid workspace retrieved source");
  if (value.kind === "project_wiki") {
    assertExactFields(value, [
      "kind",
      "retrieval",
      "projectId",
      "projectName",
      "topicId",
      "topicTitle",
      "topicUpdatedAt",
      "lastWikiBuildAt",
    ]);
    if (value.retrieval !== "direct" && value.retrieval !== "search") {
      throw new Error("Invalid workspace wiki retrieval");
    }
    return normalizeReference({
      kind: "project_wiki",
      retrieval: value.retrieval,
      projectId: boundedString(value.projectId),
      projectName: boundedString(value.projectName),
      topicId: boundedString(value.topicId),
      topicTitle: boundedString(value.topicTitle),
      topicUpdatedAt: timestamp(value.topicUpdatedAt),
      lastWikiBuildAt: nullableTimestamp(value.lastWikiBuildAt),
    });
  }
  if (value.kind === "code_map") {
    assertExactFields(value, [
      "kind",
      "retrieval",
      "projectId",
      "projectName",
      "codeMapId",
      "generatedAt",
      "lastWikiBuildAt",
    ]);
    if (value.retrieval !== "direct") {
      throw new Error("Invalid workspace code-map retrieval");
    }
    return normalizeReference({
      kind: "code_map",
      retrieval: "direct",
      projectId: boundedString(value.projectId),
      projectName: boundedString(value.projectName),
      codeMapId: boundedString(value.codeMapId),
      generatedAt: nullableTimestamp(value.generatedAt),
      lastWikiBuildAt: nullableTimestamp(value.lastWikiBuildAt),
    });
  }
  throw new Error("Invalid workspace retrieved source kind");
}

function normalizeReference(
  reference: WorkspaceRetrievedSourceReference,
): WorkspaceRetrievedSourceReference {
  if (reference.kind === "project_wiki") {
    return Object.freeze({
      kind: "project_wiki",
      retrieval: reference.retrieval,
      projectId: clip(reference.projectId),
      projectName: clip(reference.projectName),
      topicId: clip(reference.topicId),
      topicTitle: clip(reference.topicTitle),
      topicUpdatedAt: reference.topicUpdatedAt,
      lastWikiBuildAt: reference.lastWikiBuildAt,
    });
  }
  return Object.freeze({
    kind: "code_map",
    retrieval: "direct",
    projectId: clip(reference.projectId),
    projectName: clip(reference.projectName),
    codeMapId: clip(reference.codeMapId),
    generatedAt: reference.generatedAt,
    lastWikiBuildAt: reference.lastWikiBuildAt,
  });
}

function sourceKey(reference: WorkspaceRetrievedSourceReference): string {
  return reference.kind === "project_wiki"
    ? [
        reference.kind,
        reference.retrieval,
        reference.projectId,
        reference.topicId,
      ].join("\u0000")
    : [
        reference.kind,
        reference.retrieval,
        reference.projectId,
        reference.codeMapId,
      ].join("\u0000");
}

function clip(value: string): string {
  return value.slice(0, MAX_SOURCE_TEXT);
}

function boundedString(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > MAX_SOURCE_TEXT) {
    throw new Error("Invalid workspace source text");
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid workspace source timestamp");
  }
  return value;
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Invalid workspace retrieved source fields");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
