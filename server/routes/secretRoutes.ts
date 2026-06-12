/* ── Secret Routes ────────────────────────────────────────────────────
   HTTP endpoints for the centralized secret management system.

   Scopes:
   - /api/secrets/global/*        Global secrets (admin write, any read)
   - /api/secrets/app/:appId/*    App-scoped secrets (app or admin only)
   - /api/secrets/user/*          User-scoped (own secrets)
   - /api/secrets/user/:username/* Admin managing another user's secrets
   - /api/secrets/status          Platform capabilities
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import type { SecretService } from "../services/secretService.js";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

/** Safely extract a string route param (Express 5 types them as string | string[]). */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}


interface SecretRoutesDeps {
  secretService: SecretService;
  authMiddleware: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  };
  httpError: HttpErrorFn;
  mode: "standalone" | "server";
}

export function registerSecretRoutes(app: Express, deps: SecretRoutesDeps): void {
  const { secretService, authMiddleware, httpError } = deps;

  // All secret routes require authentication
  const auth = authMiddleware.requireAuth;
  const admin = authMiddleware.requireAdmin;

  // ── Platform status ───────────────────────────────────────────────

  app.get("/api/secrets/status", auth, (_req: Request, res: Response) => {
    res.json(secretService.getStatus());
  });

  // ── Global secrets ────────────────────────────────────────────────

  app.get("/api/secrets/global/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = param(req, "key");
      const value = await secretService.getGlobal(key);
      if (value === null) {
        throw httpError("Secret not found.", 404, "secret_not_found");
      }
      res.json({ key, value, scope: "global" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/secrets/global/:key", auth, admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = param(req, "key");
      const { value } = (req.body ?? {}) as { value?: string };
      if (!value || typeof value !== "string") {
        throw httpError("Secret value is required.", 400, "missing_value");
      }
      await secretService.setGlobal(key, value);
      res.json({ ok: true, key, scope: "global" });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/secrets/global/:key", auth, admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = param(req, "key");
      await secretService.deleteGlobal(key);
      res.json({ ok: true, deleted: true, key, scope: "global" });
    } catch (error) {
      next(error);
    }
  });

  // ── App-scoped secrets ────────────────────────────────────────────
  // Access control: validated via X-AIShell-App-Id header or admin

  function validateAppAccess(req: Request, res: Response, appId: string): boolean {
    // Admins can access any app's secrets
    if (req.user?.is_admin) return true;

    // Non-admin: verify the requesting app matches the target appId
    const requestingAppId = req.headers["x-aishell-app-id"];
    if (requestingAppId !== appId) {
      res.status(403).json({
        error: `Access denied. App "${requestingAppId || "(none)"}" cannot access secrets for app "${appId}".`,
        code: "app_scope_violation",
      });
      return false;
    }
    return true;
  }

  app.get("/api/secrets/app/:appId/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = param(req, "appId");
      const key = param(req, "key");
      if (!validateAppAccess(req, res, appId)) return;

      const value = await secretService.getAppSecret(appId, key);
      if (value === null) {
        throw httpError("Secret not found.", 404, "secret_not_found");
      }
      res.json({ key, value, scope: `app:${appId}` });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/secrets/app/:appId/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = param(req, "appId");
      const key = param(req, "key");
      if (!validateAppAccess(req, res, appId)) return;

      const { value } = (req.body ?? {}) as { value?: string };
      if (!value || typeof value !== "string") {
        throw httpError("Secret value is required.", 400, "missing_value");
      }
      await secretService.setAppSecret(appId, key, value);
      res.json({ ok: true, key, scope: `app:${appId}` });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/secrets/app/:appId/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = param(req, "appId");
      const key = param(req, "key");
      if (!validateAppAccess(req, res, appId)) return;

      await secretService.deleteAppSecret(appId, key);
      res.json({ ok: true, deleted: true, key, scope: `app:${appId}` });
    } catch (error) {
      next(error);
    }
  });

  // ── User-scoped secrets (own) ─────────────────────────────────────

  app.get("/api/secrets/user/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = req.user!.username;
      const key = param(req, "key");
      const value = await secretService.getUserSecret(username, key);
      if (value === null) {
        throw httpError("Secret not found.", 404, "secret_not_found");
      }
      res.json({ key, value, scope: `user:${username}` });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/secrets/user/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = req.user!.username;
      const key = param(req, "key");
      const { value } = (req.body ?? {}) as { value?: string };
      if (!value || typeof value !== "string") {
        throw httpError("Secret value is required.", 400, "missing_value");
      }
      await secretService.setUserSecret(username, key, value);
      res.json({ ok: true, key, scope: `user:${username}` });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/secrets/user/:key", auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = req.user!.username;
      const key = param(req, "key");
      await secretService.deleteUserSecret(username, key);
      res.json({ ok: true, deleted: true, key, scope: `user:${username}` });
    } catch (error) {
      next(error);
    }
  });

  // ── User-scoped secrets (admin managing another user) ─────────────

  app.get(
    "/api/secrets/admin/user/:username/:key",
    auth,
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = param(req, "username");
        const key = param(req, "key");
        const value = await secretService.getUserSecret(username, key);
        if (value === null) {
          throw httpError("Secret not found.", 404, "secret_not_found");
        }
        res.json({ key, value, scope: `user:${username}` });
      } catch (error) {
        next(error);
      }
    },
  );

  app.put(
    "/api/secrets/admin/user/:username/:key",
    auth,
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = param(req, "username");
        const key = param(req, "key");
        const { value } = (req.body ?? {}) as { value?: string };
        if (!value || typeof value !== "string") {
          throw httpError("Secret value is required.", 400, "missing_value");
        }
        await secretService.setUserSecret(username, key, value);
        res.json({ ok: true, key, scope: `user:${username}` });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/secrets/admin/user/:username/:key",
    auth,
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = param(req, "username");
        const key = param(req, "key");
        await secretService.deleteUserSecret(username, key);
        res.json({ ok: true, deleted: true, key, scope: `user:${username}` });
      } catch (error) {
        next(error);
      }
    },
  );
}

