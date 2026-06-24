/* ── DB Helper: Connection Form ───────────────────────────────────────
   Add or edit a Postgres database connection.
   In add mode all fields required. In edit mode password/certs optional.
   SSL certificates are entered as PEM text in collapsible sections.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, type FormEvent } from "react";
import type {
  DbConnectionInfo,
  DbConnectionCreatePayload,
  TestResult,
} from "./types";

interface ConnectionFormProps {
  /** If provided, we're editing an existing connection. */
  existing?: DbConnectionInfo;
  /** Navigate back to the connection list. */
  onCancel: () => void;
  /** Called after a successful save. */
  onSaved: () => void;
}

const SSL_OPTIONS: { value: string; label: string }[] = [
  { value: "disable", label: "Disabled" },
  { value: "require", label: "Require (no cert verification)" },
  { value: "verify-full", label: "Verify Full (verify CA cert)" },
];

export function ConnectionForm({
  existing,
  onCancel,
  onSaved,
}: ConnectionFormProps) {
  const isEdit = !!existing;

  const [name, setName] = useState(existing?.name ?? "");
  const [host, setHost] = useState(existing?.host ?? "");
  const [port, setPort] = useState(String(existing?.port ?? 5432));
  const [database, setDatabase] = useState(existing?.database ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState(existing?.sslMode ?? "disable");
  const [queryTimeout, setQueryTimeout] = useState(
    String(existing?.queryTimeoutSeconds ?? 30),
  );

  // SSL certificate fields
  const [sslCaCert, setSslCaCert] = useState("");
  const [sslClientCert, setSslClientCert] = useState("");
  const [sslClientKey, setSslClientKey] = useState("");
  const [showSslCerts, setShowSslCerts] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const sslEnabled = sslMode !== "disable";

  // ── Build payload ──────────────────────────────────────────────────

  function buildPayload(): DbConnectionCreatePayload {
    const payload: DbConnectionCreatePayload = {
      name: name.trim(),
      host: host.trim(),
      port: Number(port),
      database: database.trim(),
      username: username.trim(),
      password,
      sslMode: sslMode as DbConnectionCreatePayload["sslMode"],
      queryTimeoutSeconds: Number(queryTimeout) || 30,
    };
    if (sslCaCert.trim()) payload.sslCaCert = sslCaCert.trim();
    if (sslClientCert.trim()) payload.sslClientCert = sslClientCert.trim();
    if (sslClientKey.trim()) payload.sslClientKey = sslClientKey.trim();
    return payload;
  }

  // ── Client-side validation ─────────────────────────────────────────

  function validate(): string | null {
    if (!name.trim()) return "Connection name is required.";
    if (!host.trim()) return "Host is required.";
    const p = Number(port);
    if (!p || p < 1 || p > 65535) return "Port must be 1–65535.";
    if (!database.trim()) return "Database name is required.";
    if (!username.trim()) return "Username is required.";
    if (!isEdit && !password) return "Password is required.";
    return null;
  }

  // ── Save ───────────────────────────────────────────────────────────

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const payload = buildPayload();
        const url = isEdit
          ? `/api/db-helper/connections/${existing!.id}`
          : "/api/db-helper/connections";
        const method = isEdit ? "PUT" : "POST";

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          onSaved();
        } else {
          const data = await res.json().catch(() => ({ error: "Save failed" }));
          setError(data.error ?? "Failed to save connection.");
        }
      } catch {
        setError("Network error — server may be offline.");
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, host, port, database, username, password, sslMode, queryTimeout, sslCaCert, sslClientCert, sslClientKey, isEdit, existing],
  );

  // ── Test Connection ────────────────────────────────────────────────

  const handleTest = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setTesting(true);
    setError(null);
    setTestResult(null);

    try {
      let url: string;
      let body: string;

      if (isEdit && !password) {
        // Test stored connection (password not changed)
        url = `/api/db-helper/connections/${existing!.id}/test`;
        body = "{}";
      } else {
        // Test with provided credentials
        url = "/api/db-helper/connections/test-new";
        body = JSON.stringify(buildPayload());
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (res.ok) {
        const result: TestResult = await res.json();
        setTestResult(result);
      } else {
        const data = await res.json().catch(() => ({ error: "Test failed" }));
        setError(data.error ?? "Failed to test connection.");
      }
    } catch {
      setError("Network error — server may be offline.");
    } finally {
      setTesting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, host, port, database, username, password, sslMode, queryTimeout, sslCaCert, sslClientCert, sslClientKey, isEdit, existing]);

  return (
    <div className="dbh-form-container">
      <div className="dbh-form-header">
        <h2 className="dbh-form-title">
          {isEdit ? "Edit Connection" : "New Connection"}
        </h2>
        <p className="dbh-form-subtitle">
          {isEdit
            ? `Editing "${existing!.name}"`
            : "Configure a new Postgres database connection"}
        </p>
      </div>

      <form className="dbh-form" onSubmit={handleSave}>
        {/* Connection name */}
        <div className="dbh-field">
          <label className="dbh-label" htmlFor="dbh-name">
            Connection Name
          </label>
          <input
            id="dbh-name"
            className="dbh-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Production Data Warehouse"
            autoFocus
          />
        </div>

        {/* Host + Port row */}
        <div className="dbh-field-row">
          <div className="dbh-field dbh-field-grow">
            <label className="dbh-label" htmlFor="dbh-host">
              Host
            </label>
            <input
              id="dbh-host"
              className="dbh-input"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="e.g., db.company.com"
            />
          </div>
          <div className="dbh-field dbh-field-port">
            <label className="dbh-label" htmlFor="dbh-port">
              Port
            </label>
            <input
              id="dbh-port"
              className="dbh-input"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1}
              max={65535}
            />
          </div>
        </div>

        {/* Database name */}
        <div className="dbh-field">
          <label className="dbh-label" htmlFor="dbh-database">
            Database
          </label>
          <input
            id="dbh-database"
            className="dbh-input"
            type="text"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="e.g., analytics_dw"
          />
        </div>

        {/* Username + Password row */}
        <div className="dbh-field-row">
          <div className="dbh-field dbh-field-grow">
            <label className="dbh-label" htmlFor="dbh-username">
              Username
            </label>
            <input
              id="dbh-username"
              className="dbh-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g., jsmith"
            />
          </div>
          <div className="dbh-field dbh-field-grow">
            <label className="dbh-label" htmlFor="dbh-password">
              Password
            </label>
            <input
              id="dbh-password"
              className="dbh-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isEdit ? "Leave blank to keep current" : "Enter password"
              }
            />
          </div>
        </div>

        {/* SSL Mode + Query Timeout row */}
        <div className="dbh-field-row">
          <div className="dbh-field dbh-field-grow">
            <label className="dbh-label" htmlFor="dbh-ssl">
              SSL Mode
            </label>
            <select
              id="dbh-ssl"
              className="dbh-select"
              value={sslMode}
              onChange={(e) => setSslMode(e.target.value as "disable" | "require" | "verify-full")}
            >
              {SSL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="dbh-field dbh-field-port">
            <label className="dbh-label" htmlFor="dbh-timeout">
              Timeout (s)
            </label>
            <input
              id="dbh-timeout"
              className="dbh-input"
              type="number"
              value={queryTimeout}
              onChange={(e) => setQueryTimeout(e.target.value)}
              min={0}
              title="Query timeout in seconds. 0 = no limit."
            />
          </div>
        </div>

        {/* SSL Certificates (collapsible) */}
        {sslEnabled && (
          <div className="dbh-ssl-section">
            <button
              className="dbh-ssl-toggle"
              type="button"
              onClick={() => setShowSslCerts(!showSslCerts)}
            >
              <span className={`dbh-ssl-chevron ${showSslCerts ? "dbh-ssl-chevron-open" : ""}`}>
                ▸
              </span>
              SSL Certificates
              {isEdit && (existing!.hasSslCaCert || existing!.hasSslClientCert) && (
                <span className="dbh-ssl-badge">configured</span>
              )}
            </button>

            {showSslCerts && (
              <div className="dbh-ssl-fields">
                <div className="dbh-field">
                  <label className="dbh-label" htmlFor="dbh-ca-cert">
                    CA Certificate (PEM)
                    {isEdit && existing!.hasSslCaCert && (
                      <span className="dbh-label-hint"> — currently set, paste new to replace</span>
                    )}
                  </label>
                  <textarea
                    id="dbh-ca-cert"
                    className="dbh-textarea"
                    value={sslCaCert}
                    onChange={(e) => setSslCaCert(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    rows={4}
                    spellCheck={false}
                  />
                </div>

                <div className="dbh-field">
                  <label className="dbh-label" htmlFor="dbh-client-cert">
                    Client Certificate (PEM)
                    {isEdit && existing!.hasSslClientCert && (
                      <span className="dbh-label-hint"> — currently set</span>
                    )}
                  </label>
                  <textarea
                    id="dbh-client-cert"
                    className="dbh-textarea"
                    value={sslClientCert}
                    onChange={(e) => setSslClientCert(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    rows={4}
                    spellCheck={false}
                  />
                </div>

                <div className="dbh-field">
                  <label className="dbh-label" htmlFor="dbh-client-key">
                    Client Private Key (PEM)
                    {isEdit && existing!.hasSslClientKey && (
                      <span className="dbh-label-hint"> — currently set</span>
                    )}
                  </label>
                  <textarea
                    id="dbh-client-key"
                    className="dbh-textarea"
                    value={sslClientKey}
                    onChange={(e) => setSslClientKey(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                    rows={4}
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && <div className="dbh-message dbh-message-error">{error}</div>}

        {/* Test result */}
        {testResult && (
          <div
            className={`dbh-message ${testResult.success ? "dbh-message-success" : "dbh-message-error"}`}
          >
            <span className="dbh-test-icon">
              {testResult.success ? "✓" : "✗"}
            </span>
            {testResult.message}
            {testResult.latencyMs != null && (
              <span className="dbh-test-latency">
                {testResult.latencyMs}ms
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="dbh-form-actions">
          <button
            className="dbh-btn dbh-btn-secondary"
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
          <div className="dbh-form-actions-right">
            <button
              className="dbh-btn dbh-btn-ghost"
              type="button"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="dbh-btn dbh-btn-primary"
              type="submit"
              disabled={saving || testing}
            >
              {saving ? "Saving…" : isEdit ? "Update Connection" : "Save Connection"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
