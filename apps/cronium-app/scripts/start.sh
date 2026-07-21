#!/bin/sh
set -euo pipefail

# Refuse to start on missing/placeholder/invalid secrets
node apps/cronium-app/scripts/validate-env.cjs

# Run database migrations (script handles AUTO_MIGRATE flag)
node apps/cronium-app/scripts/run-migrations.cjs

# Seed bootstrap admin/settings when enabled
node apps/cronium-app/scripts/bootstrap-seed.cjs

SOCKET_ENTRY="apps/cronium-app/dist/socket-server.cjs"
SOCKET_PID=""
NEXT_PID=""

if [ -f "$SOCKET_ENTRY" ]; then
  echo "[SOCKET] Starting terminal/log bridge via $SOCKET_ENTRY"
  node "$SOCKET_ENTRY" &
  SOCKET_PID=$!
else
  echo "[SOCKET] Required socket server bundle not found: $SOCKET_ENTRY" >&2
  exit 1
fi

cleanup() {
  if [ -n "$SOCKET_PID" ] && kill -0 "$SOCKET_PID" 2>/dev/null; then
    kill "$SOCKET_PID" 2>/dev/null || true
  fi
  if [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null; then
    kill "$NEXT_PID" 2>/dev/null || true
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
node "$NEXT_ENTRY" &
NEXT_PID=$!

# BusyBox sh does not provide a portable wait-for-any primitive across every
# supported image version. Poll both children so either server exiting makes
# the container fail and Compose can restart it.
while kill -0 "$SOCKET_PID" 2>/dev/null && kill -0 "$NEXT_PID" 2>/dev/null; do
  sleep 1
done

set +e
if ! kill -0 "$SOCKET_PID" 2>/dev/null; then
  wait "$SOCKET_PID"
  STATUS=$?
  echo "[SOCKET] Socket server exited with status $STATUS" >&2
else
  wait "$NEXT_PID"
  STATUS=$?
  echo "[NEXT] Next.js server exited with status $STATUS" >&2
fi
set -e
if [ "$STATUS" -eq 0 ]; then
  STATUS=1
fi

cleanup
wait "$SOCKET_PID" 2>/dev/null || true
wait "$NEXT_PID" 2>/dev/null || true
exit "$STATUS"
