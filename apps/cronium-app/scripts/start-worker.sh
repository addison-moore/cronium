#!/bin/sh
set -euo pipefail

# Same env preflight as the app container (refuse placeholder/invalid secrets).
# "worker" role: the worker broadcasts to the socket server but never serves the
# orchestrator-facing routes, so CRONIUM_ORCHESTRATOR_KEY is not required here.
node apps/cronium-app/scripts/validate-env.cjs worker

# Migrations are run by the app container; this service depends_on it being
# healthy, so the schema is already in place.

WORKER_ENTRY="apps/cronium-app/dist/worker.cjs"
if [ ! -f "$WORKER_ENTRY" ]; then
  echo "[WORKER] $WORKER_ENTRY not found in image" >&2
  exit 1
fi

echo "[WORKER] Starting scheduling worker via $WORKER_ENTRY"
exec node "$WORKER_ENTRY"
