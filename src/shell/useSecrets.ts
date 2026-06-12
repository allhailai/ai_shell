/* ── Secret Hooks ─────────────────────────────────────────────────────
   React hooks for applications to read/write secrets.

   Usage:
     const { value, isLoading } = useGlobalSecret("openai_org_id");
     const { value, isLoading } = useAppSecret("api_key");
     const { value, isLoading } = useUserSecret("personal_token");

   The active app ID is automatically injected via the X-AIShell-App-Id
   header for app-scoped secrets. User-scoped secrets automatically
   use the authenticated user's identity.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { useShellStore } from "./store";

export interface SecretResult {
  /** The secret value, or null if not found / still loading. */
  value: string | null;
  /** True while the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message if the fetch failed. */
  error: string | null;
  /** Re-fetch the secret value. */
  refetch: () => void;
}

/**
 * Fetch a secret from the server.
 */
async function fetchSecret(
  url: string,
  appId?: string,
): Promise<{ value: string | null; error: string | null }> {
  try {
    const headers: Record<string, string> = {};
    if (appId) {
      headers["X-AIShell-App-Id"] = appId;
    }

    const res = await fetch(url, { headers });

    if (res.status === 404) {
      return { value: null, error: null };
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Failed to fetch secret" }));
      return { value: null, error: data.error ?? `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { value: data.value, error: null };
  } catch {
    return { value: null, error: "Network error" };
  }
}

/**
 * Generic secret hook — shared implementation.
 */
function useSecret(url: string, appId?: string): SecretResult {
  const [value, setValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  const refetch = useCallback(() => setFetchCount((c) => c + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetchSecret(url, appId).then((result) => {
      if (cancelled) return;
      setValue(result.value);
      setError(result.error);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [url, appId, fetchCount]);

  return { value, isLoading, error, refetch };
}

/**
 * Read a global secret.
 * Available to any authenticated user.
 */
export function useGlobalSecret(key: string): SecretResult {
  return useSecret(`/api/secrets/global/${encodeURIComponent(key)}`);
}

/**
 * Read an app-scoped secret.
 * Automatically uses the active app's ID via X-AIShell-App-Id header.
 */
export function useAppSecret(key: string): SecretResult {
  const activeAppId = useShellStore((s) => s.activeAppId);
  return useSecret(
    `/api/secrets/app/${encodeURIComponent(activeAppId ?? "unknown")}/${encodeURIComponent(key)}`,
    activeAppId ?? undefined,
  );
}

/**
 * Read a user-scoped secret.
 * Automatically scoped to the authenticated user on the server side.
 */
export function useUserSecret(key: string): SecretResult {
  return useSecret(`/api/secrets/user/${encodeURIComponent(key)}`);
}
