#!/usr/bin/env bash
#
# End-to-end pipeline test harness (testing PLAN.md Phase 5).
#
# Boots a fully DISPOSABLE stack — Postgres + Valkey + orchestrator (real
# Docker, real job containers, real runtime sidecars) via
# infra/docker/docker-compose.e2e.yml, plus the Next.js app, socket server, and
# scheduling worker as host processes — then runs the Jest "E2E Tests" project
# (tests/e2e/) against it and ALWAYS tears everything down. Nothing here ever
# touches the shared external dev database or the dev docker stack.
#
# Requirements: docker (with compose v2), pnpm workspace installed. Works on
# macOS (Docker Desktop) and ubuntu CI.
#
# Env knobs:
#   E2E_PG_PORT / E2E_VALKEY_PORT / E2E_APP_PORT / E2E_SOCKET_PORT /
#   E2E_WORKER_HEALTH_PORT / E2E_ORCH_PORT   — override default ports
#   E2E_REBUILD_APP=1  — force a fresh `next build` even if one exists
#   E2E_KEEP_STACK=1   — skip teardown (debugging)
#
set -euo pipefail
set -m # job control: background children get their own process groups

PG_PORT="${E2E_PG_PORT:-55434}"
VALKEY_PORT="${E2E_VALKEY_PORT:-56380}"
APP_PORT="${E2E_APP_PORT:-55001}"
SOCKET_PORT="${E2E_SOCKET_PORT:-55002}"
WORKER_HEALTH_PORT="${E2E_WORKER_HEALTH_PORT:-55003}"
ORCH_PORT="${E2E_ORCH_PORT:-58080}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.e2e.yml"
PROJECT="cronium-e2e"
COMPOSE=(docker compose -f "${COMPOSE_FILE}" -p "${PROJECT}")
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cronium-e2e.XXXXXX")"

log() { printf '\033[0;36m[e2e]\033[0m %s\n' "$*"; }

# Containers launched via the raw Docker API (job containers, runtime
# sidecars) can't resolve host.docker.internal on Linux, so there the host-run
# app is reached via the e2e network's pinned gateway IP (compose ipam).
case "$(uname -s)" in
Darwin) BACKEND_HOST="${E2E_BACKEND_HOST:-host.docker.internal}" ;;
*) BACKEND_HOST="${E2E_BACKEND_HOST:-172.30.99.1}" ;;
esac

# Throwaway secrets — consistent across app/worker/socket/orchestrator.
export E2E_PG_PORT="${PG_PORT}" E2E_VALKEY_PORT="${VALKEY_PORT}"
export E2E_APP_PORT="${APP_PORT}" E2E_ORCH_PORT="${ORCH_PORT}"
export E2E_BACKEND_HOST="${BACKEND_HOST}"
export E2E_ORCH_KEY="e2e-orchestrator-key-0123456789abcdef0123456789abcdef"
export E2E_JWT_SECRET="e2e0jwt0secret00112233445566778899aabbccddeeff0011223344556677"

DATABASE_URL="postgresql://postgres:e2e_test@127.0.0.1:${PG_PORT}/cronium_e2e"
APP_URL="http://127.0.0.1:${APP_PORT}"

# Env shared by the three host processes (app / socket / worker). NODE_ENV is
# left to each launcher: `next start` sets production (loopback URLs pass the
# production URL policy); tsx processes default to development via env.mjs.
HOST_ENV=(
  "DATABASE_URL=${DATABASE_URL}"
  "AUTH_SECRET=e2e-auth-secret-at-least-32-characters-long"
  "AUTH_URL=http://localhost:${APP_PORT}"
  "PUBLIC_APP_URL=http://localhost:${APP_PORT}"
  "ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
  "VALKEY_URL=redis://127.0.0.1:${VALKEY_PORT}"
  "SOCKET_INTERNAL_URL=http://127.0.0.1:${SOCKET_PORT}"
  "ORCHESTRATOR_URL=http://127.0.0.1:${ORCH_PORT}"
  "CRONIUM_ORCHESTRATOR_KEY=${E2E_ORCH_KEY}"
  "SOCKET_BROADCAST_KEY=e2e-socket-broadcast-key-0123456789abcdef"
  "JWT_SECRET=${E2E_JWT_SECRET}"
  "NEXT_TELEMETRY_DISABLED=1"
)

PIDS=()
FAILED=0

cleanup() {
  local code=$?
  [ "${code}" -ne 0 ] && FAILED=1
  if [ "${E2E_KEEP_STACK:-0}" = "1" ]; then
    log "E2E_KEEP_STACK=1 — leaving stack up. Logs: ${RUN_DIR}"
    exit "${code}"
  fi
  log "Tearing down…"
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid}" ] && kill -- -"${pid}" >/dev/null 2>&1 || true
  done
  # pnpm-exec chains can leave the actual node servers in other process
  # groups; kill whatever still listens on our ports.
  sleep 1
  for port in "${APP_PORT}" "${SOCKET_PORT}" "${WORKER_HEALTH_PORT}"; do
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done
  if [ "${FAILED}" = "1" ]; then
    log "----- app.log (tail) -----"
    tail -40 "${RUN_DIR}/app.log" 2>/dev/null || true
    log "----- worker.log (tail) -----"
    tail -40 "${RUN_DIR}/worker.log" 2>/dev/null || true
    log "----- socket.log (tail) -----"
    tail -20 "${RUN_DIR}/socket.log" 2>/dev/null || true
    log "----- orchestrator (tail) -----"
    docker logs --tail 60 cronium-e2e-orchestrator 2>&1 | tail -60 || true

    # The job's own stdout/stderr is the only place a script-side failure
    # (e.g. a cronium_* helper that can't reach its runtime sidecar) is
    # visible — the service logs above never carry it. Read it from the DB
    # while Postgres is still up.
    log "----- job logs (DB: status/exit/output/error) -----"
    docker exec -e PGPASSWORD=e2e_test cronium-e2e-postgres \
      psql -U postgres -d cronium_e2e -x -c \
      "SELECT id, event_name, status, exit_code,
              left(coalesce(output, ''), 2000) AS output,
              left(coalesce(error, ''), 2000)  AS error
         FROM logs ORDER BY id DESC LIMIT 5" 2>&1 | tail -60 || true

    # Per-job sidecars/containers are removed as each job finishes, so list
    # whatever survives plus any sidecar logs still reachable.
    log "----- cronium-managed containers (survivors) -----"
    docker ps -a --filter "label=cronium.managed=true" \
      --format '{{.Names}}\t{{.Status}}\t{{.Networks}}' 2>&1 | head -20 || true
    for c in $(docker ps -aq --filter "label=cronium.service=runtime-api" 2>/dev/null | head -3); do
      log "----- sidecar ${c} (tail) -----"
      docker logs --tail 30 "${c}" 2>&1 | tail -30 || true
    done
  fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  # Belt and braces: remove any leaked per-job containers/networks.
  docker ps -aq --filter "label=cronium.managed=true" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network ls -q --filter "label=cronium.managed=true" | xargs -r docker network rm >/dev/null 2>&1 || true
  exit "${code}"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# 1. Containers: build images, start Postgres + Valkey.
# ---------------------------------------------------------------------------
log "Building images (orchestrator, runtime sidecar, bash executor)…"
"${COMPOSE[@]}" --profile build-only build --quiet 2>"${RUN_DIR}/build.log" ||
  { cat "${RUN_DIR}/build.log"; exit 1; }

log "Starting Postgres + Valkey…"
"${COMPOSE[@]}" up -d --wait postgres valkey

# ---------------------------------------------------------------------------
# 2. Schema into the throwaway DB (drizzle-kit push; dotenv never overrides an
#    exported DATABASE_URL, so this cannot hit the shared dev database).
# ---------------------------------------------------------------------------
log "Pushing Drizzle schema…"
(cd "${REPO_ROOT}" && env "DATABASE_URL=${DATABASE_URL}" SKIP_ENV_VALIDATION=1 \
  pnpm --filter @cronium/app db:push >"${RUN_DIR}/db-push.log" 2>&1) ||
  { cat "${RUN_DIR}/db-push.log"; exit 1; }

# ---------------------------------------------------------------------------
# 3. Production build of the app (reused across runs unless E2E_REBUILD_APP=1).
# ---------------------------------------------------------------------------
if [ ! -f "${REPO_ROOT}/apps/cronium-app/.next/BUILD_ID" ] || [ "${E2E_REBUILD_APP:-0}" = "1" ]; then
  # @cronium/ui is a BUILT workspace package (main → dist/); `next build` is
  # invoked directly (not through turbo), so nothing orders the ui build
  # before the app on a fresh checkout. Build it explicitly.
  log "Building @cronium/ui…"
  (cd "${REPO_ROOT}" && pnpm --filter @cronium/ui build >"${RUN_DIR}/ui-build.log" 2>&1) ||
    { tail -20 "${RUN_DIR}/ui-build.log"; exit 1; }
  log "Building the app (next build — first run takes a few minutes)…"
  (cd "${REPO_ROOT}/apps/cronium-app" && env "${HOST_ENV[@]}" SKIP_ENV_VALIDATION=1 \
    pnpm exec next build >"${RUN_DIR}/next-build.log" 2>&1) ||
    { tail -40 "${RUN_DIR}/next-build.log"; exit 1; }
else
  log "Reusing existing production build (apps/cronium-app/.next). E2E_REBUILD_APP=1 forces a rebuild."
fi

# ---------------------------------------------------------------------------
# 4. Host processes: app (next start), socket server, scheduling worker.
# ---------------------------------------------------------------------------
log "Starting app on :${APP_PORT}…"
(cd "${REPO_ROOT}/apps/cronium-app" && exec env "${HOST_ENV[@]}" \
  pnpm exec next start -H 0.0.0.0 -p "${APP_PORT}") >"${RUN_DIR}/app.log" 2>&1 &
PIDS+=("$!")

log "Starting socket server on :${SOCKET_PORT}…"
(cd "${REPO_ROOT}/apps/cronium-app" && exec env "${HOST_ENV[@]}" "SOCKET_PORT=${SOCKET_PORT}" \
  pnpm exec tsx server.ts) >"${RUN_DIR}/socket.log" 2>&1 &
PIDS+=("$!")

log "Starting scheduling worker…"
(cd "${REPO_ROOT}/apps/cronium-app" && exec env "${HOST_ENV[@]}" \
  "WORKER_ID=worker-e2e" "WORKER_HEALTH_PORT=${WORKER_HEALTH_PORT}" \
  "WORKER_DISPATCH_INTERVAL_MS=1000" "WORKER_CLAIM_INTERVAL_MS=1000" \
  pnpm exec tsx worker.ts) >"${RUN_DIR}/worker.log" 2>&1 &
PIDS+=("$!")

wait_http() { # url, needle, label, attempts
  local url="$1" needle="$2" label="$3" attempts="${4:-60}"
  for i in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 2 "${url}" 2>/dev/null | grep -q "${needle}"; then
      log "${label} ready."
      return 0
    fi
    sleep 2
  done
  log "${label} did not become ready (${url})"
  return 1
}

wait_http "${APP_URL}/api/health" '"status":"ok"' "App"
wait_http "${APP_URL}/api/health" '"healthy":true' "Scheduler (worker heartbeat)" 30

# ---------------------------------------------------------------------------
# 5. Orchestrator (needs the app up to claim against).
# ---------------------------------------------------------------------------
log "Starting orchestrator…"
"${COMPOSE[@]}" up -d orchestrator
wait_http "http://127.0.0.1:${ORCH_PORT}/health" '' "Orchestrator" 30

# ---------------------------------------------------------------------------
# 6. Run the E2E Jest project.
# ---------------------------------------------------------------------------
log "Running E2E tests…"
(cd "${REPO_ROOT}" && env \
  "DATABASE_URL=${DATABASE_URL}" \
  "E2E_APP_URL=${APP_URL}" \
  "NODE_ENV=test" \
  pnpm --filter @cronium/app exec jest \
  --config "${REPO_ROOT}/tests/jest.config.js" \
  --selectProjects "E2E Tests" \
  --runInBand --forceExit --colors) || FAILED=1

if [ "${FAILED}" = "1" ]; then
  exit 1
fi
log "E2E tests passed."
