/* ── Secrets Tab ──────────────────────────────────────────────────────
   Manages global, app-scoped, and user-scoped secrets.
   Reads from /api/secrets/* endpoints.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface PlatformStatus {
  backendName: string;
  supported: boolean;
  platform: string;
}

type SecretScope = "global" | "app" | "user";

interface SecretFormData {
  scope: SecretScope;
  key: string;
  value: string;
  appId: string;
}

const EMPTY_FORM: SecretFormData = { scope: "global", key: "", value: "", appId: "" };

export function SecretsTab() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<SecretFormData>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Lookup state ────────────────────────────────────────────────

  const [lookupScope, setLookupScope] = useState<SecretScope>("global");
  const [lookupKey, setLookupKey] = useState("");
  const [lookupAppId, setLookupAppId] = useState("");
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [showValue, setShowValue] = useState(false);

  // ── Load platform status ────────────────────────────────────────

  useEffect(() => {
    fetch("/api/secrets/status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // ── Save secret ─────────────────────────────────────────────────

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (saving) return;

      const { scope, key, value, appId } = form;
      if (!key || !value) return;
      if (scope === "app" && !appId) return;

      setSaving(true);
      setMessage(null);

      try {
        let url: string;
        if (scope === "global") url = `/api/secrets/global/${encodeURIComponent(key)}`;
        else if (scope === "app") url = `/api/secrets/app/${encodeURIComponent(appId)}/${encodeURIComponent(key)}`;
        else url = `/api/secrets/user/${encodeURIComponent(key)}`;

        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });

        if (res.ok) {
          setMessage({ type: "success", text: `Secret "${key}" saved to ${scope} scope.` });
          setForm({ ...EMPTY_FORM });
          setShowAddForm(false);
        } else {
          const data = await res.json().catch(() => ({ error: "Save failed" }));
          setMessage({ type: "error", text: data.error ?? "Failed to save secret." });
        }
      } catch {
        setMessage({ type: "error", text: "Network error — server may be offline." });
      } finally {
        setSaving(false);
      }
    },
    [form, saving],
  );

  // ── Delete secret ───────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!lookupKey || lookupResult === null) return;

    const confirmed = window.confirm(`Delete secret "${lookupKey}" from ${lookupScope} scope?`);
    if (!confirmed) return;

    let url: string;
    if (lookupScope === "global") url = `/api/secrets/global/${encodeURIComponent(lookupKey)}`;
    else if (lookupScope === "app") url = `/api/secrets/app/${encodeURIComponent(lookupAppId)}/${encodeURIComponent(lookupKey)}`;
    else url = `/api/secrets/user/${encodeURIComponent(lookupKey)}`;

    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: `Secret "${lookupKey}" deleted.` });
        setLookupResult(null);
        setLookupKey("");
      } else {
        const data = await res.json().catch(() => ({ error: "Delete failed" }));
        setMessage({ type: "error", text: data.error ?? "Failed to delete secret." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
  }, [lookupKey, lookupScope, lookupAppId, lookupResult]);

  // ── Lookup secret ───────────────────────────────────────────────

  const handleLookup = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (lookingUp || !lookupKey) return;

      setLookingUp(true);
      setLookupResult(null);
      setLookupError(null);
      setShowValue(false);

      try {
        let url: string;
        if (lookupScope === "global") url = `/api/secrets/global/${encodeURIComponent(lookupKey)}`;
        else if (lookupScope === "app") url = `/api/secrets/app/${encodeURIComponent(lookupAppId)}/${encodeURIComponent(lookupKey)}`;
        else url = `/api/secrets/user/${encodeURIComponent(lookupKey)}`;

        const res = await fetch(url);

        if (res.status === 404) {
          setLookupError("Secret not found.");
        } else if (res.ok) {
          const data = await res.json();
          setLookupResult(data.value);
        } else {
          const data = await res.json().catch(() => ({ error: "Lookup failed" }));
          setLookupError(data.error ?? "Failed to look up secret.");
        }
      } catch {
        setLookupError("Network error.");
      } finally {
        setLookingUp(false);
      }
    },
    [lookupKey, lookupScope, lookupAppId, lookingUp],
  );

  return (
    <div className="admin-section">
      {/* Status banner */}
      {status && (
        <div className={`admin-status-banner ${status.supported ? "admin-status-ok" : "admin-status-warn"}`}>
          <span className="admin-status-dot" />
          <div>
            <strong>Backend:</strong> {status.backendName}
            <span className="admin-status-detail">
              {status.supported ? " — Ready" : " — Not available. Secrets will use environment variables only."}
            </span>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`admin-message admin-message-${message.type}`}>
          {message.text}
          <button className="admin-message-close" onClick={() => setMessage(null)} type="button">×</button>
        </div>
      )}

      {/* Lookup section */}
      <div className="admin-card">
        <h3 className="admin-card-title">Look Up Secret</h3>
        <form className="admin-form" onSubmit={handleLookup}>
          <div className="admin-form-row">
            <div className="admin-field">
              <label className="admin-label">Scope</label>
              <select
                className="admin-select"
                value={lookupScope}
                onChange={(e) => setLookupScope(e.target.value as SecretScope)}
              >
                <option value="global">Global</option>
                <option value="app">App</option>
                <option value="user">User</option>
              </select>
            </div>
            {lookupScope === "app" && (
              <div className="admin-field">
                <label className="admin-label">App ID</label>
                <input
                  className="admin-input"
                  value={lookupAppId}
                  onChange={(e) => setLookupAppId(e.target.value)}
                  placeholder="e.g., arcade"
                />
              </div>
            )}
            <div className="admin-field admin-field-grow">
              <label className="admin-label">Key</label>
              <input
                className="admin-input"
                value={lookupKey}
                onChange={(e) => setLookupKey(e.target.value)}
                placeholder="e.g., api_key"
              />
            </div>
            <div className="admin-field admin-field-action">
              <button className="admin-btn admin-btn-secondary" type="submit" disabled={!lookupKey || lookingUp}>
                {lookingUp ? "…" : "Look Up"}
              </button>
            </div>
          </div>
        </form>

        {lookupError && <div className="admin-lookup-result admin-lookup-empty">{lookupError}</div>}

        {lookupResult !== null && (
          <div className="admin-lookup-result">
            <div className="admin-lookup-value-row">
              <code className="admin-lookup-value">{showValue ? lookupResult : "•".repeat(Math.min(lookupResult.length, 40))}</code>
              <button
                className="admin-btn-icon"
                onClick={() => setShowValue(!showValue)}
                title={showValue ? "Hide" : "Reveal"}
                type="button"
              >
                {showValue ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                className="admin-btn-icon admin-btn-danger-icon"
                onClick={handleDelete}
                title="Delete secret"
                type="button"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add secret section */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">Add / Update Secret</h3>
          {!showAddForm && (
            <button className="admin-btn admin-btn-primary" onClick={() => setShowAddForm(true)} type="button">
              + Add Secret
            </button>
          )}
        </div>

        {showAddForm && (
          <form className="admin-form" onSubmit={handleSave}>
            <div className="admin-form-row">
              <div className="admin-field">
                <label className="admin-label">Scope</label>
                <select
                  className="admin-select"
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value as SecretScope })}
                >
                  <option value="global">Global</option>
                  <option value="app">App</option>
                  <option value="user">User</option>
                </select>
              </div>
              {form.scope === "app" && (
                <div className="admin-field">
                  <label className="admin-label">App ID</label>
                  <input
                    className="admin-input"
                    value={form.appId}
                    onChange={(e) => setForm({ ...form, appId: e.target.value })}
                    placeholder="e.g., arcade"
                    required
                  />
                </div>
              )}
              <div className="admin-field admin-field-grow">
                <label className="admin-label">Key</label>
                <input
                  className="admin-input"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="e.g., api_key"
                  required
                />
              </div>
            </div>

            <div className="admin-field">
              <label className="admin-label">Value</label>
              <input
                className="admin-input"
                type="password"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder="Secret value"
                required
              />
            </div>

            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Secret"}
              </button>
              <button
                className="admin-btn admin-btn-ghost"
                type="button"
                onClick={() => { setShowAddForm(false); setForm({ ...EMPTY_FORM }); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
