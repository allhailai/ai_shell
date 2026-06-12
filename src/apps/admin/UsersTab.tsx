/* ── Users Tab ────────────────────────────────────────────────────────
   Manages users in server mode.
   In standalone mode, shows a disabled overlay with explanation.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../shell/authContext";

interface User {
  username: string;
  firstname: string;
  lastname: string;
  is_admin: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

interface AddUserForm {
  username: string;
  password: string;
  firstname: string;
  lastname: string;
  is_admin: boolean;
}

const EMPTY_ADD_FORM: AddUserForm = {
  username: "",
  password: "",
  firstname: "",
  lastname: "",
  is_admin: false,
};

export function UsersTab() {
  const { mode } = useAuth();
  const isStandalone = mode === "standalone";

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddUserForm>({ ...EMPTY_ADD_FORM });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Reset password state ──────────────────────────────────────────

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  // ── Load users ────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    if (isStandalone) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } catch {
      // Server may not support user listing
    } finally {
      setLoading(false);
    }
  }, [isStandalone]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Add user ──────────────────────────────────────────────────────

  const handleAddUser = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (saving) return;

      setSaving(true);
      setMessage(null);

      try {
        const res = await fetch("/api/auth/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(addForm),
        });

        if (res.ok) {
          setMessage({ type: "success", text: `User "${addForm.username}" created.` });
          setAddForm({ ...EMPTY_ADD_FORM });
          setShowAddForm(false);
          fetchUsers();
        } else {
          const data = await res.json().catch(() => ({ error: "Create failed" }));
          setMessage({ type: "error", text: data.error ?? "Failed to create user." });
        }
      } catch {
        setMessage({ type: "error", text: "Network error." });
      } finally {
        setSaving(false);
      }
    },
    [addForm, saving, fetchUsers],
  );

  // ── Delete user ───────────────────────────────────────────────────

  const handleDeleteUser = useCallback(
    async (username: string) => {
      const confirmed = window.confirm(`Delete user "${username}"? This cannot be undone.`);
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        if (res.ok) {
          setMessage({ type: "success", text: `User "${username}" deleted.` });
          fetchUsers();
        } else {
          const data = await res.json().catch(() => ({ error: "Delete failed" }));
          setMessage({ type: "error", text: data.error ?? "Failed to delete user." });
        }
      } catch {
        setMessage({ type: "error", text: "Network error." });
      }
    },
    [fetchUsers],
  );

  // ── Toggle admin ──────────────────────────────────────────────────

  const handleToggleAdmin = useCallback(
    async (username: string, currentIsAdmin: boolean) => {
      try {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_admin: !currentIsAdmin }),
        });

        if (res.ok) {
          setMessage({ type: "success", text: `${username} is now ${!currentIsAdmin ? "an admin" : "a regular user"}.` });
          fetchUsers();
        } else {
          const data = await res.json().catch(() => ({ error: "Update failed" }));
          setMessage({ type: "error", text: data.error ?? "Failed to update user." });
        }
      } catch {
        setMessage({ type: "error", text: "Network error." });
      }
    },
    [fetchUsers],
  );

  // ── Reset password ────────────────────────────────────────────────

  const handleResetPassword = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!resetTarget || !resetPassword) return;

      try {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(resetTarget)}/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword: resetPassword }),
        });

        if (res.ok) {
          setMessage({ type: "success", text: `Password reset for "${resetTarget}".` });
          setResetTarget(null);
          setResetPassword("");
        } else {
          const data = await res.json().catch(() => ({ error: "Reset failed" }));
          setMessage({ type: "error", text: data.error ?? "Failed to reset password." });
        }
      } catch {
        setMessage({ type: "error", text: "Network error." });
      }
    },
    [resetTarget, resetPassword],
  );

  // ── Standalone mode overlay ───────────────────────────────────────

  if (isStandalone) {
    return (
      <div className="admin-section">
        <div className="admin-standalone-notice">
          <div className="admin-standalone-icon">
            <InfoIcon />
          </div>
          <h3>User Management Unavailable</h3>
          <p>
            User management is only available in <strong>server mode</strong>.
            In standalone mode, the shell operates as a single-user system
            using your OS identity.
          </p>
          <p className="admin-standalone-hint">
            To enable multi-user mode, set <code>AISHELL_MODE=server</code> or configure
            <code>"mode": "server"</code> in <code>~/.aishell/aishell.config.json</code>.
          </p>
        </div>
      </div>
    );
  }

  // ── Server mode content ───────────────────────────────────────────

  return (
    <div className="admin-section">
      {/* Message */}
      {message && (
        <div className={`admin-message admin-message-${message.type}`}>
          {message.text}
          <button className="admin-message-close" onClick={() => setMessage(null)} type="button">×</button>
        </div>
      )}

      {/* User list */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">Users</h3>
          {!showAddForm && (
            <button className="admin-btn admin-btn-primary" onClick={() => setShowAddForm(true)} type="button">
              + Add User
            </button>
          )}
        </div>

        {/* Add user form */}
        {showAddForm && (
          <form className="admin-form admin-form-add-user" onSubmit={handleAddUser}>
            <div className="admin-form-row">
              <div className="admin-field admin-field-grow">
                <label className="admin-label">Username</label>
                <input
                  className="admin-input"
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                  placeholder="username"
                  pattern="[a-zA-Z0-9_-]{2,50}"
                  required
                  autoFocus
                />
              </div>
              <div className="admin-field admin-field-grow">
                <label className="admin-label">Password</label>
                <input
                  className="admin-input"
                  type="password"
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                  placeholder="Min 8 characters"
                  minLength={8}
                  required
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field admin-field-grow">
                <label className="admin-label">First Name</label>
                <input
                  className="admin-input"
                  value={addForm.firstname}
                  onChange={(e) => setAddForm({ ...addForm, firstname: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="admin-field admin-field-grow">
                <label className="admin-label">Last Name</label>
                <input
                  className="admin-input"
                  value={addForm.lastname}
                  onChange={(e) => setAddForm({ ...addForm, lastname: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Admin</label>
                <label className="admin-checkbox-wrapper">
                  <input
                    type="checkbox"
                    className="admin-checkbox"
                    checked={addForm.is_admin}
                    onChange={(e) => setAddForm({ ...addForm, is_admin: e.target.checked })}
                  />
                  <span className="admin-checkbox-label">Admin privileges</span>
                </label>
              </div>
            </div>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-primary" type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create User"}
              </button>
              <button
                className="admin-btn admin-btn-ghost"
                type="button"
                onClick={() => { setShowAddForm(false); setAddForm({ ...EMPTY_ADD_FORM }); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* User table */}
        {loading ? (
          <div className="admin-loading">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="admin-empty">No users found.</div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.username} className={user.is_system ? "admin-row-system" : ""}>
                    <td>
                      <span className="admin-username">{user.username}</span>
                      {user.is_system && <span className="admin-badge admin-badge-system">System</span>}
                    </td>
                    <td className="admin-name-cell">
                      {user.firstname || user.lastname
                        ? `${user.firstname} ${user.lastname}`.trim()
                        : "—"}
                    </td>
                    <td>
                      <span className={`admin-badge ${user.is_admin ? "admin-badge-admin" : "admin-badge-user"}`}>
                        {user.is_admin ? "Admin" : "User"}
                      </span>
                    </td>
                    <td className="admin-date-cell">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="admin-actions-cell">
                      {!user.is_system && (
                        <>
                          <button
                            className="admin-btn-icon"
                            onClick={() => handleToggleAdmin(user.username, user.is_admin)}
                            title={user.is_admin ? "Revoke admin" : "Grant admin"}
                            type="button"
                          >
                            <ShieldIcon active={user.is_admin} />
                          </button>
                          <button
                            className="admin-btn-icon"
                            onClick={() => { setResetTarget(user.username); setResetPassword(""); }}
                            title="Reset password"
                            type="button"
                          >
                            <KeyIcon />
                          </button>
                          <button
                            className="admin-btn-icon admin-btn-danger-icon"
                            onClick={() => handleDeleteUser(user.username)}
                            title="Delete user"
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset password modal */}
      {resetTarget && (
        <div className="admin-modal-backdrop" onClick={() => setResetTarget(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Reset Password for "{resetTarget}"</h3>
            <form onSubmit={handleResetPassword}>
              <div className="admin-field">
                <label className="admin-label">New Password</label>
                <input
                  className="admin-input"
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-primary" type="submit" disabled={!resetPassword || resetPassword.length < 8}>
                  Reset Password
                </button>
                <button className="admin-btn admin-btn-ghost" type="button" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */

function InfoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ShieldIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
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
