/* ── Auth Middleware ──────────────────────────────────────────────────
   Provides Express middleware for authentication.

   In SERVER mode:
   - Verifies JWT from httpOnly cookie
   - Sliding window: re-issues cookie with fresh expiry on each request
   - Sets req.user with sanitized user data

   In STANDALONE mode:
   - Auto-injects a virtual admin user (OS-detected username)
   - No password required, no cookie management
   - Downstream code never checks the mode — req.user is always set
   ──────────────────────────────────────────────────────────────────── */

import cookieParser from "cookie-parser";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import type { AuthStrategy, User } from "../services/authService.js";

const COOKIE_NAME = "aishell_token";

interface AuthMiddlewareOpts {
  authService: AuthStrategy;
  mode: "standalone" | "server";
  osUsername: string;
  dataDir: string;
  sessionExpiryDays?: number;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function createAuthMiddleware(opts: AuthMiddlewareOpts) {
  const { authService, mode, osUsername, dataDir, sessionExpiryDays = 3 } = opts;
  const cookieMaxAgeMs = sessionExpiryDays * 24 * 60 * 60 * 1000;

  // ── Cookie helpers ──────────────────────────────────────────────

  function setAuthCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: cookieMaxAgeMs,
    });
  }

  function clearAuthCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }

  // ── Standalone username resolution ────────────────────────────────

  function resolveStandaloneUsername(): string {
    // 1. Check persisted config
    try {
      const configPath = path.join(dataDir, "aishell.config.json");
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed?.standalone_username && typeof parsed.standalone_username === "string") {
        return parsed.standalone_username;
      }
    } catch {
      // File missing or malformed
    }

    // 2. OS username
    if (osUsername) return osUsername;

    // 3. Fallback
    return "local";
  }

  const standaloneUser: User = {
    username: resolveStandaloneUsername(),
    firstname: "",
    lastname: "",
    is_admin: true,
    is_system: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // ── Middleware functions ───────────────────────────────────────────

  async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (mode === "standalone") {
      // Standalone: always authenticated as the local user
      req.user = standaloneUser;
      next();
      return;
    }

    // Server mode: verify JWT from cookie
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const result = await authService.verifyAndRefreshToken(token);
      if (!result) {
        clearAuthCookie(res);
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      req.user = result.user;

      // Sliding window: re-issue cookie with fresh expiry
      setAuthCookie(res, result.freshToken);
      next();
    } catch {
      clearAuthCookie(res);
      res.status(401).json({ error: "Authentication required" });
    }
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user?.is_admin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  }

  function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  }

  /**
   * Set standalone identity (first-boot or explicit change).
   */
  function setStandaloneUsername(username: string): void {
    const configPath = path.join(dataDir, "aishell.config.json");
    let config: Record<string, unknown> = {};
    try {
      const raw = readFileSync(configPath, "utf-8");
      config = JSON.parse(raw);
    } catch {
      // File missing — will create
    }
    config.standalone_username = username;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    // Update in-memory user
    standaloneUser.username = username;
  }

  return {
    clearAuthCookie,
    cookieParser: cookieParser(),
    requireAdmin,
    requireAuth,
    securityHeaders,
    setAuthCookie,
    setStandaloneUsername,
    standaloneUser,
  };
}
