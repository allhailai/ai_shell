/* ── AIShell Update Routes ────────────────────────────────────────────
   POST /api/system/update/check        — Check for available updates
   POST /api/system/update-and-restart  — Pull + restart

   Access control:
   - `update_access` in aishell.config.json: "admin" (default) or "any"
   - "admin" → only admins can trigger (requireAdmin middleware)
   - "any"   → any authenticated user can trigger
   - Standalone mode → always allowed (requireAdmin is a no-op)
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction, Express } from "express";

interface UpdateRoutesDeps {
  checkUpdate: () => Promise<unknown>;
  updateAndRestart: () => Promise<unknown>;
  authMiddleware: {
    requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  };
  httpError: (message: string, status: number, code: string) => Error;
  mode: "standalone" | "server";
  dataDir: string;
}

function readUpdateAccess(dataDir: string): "admin" | "any" {
  try {
    const configPath = path.join(dataDir, "aishell.config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const value = parsed?.update_access?.trim().toLowerCase();
    if (value === "any") return "any";
  } catch {
    // Missing or malformed config
  }
  return "admin";
}

export function registerAiShellUpdateRoutes(
  app: Express,
  {
    checkUpdate,
    updateAndRestart,
    authMiddleware,
    mode,
    dataDir,
  }: UpdateRoutesDeps,
) {
  // Determine the middleware to apply. In standalone mode, no gating.
  // In server mode, depends on `update_access` config.
  function resolveGate(): (req: Request, res: Response, next: NextFunction) => void {
    if (mode === "standalone") {
      return (_req, _res, next) => next();
    }
    const access = readUpdateAccess(dataDir);
    if (access === "any") {
      return (_req, _res, next) => next();
    }
    return authMiddleware.requireAdmin;
  }

  const gate = resolveGate();

  app.post(
    "/api/system/update/check",
    gate,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await checkUpdate());
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/system/update-and-restart",
    gate,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await updateAndRestart());
      } catch (error) {
        next(error);
      }
    },
  );
}
