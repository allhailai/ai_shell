/* ── DB Helper Types ──────────────────────────────────────────────────
   Shared type definitions for the DB Helper application.
   These mirror the server-side shapes with password always masked.
   ──────────────────────────────────────────────────────────────────── */

export type SslMode = "disable" | "require" | "verify-full";

/** Connection as returned by the API (password & certs always masked). */
export interface DbConnectionInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  /** Query timeout in seconds (0 = no limit). Default: 30. */
  queryTimeoutSeconds: number;
  /** True if a CA certificate is stored for this connection. */
  hasSslCaCert: boolean;
  /** True if a client certificate is stored for this connection. */
  hasSslClientCert: boolean;
  /** True if a client key is stored for this connection. */
  hasSslClientKey: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a new connection. */
export interface DbConnectionCreatePayload {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  /** Query timeout in seconds (0 = no limit). */
  queryTimeoutSeconds?: number;
  /** PEM-encoded CA certificate (optional). */
  sslCaCert?: string;
  /** PEM-encoded client certificate (optional, for mutual TLS). */
  sslClientCert?: string;
  /** PEM-encoded client private key (optional, for mutual TLS). */
  sslClientKey?: string;
}

/** Payload for updating an existing connection. */
export interface DbConnectionUpdatePayload {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;      // blank = keep existing
  sslMode: SslMode;
  /** Query timeout in seconds (0 = no limit). */
  queryTimeoutSeconds?: number;
  sslCaCert?: string;     // blank = keep existing
  sslClientCert?: string; // blank = keep existing
  sslClientKey?: string;  // blank = keep existing
}

/** Result from a connection test. */
export interface TestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}
