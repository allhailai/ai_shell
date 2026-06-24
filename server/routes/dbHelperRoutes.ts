/* ── DB Helper Routes ─────────────────────────────────────────────────
   HTTP endpoints for managing Postgres database connections.

   All connections are stored as a single JSON array in the user-scoped
   secret store under key "db-helper_connections". Passwords and SSL
   certificates are never returned to the frontend.

   Endpoints:
   - GET    /api/db-helper/connections           List all (masked)
   - POST   /api/db-helper/connections           Add new
   - PUT    /api/db-helper/connections/:id       Update existing
   - DELETE /api/db-helper/connections/:id       Remove
   - POST   /api/db-helper/connections/:id/test  Test stored connection
   - POST   /api/db-helper/connections/test-new  Test before saving
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import type { SecretService } from "../services/secretService.js";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

/** Default query timeout in seconds. */
export const DEFAULT_QUERY_TIMEOUT = 30;

/** Full connection record (stored in secret store). */
export interface DbConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: "disable" | "require" | "verify-full";
  /** Query timeout in seconds (0 = no limit). */
  queryTimeoutSeconds: number;
  /** PEM-encoded CA certificate. */
  sslCaCert?: string;
  /** PEM-encoded client certificate. */
  sslClientCert?: string;
  /** PEM-encoded client private key. */
  sslClientKey?: string;
  createdAt: string;
  updatedAt: string;
}

/** Safely extract a string route param. */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}

export const SECRET_KEY = "db-helper_connections";

interface DbHelperRoutesDeps {
  secretService: SecretService;
  authMiddleware: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  };
  httpError: HttpErrorFn;
}

// ── Helpers ───────────────────────────────────────────────────────────

export async function readConnections(
  secretService: SecretService,
  username: string,
): Promise<DbConnection[]> {
  const raw = await secretService.getUserSecret(username, SECRET_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeConnections(
  secretService: SecretService,
  username: string,
  connections: DbConnection[],
): Promise<void> {
  await secretService.setUserSecret(
    username,
    SECRET_KEY,
    JSON.stringify(connections),
  );
}

/**
 * Strip password and SSL certificate content for the API response.
 * Replaces cert content with boolean flags so the UI knows if certs are configured.
 */
function mask(conn: DbConnection) {
  const {
    password: _pw,
    sslCaCert,
    sslClientCert,
    sslClientKey,
    ...rest
  } = conn;
  return {
    ...rest,
    queryTimeoutSeconds: conn.queryTimeoutSeconds ?? DEFAULT_QUERY_TIMEOUT,
    hasSslCaCert: !!sslCaCert,
    hasSslClientCert: !!sslClientCert,
    hasSslClientKey: !!sslClientKey,
  };
}

function generateId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Validate connection payload fields. */
function validatePayload(
  body: Record<string, unknown>,
  requirePassword: boolean,
  httpError: HttpErrorFn,
): void {
  if (!body.name || typeof body.name !== "string") {
    throw httpError("Connection name is required.", 400, "missing_name");
  }
  if (!body.host || typeof body.host !== "string") {
    throw httpError("Host is required.", 400, "missing_host");
  }
  const port = Number(body.port);
  if (!port || port < 1 || port > 65535) {
    throw httpError("Port must be 1–65535.", 400, "invalid_port");
  }
  if (!body.database || typeof body.database !== "string") {
    throw httpError("Database name is required.", 400, "missing_database");
  }
  if (!body.username || typeof body.username !== "string") {
    throw httpError("Username is required.", 400, "missing_username");
  }
  if (requirePassword && (!body.password || typeof body.password !== "string")) {
    throw httpError("Password is required.", 400, "missing_password");
  }
  const validSsl = ["disable", "require", "verify-full"];
  if (body.sslMode && !validSsl.includes(body.sslMode as string)) {
    throw httpError(
      `Invalid sslMode. Must be one of: ${validSsl.join(", ")}`,
      400,
      "invalid_ssl_mode",
    );
  }
}

/** Build the pg SSL config object from connection settings. */
export function buildSslConfig(conn: {
  sslMode: string;
  sslCaCert?: string;
  sslClientCert?: string;
  sslClientKey?: string;
}): false | Record<string, unknown> {
  if (conn.sslMode === "disable") return false;

  const ssl: Record<string, unknown> = {
    rejectUnauthorized: conn.sslMode === "verify-full",
  };

  if (conn.sslCaCert) {
    ssl.ca = conn.sslCaCert;
  }
  if (conn.sslClientCert) {
    ssl.cert = conn.sslClientCert;
  }
  if (conn.sslClientKey) {
    ssl.key = conn.sslClientKey;
  }

  return ssl;
}

/** Attempt a Postgres connection and return result. */
async function testConnection(conn: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: string;
  sslCaCert?: string;
  sslClientCert?: string;
  sslClientKey?: string;
}): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    return {
      success: false,
      message: "pg driver not available on the server.",
    };
  }

  const { Client } = pg;

  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    ssl: buildSslConfig(conn),
    connectionTimeoutMillis: 10_000,
    query_timeout: 5_000,
  });

  const start = Date.now();
  try {
    await client.connect();
    await client.query("SELECT 1");
    const latencyMs = Date.now() - start;
    return { success: true, message: "Connection successful.", latencyMs };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown connection error.";
    return { success: false, message };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}

// ── Route Registration ────────────────────────────────────────────────

export function registerDbHelperRoutes(
  app: Express,
  deps: DbHelperRoutesDeps,
): void {
  const { secretService, authMiddleware, httpError } = deps;
  const auth = authMiddleware.requireAuth;

  // ── List connections ──────────────────────────────────────────────

  app.get(
    "/api/db-helper/connections",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connections = await readConnections(secretService, username);
        res.json({ connections: connections.map(mask) });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Add connection ────────────────────────────────────────────────

  app.post(
    "/api/db-helper/connections",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const body = (req.body ?? {}) as Record<string, unknown>;
        validatePayload(body, true, httpError);

        const connections = await readConnections(secretService, username);

        const now = new Date().toISOString();
        const newConn: DbConnection = {
          id: generateId(),
          name: body.name as string,
          host: body.host as string,
          port: Number(body.port),
          database: body.database as string,
          username: body.username as string,
          password: body.password as string,
          sslMode: (body.sslMode as DbConnection["sslMode"]) || "disable",
          queryTimeoutSeconds: Number(body.queryTimeoutSeconds) || DEFAULT_QUERY_TIMEOUT,
          sslCaCert: (body.sslCaCert as string) || undefined,
          sslClientCert: (body.sslClientCert as string) || undefined,
          sslClientKey: (body.sslClientKey as string) || undefined,
          createdAt: now,
          updatedAt: now,
        };

        connections.push(newConn);
        await writeConnections(secretService, username, connections);

        res.status(201).json({ connection: mask(newConn) });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Update connection ─────────────────────────────────────────────

  app.put(
    "/api/db-helper/connections/:id",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const id = param(req, "id");
        const body = (req.body ?? {}) as Record<string, unknown>;
        validatePayload(body, false, httpError);

        const connections = await readConnections(secretService, username);
        const idx = connections.findIndex((c) => c.id === id);
        if (idx === -1) {
          throw httpError("Connection not found.", 404, "connection_not_found");
        }

        const existing = connections[idx];
        const now = new Date().toISOString();

        connections[idx] = {
          ...existing,
          name: body.name as string,
          host: body.host as string,
          port: Number(body.port),
          database: body.database as string,
          username: body.username as string,
          password:
            body.password && typeof body.password === "string"
              ? body.password
              : existing.password,
          sslMode: (body.sslMode as DbConnection["sslMode"]) || existing.sslMode,
          queryTimeoutSeconds:
            body.queryTimeoutSeconds !== undefined
              ? Number(body.queryTimeoutSeconds)
              : existing.queryTimeoutSeconds ?? DEFAULT_QUERY_TIMEOUT,
          // For certs: if provided, update; if empty string, clear; if undefined, keep existing
          sslCaCert:
            typeof body.sslCaCert === "string"
              ? body.sslCaCert || undefined
              : existing.sslCaCert,
          sslClientCert:
            typeof body.sslClientCert === "string"
              ? body.sslClientCert || undefined
              : existing.sslClientCert,
          sslClientKey:
            typeof body.sslClientKey === "string"
              ? body.sslClientKey || undefined
              : existing.sslClientKey,
          updatedAt: now,
        };

        await writeConnections(secretService, username, connections);

        res.json({ connection: mask(connections[idx]) });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Delete connection ─────────────────────────────────────────────

  app.delete(
    "/api/db-helper/connections/:id",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const id = param(req, "id");

        const connections = await readConnections(secretService, username);
        const idx = connections.findIndex((c) => c.id === id);
        if (idx === -1) {
          throw httpError("Connection not found.", 404, "connection_not_found");
        }

        connections.splice(idx, 1);
        await writeConnections(secretService, username, connections);

        res.json({ ok: true, deleted: true, id });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Test stored connection ────────────────────────────────────────

  app.post(
    "/api/db-helper/connections/:id/test",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const id = param(req, "id");

        const connections = await readConnections(secretService, username);
        const conn = connections.find((c) => c.id === id);
        if (!conn) {
          throw httpError("Connection not found.", 404, "connection_not_found");
        }

        const result = await testConnection(conn);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Test new connection (before saving) ───────────────────────────

  app.post(
    "/api/db-helper/connections/test-new",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        validatePayload(body, true, httpError);

        const result = await testConnection({
          host: body.host as string,
          port: Number(body.port),
          database: body.database as string,
          username: body.username as string,
          password: body.password as string,
          sslMode: (body.sslMode as string) || "disable",
          sslCaCert: (body.sslCaCert as string) || undefined,
          sslClientCert: (body.sslClientCert as string) || undefined,
          sslClientKey: (body.sslClientKey as string) || undefined,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
}
