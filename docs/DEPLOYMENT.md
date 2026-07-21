# Cronium Deployment Guide

How to run Cronium on your own infrastructure with Docker Compose. This is the
single deployment reference; the same material, formatted for the docs site,
lives at https://cronium.app/docs/self-hosting.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Install](#quick-install)
- [Manual Install](#manual-install)
- [First Boot](#first-boot)
- [Building From Source](#building-from-source)
- [Configuration](#configuration)
- [Verification](#verification)
- [Upgrades](#upgrades)
- [Backup and Restore](#backup-and-restore)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)

## Prerequisites

- Docker Engine 24.x+ with the Docker Compose V2 plugin
- 4GB RAM minimum (8GB recommended), 20GB disk
- Linux, macOS, or Windows with WSL2
- The Docker socket must be available to the orchestrator for container jobs
  (SSH-only setups can drop that mount)

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/addison-moore/cronium/main/install.sh | bash
```

The installer checks your Docker setup, downloads the Compose file for the
newest release, generates every secret into a chmod-600 `.env`, asks one
question (the public URL, `--url` for non-interactive use), starts the stack,
and waits until Cronium is healthy. Useful flags: `--dir`, `--version vX.Y.Z`,
`--uninstall` (stops the stack, keeps data). Re-running the installer upgrades
in place and never regenerates existing secrets.

## Manual Install

The installer automates exactly these steps:

1. **Download the Compose file** (no repository clone needed):

   ```bash
   mkdir cronium && cd cronium
   curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/addison-moore/cronium/main/docker-compose.example.yml
   ```

2. **Create `.env`** next to it:

   ```bash
   cat <<ENV > .env
   AUTH_URL=http://localhost:3000
   PUBLIC_APP_URL=http://localhost:3000
   SOCKET_ALLOWED_ORIGINS=http://localhost:3000
   AUTH_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   INTERNAL_API_KEY=$(openssl rand -base64 32)
   JWT_SECRET=$(openssl rand -hex 32)
   POSTGRES_PASSWORD=$(openssl rand -hex 16)
   ENV
   chmod 600 .env
   ```

   `ENCRYPTION_KEY` must be exactly 64 hex characters — the app refuses to
   start otherwise (a wrong-length key would silently disable credential
   encryption in older versions; now it is a hard boot error).

3. **Start the stack**:

   ```bash
   docker compose up -d
   ```

   A missing or placeholder value stops `docker compose up` immediately with
   the exact generation command in the error message. Every setting is read
   from `.env`; a standard deployment never edits the YAML.

For a domain deployment, set `AUTH_URL`/`PUBLIC_APP_URL` to your public URL and
set `NEXT_PUBLIC_SOCKET_URL` to the browser-reachable HTTPS URL used for live
logs and terminals. Route that URL's `/api/socketio` path through a TLS reverse
proxy to port 5002. Keep the raw port off the public Internet when possible;
the `/broadcast/*` routes on it are intended only for Cronium services and
require `Authorization: Bearer $INTERNAL_API_KEY`.

The socket server accepts browser handshakes only from exact trusted origins.
It uses `PUBLIC_APP_URL` and `AUTH_URL` by default. If more than one frontend
origin is legitimate, set `SOCKET_ALLOWED_ORIGINS` to a comma-separated list
such as `https://cronium.example.com,https://admin.example.com`. Include the
scheme and non-default port, if any; paths and wildcards are not supported.
Authenticated users obtain a 30-second, audience-specific ticket before each
connection. Tickets are single-use within the socket process, and the server
rechecks that the user is active (plus console permission for terminals).

## First Boot

- **Migrations** apply automatically when the app container starts (versioned
  Drizzle migrations). Set `AUTO_MIGRATE=false` to manage the schema yourself,
  and apply pending migrations from a repo checkout with
  `pnpm --filter @cronium/app db:migrate`.
- **Admin account**: there are no default credentials. The first browser visit
  shows a one-time setup page where you create the admin account. For headless
  installs, set `AUTO_SEED_ADMIN=true` plus
  `ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` — seeding refuses
  to run without an explicit `ADMIN_PASSWORD`.
- **Email**: add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and
  `SMTP_FROM_EMAIL` to `.env` to enable outbound email.

## Building From Source

For development or custom builds, use the from-source Compose file, which
builds the same images CI publishes:

```bash
git clone https://github.com/addison-moore/cronium.git && cd cronium
# .env with the same variables as above (setup helper: ./infra/scripts/setup-secrets.sh)
docker compose -f infra/docker/docker-compose.yml up -d --build
```

For the local development loop (app on the host, infrastructure in Docker),
see [GETTING_STARTED.md](./GETTING_STARTED.md) and `pnpm dev:docker:up`.

## Configuration

1. **Environment variables** — the complete reference is
   [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md). Common `.env`
   options: `APP_PORT`/`SOCKET_PORT` (published ports),
   `SOCKET_ALLOWED_ORIGINS` (exact trusted browser origins),
   `CRONIUM_IMAGE_TAG` (pin a release), `LOG_LEVEL`.
2. **Orchestrator tuning** — advanced settings (polling cadence, SSH executor
   limits, metrics) via `apps/orchestrator/configs/cronium-orchestrator.yaml`.
3. **Networking** — services share a fixed-name `cronium` bridge network. Only
   the app's ports (3000, 5002) are published; the worker, orchestrator, and
   runtime are internal-only. On an Internet-facing deployment, firewall the
   raw socket port and proxy only `/api/socketio` to it. Do not expose
   `/broadcast/*`; those endpoints are authenticated with `INTERNAL_API_KEY`
   but remain service-only.
4. **Volumes** — `postgres-data` (database), `valkey-data` (cache),
   `orchestrator-data` (payload signing key + SSH known_hosts; losing it
   breaks registered remote runners).

## Verification

```bash
# Application health
curl http://localhost:3000/api/health

# All six services (postgres, valkey, app, worker, orchestrator, runtime)
# report health via container healthchecks
docker compose ps
```

The `cronium-worker` service is the scheduler: it turns due schedules into
jobs, executes tool-action/HTTP jobs, and recovers stuck work. If it is down,
scheduled events do not run and the app shows a persistent "scheduling is
offline" banner (also visible as `scheduler.healthy: false` in
`/api/health`).

Images are cosign-signed and Trivy-scanned in CI. To verify a signature:

```bash
cosign verify ghcr.io/addison-moore/cronium-app:latest \
  --certificate-identity-regexp=".*" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com
```

## Upgrades

```bash
docker compose pull
docker compose up -d
```

- Migrations run automatically on the new app container's first start.
- **Pin releases in production**: set `CRONIUM_IMAGE_TAG=<version>` in `.env`
  (e.g. `1.2.0`) instead of tracking `latest`, and bump it deliberately.
  `install.sh --version vX.Y.Z` does this for you.
- Take a database backup before major-version upgrades.
- The orchestrator's signing key persists in `orchestrator-data`, so remote
  runners keep working across upgrades.

## Backup and Restore

The entire state of a deployment is: the three data volumes plus your `.env`.

```bash
# Database
docker compose exec postgres pg_dump -U cronium cronium > backup.sql
docker compose exec -T postgres psql -U cronium cronium < backup.sql

# Orchestrator data (signing key + known_hosts)
docker run --rm -v cronium-e2e_orchestrator-data:/data -v "$(pwd)":/backup \
  alpine tar czf /backup/orchestrator-data.tar.gz -C /data .
```

(Volume names are prefixed with your Compose project name — list them with
`docker volume ls`.) Store `.env` with your backups: the database is useless
without the same `ENCRYPTION_KEY`, since stored credentials are encrypted with
it.

## Troubleshooting

**Container fails to start** — `docker compose logs cronium-app`. A
`[PREFLIGHT]` error means a secret is missing or malformed; the message names
the variable and the command to generate it.

**"Scheduling is offline" banner / scheduled events not running** — the
`cronium-worker` service is down or can't reach the database. Check
`docker compose ps` and `docker compose logs cronium-worker`. Missed ticks
while the worker is down are recorded per event (visible on the event's run
history) and handled by each event's catch-up policy when the worker returns.

**Database connection issues**:

```bash
docker compose exec postgres psql -U cronium -d cronium -c "SELECT 1;"
docker compose logs postgres
```

**Permission denied on Docker socket** — add your user to the docker group:
`sudo usermod -aG docker $USER` (log out and back in).

**Port already in use** — set `APP_PORT`/`SOCKET_PORT` in `.env`.

**Debug logging** — set `LOG_LEVEL=debug` in `.env`.

**Reset everything** (WARNING: `-v` deletes all data):

```bash
docker compose down        # stop
docker compose down -v     # stop and delete data volumes
```

## Security Notes

- Secrets live only in `.env` (chmod 600) — never commit it.
- Rotate secrets periodically; restart the stack after updating `.env`.
  Rotating `ENCRYPTION_KEY` requires re-entering stored tool credentials.
- Keep images fresh (`docker compose pull` on a schedule, or pin and bump).
- The app runs as a non-root user; the orchestrator image is distroless. The
  orchestrator needs the Docker socket for container jobs — treat that host
  accordingly.

## Support

- GitHub Issues: https://github.com/addison-moore/cronium/issues
- Documentation: https://cronium.app/docs

---

**Maintainers — keep these in sync** when deployment behavior changes
(compose services/ports/env vars, boot scripts, installer flow):
`docker-compose.example.yml` (source of truth, including its header comment),
`install.sh`, `infra/docker/docker-compose.yml`, this file,
`docs/ENVIRONMENT_VARIABLES.md`, the docs-site `self-hosting` and
`quick-start` pages, the root `README.md` Quick Start, and
`env/.env*.example`. The self-hosting page links to the compose file rather
than inlining it — keep it that way. `.github/workflows/install-smoke.yml`
runs the installer end-to-end and fails when these drift; schema changes
require a generated migration (`pnpm --filter @cronium/app db:generate`,
enforced by `.github/workflows/migrations-check.yml`).
