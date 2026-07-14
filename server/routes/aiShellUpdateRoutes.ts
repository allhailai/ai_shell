/* ── AIShell Update Routes ────────────────────────────────────────────
   POST /api/system/update/check                    — Check for available updates
   POST /api/system/update-and-restart              — Pull + restart
   GET  /api/system/update/worktree                 — Inspect local changes (admin only)
   GET  /api/system/update/stashes                  — List AIShell recovery stashes (admin only)
   POST /api/system/update/stash                    — Stash local changes (admin only)
   POST /api/system/update/stashes/:stashId/restore — Restore a recovery stash (admin only)

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
  getWorktreeStatus: () => Promise<unknown>;
  listRecoveryStashes: () => Promise<unknown>;
  stashWorkingTree: (input: { actor: string; confirmation: unknown; statusFingerprint: unknown }) => Promise<unknown>;
  restoreRecoveryStash: (input: { actor: string; confirmation: unknown; stashId: unknown }) => Promise<unknown>;
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
    getWorktreeStatus,
    listRecoveryStashes,
    stashWorkingTree,
    restoreRecoveryStash,
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
  // Recovery operations reveal and modify the server checkout. They must never
  // inherit the optional update_access="any" relaxation.
  const admin = authMiddleware.requireAdmin;

  app.get(
    "/api/system/update/worktree",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await getWorktreeStatus());
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/system/update/stashes",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({ stashes: await listRecoveryStashes() });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/system/update/stash",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as { confirmation?: unknown; statusFingerprint?: unknown };
        res.json(await stashWorkingTree({
          actor: req.user!.username,
          confirmation: body.confirmation,
          statusFingerprint: body.statusFingerprint,
        }));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/system/update/stashes/:stashId/restore",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as { confirmation?: unknown };
        res.json(await restoreRecoveryStash({
          actor: req.user!.username,
          confirmation: body.confirmation,
          stashId: req.params.stashId,
        }));
      } catch (error) {
        next(error);
      }
    },
  );

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
