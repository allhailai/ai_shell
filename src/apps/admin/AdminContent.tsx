/* ── Admin Content ────────────────────────────────────────────────────
   Root component for the admin app. Tab-based navigation between:
   - Secrets management
   - User management
   - Software updates
   ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { SecretsTab } from "./SecretsTab";
import { UsersTab } from "./UsersTab";
import { UpdateTab, UpdateTabIcon, useAutoUpdateCheck } from "./UpdateTab";

type Tab = "secrets" | "users" | "updates";

export function AdminContent() {
  const [activeTab, setActiveTab] = useState<Tab>("secrets");
  const updateAvailable = useAutoUpdateCheck();

  return (
    <div className="admin-page">
      <div className="admin-page-inner">
        {/* Update available banner */}
        {updateAvailable && activeTab !== "updates" ? (
          <button
            className="admin-update-banner"
            onClick={() => setActiveTab("updates")}
            type="button"
          >
            <span className="admin-update-banner-dot" />
            <span>
              A new AIShell version is available.{" "}
              <strong>Go to Updates →</strong>
            </span>
          </button>
        ) : null}

        {/* Header */}
        <div className="admin-header">
          <h1 className="admin-title">Administration</h1>
          <p className="admin-subtitle">Manage secrets, users, and system configuration</p>
        </div>

        {/* Tab bar */}
        <div className="admin-tabs">
          <button
            className={`admin-tab${activeTab === "secrets" ? " active" : ""}`}
            onClick={() => setActiveTab("secrets")}
            type="button"
          >
            <KeyIcon />
            Secrets
          </button>
          <button
            className={`admin-tab${activeTab === "users" ? " active" : ""}`}
            onClick={() => setActiveTab("users")}
            type="button"
          >
            <UsersIcon />
            Users
          </button>
          <button
            className={`admin-tab${activeTab === "updates" ? " active" : ""}`}
            onClick={() => setActiveTab("updates")}
            type="button"
          >
            <UpdateTabIcon />
            Updates
            {updateAvailable ? <span className="admin-update-badge-dot" /> : null}
          </button>
        </div>

        {/* Tab content */}
        <div className="admin-tab-content">
          {activeTab === "secrets" && <SecretsTab />}
          {activeTab === "users" && <UsersTab />}
          {activeTab === "updates" && <UpdateTab />}
        </div>
      </div>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
