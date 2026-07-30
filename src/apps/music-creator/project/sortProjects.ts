import type { MusicProject } from "../types";

/** Hub list order — most recently updated first */
export function sortProjectsByUpdatedAt(projects: MusicProject[]): MusicProject[] {
  return [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
