/* ── Local Auth Strategy ──────────────────────────────────────────────
   Username/password authentication with scrypt + JWT.
   Ported from Kiss AI's auth.js to TypeScript.

   Storage: <dataDir>/auth.json
   Password hashing: scrypt (N=16384, r=8, p=1, keylen=64, 16-byte salt)
   Tokens: JWT with configurable expiry and token versioning
   ──────────────────────────────────────────────────────────────────── */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import type {
  AuthResult,
  AuthStrategy,
  CreateUserParams,
  SessionResult,
  User,
  UserUpdates,
} from "./authService.js";

// ── Scrypt parameters ───────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N = 2^14
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SALT_BYTES = 16;

// ── Internal types ──────────────────────────────────────────────────

interface StoredUser {
  username: string;
  password_hash: string;
  firstname: string;
  lastname: string;
  is_admin: boolean;
  is_system: boolean;
  token_version: number;
  created_at: string;
  updated_at: string;
}

interface AuthFileData {
  jwt_secret: string;
  users: StoredUser[];
}

interface JwtPayload {
  username: string;
  is_admin: boolean;
  token_version: number;
}

type HttpErrorFn = (message: string, status: number, code: string) => Error;

// ── Password hashing ────────────────────────────────────────────────

function hashPassword(plainText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_BYTES);
    scrypt(
      plainText,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM },
      (error, derivedKey) => {
        if (error) return reject(error);
        resolve(`scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`);
      },
    );
  });
}

function verifyPassword(plainText: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return resolve(false);

    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");

    scrypt(
      plainText,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM },
      (error, derivedKey) => {
        if (error) return reject(error);
        resolve(timingSafeEqual(derivedKey, expected));
      },
    );
  });
}

// ── Strategy factory ────────────────────────────────────────────────

export function createLocalAuthStrategy(opts: {
  dataDir: string;
  httpError: HttpErrorFn;
  sessionExpiryDays?: number;
}): AuthStrategy {
  const { dataDir, httpError, sessionExpiryDays = 3 } = opts;
  const authFilePath = path.join(dataDir, "auth.json");

  let cachedData: AuthFileData | null = null;
  let cachedMtime = 0;
  let writeLock: Promise<void> = Promise.resolve();

  // ── File I/O with caching ─────────────────────────────────────────

  async function readAuthFile(): Promise<AuthFileData | null> {
    try {
      const stat = await fs.stat(authFilePath);
      const mtime = stat.mtimeMs;

      if (cachedData && mtime === cachedMtime) return cachedData;

      const raw = await fs.readFile(authFilePath, "utf-8");
      cachedData = JSON.parse(raw) as AuthFileData;
      cachedMtime = mtime;
      return cachedData;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeAuthFile(data: AuthFileData): Promise<void> {
    writeLock = writeLock.then(async () => {
      await fs.writeFile(authFilePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
      cachedData = data;
      try {
        const stat = await fs.stat(authFilePath);
        cachedMtime = stat.mtimeMs;
      } catch {
        /* stat after write shouldn't fail */
      }
    });
    return writeLock;
  }

  // ── JWT helpers ───────────────────────────────────────────────────

  function signToken(user: StoredUser, jwtSecret: string): string {
    const payload: JwtPayload = {
      username: user.username,
      is_admin: user.is_admin,
      token_version: user.token_version,
    };
    return jwt.sign(payload, jwtSecret, { expiresIn: `${sessionExpiryDays}d` });
  }

  function verifyToken(token: string, jwtSecret: string): JwtPayload {
    return jwt.verify(token, jwtSecret) as JwtPayload;
  }

  // ── User helpers ──────────────────────────────────────────────────

  function findUserInData(data: AuthFileData | null, username: string): StoredUser | null {
    if (!data?.users) return null;
    return data.users.find((u) => u.username === username) ?? null;
  }

  function sanitizeUser(user: StoredUser): User {
    return {
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      is_admin: user.is_admin,
      is_system: user.is_system,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  // ── Strategy implementation ───────────────────────────────────────

  const strategy: AuthStrategy = {
    async initialize(adminPassword) {
      const existing = await readAuthFile();
      if (existing) {
        const admin = findUserInData(existing, "aishell_admin");
        if (!admin) {
          throw new Error("Auth file exists but aishell_admin user is missing. File may be corrupted.");
        }
        return { initialized: false };
      }

      if (!adminPassword) {
        throw new Error(
          "Server mode requires an admin password on first boot.\n" +
            "Set AISHELL_ADMIN_PASSWORD environment variable and restart.",
        );
      }

      const jwtSecret = randomBytes(32).toString("hex");
      const passwordHash = await hashPassword(adminPassword);
      const now = new Date().toISOString();

      const data: AuthFileData = {
        jwt_secret: jwtSecret,
        users: [
          {
            username: "aishell_admin",
            password_hash: passwordHash,
            firstname: "Admin",
            lastname: "User",
            is_admin: true,
            is_system: true,
            token_version: 1,
            created_at: now,
            updated_at: now,
          },
        ],
      };

      await writeAuthFile(data);
      return { initialized: true };
    },

    async authenticate(username, password) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("Invalid credentials.", 401, "invalid_credentials");

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) throw httpError("Invalid credentials.", 401, "invalid_credentials");

      const token = signToken(user, data.jwt_secret);
      return { token, user: sanitizeUser(user) };
    },

    async verifyAndRefreshToken(token) {
      const data = await readAuthFile();
      if (!data) return null;

      let payload: JwtPayload;
      try {
        payload = verifyToken(token, data.jwt_secret);
      } catch {
        return null;
      }

      const user = findUserInData(data, payload.username);
      if (!user) return null;
      if (user.token_version !== payload.token_version) return null;

      const freshToken = signToken(user, data.jwt_secret);
      return { user: sanitizeUser(user), freshToken };
    },

    async getJwtSecret() {
      const data = await readAuthFile();
      return data?.jwt_secret ?? null;
    },

    async signTokenForUser(user) {
      const data = await readAuthFile();
      if (!data) {
        // No auth file — generate a transient secret for standalone
        const transientSecret = randomBytes(32).toString("hex");
        const storedUser: StoredUser = {
          ...user,
          password_hash: "",
          token_version: 1,
        };
        return signToken(storedUser, transientSecret);
      }
      const storedUser = findUserInData(data, user.username);
      if (!storedUser) {
        // User doesn't exist in file — create a virtual stored user
        const virtualUser: StoredUser = {
          ...user,
          password_hash: "",
          token_version: 1,
        };
        return signToken(virtualUser, data.jwt_secret);
      }
      return signToken(storedUser, data.jwt_secret);
    },

    // ── User CRUD ─────────────────────────────────────────────────

    async createUser({ username, password, firstname, lastname, is_admin }) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      if (findUserInData(data, username)) {
        throw httpError("Username already exists.", 409, "user_exists");
      }

      if (!username || !/^[a-zA-Z0-9_-]{2,50}$/.test(username)) {
        throw httpError(
          "Username must be 2-50 characters (letters, numbers, underscores, hyphens).",
          400,
          "invalid_username",
        );
      }

      if (!password || password.length < 8) {
        throw httpError("Password must be at least 8 characters.", 400, "invalid_password");
      }

      const passwordHash = await hashPassword(password);
      const now = new Date().toISOString();

      const newUser: StoredUser = {
        username,
        password_hash: passwordHash,
        firstname: firstname ?? "",
        lastname: lastname ?? "",
        is_admin: is_admin === true,
        is_system: false,
        token_version: 1,
        created_at: now,
        updated_at: now,
      };

      data.users.push(newUser);
      await writeAuthFile(data);
      return sanitizeUser(newUser);
    },

    async updateUser(username, updates) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("User not found.", 404, "user_not_found");
      if (user.is_system) throw httpError("System user cannot be edited via API.", 403, "system_user_immutable");

      let versionBumped = false;

      if (updates.firstname !== undefined) user.firstname = String(updates.firstname);
      if (updates.lastname !== undefined) user.lastname = String(updates.lastname);

      if (updates.is_admin !== undefined && updates.is_admin !== user.is_admin) {
        user.is_admin = updates.is_admin === true;
        user.token_version += 1;
        versionBumped = true;
      }

      user.updated_at = new Date().toISOString();
      await writeAuthFile(data);
      return { user: sanitizeUser(user), versionBumped };
    },

    async deleteUser(username) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("User not found.", 404, "user_not_found");
      if (user.is_system) throw httpError("System user cannot be deleted.", 403, "system_user_immutable");

      data.users = data.users.filter((u) => u.username !== username);
      await writeAuthFile(data);
      return { deleted: true, username };
    },

    async listUsers() {
      const data = await readAuthFile();
      if (!data) return [];
      return data.users.map(sanitizeUser);
    },

    async getUser(username) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("User not found.", 404, "user_not_found");
      return sanitizeUser(user);
    },

    async changePassword(username, currentPassword, newPassword) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("User not found.", 404, "user_not_found");
      if (user.is_system)
        throw httpError("System user password cannot be changed via API.", 403, "system_user_immutable");

      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) throw httpError("Current password is incorrect.", 401, "incorrect_password");

      if (!newPassword || newPassword.length < 8) {
        throw httpError("New password must be at least 8 characters.", 400, "invalid_password");
      }

      user.password_hash = await hashPassword(newPassword);
      user.token_version += 1;
      user.updated_at = new Date().toISOString();
      await writeAuthFile(data);
      return { changed: true };
    },

    async resetPassword(username, newPassword) {
      const data = await readAuthFile();
      if (!data) throw httpError("Authentication system not initialized.", 500, "auth_not_initialized");

      const user = findUserInData(data, username);
      if (!user) throw httpError("User not found.", 404, "user_not_found");
      if (user.is_system)
        throw httpError("System user password can only be changed via CLI.", 403, "system_user_immutable");

      if (!newPassword || newPassword.length < 8) {
        throw httpError("New password must be at least 8 characters.", 400, "invalid_password");
      }

      user.password_hash = await hashPassword(newPassword);
      user.token_version += 1;
      user.updated_at = new Date().toISOString();
      await writeAuthFile(data);
      return { reset: true };
    },
  };

  return strategy;
}
