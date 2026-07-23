/* ── CodaScope: Artifact API Client ──────────────────────────────────
   Typed wrappers for all artifact REST endpoints.
   Maps to routes registered in codaScopeArtifactRoutes.ts (Phase 2).
   ──────────────────────────────────────────────────────────────────── */

import type {
  ArtifactSpec,
  ArtifactAnnotation,
  ArtifactSectionsResponse,
  ArtifactBuildVersion,
  ArtifactBuildProgress,
  ArtifactElementContext,
} from "../../codaScopeTypes.js";

/* ── Helpers ──────────────────────────────────────────────────────── */

const BASE = "/api/codascope/projects";

function epicBase(projectId: string, epicId: string): string {
  return `${BASE}/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/artifacts`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

/* ── Artifact CRUD ────────────────────────────────────────────────── */

export async function listArtifacts(
  projectId: string,
  epicId: string,
): Promise<ArtifactSpec[]> {
  const data = await request<{ artifacts: ArtifactSpec[] }>(
    epicBase(projectId, epicId),
  );
  return data.artifacts;
}

export async function createArtifact(
  projectId: string,
  epicId: string,
  spec: {
    title: string;
  },
): Promise<ArtifactSpec> {
  const data = await request<{ artifact: ArtifactSpec }>(
    epicBase(projectId, epicId),
    { method: "POST", body: JSON.stringify(spec) },
  );
  return data.artifact;
}

export async function getArtifact(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<ArtifactSpec> {
  const data = await request<{ artifact: ArtifactSpec }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}`,
  );
  return data.artifact;
}

export async function updateArtifact(
  projectId: string,
  epicId: string,
  artifactId: string,
  updates: {
    title?: string;
  },
): Promise<ArtifactSpec> {
  const data = await request<{ artifact: ArtifactSpec }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}`,
    { method: "PUT", body: JSON.stringify(updates) },
  );
  return data.artifact;
}

export async function deleteArtifact(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<void> {
  await request<{ deleted: boolean }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}`,
    { method: "DELETE" },
  );
}

/* ── Build ────────────────────────────────────────────────────────── */

export async function triggerBuild(
  projectId: string,
  epicId: string,
  artifactId: string,
  modelId?: string,
): Promise<{ status: string; artifactId: string }> {
  return request<{ status: string; artifactId: string }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/build`,
    { method: "POST", body: JSON.stringify({ modelId }) },
  );
}

export function buildStatusUrl(
  projectId: string,
  epicId: string,
  artifactId: string,
): string {
  return `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/status`;
}

export function subscribeBuildStatus(
  projectId: string,
  epicId: string,
  artifactId: string,
  onProgress: (progress: ArtifactBuildProgress) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  const url = buildStatusUrl(projectId, epicId, artifactId);
  const es = new EventSource(url);
  let terminalSettled = false;

  const settle = (callback: () => void): void => {
    if (terminalSettled) return;
    terminalSettled = true;
    es.close();
    try {
      callback();
    } catch {
      // Consumer callback failures must not produce a second terminal outcome.
    }
  };

  es.onmessage = (event) => {
    if (terminalSettled) return;
    let data: ArtifactBuildProgress;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("Artifact build status must be an object.");
      }
      const status = (parsed as { status?: unknown }).status;
      if (!["idle", "building", "regenerating", "complete", "error"].includes(String(status))) {
        throw new TypeError("Artifact build status is invalid.");
      }
      data = parsed as ArtifactBuildProgress;
    } catch {
      settle(() => onError(new Error("Artifact build stream returned malformed status data.")));
      return;
    }

    try {
      onProgress(data);
    } catch {
      // Progress observers do not own transport or terminal state.
    }

    if (data.status === "complete") {
      settle(onDone);
    } else if (data.status === "error") {
      settle(() => onError(new Error(data.error ?? "Build failed")));
    } else if (data.status === "idle") {
      settle(() => onError(new Error("Artifact build stream has no active run.")));
    }
  };
  es.onerror = () => {
    settle(() => onError(new Error("SSE connection lost")));
  };
  return () => {
    terminalSettled = true;
    es.close();
  };
}

/* ── Preview ──────────────────────────────────────────────────────── */

export function previewUrl(
  projectId: string,
  epicId: string,
  artifactId: string,
): string {
  return `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/preview`;
}

/* ── Sections ─────────────────────────────────────────────────────── */

export async function listSections(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<ArtifactSectionsResponse> {
  return request<ArtifactSectionsResponse>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/sections`,
  );
}

export async function addSection(
  projectId: string,
  epicId: string,
  artifactId: string,
  data: { title: string; instruction?: string; afterSectionId?: string | null },
): Promise<ArtifactAnnotation> {
  const resp = await request<{ annotation: ArtifactAnnotation }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/sections`,
    { method: "POST", body: JSON.stringify(data) },
  );
  return resp.annotation;
}

export async function hideSection(
  projectId: string,
  epicId: string,
  artifactId: string,
  sectionId: string,
): Promise<ArtifactSectionsResponse> {
  return request<ArtifactSectionsResponse>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/sections/${encodeURIComponent(sectionId)}/hide`,
    { method: "POST" },
  );
}

export async function unhideSection(
  projectId: string,
  epicId: string,
  artifactId: string,
  sectionId: string,
): Promise<ArtifactSectionsResponse> {
  return request<ArtifactSectionsResponse>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/sections/${encodeURIComponent(sectionId)}/unhide`,
    { method: "POST" },
  );
}

export async function reorderSections(
  projectId: string,
  epicId: string,
  artifactId: string,
  orderedSectionIds: string[],
): Promise<ArtifactSectionsResponse> {
  return request<ArtifactSectionsResponse>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/sections/reorder`,
    { method: "POST", body: JSON.stringify({ orderedSectionIds }) },
  );
}

/* ── Annotations ──────────────────────────────────────────────────── */

export async function listAnnotations(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<ArtifactAnnotation[]> {
  const data = await request<{ annotations: ArtifactAnnotation[] }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations`,
  );
  return data.annotations;
}

export async function addAnnotation(
  projectId: string,
  epicId: string,
  artifactId: string,
  data: {
    sectionId: string;
    sectionTitle: string;
    instruction: string;
    elementContext?: ArtifactElementContext | null;
    type?: "modify" | "add_section";
    afterSectionId?: string | null;
  },
): Promise<ArtifactAnnotation> {
  const resp = await request<{ annotation: ArtifactAnnotation }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations`,
    { method: "POST", body: JSON.stringify(data) },
  );
  return resp.annotation;
}

export async function updateAnnotation(
  projectId: string,
  epicId: string,
  artifactId: string,
  annotationId: string,
  updates: {
    instruction?: string;
    elementContext?: ArtifactElementContext | null;
  },
): Promise<ArtifactAnnotation> {
  const resp = await request<{ annotation: ArtifactAnnotation }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "PUT", body: JSON.stringify(updates) },
  );
  return resp.annotation;
}

export async function deleteAnnotation(
  projectId: string,
  epicId: string,
  artifactId: string,
  annotationId: string,
): Promise<void> {
  await request<{ deleted: boolean }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "DELETE" },
  );
}

export async function toggleAnnotation(
  projectId: string,
  epicId: string,
  artifactId: string,
  annotationId: string,
): Promise<ArtifactAnnotation> {
  const resp = await request<{ annotation: ArtifactAnnotation }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations/${encodeURIComponent(annotationId)}/toggle`,
    { method: "POST" },
  );
  return resp.annotation;
}

export async function batchApplyAnnotations(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<{ applied: number; sections: Array<{ sectionId: string; annotationCount: number }> }> {
  return request<{ applied: number; sections: Array<{ sectionId: string; annotationCount: number }> }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations/apply`,
    { method: "POST" },
  );
}

export async function retryFailedAnnotations(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<{ retriedCount: number }> {
  return request<{ retriedCount: number }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/annotations/retry`,
    { method: "POST" },
  );
}

/* ── Versions ─────────────────────────────────────────────────────── */

export async function listVersions(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<ArtifactBuildVersion[]> {
  const data = await request<{ versions: ArtifactBuildVersion[] }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/versions`,
  );
  return data.versions;
}

export async function revertToVersion(
  projectId: string,
  epicId: string,
  artifactId: string,
  versionDir: string,
): Promise<void> {
  await request<{ reverted: boolean }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionDir)}/revert`,
    { method: "POST" },
  );
}

export async function revertToLatest(
  projectId: string,
  epicId: string,
  artifactId: string,
): Promise<void> {
  await request<{ reverted: boolean }>(
    `${epicBase(projectId, epicId)}/${encodeURIComponent(artifactId)}/versions/latest/revert`,
    { method: "POST" },
  );
}
