#!/bin/sh
set -euo pipefail

# Refuse to start on missing/placeholder/invalid secrets
node apps/cronium-app/scripts/validate-env.cjs

# Run database migrations (script handles AUTO_MIGRATE flag)
node apps/cronium-app/scripts/run-migrations.cjs

# Seed bootstrap admin/settings when enabled
node apps/cronium-app/scripts/bootstrap-seed.cjs

SOCKET_ENTRY="server.js"
SOCKET_PID=""

if [ -f "$SOCKET_ENTRY" ]; then
  echo "[SOCKET] Starting terminal/log bridge via $SOCKET_ENTRY"
  node "$SOCKET_ENTRY" &
  SOCKET_PID=$!
else
  echo "[SOCKET] $SOCKET_ENTRY not found; skipping socket server"
fi

cleanup() {
  if [ -n "$SOCKET_PID" ] && kill -0 "$SOCKET_PID" 2>/dev/null; then
    kill "$SOCKET_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

NEXT_ENTRY=".next/standalone/server.js"
if [ ! -f "$NEXT_ENTRY" ]; then
  if [ -f "apps/cronium-app/server.js" ]; then
    NEXT_ENTRY="apps/cronium-app/server.js"
  else
    echo "[NEXT] Could not locate Next.js standalone entrypoint" >&2
    exit 1
  fi
fi

echo "[NEXT] Starting Next.js server via $NEXT_ENTRY"
exec node "$NEXT_ENTRY"
