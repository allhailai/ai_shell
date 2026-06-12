/* ── AI Shell Server ─────────────────────────────────────────────────
   Express backend for AI Shell.

   Operating modes:
   - standalone: Single user, binds 127.0.0.1, no login required.
   - server:     Multi-user, binds 0.0.0.0, full auth pipeline.

   Mode detection priority:
   1. AISHELL_MODE env var ("server" | "standalone")
   2. <dataDir>/aishell.config.json  { "mode": "server" }
   3. Default: "standalone"
   ──────────────────────────────────────────────────────────────────── */

import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectPlatform } from "./services/platform.js";
import { createLocalAuthStrategy } from "./services/localAuthStrategy.js";
import { createAuthService } from "./services/authService.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { createKeychainBackend } from "./services/keychainBackend.js";
import { createSecretService } from "./services/secretService.js";
import { registerSecretRoutes } from "./routes/secretRoutes.js";

export type ShellMode = "standalone" | "server";

// ── Platform detection ──────────────────────────────────────────────

const platformInfo = detectPlatform();
console.log(`[aishell] Platform: ${platformInfo.platform}`);
console.log(`[aishell] Data dir: ${platformInfo.dataDir}`);
console.log(`[aishell] OS user:  ${platformInfo.osUsername}`);
console.log(`[aishell] Keychain: ${platformInfo.keychainLabel}`);

// ── Mode detection ──────────────────────────────────────────────────

function resolveMode(): ShellMode {
  const envMode = process.env.AISHELL_MODE?.trim().toLowerCase();
  if (envMode === "server" || envMode === "standalone") {
    console.log(`[aishell] Mode: ${envMode} (source: AISHELL_MODE env)`);
    return envMode;
  }
  if (envMode) {
    console.warn(`[aishell] Warning: Invalid AISHELL_MODE "${envMode}", falling back to standalone.`);
  }

  // Check config file
  try {
    const configPath = path.join(platformInfo.dataDir, "aishell.config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const fileMode = parsed?.mode?.trim().toLowerCase();
    if (fileMode === "server" || fileMode === "standalone") {
      console.log(`[aishell] Mode: ${fileMode} (source: aishell.config.json)`);
      return fileMode;
    }
    if (fileMode) {
      console.warn(`[aishell] Warning: Invalid mode "${fileMode}" in config, falling back to standalone.`);
    }
  } catch {
    // Config file missing or malformed — use default
  }

  console.log("[aishell] Mode: standalone (source: default)");
  return "standalone";
}

const SHELL_MODE = resolveMode();
const PORT = Number(process.env.AISHELL_PORT ?? 5175);

// ── Session config ──────────────────────────────────────────────────

function readSessionExpiryDays(): number {
  try {
    const configPath = path.join(platformInfo.dataDir, "aishell.config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const days = Number(parsed?.session_expiry_days);
    if (days > 0) return days;
  } catch {
    // Missing or malformed
  }
  return 3;
}

const SESSION_EXPIRY_DAYS = readSessionExpiryDays();

// ── HTTP error helper ───────────────────────────────────────────────

interface HttpError extends Error {
  status: number;
  code: string;
}

export function httpError(message: string, status: number, code: string): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  err.code = code;
  return err;
}

// ── Express app ─────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Auth infrastructure ─────────────────────────────────────────────

const localStrategy = createLocalAuthStrategy({
  dataDir: platformInfo.dataDir,
  httpError,
  sessionExpiryDays: SESSION_EXPIRY_DAYS,
});

const authService = createAuthService(localStrategy);

const authMiddleware = createAuthMiddleware({
  authService,
  mode: SHELL_MODE,
  osUsername: platformInfo.osUsername,
  dataDir: platformInfo.dataDir,
  sessionExpiryDays: SESSION_EXPIRY_DAYS,
});

if (SHELL_MODE === "server") {
  app.set("trust proxy", 1);

  // Cookie parser + security headers (before any routes)
  app.use(authMiddleware.cookieParser);
  app.use(authMiddleware.securityHeaders);

  // Initialize auth (first boot requires AISHELL_ADMIN_PASSWORD)
  try {
    const adminPassword = process.env.AISHELL_ADMIN_PASSWORD?.trim() || null;
    const result = await authService.initialize(adminPassword);
    if (result.initialized) {
      console.log("[aishell] Auth: Admin user created (first boot).");
    } else {
      console.log("[aishell] Auth: Auth file loaded.");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[aishell FATAL] ${message}\n`);
    process.exit(1);
  }

  // Register auth routes (login, logout, me, user management)
  registerAuthRoutes(app, { authService, authMiddleware, httpError, mode: SHELL_MODE });
} else {
  // Standalone: still register limited auth routes (me, setup-identity)
  app.use(authMiddleware.cookieParser);
  registerAuthRoutes(app, { authService, authMiddleware, httpError, mode: SHELL_MODE });
}

// ── Version endpoint (always public) ────────────────────────────────

const SERVER_STARTED_AT = new Date().toISOString();

app.get("/api/version", (_req, res) => {
  res.json({
    mode: SHELL_MODE,
    startedAt: SERVER_STARTED_AT,
    platform: platformInfo.platform,
    keychainAvailable: platformInfo.keychainAvailable,
  });
});

// ── Protect all /api/* in server mode ───────────────────────────────

if (SHELL_MODE === "server") {
  app.use("/api", authMiddleware.requireAuth);
}

// ── Secret infrastructure ───────────────────────────────────────────

const keychainBackend = createKeychainBackend({
  platform: platformInfo.platform,
  osUsername: platformInfo.osUsername,
});

const secretService = createSecretService({
  backend: keychainBackend,
});

registerSecretRoutes(app, { secretService, authMiddleware, httpError, mode: SHELL_MODE });

// ── Error handler ───────────────────────────────────────────────────

app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  const code = err.code ?? "internal_error";
  if (status >= 500) {
    console.error("[aishell] Server error:", err);
  }
  res.status(status).json({ error: err.message, code });
});

// ── Start server ────────────────────────────────────────────────────

const HOST = SHELL_MODE === "server" ? "0.0.0.0" : "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`\n[aishell] Server running at http://${HOST}:${PORT}`);
  console.log(`[aishell] Mode: ${SHELL_MODE}`);
  if (SHELL_MODE === "standalone") {
    console.log("[aishell] Standalone mode — no login required\n");
  } else {
    console.log("[aishell] Server mode — authentication required\n");
  }
});

// ── Process-level safety net ────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  console.error("[aishell UNHANDLED REJECTION]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[aishell UNCAUGHT EXCEPTION]", error);
});
