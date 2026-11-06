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
- [Data Retention](#data-retention)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)

## Prerequisites

- Docker Engine 24.x+ with the Docker Compose V2 plugin
- 4GB RAM minimum to run the published images (8GB recommended), 20GB disk.
  [Building from source](#building-from-source) needs 8GB.
- Linux, macOS, or Windows with WSL2
- The Docker socket must be available to the orchestrator for container jobs
  (an externally isolated SSH-only setup can drop that mount)

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/addison-moore/cronium/main/install.sh | bash
```

The installer checks your Docker setup, downloads the Compose file for the
newest release, generates every secret into a chmod-600 `.env`, asks one
question (the public URL, `--url` for non-interactive use), starts the stack,
and waits until Cronium is healthy. Useful flags: `--dir`, `--version vX.Y.Z`,
`--uninstall` (stops the stack, keeps data). Re-running the installer upgrades
in place and never regenerates existing secrets. For a non-loopback public URL,
the installer configures sockets on that same origin and prints the required
`/api/socketio` reverse-proxy target.

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
   NEXT_PUBLIC_SOCKET_URL=http://localhost:5002
   AUTH_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   CRONIUM_ORCHESTRATOR_KEY=$(openssl rand -base64 32)
   SOCKET_BROADCAST_KEY=$(openssl rand -base64 32)
   JWT_SECRET=$(openssl rand -hex 32)
   POSTGRES_PASSWORD=$(openssl rand -hex 16)
   VALKEY_PASSWORD=$(openssl rand -hex 24)
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

For a domain deployment, set `AUTH_URL`, `PUBLIC_APP_URL`, and
`NEXT_PUBLIC_SOCKET_URL` to the same public HTTPS origin. Route only its
`/api/socketio` path through a TLS reverse proxy to `127.0.0.1:5002`. A proxy
container on the Cronium network can instead use `http://cronium-app:5002`.
Compose binds host port 5002 to loopback; never proxy `/broadcast/*`. Those
routes are intended only for Cronium services and require
`Authorization: Bearer $SOCKET_BROADCAST_KEY`.

A reverse proxy in front of the app also carries saves, so let it pass request
bodies of at least 10 MB, the most one save can carry. nginx's
`client_max_body_size` defaults to 1 MB, and past that it refuses a script before
Cronium sees it, so set `client_max_body_size 10m;`. Until a proxy allows a save,
the event form and the JSON import dialog say that a reverse proxy refused it, and
callers of the REST API and `/api/mcp` get the proxy's own 413, which may not be
JSON.

The socket server accepts browser handshakes only from exact trusted origins.
It uses `PUBLIC_APP_URL` and `AUTH_URL` by default. If more than one frontend
origin is legitimate, set `SOCKET_ALLOWED_ORIGINS` to a comma-separated list
such as `https://cronium.example.com,https://admin.example.com`. Include the
scheme and non-default port, if any; paths and wildcards are not supported.
Authenticated users obtain a 30-second, audience-specific ticket before each
connection. Tickets are consumed atomically in shared Valkey across replicas.
The server rechecks that the user is active (plus console permission for
terminals), subscribes to authorization revocations, and periodically
revalidates connected principals.

The bundled Valkey service uses the `noeviction` policy because consumed socket
ticket markers are security state, not disposable cache entries. If Valkey
reaches its configured memory limit, new security-sensitive writes fail closed.

Remote SSH execution is disabled by default. Cronium's static SSH credential
cannot create a new Unix identity on an arbitrary target, so a normal shared
SSH account does not satisfy the execution isolation boundary. Set
`CRONIUM_SSH_EXECUTION_ISOLATION_MODE=operator-enforced` only when a trusted
external launcher guarantees a separate OS identity or isolated container for
every mutually untrusted remote job. The orchestrator otherwise rejects SSH
jobs with `SSH_ISOLATION_REQUIRED`.

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

Give Docker about 8GB of memory for the build. `next build` alone peaks above
4GB and can run out of memory on a smaller machine. If it does, build somewhere
larger or use the published images.

For the local development loop (app on the host, infrastructure in Docker),
see [GETTING_STARTED.md](./GETTING_STARTED.md) and `pnpm dev:docker:up`.

## Configuration

1. **Environment variables** — the complete reference is
   [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md). Common `.env`
   options: `APP_PORT` (public web port), `SOCKET_PORT` (loopback proxy target),
   `SOCKET_ALLOWED_ORIGINS` (exact trusted browser origins),
   `CRONIUM_IMAGE_TAG` (pin a release), `LOG_LEVEL`, and the
   `CRONIUM_*_RETENTION_DAYS` windows ([Data Retention](#data-retention)).
2. **Orchestrator tuning** — advanced settings (polling cadence, SSH executor
   limits, metrics) via `apps/orchestrator/configs/cronium-orchestrator.yaml`.
   SSH remains disabled unless the operator explicitly attests to external
   per-job identity/container isolation.
3. **Networking** — services share a fixed-name `cronium` bridge network. Port
   3000 is published normally; port 5002 is published only on `127.0.0.1` for a
   host reverse proxy. The worker, orchestrator, and runtime are internal-only.
   Proxy only `/api/socketio`; do not expose `/broadcast/*`, which remains a
   service-only authenticated endpoint.
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
- **Run history is deleted by age.** If your instance predates
  [Data Retention](#data-retention), the worker starts deleting history past the
  default windows as soon as it comes up after the upgrade. To keep everything, set
  those variables to `0` in `.env` first. Re-running `install.sh` keeps your existing
  `.env` and does not add them for you. The tool audit log is the exception: nothing
  is deleted from it until you set a window.
- **Webhooks and variables saved before July 2026 stay plaintext until you encrypt
  them.** Upgrading doesn't do it for you. The worker logs a warning at boot if any
  remain, and
  [Encrypting values saved before encryption at rest](ENVIRONMENT_VARIABLES.md#encrypting-values-saved-before-encryption-at-rest)
  has the command.
- **Since November 2026, container jobs need Docker's attach endpoint.** A job's script
  reaches its container on stdin, so the orchestrator calls
  `POST /containers/{id}/attach` before it starts any container job, however short the
  script. The compose files here mount the Docker socket directly, so this only matters
  if your orchestrator goes through a Docker socket proxy. In that case, before you
  upgrade, allow that route and let the connection upgrade through. Otherwise every
  container job fails at once with
  `failed to attach to container: unable to upgrade to tcp, received 403`, with whatever
  status your proxy answers, and its container is never started. Remote jobs don't use
  this endpoint.
- The orchestrator's signing key persists in `orchestrator-data`, so remote
  runners keep working across upgrades.

Both compose files give `cronium-app` 20 seconds to stop and `cronium-worker` 40, so
requests and jobs can finish and the last tool audit log entries can be written. If you
run the images another way, allow them the same: a process killed sooner loses the
entries it hadn't written.

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

## Data Retention

The `cronium-worker` service deletes old run history so the database does not
grow without limit. It runs when the worker starts and every six hours. Each kind
of data has its own window, set in `.env`; restart the worker to apply a change.

| Variable                                 | Default (days)   | What it deletes                                                                       |
| ---------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `CRONIUM_LOG_RETENTION_DAYS`             | 90               | Run logs (`logs`), the history shown on the Logs page                                 |
| `CRONIUM_WORKFLOW_RETENTION_DAYS`        | 90               | Finished workflow runs, their per-step rows, and workflow log lines (`workflow_logs`) |
| `CRONIUM_INCIDENT_RETENTION_DAYS`        | 90               | Schedule incidents (missed or skipped runs)                                           |
| `CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS` | 90               | Tool action logs                                                                      |
| `CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS`  | 0 (keep forever) | Tool audit log (`tool_audit_logs`): who changed or used a tool credential             |
| `CRONIUM_JOB_RETENTION_DAYS`             | 30               | Finished job queue rows, with their executions and transitions                        |
| `CRONIUM_WEBHOOK_RETENTION_DAYS`         | 30               | Webhook deliveries, events and logs                                                   |

- **`0` keeps that data forever.** A value that isn't a number of days up to 36500
  is ignored with a warning in the worker's log, and that data is kept until it is
  fixed.
- **Only finished work is deleted.** A job that is still active keeps its logs, and
  a workflow run in progress keeps its run and step rows, however old they are.
  Definitions (events, workflows, servers, webhooks, tool credentials) are never
  touched. Workflow log lines aren't tied to a run, so each one ages from when it
  was written.
- **The tool audit log is kept until you set a window.** It is a security record,
  not run output: it holds who changed or used a tool credential, with the IP address
  and user agent for changes. Deleting that is your decision, so it keeps growing, by
  about 150 bytes a row, until you set `CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS`. The
  tool action window doesn't affect it, and quotas don't read it.
- **Deleting audit rows leaves a record.** Each batch the worker deletes writes a row
  to the same table, in the same transaction, with `action` set to `retention.purge`
  and `user_id` to `system:retention`. Its `action_details` holds the window, the
  cutoff, how many rows went, and their lowest and highest ids, so missing rows can
  be told apart from tampering after the worker's logs are gone. These rows are never
  purged.
- **Logs outlive their jobs.** Deleting a job row only detaches its log, so logs
  stay on their own longer window.
- **Keep the log and tool action windows at 31 days or more if you use quotas.**
  Monthly quotas count rows in those two tables, so a shorter window makes usage
  read low.

The worker logs the windows in effect when it starts, and what it deleted on each
pass. It deletes in small batches, and when a pass stops at its per-table cap it
returns a minute later rather than six hours later, so a large backlog clears
gradually without holding long locks.

Postgres reuses the freed space for new rows rather than returning it to the
operating system, so the database stops growing but doesn't shrink. To shrink it
after a large first purge, run `VACUUM FULL` in a quiet period. It locks each table
while rewriting it and needs enough free disk for a copy.

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

**Port already in use** — set `APP_PORT` or the loopback `SOCKET_PORT` in
`.env`.

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
- Behind a TLS proxy, set `TRUSTED_PROXY_HOPS=1` (one per trusted proxy). At the
  default of `0` forwarding headers are ignored, so every client shares one login
  rate-limit bucket and webhook IP allowlists can never match.
- Keep port 5002 loopback-only and proxy only `/api/socketio`; never expose the
  `/broadcast/*` internal routes.
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
enforced by `.github/workflows/migrations-check.yml`). A data change or a
trigger goes in its own file from `db:generate --custom`, starting with
`-- cronium:custom-migration`: a database from the old `drizzle-kit push` flow
stamps a migration without that line and never runs it. A test,
`migration-legacy-marker.test.ts`, enforces this.
