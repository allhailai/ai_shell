# DB Helper — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context.

---

## Level 0 — What Is This?

DB Helper is a database connection manager for AI Shell. It allows users to configure, test, and manage Postgres database connections. Credentials are stored securely in the OS keychain via the shell's secret service. Each user has their own isolated set of connections.

---

## Level 1 — File Map

```
db-helper/
├── ARCHITECTURE.md       # This document
├── manifest.tsx          # AppManifest — registers with shell
├── db-helper.css         # Styles (namespaced .dbh-*)
├── types.ts              # Shared TypeScript types
├── DbHelperContent.tsx   # Root component — sub-route navigation
├── ConnectionList.tsx    # Card grid of configured connections
└── ConnectionForm.tsx    # Add/edit form with SSL certificate support
```

Server-side:
```
server/routes/dbHelperRoutes.ts   # REST API for connection CRUD + test
```

---

## Level 2 — Core Concepts

### Storage Model

All connections for a user are stored as **a single JSON array** in one user-scoped secret:

- **Secret key**: `db-helper_connections`
- **Secret scope**: User (each user has their own)
- **Backend**: OS keychain (macOS Keychain / Linux libsecret)
- **Content**: `JSON.stringify(DbConnection[])` — includes passwords and SSL certificates

The server reads/parses this JSON on every API request and writes it back after mutations. Passwords and certificate content are **never** sent to the frontend.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/db-helper/connections` | List all (passwords/certs masked) |
| `POST` | `/api/db-helper/connections` | Add new connection |
| `PUT` | `/api/db-helper/connections/:id` | Update existing |
| `DELETE` | `/api/db-helper/connections/:id` | Remove |
| `POST` | `/api/db-helper/connections/:id/test` | Test stored connection |
| `POST` | `/api/db-helper/connections/test-new` | Test before saving |

### URL Deep-Linking

| URL | View |
|-----|------|
| `/db-helper` | Connection list |
| `/db-helper/new` | Add connection form |
| `/db-helper/edit/:id` | Edit connection form |

---

## Level 3 — Data Flow

```
Frontend                          Server                          Secret Store
   │                                │                                │
   │  GET /connections              │                                │
   │──────────────────────────────→ │  getUserSecret(user, key)      │
   │                                │──────────────────────────────→ │
   │                                │  ← JSON string                │
   │                                │  parse → strip passwords      │
   │  ← { connections: [...] }      │                                │
   │                                │                                │
   │  POST /connections (w/ pwd)    │                                │
   │──────────────────────────────→ │  read → push → write           │
   │                                │──────────────────────────────→ │
   │  ← { connection: (masked) }    │                                │
```

### SSL Certificate Support

When SSL mode is `require` or `verify-full`, users can optionally provide:
- **CA Certificate** (PEM) — validates the server's identity
- **Client Certificate** (PEM) — for mutual TLS authentication
- **Client Key** (PEM) — private key for the client certificate

These are stored in the JSON blob alongside other connection data (encrypted by the OS keychain). The frontend only sees boolean flags (`hasSslCaCert`, `hasSslClientCert`, `hasSslClientKey`).
