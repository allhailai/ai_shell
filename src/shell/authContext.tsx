/* ── Auth Context ─────────────────────────────────────────────────────
   React context that provides authentication state to all components.

   On mount, calls GET /api/auth/me to determine the current user.
   In standalone mode, this always returns the auto-injected OS user.
   In server mode, a 401 response shows the login page.

   Apps access auth state via the useAuth() hook.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface AuthUser {
  username: string;
  firstname: string;
  lastname: string;
  is_admin: boolean;
  is_system: boolean;
}

export interface AuthState {
  /** Current authenticated user, or null if not yet loaded / logged out. */
  user: AuthUser | null;
  /** Shell operating mode. */
  mode: "standalone" | "server" | null;
  /** True while the initial auth check is in progress. */
  isLoading: boolean;
  /** Login error message (server mode only). */
  error: string | null;
  /** Attempt login (server mode). */
  login: (username: string, password: string) => Promise<void>;
  /** Log out and clear session. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Hook for apps to access auth state.
 * Must be used within an <AuthProvider>.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used within <AuthProvider>");
  }
  return ctx;
}

/**
 * Auth provider — wraps the entire shell.
 * Handles initial auth check, login, and logout.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<"standalone" | "server" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Initial auth check ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setUser(data.user);
            setMode(data.mode ?? "standalone");
          }
        } else {
          // 401 — not authenticated (server mode, no valid session)
          if (!cancelled) {
            setUser(null);
            // Try to get mode from version endpoint
            try {
              const versionRes = await fetch("/api/version");
              if (versionRes.ok) {
                const versionData = await versionRes.json();
                setMode(versionData.mode ?? "server");
              } else {
                setMode("server");
              }
            } catch {
              setMode("server");
            }
          }
        }
      } catch {
        // Network error — server might not be running yet
        if (!cancelled) {
          setUser(null);
          setMode(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Login ───────────────────────────────────────────────────────

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setMode("server");
      } else {
        const data = await res.json().catch(() => ({ error: "Login failed" }));
        if (res.status === 429) {
          setError("Too many login attempts. Please wait and try again.");
        } else {
          setError(data.error ?? "Invalid credentials.");
        }
      }
    } catch {
      setError("Unable to connect to the server.");
    }
  }, []);

  // ── Logout ──────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort logout
    }
    setUser(null);
    setError(null);
  }, []);

  // ── Provide context ─────────────────────────────────────────────

  return (
    <AuthContext.Provider value={{ user, mode, isLoading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
