/* ── Auth Service (Strategy Pattern) ─────────────────────────────────
   Pluggable authentication abstraction.

   The shell uses this interface for all auth operations. The active
   strategy (local, OAuth, LDAP, etc.) is injected at startup.
   Only LocalAuthStrategy is implemented now.
   ──────────────────────────────────────────────────────────────────── */

/** Sanitized user record — never contains password_hash. */
export interface User {
  username: string;
  firstname: string;
  lastname: string;
  is_admin: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResult {
  token: string;
  user: User;
}

export interface SessionResult {
  user: User;
  freshToken: string;
}

export interface CreateUserParams {
  username: string;
  password: string;
  firstname?: string;
  lastname?: string;
  is_admin?: boolean;
}

export interface UserUpdates {
  firstname?: string;
  lastname?: string;
  is_admin?: boolean;
}

/** Strategy interface — implement to add OAuth, LDAP, etc. */
export interface AuthStrategy {
  /**
   * One-time initialization (create admin on first boot, load config, etc.).
   * @param adminPassword - Required on first boot in server mode.
   */
  initialize(adminPassword: string | null): Promise<{ initialized: boolean }>;

  /** Authenticate with credentials. Returns a JWT + sanitized user. */
  authenticate(username: string, password: string): Promise<AuthResult>;

  /** Verify a JWT and return a refreshed session, or null if invalid. */
  verifyAndRefreshToken(token: string): Promise<SessionResult | null>;

  /** Get the JWT secret (for standalone token generation). */
  getJwtSecret(): Promise<string | null>;

  /** Sign a token for a user (used by standalone mode). */
  signTokenForUser(user: User): Promise<string>;

  // ── User management (optional for non-local strategies) ──────────

  createUser(params: CreateUserParams): Promise<User>;
  updateUser(username: string, updates: UserUpdates): Promise<{ user: User; versionBumped: boolean }>;
  deleteUser(username: string): Promise<{ deleted: boolean; username: string }>;
  listUsers(): Promise<User[]>;
  getUser(username: string): Promise<User>;
  changePassword(username: string, currentPassword: string, newPassword: string): Promise<{ changed: boolean }>;
  resetPassword(username: string, newPassword: string): Promise<{ reset: boolean }>;
}

/**
 * Create an auth service from a strategy.
 *
 * This is intentionally a thin wrapper. The value is the seam: if we
 * need to add cross-cutting concerns (audit logging, metrics, etc.)
 * they go here, not in each strategy.
 */
export function createAuthService(strategy: AuthStrategy): AuthStrategy {
  return strategy;
}
