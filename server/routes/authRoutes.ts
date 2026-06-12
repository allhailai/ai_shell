/* ── Auth Routes ──────────────────────────────────────────────────────
   HTTP endpoints for authentication and user management.

   Server mode:  All routes active (login, logout, user CRUD).
   Standalone:   Only /me and /setup-identity are meaningful.
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import type { AuthStrategy } from "../services/authService.js";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

/** Safely extract a string route param (Express 5 types them as string | string[]). */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}

interface AuthRoutesDeps {
  authService: AuthStrategy;
  authMiddleware: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
    setAuthCookie: (res: Response, token: string) => void;
    clearAuthCookie: (res: Response) => void;
    setStandaloneUsername: (username: string) => void;
    standaloneUser: { username: string };
  };
  httpError: HttpErrorFn;
  mode: "standalone" | "server";
}

// ── Login rate limiter ──────────────────────────────────────────────

function createLoginRateLimiter({ maxAttempts = 5, windowMs = 60_000 } = {}) {
  const attempts = new Map<string, { count: number; windowStart: number }>();

  // Clean up expired entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of attempts) {
      if (now - record.windowStart > windowMs) attempts.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimitLogin(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    let record = attempts.get(ip);

    if (!record || now - record.windowStart > windowMs) {
      record = { count: 0, windowStart: now };
      attempts.set(ip, record);
    }

    record.count += 1;

    if (record.count > maxAttempts) {
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }

    next();
  };
}

// ── Route registration ──────────────────────────────────────────────

export function registerAuthRoutes(app: Express, deps: AuthRoutesDeps): void {
  const { authService, authMiddleware, httpError, mode } = deps;
  const rateLimitLogin = createLoginRateLimiter();

  // ── Login (server mode only) ────────────────────────────────────

  if (mode === "server") {
    app.post("/api/auth/login", rateLimitLogin, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { username, password } = (req.body ?? {}) as { username?: string; password?: string };

        if (!username || !password) {
          throw httpError("Username and password are required.", 400, "missing_credentials");
        }

        const { token, user } = await authService.authenticate(String(username), String(password));
        authMiddleware.setAuthCookie(res, token);
        res.json({ ok: true, user });
      } catch (error) {
        next(error);
      }
    });
  }

  // ── Logout ──────────────────────────────────────────────────────

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    authMiddleware.clearAuthCookie(res);
    res.json({ ok: true });
  });

  // ── Current user ────────────────────────────────────────────────

  app.get("/api/auth/me", authMiddleware.requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user, mode });
  });

  // ── Setup standalone identity ───────────────────────────────────

  if (mode === "standalone") {
    app.post("/api/auth/setup-identity", (req: Request, res: Response, next: NextFunction) => {
      try {
        const { username } = (req.body ?? {}) as { username?: string };

        if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_-]{2,50}$/.test(username)) {
          throw httpError(
            "Username must be 2-50 characters (letters, numbers, underscores, hyphens).",
            400,
            "invalid_username",
          );
        }

        authMiddleware.setStandaloneUsername(username);
        res.json({ ok: true, username });
      } catch (error) {
        next(error);
      }
    });
  }

  // ── Change own password (server mode only) ──────────────────────

  if (mode === "server") {
    app.post(
      "/api/auth/me/password",
      authMiddleware.requireAuth,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { currentPassword, newPassword } = (req.body ?? {}) as {
            currentPassword?: string;
            newPassword?: string;
          };

          if (!currentPassword || !newPassword) {
            throw httpError("Current password and new password are required.", 400, "missing_fields");
          }

          await authService.changePassword(req.user!.username, String(currentPassword), String(newPassword));

          authMiddleware.clearAuthCookie(res);
          res.json({ ok: true, message: "Password changed. Please log in again." });
        } catch (error) {
          next(error);
        }
      },
    );

    // ── User management (admin only) ──────────────────────────────

    app.get(
      "/api/auth/users",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (_req: Request, res: Response, next: NextFunction) => {
        try {
          res.json({ users: await authService.listUsers() });
        } catch (error) {
          next(error);
        }
      },
    );

    app.post(
      "/api/auth/users",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { username, password, firstname, lastname, is_admin } = (req.body ?? {}) as Record<string, unknown>;

          if (!username || !password) {
            throw httpError("Username and password are required.", 400, "missing_fields");
          }

          const user = await authService.createUser({
            username: String(username),
            password: String(password),
            firstname: firstname != null ? String(firstname) : "",
            lastname: lastname != null ? String(lastname) : "",
            is_admin: is_admin === true,
          });

          res.status(201).json(user);
        } catch (error) {
          next(error);
        }
      },
    );

    app.get(
      "/api/auth/users/:username",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          res.json(await authService.getUser(param(req, "username")));
        } catch (error) {
          next(error);
        }
      },
    );

    app.put(
      "/api/auth/users/:username",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { firstname, lastname, is_admin } = (req.body ?? {}) as Record<string, unknown>;
          const { user } = await authService.updateUser(param(req, "username"), {
            firstname: firstname != null ? String(firstname) : undefined,
            lastname: lastname != null ? String(lastname) : undefined,
            is_admin: is_admin !== undefined ? is_admin === true : undefined,
          });
          res.json(user);
        } catch (error) {
          next(error);
        }
      },
    );

    app.delete(
      "/api/auth/users/:username",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          res.json(await authService.deleteUser(param(req, "username")));
        } catch (error) {
          next(error);
        }
      },
    );

    app.post(
      "/api/auth/users/:username/reset-password",
      authMiddleware.requireAuth,
      authMiddleware.requireAdmin,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { newPassword } = (req.body ?? {}) as { newPassword?: string };

          if (!newPassword) {
            throw httpError("New password is required.", 400, "missing_fields");
          }

          await authService.resetPassword(param(req, "username"), String(newPassword));
          res.json({ ok: true, message: "Password has been reset." });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
