#!/bin/sh
set -euo pipefail

# Run database migrations (script handles AUTO_MIGRATE flag)
node apps/cronium-app/scripts/run-migrations.mjs

# Start WebSocket/terminal bridge in background
node apps/cronium-app/server.js &
SOCKET_PID=$!

cleanup() {
  if kill -0 "$SOCKET_PID" 2>/dev/null; then
    kill "$SOCKET_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# Start Next.js standalone server (foreground)
exec node server.js
