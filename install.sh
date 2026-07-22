#!/usr/bin/env bash
#
# Cronium installer — sets up a self-hosted Cronium stack with Docker Compose.
#
#   curl -fsSL https://raw.githubusercontent.com/addison-moore/cronium/main/install.sh | bash
#
# What it does:
#   1. Checks Docker Engine + Compose V2 are available.
#   2. Creates an install directory (./cronium by default).
#   3. Downloads the docker-compose file for the chosen version.
#   4. Generates all required secrets into a chmod-600 .env (kept on re-runs).
#   5. Starts the stack and waits until the app is healthy.
#
# Re-running upgrades in place: existing secrets are never regenerated, and
# `docker compose pull` fetches newer images.
#
# Options:
#   --url URL        Public URL for the instance (default: http://localhost:3000).
#                    Prompted for interactively when omitted.
#   --dir DIR        Install directory (default: ./cronium).
#   --version TAG    Release tag to install (e.g. v1.2.0). Defaults to the
#                    latest GitHub release, or main/latest if none exist.
#   --no-pull        Skip `docker compose pull` (use images already present).
#   --uninstall      Stop the stack (data volumes are kept; remove them with
#                    `docker compose down -v` inside the install directory).
#   -h, --help       Show this help.

set -euo pipefail

REPO="addison-moore/cronium"
RAW_BASE="https://raw.githubusercontent.com/${REPO}"

INSTALL_DIR="./cronium"
PUBLIC_URL=""
VERSION=""
NO_PULL="${CRONIUM_INSTALL_NO_PULL:-0}"
UNINSTALL=0
SOCKET_PROXY_REQUIRED=0
LEGACY_SOCKET_URL=""

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,27p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
  exit 0
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --url)
        PUBLIC_URL="${2:?--url requires a value}"
        shift 2
        ;;
      --dir)
        INSTALL_DIR="${2:?--dir requires a value}"
        shift 2
        ;;
      --version)
        VERSION="${2:?--version requires a value}"
        shift 2
        ;;
      --no-pull)
        NO_PULL=1
        shift
        ;;
      --uninstall)
        UNINSTALL=1
        shift
        ;;
      -h | --help) usage ;;
      *) die "Unknown option: $1 (see --help)" ;;
    esac
  done
}

check_prereqs() {
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v docker >/dev/null 2>&1 ||
    die "Docker is required — install it from https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 ||
    die "Docker Compose V2 is required (the 'docker compose' plugin, not docker-compose v1)"
  docker info >/dev/null 2>&1 ||
    die "The Docker daemon is not running or not reachable by this user"

  if ! command -v openssl >/dev/null 2>&1; then
    [ -r /dev/urandom ] || die "openssl (or /dev/urandom) is required to generate secrets"
  fi

  local server_version major
  server_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
  major=${server_version%%.*}
  case "$major" in
    '' | *[!0-9]*) warn "Could not determine Docker Engine version; Cronium expects 24.x or newer" ;;
    *)
      if [ "$major" -lt 24 ]; then
        warn "Docker Engine ${server_version} detected; Cronium expects 24.x or newer"
      fi
      ;;
  esac
}

rand_hex() {
  # $1 = number of bytes
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -vN "$1" -An -tx1 /dev/urandom | tr -d ' \n'
  fi
}

rand_base64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$1"
  else
    od -vN "$1" -An -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# sha256 hex of stdin's first argument. Tries the common tools in order.
sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "$1" | openssl dgst -sha256 | sed 's/^.*= //'
  else
    die "sha256sum, shasum, or openssl is required to hash the bootstrap token"
  fi
}

resolve_version() {
  # Sets REF (git ref for raw downloads) and IMAGE_TAG (GHCR tag), from
  # --version, the latest GitHub release, or main/latest as a fallback.
  if [ -n "$VERSION" ]; then
    REF="$VERSION"
    IMAGE_TAG="${VERSION#v}" # CI publishes v1.2.3 as image tag 1.2.3
    return
  fi
  local latest
  latest=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1) || true
  if [ -n "${latest:-}" ]; then
    REF="$latest"
    IMAGE_TAG="${latest#v}"
  else
    REF="main"
    IMAGE_TAG="latest"
  fi
}

prompt_url() {
  if [ -n "$PUBLIC_URL" ]; then
    return
  fi
  PUBLIC_URL="http://localhost:3000"
  # `curl | bash` leaves stdin holding the script, so prompt via the terminal.
  if [ -e /dev/tty ] && [ -t 1 ]; then
    printf 'Where will Cronium be reached? [http://localhost:3000] ' >/dev/tty
    local answer=""
    read -r answer </dev/tty || true
    if [ -n "$answer" ]; then
      PUBLIC_URL="$answer"
    fi
  fi
}

derive_socket_url() {
  # Raw port 5002 is loopback-only. Local installs can reach it directly;
  # public installs use the page origin and must proxy only /api/socketio.
  local no_scheme="${PUBLIC_URL#*://}"
  local scheme="${PUBLIC_URL%%://*}"
  local hostport="${no_scheme%%/*}"
  local host
  if [[ "$hostport" == \[* ]]; then
    host="${hostport%%]*}]"
  else
    host="${hostport%%:*}"
  fi
  LEGACY_SOCKET_URL="${scheme}://${host}:5002"
  case "${scheme}:${host}" in
    http:localhost | http:127.* | "http:[::1]")
      SOCKET_URL="${scheme}://${host}:5002"
      ;;
    *)
      SOCKET_URL="${PUBLIC_URL%/}"
      SOCKET_PROXY_REQUIRED=1
      ;;
  esac
}

fetch_compose() {
  if [ -n "${CRONIUM_INSTALL_COMPOSE_FILE:-}" ]; then
    # Testing hook (used by CI): install from a local compose file instead of
    # downloading, so changes under review are what gets exercised.
    log "Using local compose file ${CRONIUM_INSTALL_COMPOSE_FILE}"
    cp "$CRONIUM_INSTALL_COMPOSE_FILE" docker-compose.yml.new
  else
    local url="${RAW_BASE}/${REF}/docker-compose.example.yml"
    log "Fetching compose file (${REF})"
    curl -fsSL "$url" -o docker-compose.yml.new ||
      die "Could not download ${url}"
  fi
  if [ -f docker-compose.yml ] && ! cmp -s docker-compose.yml docker-compose.yml.new; then
    cp docker-compose.yml docker-compose.yml.bak
    log "Compose file updated (previous version saved as docker-compose.yml.bak)"
  fi
  mv docker-compose.yml.new docker-compose.yml
}

write_env() {
  if [ -f .env ]; then
    log "Keeping existing .env (secrets are never regenerated)"
    if [ "$SOCKET_PROXY_REQUIRED" = 1 ] &&
      grep -Fqx "NEXT_PUBLIC_SOCKET_URL=${LEGACY_SOCKET_URL}" .env; then
      sed -i.bak \
        "s|^NEXT_PUBLIC_SOCKET_URL=${LEGACY_SOCKET_URL}$|NEXT_PUBLIC_SOCKET_URL=${SOCKET_URL}|" \
        .env
      rm -f .env.bak
      log "Updated the legacy public :5002 socket URL to the proxied app origin"
    fi
    # Pin the image tag for --version installs even on re-runs.
    if [ -n "$VERSION" ]; then
      if grep -q '^CRONIUM_IMAGE_TAG=' .env; then
        sed -i.bak "s|^CRONIUM_IMAGE_TAG=.*|CRONIUM_IMAGE_TAG=${IMAGE_TAG}|" .env && rm -f .env.bak
      else
        printf 'CRONIUM_IMAGE_TAG=%s\n' "$IMAGE_TAG" >>.env
      fi
    fi
    return
  fi

  log "Generating secrets into .env"
  # One-time first-admin bootstrap token: only its hash is stored on the server.
  # The operator must enter the plaintext during first-admin setup, so a random
  # internet visitor cannot claim the admin account before the operator does.
  BOOTSTRAP_TOKEN=$(rand_hex 16)
  BOOTSTRAP_TOKEN_HASH=$(sha256_hex "$BOOTSTRAP_TOKEN")
  umask 177
  cat >.env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Every value here overrides a default in docker-compose.yml.

# Where users reach Cronium in the browser
AUTH_URL=${PUBLIC_URL}
PUBLIC_APP_URL=${PUBLIC_URL}
# Exact browser origin permitted to open authenticated socket connections
SOCKET_ALLOWED_ORIGINS=${PUBLIC_URL}
# Public installs use the same origin; proxy only /api/socketio to 127.0.0.1:5002
NEXT_PUBLIC_SOCKET_URL=${SOCKET_URL}

# Secrets — generated for this installation; keep this file safe
AUTH_SECRET=$(rand_hex 32)
ENCRYPTION_KEY=$(rand_hex 32)
# Per-service internal credentials (HI-10): the orchestrator's service identity
# and the app<->socket broadcast secret. These replaced the former single shared
# INTERNAL_API_KEY; job/execution access uses per-job capability tokens.
CRONIUM_ORCHESTRATOR_KEY=$(rand_base64 32)
SOCKET_BROADCAST_KEY=$(rand_base64 32)
JWT_SECRET=$(rand_hex 32)
POSTGRES_PASSWORD=$(rand_hex 16)
# Hash of the one-time first-admin bootstrap token (plaintext shown once at the
# end of install; never stored). Required to create the first admin account.
BOOTSTRAP_TOKEN_HASH=${BOOTSTRAP_TOKEN_HASH}

# Image version to run
CRONIUM_IMAGE_TAG=${IMAGE_TAG}

# Remote SSH jobs remain disabled unless an external launcher enforces a
# separate OS identity or isolated container for every mutually untrusted job.
CRONIUM_SSH_EXECUTION_ISOLATION_MODE=disabled
EOF
  umask 022
  chmod 600 .env
}

wait_for_health() {
  local port
  port=$(grep -s '^APP_PORT=' .env | cut -d= -f2)
  port="${port:-${APP_PORT:-3000}}"
  log "Waiting for Cronium to become healthy on port ${port} (this can take a few minutes on first start)"
  local i=0
  while [ $i -lt 90 ]; do
    if curl -fsS "http://localhost:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    i=$((i + 1))
  done
  warn "Timed out waiting for http://localhost:${port}/api/health"
  warn "Check progress with: docker compose logs -f cronium-app"
  return 1
}

main() {
  parse_args "$@"

  if [ "$UNINSTALL" = 1 ]; then
    [ -f "${INSTALL_DIR}/docker-compose.yml" ] ||
      die "No installation found in ${INSTALL_DIR}"
    cd "$INSTALL_DIR"
    log "Stopping Cronium"
    docker compose down
    log "Stopped. Data volumes were kept — remove them with: docker compose down -v"
    exit 0
  fi

  check_prereqs
  resolve_version
  prompt_url
  derive_socket_url

  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"

  fetch_compose
  write_env

  if [ "$NO_PULL" != 1 ]; then
    log "Pulling images"
    docker compose pull
  fi

  log "Starting the stack"
  docker compose up -d

  wait_for_health || exit 1

  log "Cronium is running."
  printf '\n'
  printf '  Open:    %s\n' "$PUBLIC_URL"
  printf '           Your first visit walks you through creating the admin account.\n'
  if [ -n "${BOOTSTRAP_TOKEN:-}" ]; then
    printf '\n'
    printf '  Setup token (enter this on the create-admin screen; shown only once):\n'
    printf '           %s\n' "$BOOTSTRAP_TOKEN"
  fi
  printf '  Status:  (cd %s && docker compose ps)\n' "$INSTALL_DIR"
  printf '  Logs:    (cd %s && docker compose logs -f)\n' "$INSTALL_DIR"
  printf '  Upgrade: re-run this installer, or: docker compose pull && docker compose up -d\n'
  if [ "$SOCKET_PROXY_REQUIRED" = 1 ]; then
    printf '  Socket:  proxy /api/socketio to http://127.0.0.1:5002 (raw port is loopback-only)\n'
  fi
  printf '\n'
}

main "$@"
