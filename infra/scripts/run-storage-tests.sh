#!/usr/bin/env bash
#
# Storage-layer test harness (testing PLAN.md Phase 3).
#
# Spins up a DISPOSABLE local Postgres + Valkey per run, pushes the live Drizzle
# schema into it, runs the Jest "Storage Tests" project against it, and ALWAYS
# tears the containers down. Nothing here ever touches the shared external dev
# database (env/.env.local's DATABASE_URL) — the whole point is an isolated,
# throwaway instance that can be truncated freely.
#
# Works both locally (Docker Desktop) and on ubuntu-latest CI. The only
# requirement is a working `docker`.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config. Ports deliberately avoid 5432/6379 (already taken by other local
# containers). Override PG_PORT / VALKEY_PORT to dodge a collision.
# ---------------------------------------------------------------------------
PG_IMAGE="postgres:16-alpine"          # matches infra/docker/docker-compose.yml
VALKEY_IMAGE="valkey/valkey:7-alpine"  # matches infra/docker/docker-compose.yml
PG_PORT="${PG_PORT:-55433}"
VALKEY_PORT="${VALKEY_PORT:-56379}"
PG_PASSWORD="storage_test"
PG_DB="cronium_storage_test"
RUN_ID="$$"
PG_NAME="cronium-storage-test-pg-${RUN_ID}"
VALKEY_NAME="cronium-storage-test-valkey-${RUN_ID}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"

log() { printf '\033[0;36m[storage-tests]\033[0m %s\n' "$*"; }

cleanup() {
  local code=$?
  log "Tearing down containers…"
  docker rm -f "${PG_NAME}" "${VALKEY_NAME}" >/dev/null 2>&1 || true
  exit "${code}"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Boot throwaway containers.
# ---------------------------------------------------------------------------
log "Starting disposable Postgres (${PG_IMAGE}) on :${PG_PORT}…"
docker rm -f "${PG_NAME}" >/dev/null 2>&1 || true
docker run -d --name "${PG_NAME}" \
  -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
  -e POSTGRES_DB="${PG_DB}" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  "${PG_IMAGE}" \
  -c fsync=off -c full_page_writes=off -c synchronous_commit=off >/dev/null

log "Starting disposable Valkey (${VALKEY_IMAGE}) on :${VALKEY_PORT}…"
docker rm -f "${VALKEY_NAME}" >/dev/null 2>&1 || true
docker run -d --name "${VALKEY_NAME}" \
  -p "127.0.0.1:${VALKEY_PORT}:6379" \
  "${VALKEY_IMAGE}" >/dev/null

# ---------------------------------------------------------------------------
# Wait for readiness.
# ---------------------------------------------------------------------------
log "Waiting for Postgres readiness…"
for i in $(seq 1 60); do
  if docker exec "${PG_NAME}" pg_isready -U postgres -d "${PG_DB}" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    log "Postgres did not become ready in time"
    docker logs "${PG_NAME}" || true
    exit 1
  fi
  sleep 1
done

log "Waiting for Valkey readiness…"
for i in $(seq 1 30); do
  if docker exec "${VALKEY_NAME}" valkey-cli ping >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    log "Valkey did not become ready in time"
    exit 1
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# Environment for db:push and the Jest run. DATABASE_URL points at 127.0.0.1
# so the setup guard (tests/storage/setup.ts) recognises it as disposable and
# lets the suite run; anything non-loopback is refused.
# ---------------------------------------------------------------------------
export DATABASE_URL="postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}"
export VALKEY_URL="redis://127.0.0.1:${VALKEY_PORT}"
export REDIS_URL="${VALKEY_URL}"
# A valid throwaway 32-byte hex ENCRYPTION_KEY and a >=32-char AUTH_SECRET so
# any storage path that touches the crypto/auth modules loads.
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff}"
export AUTH_SECRET="${AUTH_SECRET:-storage-tests-auth-secret-min-32-characters}"
export SKIP_ENV_VALIDATION=1
export NODE_ENV=test

# ---------------------------------------------------------------------------
# Push the live Drizzle schema into the throwaway DB. drizzle.config.ts loads
# env/.env.local, but dotenv does NOT override an already-exported DATABASE_URL,
# so this targets the disposable instance, never the shared dev DB.
# ---------------------------------------------------------------------------
log "Pushing Drizzle schema (db:push)…"
pnpm --filter @cronium/app db:push

# ---------------------------------------------------------------------------
# Run the Storage Tests Jest project. --runInBand: every test file shares the
# one database and truncates between tests, so they must not run concurrently.
# --forceExit: the pg pool / Valkey clients keep the event loop alive after the
# run, so jest would otherwise hang ~30s and get SIGTERM'd (exit 143); the
# database is disposable and torn down next, so a hard exit is safe here.
# ---------------------------------------------------------------------------
log "Running Storage Tests…"
pnpm --filter @cronium/app exec jest \
  --config "${REPO_ROOT}/tests/jest.config.js" \
  --selectProjects "Storage Tests" \
  --runInBand \
  --forceExit \
  "$@"

log "Storage Tests complete."
