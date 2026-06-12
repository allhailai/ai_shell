/* ── Login Page ───────────────────────────────────────────────────────
   Full-screen login form shown in server mode when not authenticated.
   Matches the shell's dark theme aesthetic.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type FormEvent } from "react";
import { useAuth } from "../shell/authContext";

export function LoginPage() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting || !username || !password) return;

    setIsSubmitting(true);
    try {
      await login(username, password);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="var(--color-accent)" />
              <path
                d="M12 28V20C12 15.5817 15.5817 12 20 12V12C24.4183 12 28 15.5817 28 20V28"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="20" cy="22" r="2.5" fill="white" />
            </svg>
          </div>
          <h1 className="login-title">AI Shell</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="login-username" className="login-label">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password" className="login-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isSubmitting || !username || !password}
          >
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
