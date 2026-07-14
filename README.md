# AIShell

Multi-application hosting framework built with React, TypeScript, Vite, and Express.

## Quick Start

### Dev Container (recommended)

1. Open this folder in VS Code or Cursor.
2. Run **Dev Containers: Reopen in Container** from the command palette.
3. After the container builds and `npm ci` completes, start the dev server:

```bash
npm run dev:container
```

4. Open the forwarded port **5174** (AIShell UI).

The API runs on port **5175** and is proxied through Vite at `/api`.

### GitHub authentication (dev container)

After the first build (or any rebuild), authenticate once so `git push` and `gh` work inside the container:

```bash
gh auth login
gh auth setup-git
```

Use **GitHub.com**, **HTTPS**, and **Login with a web browser** when prompted. This works the same on macOS and Windows hosts.

Verify:

```bash
gh auth status
git ls-remote origin HEAD
```

Credentials are stored in the container. If you rebuild the dev container, run the two commands again.

### Local (non-container)

Requires Node.js **22.13+**.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API + Vite (local; Vite binds to 127.0.0.1) |
| `npm run dev:container` | Start API + Vite (container; Vite binds to 0.0.0.0) |
| `npm run check` | TypeScript type check |
| `npm test` | Run unit tests |
| `npm run build` | Production build |

## Optional Postgres (db-helper)

To test database features against a local Postgres instance, start the optional sidecar from `.devcontainer/`:

```bash
cd .devcontainer
docker compose --profile db-helper up -d postgres
```

Connection string from inside the dev container:

```
postgresql://aishell:aishell@postgres:5432/aishell_dev
```

Add this connection in the **db-helper** app UI.

## CodaScope Setup

CodaScope requires two app-scoped secrets:

- `cursor_api_key` — Cursor API key for AI agents
- `codascope_projects_root` — filesystem path to project data

Set these via the Admin app UI, or via environment variables (see [`.env.example`](.env.example)).

For git operations, target repositories must be accessible inside the container filesystem. Bind-mount sibling repos as needed.

## Server Mode (optional)

By default, AIShell runs in **standalone** mode (single user, no login). For multi-user auth:

```bash
AISHELL_MODE=server AISHELL_ADMIN_PASSWORD=<strong-password> npm run dev
```

On first boot, `AISHELL_ADMIN_PASSWORD` creates the `aishell_admin` user.

## Environment Variables

See [`.env.example`](.env.example) for the full list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AISHELL_MODE` | `standalone` | Operating mode |
| `AISHELL_DATA_DIR` | `~/.aishell` | Config, secrets, auth storage |
| `AISHELL_PORT` | `5175` | API port |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — Shell framework architecture
- [APP_DEVELOPMENT_GUIDE.md](APP_DEVELOPMENT_GUIDE.md) — How to build apps within AIShell
