/* ── DB Explorer Routes ──────────────────────────────────────────────
   HTTP endpoints for browsing database schemas, previewing table data,
   and executing arbitrary SQL queries.

   Endpoints:
   - GET    /api/db-helper/:connId/schemas                              List schemas
   - GET    /api/db-helper/:connId/schemas/:schema/tables               List tables
   - GET    /api/db-helper/:connId/schemas/:schema/tables/:table/structure  Table structure
   - GET    /api/db-helper/:connId/schemas/:schema/tables/:table/count  Row count
   - GET    /api/db-helper/:connId/schemas/:schema/tables/:table/data   Preview data
   - POST   /api/db-helper/:connId/query                                Execute SQL
   - POST   /api/db-helper/:connId/query/export                         Execute SQL → CSV
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import type { SecretService } from "../services/secretService.js";
import {
  readConnections,
  buildSslConfig,
  DEFAULT_QUERY_TIMEOUT,
  type DbConnection,
} from "./dbHelperRoutes.js";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

interface DbExplorerRoutesDeps {
  secretService: SecretService;
  authMiddleware: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  };
  httpError: HttpErrorFn;
}

/** Max rows for table data preview. */
const MAX_DATA_ROWS = 500;
/** Max rows for query results. */
const MAX_QUERY_ROWS = 10_000;
/** Max response size in bytes (~10MB). */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/** Safely extract a string route param. */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}

/**
 * Connect to a stored database connection.
 * Returns a connected pg.Client with statement_timeout set.
 * Caller MUST call client.end() when done.
 */
async function connectToDatabase(
  secretService: SecretService,
  username: string,
  connId: string,
  httpError: HttpErrorFn,
): Promise<{ client: InstanceType<typeof import("pg").Client>; conn: DbConnection }> {
  const connections = await readConnections(secretService, username);
  const conn = connections.find((c) => c.id === connId);
  if (!conn) {
    throw httpError("Connection not found.", 404, "connection_not_found");
  }

  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw httpError("pg driver not available.", 500, "pg_not_available");
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
  });

  await client.connect();

  // Set query timeout from connection config
  const timeoutSeconds = conn.queryTimeoutSeconds ?? DEFAULT_QUERY_TIMEOUT;
  if (timeoutSeconds > 0) {
    await client.query(`SET statement_timeout = '${timeoutSeconds}s'`);
  }

  return { client, conn };
}

/**
 * Wrapper to handle connection + query + cleanup in one pattern.
 */
async function withConnection<T>(
  secretService: SecretService,
  username: string,
  connId: string,
  httpError: HttpErrorFn,
  fn: (client: InstanceType<typeof import("pg").Client>, conn: DbConnection) => Promise<T>,
): Promise<T> {
  const { client, conn } = await connectToDatabase(secretService, username, connId, httpError);
  try {
    return await fn(client, conn);
  } finally {
    try {
      await client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}

/** Convert query result rows to CSV string. */
function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(escape).join(",");
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(","));
  return [header, ...body].join("\n");
}

// ── Route Registration ────────────────────────────────────────────────

export function registerDbExplorerRoutes(
  app: Express,
  deps: DbExplorerRoutesDeps,
): void {
  const { secretService, authMiddleware, httpError } = deps;
  const auth = authMiddleware.requireAuth;

  // ── List schemas ──────────────────────────────────────────────────

  app.get(
    "/api/db-helper/:connId/schemas",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");

        const schemas = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            const result = await client.query(`
              SELECT schema_name
              FROM information_schema.schemata
              WHERE schema_name NOT LIKE 'pg_temp%'
                AND schema_name NOT LIKE 'pg_toast%'
              ORDER BY
                CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END,
                schema_name
            `);
            return result.rows.map((r: Record<string, unknown>) => r.schema_name as string);
          },
        );

        res.json({ schemas });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── List tables in a schema ───────────────────────────────────────

  app.get(
    "/api/db-helper/:connId/schemas/:schema/tables",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const schema = param(req, "schema");

        const tables = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            const result = await client.query(
              `SELECT table_name, table_type
               FROM information_schema.tables
               WHERE table_schema = $1
               ORDER BY table_type, table_name`,
              [schema],
            );
            return result.rows.map((r: Record<string, unknown>) => ({
              name: r.table_name as string,
              type: r.table_type === "VIEW" ? "view" as const : "table" as const,
            }));
          },
        );

        res.json({ tables });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Table structure ───────────────────────────────────────────────

  app.get(
    "/api/db-helper/:connId/schemas/:schema/tables/:table/structure",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const schema = param(req, "schema");
        const table = param(req, "table");

        const structure = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            // Columns
            const colResult = await client.query(
              `SELECT
                 column_name, data_type, character_maximum_length,
                 numeric_precision, numeric_scale,
                 is_nullable, column_default, ordinal_position,
                 udt_name
               FROM information_schema.columns
               WHERE table_schema = $1 AND table_name = $2
               ORDER BY ordinal_position`,
              [schema, table],
            );

            // Indexes
            const idxResult = await client.query(
              `SELECT
                 i.relname AS index_name,
                 am.amname AS index_type,
                 ix.indisprimary AS is_primary,
                 ix.indisunique AS is_unique,
                 array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
               FROM pg_index ix
               JOIN pg_class t ON t.oid = ix.indrelid
               JOIN pg_class i ON i.oid = ix.indexrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
               JOIN pg_am am ON am.oid = i.relam
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
               WHERE n.nspname = $1 AND t.relname = $2
               GROUP BY i.relname, am.amname, ix.indisprimary, ix.indisunique
               ORDER BY ix.indisprimary DESC, i.relname`,
              [schema, table],
            );

            // Foreign keys
            const fkResult = await client.query(
              `SELECT
                 tc.constraint_name,
                 kcu.column_name,
                 ccu.table_schema AS foreign_schema,
                 ccu.table_name AS foreign_table,
                 ccu.column_name AS foreign_column
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
               JOIN information_schema.constraint_column_usage ccu
                 ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
               WHERE tc.constraint_type = 'FOREIGN KEY'
                 AND tc.table_schema = $1 AND tc.table_name = $2
               ORDER BY tc.constraint_name`,
              [schema, table],
            );

            // Check constraints
            const chkResult = await client.query(
              `SELECT
                 tc.constraint_name,
                 cc.check_clause
               FROM information_schema.table_constraints tc
               JOIN information_schema.check_constraints cc
                 ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
               WHERE tc.constraint_type = 'CHECK'
                 AND tc.table_schema = $1 AND tc.table_name = $2
                 AND tc.constraint_name NOT LIKE '%_not_null'
               ORDER BY tc.constraint_name`,
              [schema, table],
            );

            return {
              columns: colResult.rows.map((r: Record<string, unknown>) => ({
                name: r.column_name,
                dataType: r.udt_name || r.data_type,
                maxLength: r.character_maximum_length,
                numericPrecision: r.numeric_precision,
                numericScale: r.numeric_scale,
                nullable: r.is_nullable === "YES",
                defaultValue: r.column_default,
                position: r.ordinal_position,
              })),
              indexes: idxResult.rows.map((r: Record<string, unknown>) => ({
                name: r.index_name,
                type: r.index_type,
                isPrimary: r.is_primary,
                isUnique: r.is_unique,
                columns: r.columns,
              })),
              foreignKeys: fkResult.rows.map((r: Record<string, unknown>) => ({
                name: r.constraint_name,
                column: r.column_name,
                foreignSchema: r.foreign_schema,
                foreignTable: r.foreign_table,
                foreignColumn: r.foreign_column,
              })),
              checkConstraints: chkResult.rows.map((r: Record<string, unknown>) => ({
                name: r.constraint_name,
                clause: r.check_clause,
              })),
            };
          },
        );

        res.json(structure);
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Row count ─────────────────────────────────────────────────────

  app.get(
    "/api/db-helper/:connId/schemas/:schema/tables/:table/count",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const schema = param(req, "schema");
        const table = param(req, "table");

        const count = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            // Use pg_class for approximate count (fast, no full table scan)
            const result = await client.query(
              `SELECT reltuples::bigint AS approximate_count
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = $1 AND c.relname = $2`,
              [schema, table],
            );
            return Number(result.rows[0]?.approximate_count ?? 0);
          },
        );

        res.json({ count, approximate: true });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Table data preview ────────────────────────────────────────────

  app.get(
    "/api/db-helper/:connId/schemas/:schema/tables/:table/data",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const schema = param(req, "schema");
        const table = param(req, "table");

        const limit = Math.min(Number(req.query.limit) || 100, MAX_DATA_ROWS);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const sortColumn = req.query.sortColumn as string | undefined;
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";

        const data = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            // Validate sort column exists (prevent SQL injection)
            let orderClause = "";
            if (sortColumn) {
              const colCheck = await client.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
                [schema, table, sortColumn],
              );
              if (colCheck.rows.length > 0) {
                orderClause = `ORDER BY ${client.escapeLiteral(sortColumn).replace(/'/g, '"')} ${sortOrder}`;
              }
            }

            // Use identifier quoting to prevent SQL injection for schema/table names
            const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
            const quotedTable = `"${table.replace(/"/g, '""')}"`;

            const result = await client.query(
              `SELECT * FROM ${quotedSchema}.${quotedTable} ${orderClause} LIMIT $1 OFFSET $2`,
              [limit, offset],
            );

            return {
              columns: result.fields.map((f) => ({
                name: f.name,
                dataTypeId: f.dataTypeID,
              })),
              rows: result.rows,
              rowCount: result.rowCount ?? 0,
              hasMore: (result.rowCount ?? 0) === limit,
            };
          },
        );

        res.json(data);
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Execute SQL query ─────────────────────────────────────────────

  app.post(
    "/api/db-helper/:connId/query",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const { sql } = (req.body ?? {}) as { sql?: string };

        if (!sql || typeof sql !== "string" || !sql.trim()) {
          throw httpError("SQL query is required.", 400, "missing_sql");
        }

        const result = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            const start = Date.now();
            const queryResult = await client.query(sql);
            const durationMs = Date.now() - start;

            // Handle different result types
            const rows = queryResult.rows ?? [];
            const columns = queryResult.fields?.map((f) => ({
              name: f.name,
              dataTypeId: f.dataTypeID,
            })) ?? [];

            // Truncate rows if needed
            const truncated = rows.length > MAX_QUERY_ROWS;
            const returnRows = truncated ? rows.slice(0, MAX_QUERY_ROWS) : rows;

            // Check response size
            const payload = JSON.stringify({ columns, rows: returnRows });
            if (payload.length > MAX_RESPONSE_SIZE) {
              return {
                columns,
                rows: returnRows.slice(0, 100),
                rowCount: queryResult.rowCount ?? 0,
                durationMs,
                truncated: true,
                message: `Result too large. Showing first 100 of ${rows.length} rows.`,
              };
            }

            return {
              columns,
              rows: returnRows,
              rowCount: queryResult.rowCount ?? 0,
              durationMs,
              truncated,
              command: queryResult.command,
            };
          },
        );

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Export query results as CSV ────────────────────────────────────

  app.post(
    "/api/db-helper/:connId/query/export",
    auth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const username = req.user!.username;
        const connId = param(req, "connId");
        const { sql } = (req.body ?? {}) as { sql?: string };

        if (!sql || typeof sql !== "string" || !sql.trim()) {
          throw httpError("SQL query is required.", 400, "missing_sql");
        }

        const csv = await withConnection(
          secretService, username, connId, httpError,
          async (client) => {
            const result = await client.query(sql);
            const columns = result.fields?.map((f) => f.name) ?? [];
            return rowsToCsv(columns, result.rows ?? []);
          },
        );

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=query_results.csv");
        res.send(csv);
      } catch (error) {
        next(error);
      }
    },
  );
}
