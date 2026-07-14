import type { AppManifest } from "../types/app";
import type { AuthUser } from "./authContext";

/** One shell-wide access decision for navigation and rendered routes. */
export function canAccessApp(app: AppManifest, user: AuthUser | null): boolean {
  return !app.requiresAdmin || user?.is_admin === true;
}
