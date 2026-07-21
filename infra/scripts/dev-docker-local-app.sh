#!/bin/bash

# Run Valkey, the worker, orchestrator, and runtime containers while the app
# and socket server run locally.

set -e

# Change to project root
cd "$(dirname "$0")/../.."

# Load environment variables from env/.env.local file if it exists
if [ -f env/.env.local ]; then
    set -a
    source env/.env.local
    set +a
elif [ -f env/.env ]; then
    set -a
    source env/.env
    set +a
else
    echo "Warning: No env/.env.local or env/.env file found. Some environment variables may be missing."
fi

# DATABASE_URL is host-oriented for the local Next.js process. Translate only
# loopback hosts so the worker container reaches that same database through the
# Docker host gateway; hosted database URLs are left unchanged.
if [ -z "${CRONIUM_DEV_WORKER_DATABASE_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
    CRONIUM_DEV_WORKER_DATABASE_URL="$DATABASE_URL"
    CRONIUM_DEV_WORKER_DATABASE_URL="${CRONIUM_DEV_WORKER_DATABASE_URL/@localhost:/@host.docker.internal:}"
    CRONIUM_DEV_WORKER_DATABASE_URL="${CRONIUM_DEV_WORKER_DATABASE_URL/\/\/localhost:/\/\/host.docker.internal:}"
    CRONIUM_DEV_WORKER_DATABASE_URL="${CRONIUM_DEV_WORKER_DATABASE_URL/@127.0.0.1:/@host.docker.internal:}"
    CRONIUM_DEV_WORKER_DATABASE_URL="${CRONIUM_DEV_WORKER_DATABASE_URL/\/\/127.0.0.1:/\/\/host.docker.internal:}"
    export CRONIUM_DEV_WORKER_DATABASE_URL
fi

# Display helpful information
echo "Starting Valkey, scheduling worker, orchestrator, and runtime containers..."
echo "Run 'pnpm dev:app' and 'pnpm dev:socket' separately for the host app."
echo ""
echo "The local app should have these environment variables set:"
echo "  VALKEY_URL=redis://localhost:6379"
echo "  ORCHESTRATOR_URL=http://localhost:8080"
echo ""

# Run docker compose with the local app configuration
# If no arguments provided, default to "up"
if [ $# -eq 0 ]; then
    set -- up
fi
exec docker compose -f infra/docker/docker-compose.dev.local-app.yml "$@"
