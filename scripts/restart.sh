#!/usr/bin/env bash
# restart.sh — Detached process that restarts the AIShell dev server.
#
# Usage (called by the Node.js server, not manually):
#   bash restart.sh <REPO_ROOT> <API_PORT> <OLD_PID>
#
# The script:
#   1. Waits for the old server process to exit
#   2. Waits for the API port to be free
#   3. Runs npm install and restores package-lock.json to keep the tree clean
#   4. Starts npm run dev in the background
#   5. Waits for the server to be listening

set -euo pipefail

REPO_ROOT="${1:?Usage: restart.sh <REPO_ROOT> <API_PORT> <OLD_PID>}"
API_PORT="${2:?Usage: restart.sh <REPO_ROOT> <API_PORT> <OLD_PID>}"
OLD_PID="${3:-}"

RUNTIME_DIR="$REPO_ROOT/.runtime"
LOG_FILE="$RUNTIME_DIR/restart.log"
PID_FILE="$RUNTIME_DIR/dev.pid"
mkdir -p "$RUNTIME_DIR"

exec > "$LOG_FILE" 2>&1

echo "[restart] $(date) — Starting restart sequence"
echo "[restart] REPO_ROOT=$REPO_ROOT"
echo "[restart] API_PORT=$API_PORT"
echo "[restart] OLD_PID=$OLD_PID"

# ── 1. Wait for old process to exit (up to 15 seconds) ──────────────────────
if [ -n "$OLD_PID" ]; then
  echo "[restart] Waiting for old process $OLD_PID to exit..."
  for i in $(seq 1 30); do
    if ! kill -0 "$OLD_PID" 2>/dev/null; then
      echo "[restart] Old process exited"
      break
    fi
    sleep 0.5
  done

  # Force-kill if still alive
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[restart] Force-killing old process $OLD_PID"
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# ── 2. Wait for the API port to be free (up to 15 seconds) ──────────────────
echo "[restart] Waiting for port $API_PORT to be free..."
for i in $(seq 1 30); do
  if ! lsof -ti:"$API_PORT" >/dev/null 2>&1; then
    echo "[restart] Port $API_PORT is free"
    break
  fi

  # On the last attempt, force-kill whatever is on the port
  if [ "$i" -eq 30 ]; then
    echo "[restart] Force-killing processes on port $API_PORT"
    lsof -ti:"$API_PORT" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi

  sleep 0.5
done

# ── 3. Run npm install ───────────────────────────────────────────────────────
echo "[restart] Running npm install..."
cd "$REPO_ROOT"
if npm install 2>&1; then
  echo "[restart] npm install succeeded"
else
  echo "[restart] WARNING: npm install failed (exit code $?), attempting to start anyway"
fi

# ── 3b. Restore lockfile to match git so the tree stays clean ───────────────
# npm install may rewrite package-lock.json (different npm version formatting,
# resolved metadata). The actual installed packages in node_modules are correct
# regardless. If we leave the lockfile dirty, git status shows a dirty tree and
# the next update check rejects with "aishell_working_tree_dirty".
# We restore instead of committing to avoid diverging from the remote (which
# would break the next git pull --ff-only).
cd "$REPO_ROOT"
if [ -n "$(git status --porcelain -- package-lock.json 2>/dev/null)" ]; then
  echo "[restart] Restoring package-lock.json to match git (npm reformatted it)"
  git checkout -- package-lock.json
fi

# ── 4. Start npm run dev ────────────────────────────────────────────────────
echo "[restart] Starting npm run dev..."
cd "$REPO_ROOT"
nohup npm run dev >> "$LOG_FILE" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"
echo "[restart] Dev server started with PID $DEV_PID"

# ── 5. Wait for server to start ─────────────────────────────────────────────
# The frontend's UpdateTab polls the API and auto-reloads the page
# when the server comes back, so no need to open a new browser tab.
echo "[restart] Waiting for server to start on port $API_PORT..."
for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:$API_PORT/api/version" >/dev/null 2>&1; then
    echo "[restart] Server is up after ~${i}s"
    echo "[restart] $(date) — Restart complete"
    exit 0
  fi
  sleep 1
done

echo "[restart] WARNING: Server did not start within 90 seconds"
echo "[restart] Check $LOG_FILE for dev server output"
exit 1
