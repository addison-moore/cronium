# Environment Variables Documentation

This document provides comprehensive documentation for all environment variables used by the Cronium application and its services.

## Service Architecture

Cronium consists of multiple services:

- **Next.js Application** (`cronium-app`) - The main web application
- **Orchestrator Service** (`cronium-orchestrator`) - Handles job execution in containers
- **Runtime Service** - Provides runtime API for executing containers
- **WebSocket Server** - Real-time communication service
- **Valkey/Redis** - Caching and job queue service

Variables are marked with service indicators:

- 📱 = Next.js Application
- 🎯 = Orchestrator Service
- 🏃 = Runtime Service
- 🔌 = WebSocket Server
- 💾 = Valkey/Redis

## Table of Contents

- [Required Variables](#required-variables)
  - [Core Application](#core-application)
  - [Authentication & Security](#authentication--security)
  - [Database](#database)
  - [Service Communication](#service-communication)
- [Optional Variables](#optional-variables)
  - [Email Configuration](#email-configuration)
  - [AI Integration](#ai-integration)
  - [Marketing Site (apps/cronium-info)](#marketing-site-appscronium-info)
  - [Docker Registry](#docker-registry)
- [Service-Specific Configuration](#service-specific-configuration)
  - [Main Application (cronium-app)](#main-application-cronium-app)
  - [WebSocket Server](#websocket-server)
  - [Orchestrator Service (cronium-orchestrator)](#orchestrator-service-cronium-orchestrator)
  - [Valkey/Redis](#valkeyredis)
- [Development Variables](#development-variables)
- [Future Container Execution Variables](#future-container-execution-variables)
- [Environment Variable Best Practices](#environment-variable-best-practices)
- [Example Configurations](#example-configurations)

## Required Variables

These environment variables must be set for the application to function correctly.

### Core Application

| Variable         | Description                   | Type           | Default      | Example                             | Service  |
| ---------------- | ----------------------------- | -------------- | ------------ | ----------------------------------- | -------- |
| `NODE_ENV`       | Node.js environment           | `string`       | `production` | `development`, `test`, `production` | 📱 🎯 🏃 |
| `PUBLIC_APP_URL` | Public URL of the application | `string` (URL) | -            | `http://localhost:3000`             | 📱       |
| `BUILD_VERSION`  | Docker image version tag      | `string`       | `latest`     | `1.2.3`                             | 📱 🎯    |
| `LOG_LEVEL`      | Logging level                 | `string`       | `info`       | `debug`, `info`, `warn`, `error`    | 📱 🎯 🏃 |

**Notes:**

- `PUBLIC_APP_URL` is used for client-side components, webhook URLs, and OAuth callbacks
- Must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser

### Authentication & Security

| Variable                   | Description                                                                                                                                                                                                    | Type                    | Required | Example                                 | Service |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- | --------------------------------------- | ------- |
| `AUTH_URL`                 | NextAuth base URL                                                                                                                                                                                              | `string` (URL)          | Yes      | `http://localhost:3000`                 | 📱      |
| `AUTH_SECRET`              | NextAuth encryption secret                                                                                                                                                                                     | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32` | 📱      |
| `ENCRYPTION_KEY`           | Data encryption key (active). Encrypts every secret at rest via the versioned vault + tool-credential scheme                                                                                                   | `string` (64 hex)       | Yes      | Generate with `openssl rand -hex 32`    | 📱      |
| `ENCRYPTION_KEYS_RETIRED`  | JSON array of former `ENCRYPTION_KEY` values kept during a key rotation so secrets under them decrypt and job tokens verify. Empty/unset otherwise. The app won't start if it's malformed. See "Key rotation". | `string` (JSON array)   | No       | e.g. `["<old-hex-key>"]`                | 📱      |
| `JWT_SECRET`               | JWT signing secret                                                                                                                                                                                             | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32` |
| `CRONIUM_ORCHESTRATOR_KEY` | Orchestrator service-identity credential — the app verifies it on the orchestrator-facing routes (claim, heartbeat, health/metrics)                                                                            | `string`                | Yes      | Generate with `openssl rand -base64 32` |
| `SOCKET_BROADCAST_KEY`     | Authenticates internal broadcasts from the app/worker to the socket server                                                                                                                                     | `string`                | Yes      | Generate with `openssl rand -base64 32` |

**Notes:**

- Never commit secrets to version control
- Use strong, randomly generated secrets
- Auth variables use the `AUTH_*` prefix. The legacy `NEXTAUTH_*` names are no
  longer read by the app and can be removed from existing `.env` files.

### Database

| Variable                   | Description                  | Type     | Default   | Required | Service |
| -------------------------- | ---------------------------- | -------- | --------- | -------- | ------- |
| `DATABASE_URL`             | PostgreSQL connection string | `string` | -         | Yes      | 📱 🎯   |
| `POSTGRES_USER`            | PostgreSQL username          | `string` | `cronium` | No       | 📱 🎯   |
| `POSTGRES_PASSWORD`        | PostgreSQL password          | `string` | `cronium` | Yes      | 📱 🎯   |
| `POSTGRES_DB`              | PostgreSQL database name     | `string` | `cronium` | No       | 📱 🎯   |
| `POSTGRES_PORT`            | PostgreSQL port              | `string` | `5432`    | No       | 📱 🎯   |
| `POSTGRES_MAX_CONNECTIONS` | Max database connections     | `number` | `100`     | No       | 📱 🎯   |
| `DB_SSL_MODE`              | SSL mode                     | `string` | `disable` | No       | 📱 🎯   |

**Example DATABASE_URL:**

```
postgresql://user:password@localhost:5432/cronium?sslmode=require
```

**Notes:**

- For Neon database, include `?sslmode=require`
- SSL modes: `disable`, `require`, `verify-full`

### Service Communication

| Variable             | Description                                                                                                                                                                                                                                                                                                                                                    | Type           | Default                    | Required | Service |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------- | -------- | ------- |
| `ORCHESTRATOR_URL`   | Orchestrator service URL                                                                                                                                                                                                                                                                                                                                       | `string` (URL) | `http://orchestrator:8080` | Yes      | 📱      |
| `VALKEY_URL`         | Valkey/Redis connection URL (for caching static resources, sessions, and rate limiting). With a password-protected Valkey, embed it: `valkey://:PASSWORD@valkey:6379`                                                                                                                                                                                          | `string` (URL) | `valkey://valkey:6379`     | Yes      | 📱 🎯   |
| `VALKEY_PASSWORD`    | Valkey `requirepass`. Required by the production compose files (they run `valkey-server --requirepass` and every service authenticates). The orchestrator passes it to per-job runtime sidecars (`CRONIUM_CONTAINER_RUNTIME_VALKEY_PASSWORD`) and the runtime reads it directly (`RUNTIME_VALKEY_PASSWORD`). Generate with `openssl rand -hex 24`              | `string`       | _(empty)_                  | Compose  | 🎯 🐳   |
| `BACKEND_URL`        | Backend service URL (for orchestrator)                                                                                                                                                                                                                                                                                                                         | `string` (URL) | `http://cronium-app:3000`  | Yes      | 🎯      |
| `TRUSTED_PROXY_HOPS` | Number of trusted reverse-proxy hops in front of the app. Controls how the client IP is derived from `X-Forwarded-For` for rate limiting and IP checks. `0` (default) ignores forwarding headers, including `X-Real-IP`, so all clients share one login rate-limit bucket and webhook IP allowlists cannot be satisfied; set to `1` behind a single TLS proxy. | `number`       | `0`                        | No       | 📱      |

## Optional Variables

### Bootstrap Seeding (opt-in)

| Variable               | Description                                                                                                                                                                                                                                                                                                                                                                                                | Type              | Default             | Required |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------- | -------- |
| `AUTO_SEED_ADMIN`      | When `true`, seeds an admin user and default settings on first boot                                                                                                                                                                                                                                                                                                                                        | `bool`            | `false`             | No       |
| `ADMIN_USERNAME`       | Admin username for bootstrap                                                                                                                                                                                                                                                                                                                                                                               | `string`          | `admin`             | No       |
| `ADMIN_EMAIL`          | Admin email for bootstrap                                                                                                                                                                                                                                                                                                                                                                                  | `string`          | `admin@example.com` | No       |
| `ADMIN_PASSWORD`       | Admin password for bootstrap                                                                                                                                                                                                                                                                                                                                                                               | `string`          | `admin`             | No       |
| `BOOTSTRAP_TOKEN_HASH` | SHA-256 hex hash of the one-time first-admin **setup token**. When set, the browser first-admin flow requires the matching plaintext token (shown once by `install.sh`), so a random visitor can't claim the admin account. Generated automatically by the installer; set it manually for hand-rolled production deploys (`printf '%s' "$TOKEN" \| sha256sum`). Absent in dev, where setup needs no token. | `string` (64 hex) | –                   | No       |

### Email Configuration

| Variable          | Description          | Type     | Default                 | Required |
| ----------------- | -------------------- | -------- | ----------------------- | -------- |
| `SMTP_HOST`       | SMTP server hostname | `string` | -                       | No       |
| `SMTP_PORT`       | SMTP server port     | `string` | `587`                   | No       |
| `SMTP_USER`       | SMTP username        | `string` | -                       | No       |
| `SMTP_PASSWORD`   | SMTP password        | `string` | -                       | No       |
| `SMTP_FROM_EMAIL` | Default sender email | `string` | `noreply@cronium.local` | No       |

> Email is automatically enabled whenever valid SMTP credentials exist. If any of the above values are missing, Cronium will warn the user when an email action (e.g. password reset) is triggered.

**Example configurations:**

- Gmail: Port `465` (SSL) or `587` (TLS), use app-specific password
- SendGrid: Port `587`, username `apikey`, password is your API key

### AI Integration

| Variable                        | Description                                                                                                                                                                                                                                | Type     | Default | Required |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------- | -------- |
| `OPENAI_API_KEY`                | OpenAI API key for AI features                                                                                                                                                                                                             | `string` | -       | No       |
| `CRONIUM_AI_ALLOW_PRIVATE_URLS` | Let users' AI connections point at private addresses, such as a LAN Ollama or vLLM. Off by default, because any user with an AI connection can then reach the server's internal network. Endpoints an administrator configures are exempt. | `bool`   | `false` | No       |

### Marketing Site (`apps/cronium-info`)

These only affect the public marketing/docs site, not the Cronium app. Both are
inlined at build time, so they must be present when the site is built — and
declared in `turbo.json`'s `globalEnv`, or Turborepo strips them from the build
environment.

| Variable               | Description                                                                             | Type     | Default               | Required |
| ---------------------- | --------------------------------------------------------------------------------------- | -------- | --------------------- | -------- |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin used for canonical URLs, the sitemap, OpenGraph tags, and JSON-LD       | `string` | `https://cronium.app` | No       |
| `NEXT_PUBLIC_GA_ID`    | Google Analytics 4 measurement ID. Set to an empty string to disable analytics entirely | `string` | `G-K5J8YTQYPN`        | No       |

Analytics render only in production builds, so `pnpm dev` never sends events.

### OAuth Tool Integrations (optional)

OAuth apps used by tool integrations (currently Google Sheets). Register the
redirect URI `{AUTH_URL}/api/oauth/callback` with the provider. Users then
click "Connect" on the tool's credential card to authorize their account.

| Variable                        | Description                                    | Type     | Default | Required |
| ------------------------------- | ---------------------------------------------- | -------- | ------- | -------- |
| `OAUTH_GOOGLE_CLIENT_ID`        | Google OAuth client ID (Google Sheets)         | `string` | -       | No       |
| `OAUTH_GOOGLE_CLIENT_SECRET`    | Google OAuth client secret                     | `string` | -       | No       |
| `OAUTH_MICROSOFT_CLIENT_ID`     | Microsoft OAuth client ID                      | `string` | -       | No       |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft OAuth client secret                  | `string` | -       | No       |
| `OAUTH_MICROSOFT_TENANT_ID`     | Microsoft tenant ID (defaults to multi-tenant) | `string` | -       | No       |
| `OAUTH_SLACK_CLIENT_ID`         | Slack OAuth client ID                          | `string` | -       | No       |
| `OAUTH_SLACK_CLIENT_SECRET`     | Slack OAuth client secret                      | `string` | -       | No       |

### Docker Registry

| Variable          | Description                 | Type           | Default | Required |
| ----------------- | --------------------------- | -------------- | ------- | -------- |
| `DOCKER_REGISTRY` | Private Docker registry URL | `string` (URL) | -       | No       |
| `DOCKER_USERNAME` | Docker registry username    | `string`       | -       | No       |
| `DOCKER_PASSWORD` | Docker registry password    | `string`       | -       | No       |

## Service-Specific Configuration

### Main Application (cronium-app)

| Variable                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                   | Type      | Default      | Required |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------ | -------- |
| `APP_PORT`                    | Application HTTP port                                                                                                                                                                                                                                                                                                                                                                                                                         | `number`  | `5001`       | No       |
| `CRONIUM_SSH_HOST_KEY_POLICY` | Host-key verification for the app's direct SSH connections (web terminal, server health checks). `accept-new`: record an unknown server's key on first connect (Trust-On-First-Use) and reject a later changed key; `strict`: also reject unknown hosts; `insecure`: skip verification (logs a loud warning). A changed key fails the connection closed. Reset trust by clearing `ssh_host_key` on the server record or re-adding the server. | `string`  | `accept-new` | No       |
| `CRONIUM_SSH_DEBUG`           | When set, logs ssh2 auth-protocol debug lines for app SSH connections. Off by default (auth-line logging is noisy and can leak protocol detail).                                                                                                                                                                                                                                                                                              | `boolean` | `false`      | No       |

The app records each server's trusted host key fingerprint (`SHA256:…`) on the
`servers.ssh_host_key` column. This is the app-side counterpart to the
orchestrator's `CRONIUM_SSH_SECURITY_HOST_KEY_POLICY` (which uses a shared
`known_hosts` file). First connect to a new server is silent under the default
`accept-new`; a mismatch on a later connect fails closed as a possible MITM.

### WebSocket Server

| Variable                  | Description                                                                                      | Type                   | Default                      | Required |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------- | -------- |
| `SOCKET_PORT`             | Host loopback port used by a reverse proxy to reach the WebSocket server                         | `number`               | `5002`                       | No       |
| `NEXT_PUBLIC_SOCKET_PORT` | Client-side WebSocket port                                                                       | `number`               | `5002`                       | No       |
| `NEXT_PUBLIC_SOCKET_URL`  | Browser-reachable URL whose `/api/socketio` path reaches the socket server                       | `string` (URL)         | `http://localhost:5002`      | No       |
| `SOCKET_ALLOWED_ORIGINS`  | Comma-separated exact browser origins allowed to open sockets; scheme, host, and port must match | `string` (origin list) | `PUBLIC_APP_URL`, `AUTH_URL` | No       |
| `SOCKET_INTERNAL_URL`     | Service-only base URL used by the worker for authenticated socket broadcasts                     | `string` (URL)         | `http://localhost:5002`      | No       |

Every terminal and live-log connection requires a 30-second,
audience-specific ticket issued to an authenticated user. A ticket is
consumed atomically in shared Valkey across all socket replicas. The socket
server rechecks that the user is active; terminal tickets also require console
permission. Authorization changes publish shared revocations, and connected
principals are periodically revalidated. Origin allowlisting is an additional
browser boundary, not a replacement for this authentication. Originless
requests and origins outside the exact allowlist are rejected.

For public deployments, terminate TLS at a reverse proxy and route only
`/api/socketio` to `127.0.0.1:5002` (or `cronium-app:5002` from a proxy on the
Docker network). Compose binds host port 5002 to loopback. Never expose
`/broadcast/*`; internal broadcast producers authenticate those routes with
`Authorization: Bearer $SOCKET_BROADCAST_KEY`. Never place that key in browser
code or proxy configuration sent to clients.

### Scheduling Worker (cronium-worker)

The worker is a separate process/service using the app image (entrypoint
`scripts/start-worker.sh`; dev: `pnpm dev:worker`). It hosts the schedule
dispatcher, the in-process executor pool for tool-action/HTTP jobs, the lease
sweeper, and retention. All values have sensible defaults.

| Variable                                 | Description                                                                        | Type     | Default             | Required |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ------------------- | -------- |
| `WORKER_ID`                              | Stable worker identity (leases, audit actor)                                       | `string` | `worker-<hostname>` | No       |
| `WORKER_HEALTH_PORT`                     | HTTP health endpoint port (container healthcheck)                                  | `number` | `5003`              | No       |
| `WORKER_DISPATCH_INTERVAL_MS`            | Schedule dispatcher tick interval                                                  | `number` | `5000`              | No       |
| `WORKER_CLAIM_INTERVAL_MS`               | In-process job claim interval                                                      | `number` | `2000`              | No       |
| `WORKER_MAX_CONCURRENT`                  | Max concurrent in-process (tool/HTTP) executions                                   | `number` | `10`                | No       |
| `CRONIUM_JOB_RETENTION_DAYS`             | Days to keep finished jobs, with their executions and transitions. Their logs stay | `number` | `30`                | No       |
| `CRONIUM_LOG_RETENTION_DAYS`             | Days to keep run logs                                                              | `number` | `90`                | No       |
| `CRONIUM_WORKFLOW_RETENTION_DAYS`        | Days to keep finished workflow runs, their step rows and workflow log lines        | `number` | `90`                | No       |
| `CRONIUM_INCIDENT_RETENTION_DAYS`        | Days to keep schedule incidents                                                    | `number` | `90`                | No       |
| `CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS` | Days to keep tool action logs                                                      | `number` | `90`                | No       |
| `CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS`  | Days to keep the tool audit log, the record of who changed or used a credential    | `number` | `0` (keep forever)  | No       |
| `CRONIUM_WEBHOOK_RETENTION_DAYS`         | Days to keep webhook deliveries, events and logs                                   | `number` | `30`                | No       |

For the `*_RETENTION_DAYS` variables, `0` keeps that data forever. An unset or
empty variable uses the default. Any other value that isn't a number of days up
to 36500 is ignored with a warning in the worker's log, and that data is kept
until it is fixed. See [Data Retention](./DEPLOYMENT.md#data-retention).

### Orchestrator Service (cronium-orchestrator)

#### Orchestrator-Only Variables

These variables are only used by the orchestrator service and should NOT be included in env.mjs:

| Variable                   | Description                                                                                    | Type                | Default                                 | Required |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------- | -------- |
| `CONFIG_FILE`              | Configuration file path                                                                        | `string`            | `/app/config/cronium-orchestrator.yaml` | Yes      |
| `ORCHESTRATOR_ID`          | Unique orchestrator identifier                                                                 | `string`            | `prod-orchestrator-01`                  | Yes      |
| `MAX_CONCURRENT_JOBS`      | Maximum concurrent job executions                                                              | `number`            | `10`                                    | No       |
| `JOB_POLL_INTERVAL`        | Job queue polling interval                                                                     | `string`            | `5s`                                    | No       |
| `DOCKER_HOST`              | Docker daemon socket                                                                           | `string`            | `unix:///var/run/docker.sock`           | Yes      |
| `JWT_SECRET`               | JWT secret for container auth                                                                  | `string` (32 chars) | -                                       | Yes      |
| `CRONIUM_ORCHESTRATOR_KEY` | Orchestrator service-identity credential (app verifies it on claim, heartbeat, health/metrics) | `string`            | -                                       | Yes      |

Keep `ORCHESTRATOR_ID` the same across restarts, because job leases and containers belong
to it. Jobs running when it changes are failed or re-queued when their leases run out, and
their containers stay until removed by hand.

`docker-compose.example.yml` gives the orchestrator and `cronium-runtime` only the
variables it lists, not all of `.env`, so changing something only the app reads doesn't
recreate them. The orchestrator's common tuning settings are listed there by name and
are read from `.env` as usual. To set one that isn't listed, add its name to that
service's `environment` the same way.

#### Timeout Configuration

| Variable                        | Description                         | Type     | Default | Required |
| ------------------------------- | ----------------------------------- | -------- | ------- | -------- |
| `CRONIUM_SETUP_TIMEOUT`         | Setup phase timeout (seconds)       | `number` | `300`   | No       |
| `CRONIUM_CLEANUP_TIMEOUT`       | Cleanup phase timeout (seconds)     | `number` | `60`    | No       |
| `CRONIUM_MAX_EXECUTION_TIMEOUT` | Maximum execution timeout (seconds) | `number` | `86400` | No       |

#### SSH Security

| Variable                                        | Description                                                                                                                                                      | Type     | Default                         | Required |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------- | -------- |
| `CRONIUM_SSH_SECURITY_HOST_KEY_POLICY`          | Host key verification policy: `accept-new` (record unknown hosts on first connect, reject changed keys), `strict` (reject unknown hosts), `insecure` (no checks) | `string` | `accept-new`                    | No       |
| `CRONIUM_SSH_SECURITY_KNOWN_HOSTS_FILE`         | Path to the known_hosts file used for host key verification                                                                                                      | `string` | `/app/data/known_hosts`         | No       |
| `CRONIUM_SSH_SECURITY_STRICT_HOST_KEY_CHECKING` | Legacy switch; setting `false` disables host key verification entirely (same as `insecure` policy)                                                               | `bool`   | `true`                          | No       |
| `CRONIUM_SSH_SECURITY_PAYLOAD_SIGNING_KEY_FILE` | Path to the Ed25519 payload signing key (auto-generated on first boot if missing)                                                                                | `string` | `/app/data/payload_signing.key` | No       |
| `CRONIUM_SSH_EXECUTION_ISOLATION_MODE`          | Remote execution gate: `disabled` or `operator-enforced` after external per-job UID/container isolation is verified                                              | `string` | `disabled`                      | No       |

`operator-enforced` is an explicit operational attestation, not an isolation
mechanism implemented by Cronium. Never enable it for a normal shared SSH
account. Without it, SSH jobs fail closed with `SSH_ISOLATION_REQUIRED`.

**Note:** The orchestrator expects environment variables with `CRONIUM_` prefix. Docker Compose should map unprefixed variables to prefixed ones (e.g., `CRONIUM_POSTGRES_URL: ${POSTGRES_URL}`).

### Valkey/Redis

| Variable            | Description                                                                                        | Type     | Default | Required |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------- | ------- | -------- |
| `VALKEY_PORT`       | Valkey/Redis port                                                                                  | `number` | `6379`  | No       |
| `VALKEY_MAX_MEMORY` | Maximum memory allocation; `noeviction` is fixed so security-state writes fail closed at the limit | `string` | `256mb` | No       |

**Caching Strategy Note:** As of 2025-07-16, Cronium uses selective caching only for:

- **Static Resources**: Script templates, tool configurations (1 hour TTL)
- **Session Data**: User authentication and permissions (10 minute TTL)
- **Rate Limiting**: API request tracking (1 minute TTL)

All CRUD operations (events, workflows, servers, logs) and real-time data (dashboard stats, monitoring) are NOT cached to ensure data freshness. See `/docs/CACHING_STRATEGY.md` for details.

## Development Variables

| Variable                    | Description                                                                                                                                                                        | Type     | Default                      | Required |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | -------- |
| `SKIP_ENV_VALIDATION`       | Skip environment variable validation                                                                                                                                               | `string` | -                            | No       |
| `CRONIUM_DEV_AUTO_AUTH`     | When `true` **and** `NODE_ENV=development`, auto-authenticates sessionless API requests as the first admin                                                                         | `bool`   | `false`                      | No       |
| `CRONIUM_ENFORCE_ADMIN_MFA` | Require Admin accounts to have TOTP MFA enabled before performing admin operations. Defaults to enforced in production and relaxed in development; set `true`/`false` to override. | `bool`   | (prod: `true`, dev: `false`) | No       |

**Warning:** Only use `SKIP_ENV_VALIDATION` in development. Any non-empty value will skip validation.

**Warning:** `CRONIUM_DEV_AUTO_AUTH` is a development convenience only. It is
ignored outside development mode, and the explicit flag ensures a production
deployment that accidentally sets `NODE_ENV=development` does not expose an
unauthenticated admin API.

## Future Container Execution Variables

These variables are defined for future container execution features (not yet implemented).

| Variable                | Description                                | Type     | Default | Required |
| ----------------------- | ------------------------------------------ | -------- | ------- | -------- |
| `LOCAL_EXEC_CONTAINER`  | Docker container name for script execution | `string` | -       | No       |
| `LOCAL_EXEC_NETWORK`    | Docker network name                        | `string` | -       | No       |
| `EXECUTOR_CPU_LIMIT`    | CPU limit for executor containers          | `string` | -       | No       |
| `EXECUTOR_MEMORY_LIMIT` | Memory limit for executor containers       | `string` | -       | No       |
| `EXECUTOR_TMPFS_SIZE`   | Temporary filesystem size for containers   | `string` | -       | No       |

## Getting Started

### Quick Setup

1. **For Production (docker-compose.yml)**:

   ```bash
   cp .env.example .env
   # Edit .env with your values
   docker-compose up -d
   ```

2. **For Development (docker-compose.dev.yml)**:
   ```bash
   cp .env.dev.example .env.dev
   # Edit .env.dev with your values
   docker-compose -f docker-compose.dev.yml --env-file .env.dev up -d
   ```

## Environment Variable Best Practices

### 1. Security

- Never commit secrets to version control
- Use strong, randomly generated secrets (minimum 32 characters)
- Rotate secrets regularly
- Use different secrets for each environment
- Store production secrets in secure vaults (Vault, AWS Secrets Manager, etc.)

### 2. Configuration Management

- Use `.env` files for local development
- Use environment-specific `.env` files (`.env.production`, `.env.staging`)
- Keep `.env.example` updated with all variables (without actual secrets)
- Client-side variables must be prefixed with `NEXT_PUBLIC_`

### 3. Validation

- The application uses `@t3-oss/env-nextjs` with Zod schemas for validation
- Validation occurs at both build time and runtime
- All required variables are validated on startup
- Provide meaningful error messages for missing variables

### 4. Documentation

- Keep this documentation up to date
- Document any new environment variables
- Include examples in `.env.example`
- Add new variables to `src/env.mjs` with appropriate Zod schema

## Example Configurations

### Development Environment (.env.local)

```bash
# Core
NODE_ENV="development"
PUBLIC_APP_URL="http://localhost:5001"
BUILD_VERSION="dev"
LOG_LEVEL="debug"

# Authentication & Security
AUTH_SECRET="development-secret-key-32-chars-long"
AUTH_URL="http://localhost:5001"
ENCRYPTION_KEY="dev-encryption-key-32-characters"
ENCRYPTION_MASTER_KEY="dev-master-key-exactly-32-chars!"
JWT_SECRET="dev-jwt-secret-32-characters-long"
CRONIUM_ORCHESTRATOR_KEY="dev-orchestrator-key-32-chars-ok"
SOCKET_BROADCAST_KEY="dev-socket-broadcast-key-32-chrs"

# Database
DATABASE_URL="postgresql://cronium:cronium@localhost:5432/cronium_dev"
POSTGRES_USER="cronium"
POSTGRES_PASSWORD="cronium"
POSTGRES_DB="cronium_dev"
DB_SSL_MODE="disable"

# Services
ORCHESTRATOR_URL="http://localhost:8080"
VALKEY_URL="redis://localhost:6379"
BACKEND_URL="http://localhost:5001"

# WebSocket
SOCKET_PORT="5002"
NEXT_PUBLIC_SOCKET_PORT="5002"
NEXT_PUBLIC_SOCKET_URL="http://localhost:5002"
SOCKET_ALLOWED_ORIGINS="http://localhost:5001"

# Email (using Gmail)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"
SMTP_FROM_EMAIL="Cronium Dev <your-email@gmail.com>"

# Optional - AI Features
OPENAI_API_KEY="sk-..."

# Development
SKIP_ENV_VALIDATION=""  # Remove to enable validation
```

### Production Environment (.env.production)

```bash
# Core
NODE_ENV="production"
PUBLIC_APP_URL="https://cronium.yourdomain.com"
BUILD_VERSION="1.2.3"
LOG_LEVEL="info"

# Authentication & Security (generate all of these)
AUTH_SECRET="<generate-with: openssl rand -base64 32>"
AUTH_URL="https://cronium.yourdomain.com"
ENCRYPTION_KEY="<generate-with: openssl rand -hex 16>"
ENCRYPTION_MASTER_KEY="<generate-with: openssl rand -base64 24 | head -c 32>"
JWT_SECRET="<generate-with: openssl rand -base64 32>"
CRONIUM_ORCHESTRATOR_KEY="<generate-with: openssl rand -base64 32>"
SOCKET_BROADCAST_KEY="<generate-with: openssl rand -base64 32>"

# Database
DATABASE_URL="postgresql://user:password@db.neon.tech/cronium?sslmode=require"
POSTGRES_MAX_CONNECTIONS="50"
DB_SSL_MODE="require"

# Services
ORCHESTRATOR_URL="http://cronium-orchestrator:8080"
VALKEY_URL="valkey://valkey:6379"
BACKEND_URL="http://cronium-app:5001"

# WebSocket
SOCKET_PORT="5002"
NEXT_PUBLIC_SOCKET_PORT="443"  # If using reverse proxy
NEXT_PUBLIC_SOCKET_URL="https://cronium.yourdomain.com"
SOCKET_INTERNAL_URL="http://cronium-app:5002"
SOCKET_ALLOWED_ORIGINS="https://cronium.yourdomain.com"

# Email (using SendGrid)
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT="587"
SMTP_USER="apikey"
SMTP_PASSWORD="<sendgrid-api-key>"
SMTP_FROM="Cronium <noreply@yourdomain.com>"

# Orchestrator
CONFIG_FILE="/app/config/cronium-orchestrator.yaml"
ORCHESTRATOR_ID="prod-orchestrator-01"
MAX_CONCURRENT_JOBS="20"
DOCKER_HOST="unix:///var/run/docker.sock"

# Optional - Monitoring
```

### Docker Compose Environment

```bash
# Copy .env.example to .env and update values
cp .env.example .env

# Generate secure secrets
openssl rand -base64 32  # For AUTH_SECRET
openssl rand -hex 16     # For ENCRYPTION_KEY (32 chars)
openssl rand -base64 24 | head -c 32  # For ENCRYPTION_MASTER_KEY
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For CRONIUM_ORCHESTRATOR_KEY
openssl rand -base64 32  # For SOCKET_BROADCAST_KEY
```

## Notes

1. **Validation**: Environment variables are validated using `@t3-oss/env-nextjs` in `src/env.mjs`
2. **Client Variables**: Browser-accessible variables must be prefixed with `NEXT_PUBLIC_`
3. **Consolidation**: Some variables serve similar purposes (e.g., `ENCRYPTION_KEY` and `ENCRYPTION_MASTER_KEY`) and should be consolidated
4. **Containerization**: Container-related variables are prepared for future isolation features
5. **Service Architecture**: The application uses multiple services (app, websocket, orchestrator) that communicate via internal URLs
6. **Proxies**: HTTP request events, outbound webhooks and user-supplied AI endpoints ignore `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` and always connect directly, because a proxy would resolve the target itself and bypass the SSRF guard. These features need direct outbound access from the app and worker.

## Key rotation (`ENCRYPTION_KEY`)

Rotating the data encryption key re-encrypts every at-rest secret onto a new key, along
with the env var copies held by jobs that haven't finished. It needs two restarts of the
two services that use the key, `cronium-app` and `cronium-worker`, so it isn't free of
downtime. See [What stops working](#what-stops-working) below. Between the two restarts
every row stays readable, because both services hold both keys.

**Rotating because the key leaked?** Use [If the old key leaked](#if-the-old-key-leaked)
instead. The steps below keep trusting the old key until step 6.

**Every service must hold both keys before any row moves.** A service reads the keys
when it starts, so changing them anywhere else doesn't reach it until it restarts. A
service still on the old key can't read a row the driver has moved: signed webhooks get
a 500, the variables page and `cronium.getVariable()` fail, tool credentials and env
vars come back empty, and an MFA sign-in is refused as a wrong code. Saving an event in
that state stores its env vars blank, for good. That service also keeps writing with the
old key, so a value saved after the driver's last pass can't be read once the old key is
gone, and one such variable fails its owner's whole variables page. If this has
happened, restart the services with both keys and run the driver again. Everything
except those blanked env vars comes back, as long as you still have the old key.

**Don't export either key in the shell you run Compose from.** Compose prefers the
shell's value over `.env`, so an exported key quietly overrides what you put in `.env`.
Putting the old key back in `.env` then leaves the services on the new key, unable to
read anything, and removing the retired key from `.env` can leave it in place. Loading
`.env` with `set -a` exports them too. Give the driver its keys on its own command, as
below.

The driver is **idempotent and resumable**: it skips values already under the active
key, so a re-run after an interruption simply finishes the remainder, and it updates
each row independently. Decryption is authenticated, so a wrong key/binding fails safely
(recorded as an error, never written) rather than corrupting data.

The steps below use Docker Compose and run the driver inside `cronium-worker`, which
needs no source checkout and can reach the database. With
`infra/docker/docker-compose.yml`, add `-f infra/docker/docker-compose.yml` to each
`docker compose` command, and `--env-file .env` if your `.env` is at the repo root,
because Compose otherwise looks for it next to that file. Without Compose, restart every
process holding the key instead: the app, the socket server and the worker. Run the
driver as `node apps/cronium-app/dist/rotate-secrets.cjs` in the image, or as
`pnpm --filter @cronium/app rotate:secrets` from a source checkout (it needs `tsx`, a
devDependency), with its keys set for that command only. It also needs `DATABASE_URL`,
`AUTH_SECRET`, `AUTH_URL` and `PUBLIC_APP_URL`.

```bash
# Run all of this in one shell with neither key exported.
unset ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED

# 0. While the old key is still the active one, move what's from before the vault. Take
#    a backup first. "Encrypting values saved before encryption at rest" below has a dry
#    run, and what to do with what it reports.
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy

# 1. Back up the database, generate a new key and preview the run. Nothing moves and
#    nothing restarts. The driver gets both keys for this one command, because the
#    worker doesn't hold the new one yet.
NEW=$(openssl rand -hex 32)
docker compose exec -e ENCRYPTION_KEY="$NEW" -e ENCRYPTION_KEYS_RETIRED='["<old-hex-key>"]' \
  cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs --dry-run

# 2. Fix anything in "Before step 3" below. Scripts can keep running through all of
#    this: their job tokens stay valid while the old key is retired.

# 3. Give both services both keys. Change these two lines in .env, keeping the single
#    quotes. This should print "Environment validation passed": the services won't start
#    on a typo in either line, and everything is still running at this point.
#      ENCRYPTION_KEY=<new-hex-key>
#      ENCRYPTION_KEYS_RETIRED='["<old-hex-key>"]'
docker compose run --rm --no-deps cronium-app node apps/cronium-app/scripts/validate-env.cjs

# Restart, and note the time. docker compose restart wouldn't load the new values.
docker compose up -d --no-deps cronium-app cronium-worker
date -u '+%F %T'

# Check that both services hold both keys, then that a variable or a webhook still
# reads. If either fails, nothing has moved yet: roll back, as described below.
docker compose exec cronium-app printenv ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED
docker compose exec cronium-worker printenv ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED

# 4. Move the rows, and the env var copies in jobs that haven't finished. The worker now
#    holds both keys, so it needs none on the command. Re-run until it prints
#    "Total re-encrypted: 0; errors: 0".
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs

# 5. Check that nothing still needs the old key, right before it goes. Scripts started
#    before step 3 hold job tokens only the old key can verify. Wait for this to say 0.
docker compose exec postgres psql -U cronium -d cronium -c \
  "SELECT count(*) FROM jobs WHERE type = 'SCRIPT' AND status IN ('claimed', 'running') AND created_at < '<time from step 3>';"

# A job queued during step 4 can hold a copy of an env var from before that env var
# moved. This has to print "Total to re-encrypt: 0; errors: 0". If it doesn't, go back to
# step 4.
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs --dry-run

# 6. Remove the ENCRYPTION_KEYS_RETIRED line from .env and restart. From here the app
#    no longer trusts the old key, so check it's gone: this should print nothing.
docker compose up -d --no-deps cronium-app cronium-worker
docker compose exec cronium-app printenv ENCRYPTION_KEYS_RETIRED
```

Keep the old key for as long as you keep a backup taken before the rotation. Those
backups can't be read without it.

Finished jobs keep their env var copies under the old key. Nothing decrypts them again,
and they go with the job after `CRONIUM_JOB_RETENTION_DAYS`, 30 by default. If you're
rotating because the old key may have leaked, anyone holding it and a copy of the
database can read them until then. This removes them now, and touches only finished jobs:

```bash
docker compose exec postgres psql -U cronium -d cronium -c \
  "UPDATE jobs SET payload = payload - 'environment' WHERE status NOT IN ('queued', 'claimed', 'running') AND payload ? 'environment';"
```

The driver doesn't overwrite a value saved while it runs, such as a regenerated webhook
secret or a refreshed OAuth token: each write applies only to the row version it read. A
row that changed is left as it was saved, and its values count as `changed-during-run`, not
as re-encrypted or as errors. That run exits non-zero and says so on its total line, because
those values may still be under the old key, so don't take it as the last one.

### Before step 3

- **It warns about values still bound to the key they were saved under.** Those are
  `legacy` values on servers, env vars and MFA secrets. Reads only try the active key, so
  they stop working at step 3: an env var reads back blank. Step 0 moves them, so run it
  again and fix anything it reports. If the key has already changed, it can still open
  them while the old key is in `ENCRYPTION_KEYS_RETIRED`. Its other warning, about
  plaintext values, doesn't matter here: a key change doesn't affect them. Step 0 encrypts
  those too.
- **`errors` isn't 0 in the dry run.** No key in the ring can read those values, so the app
  can't either. Replace each one it names in the app.
- **It warns about sensitive settings.** Older ciphertext is stored outside the vault,
  which is how the bootstrap seed used to store `SMTP_PASSWORD`. After step 3 the app
  can't read it and uses the ciphertext as the value, so an SMTP login fails with only a
  log line to show for it. Step 0 moves these too.
- **It warns about API tokens.** These are from before tokens were hashed. Each is hashed
  the first time it's used. One nobody has used since stops working at step 3, with a
  401, and has to be replaced. Use each one it names once first, or issue a new one. It
  doesn't count revoked or expired tokens.
- **It warns about env var values copied into unfinished jobs.** Each job it names was
  queued with a copy of an env var from before the vault. The driver can't move that copy,
  so the job fails at step 3 with `Could not prepare this job to run`. Let the job finish
  first, or cancel it and run the event again once step 0 has moved its env var. An error
  on `jobs.payload.environment` means a copy no key in the ring can read, and that job
  fails too, so cancel it as well.

### What stops working

- **Each restart in steps 3 and 6 is an outage.** On a Mac, with the published compose
  file and the real image, the app answered nothing for about 3 seconds each time, or
  up to 16 if a request was still in flight, which it waits for, and the worker was down
  for about 12 while it waited for the app to be healthy. Requests in that window fail,
  including webhooks sent to Cronium, so a sender needs to retry. Nothing is dispatched
  until the worker is back. Signed-in users stay signed in. A tool action or HTTP request
  running in the worker gets up to 30 seconds to finish when it stops.
- **A malformed `ENCRYPTION_KEYS_RETIRED` keeps the app and worker down until it's
  fixed,** which is why step 3 checks `.env` before restarting. If one gets through,
  `docker compose up` fails after about 5 seconds with
  `dependency failed to start: container ... is unhealthy`. The app keeps restarting and
  answers nothing, and the worker doesn't start. `docker compose logs cronium-app` says
  what's wrong, without printing the value. Nothing has run on the new key and no row has
  moved, so correct the line and run the command again, or put the two old lines back. A
  list that's well formed but holds the wrong key still starts, which is why step 3 also
  checks that something reads.
- **Nothing stops between the restarts.** About 500 requests to the app all succeeded
  while the driver moved 20,000 rows, so steps 4 and 5 can take as long as they need.
- **A script running at step 3 carries on.** Its job token is signed with the old key,
  which the app keeps accepting while that key is in `ENCRYPTION_KEYS_RETIRED`. Its calls
  wait out the restart: bash scripts writing a variable every second paused for 5 seconds,
  or 16 with a request held in flight, with no failed call, and finished normally.
- **A script still running when the old key goes at step 6 can't finish cleanly, which
  is why step 5 waits.** Its token is one the app no longer accepts, so its
  `cronium.getVariable()` calls and its completion report get a 403 and its result is
  lost. A minute or two later it's marked failed with `Lease expired`, or, if the event
  has retries, it runs again from the start, even if its script had already finished.
  A script started after step 3 has a token signed with the new key, and step 6 doesn't
  affect it.
- **The orchestrator and runtime aren't restarted.** They don't read either key, so a
  plain `docker compose up -d` in steps 3 and 6 recreates the same two services. An older
  `docker-compose.yml`, with `env_file` under `cronium-orchestrator`, still gives them all
  of `.env`. There a plain `up -d` recreates all four, and the commands above leave the
  old key in those two services' environment, where nothing uses it.
- **A job still queued when the old key goes keeps working.** The driver moves the env
  var copies of every job that hasn't finished. If step 5 is skipped, a job holding a
  copy it would have reported fails with `Could not prepare this job to run` when the
  old key goes. Running the event again works.

### Rolling back

To back out before step 6, go through the same steps with the keys swapped, services
first. This also covers a failed check at step 3, because anything saved since that
restart is under the new key, and the driver brings it back.

```bash
# 1. Change these two lines in .env, check them as in step 3, restart, and note the time.
#    Running scripts carry on, because tokens signed with either key still verify.
#      ENCRYPTION_KEY=<old-hex-key>
#      ENCRYPTION_KEYS_RETIRED='["<new-hex-key>"]'
docker compose run --rm --no-deps cronium-app node apps/cronium-app/scripts/validate-env.cjs
docker compose up -d --no-deps cronium-app cronium-worker
date -u '+%F %T'
docker compose exec cronium-app printenv ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED
docker compose exec cronium-worker printenv ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED

# 2. Move the rows back. Re-run until it prints "Total re-encrypted: 0; errors: 0", then
#    wait and check as in step 5, with the time from step 1 here.
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs

# 3. Remove the ENCRYPTION_KEYS_RETIRED line from .env and restart.
docker compose up -d --no-deps cronium-app cronium-worker
```

### If the old key leaked

Whoever holds a key can sign a job token the app accepts, for any job and any user, for
as long as that key is `ENCRYPTION_KEY` or in `ENCRYPTION_KEYS_RETIRED` on a running app,
and `/api/internal` answers on the app's own port. With the right ids, such a token can
read and write a user's variables, change a job's status, run a tool action as a job's
owner, and read a server's address and username. The usual steps would keep that open
until step 6, so here the old key never goes in a running service's list. The app and
worker stay down while the rows move, with nothing to read them:

```bash
# Run all of this in one shell with neither key exported.
unset ENCRYPTION_KEY ENCRYPTION_KEYS_RETIRED

# 1. Run step 0 above, while the old key is still the active one. Then back up the
#    database, generate a new key and preview the run, as in step 1 above, and fix anything
#    in "Before step 3".

# 2. Decide whether to let running scripts finish. A script still running at step 3 loses
#    its result, but waiting leaves the key trusted for that long. To wait: stopping the
#    worker holds back scheduled runs, and gives a tool action or HTTP request running in
#    it up to 30 seconds to finish. Wait for this to say 0.
docker compose stop cronium-worker
docker compose exec postgres psql -U cronium -d cronium -c \
  "SELECT count(*) FROM jobs WHERE type = 'SCRIPT' AND status IN ('queued', 'claimed', 'running');"

# 3. Stop the app and worker. From here nobody's token is accepted, forged or real.
docker compose stop cronium-app cronium-worker

# 4. Move the rows from a one-off worker container, which gets both keys for this one
#    command. Re-run until it prints "Total re-encrypted: 0; errors: 0".
docker compose run --rm --no-deps -e ENCRYPTION_KEY="$NEW" -e ENCRYPTION_KEYS_RETIRED='["<old-hex-key>"]' \
  cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs

# 5. Change these lines in .env and start the services. The printenv should print nothing.
#      ENCRYPTION_KEY=<new-hex-key>
#      ENCRYPTION_KEYS_RETIRED=
docker compose up -d --no-deps cronium-app cronium-worker
docker compose exec cronium-app printenv ENCRYPTION_KEYS_RETIRED

# 6. Finished jobs keep their env var copies under the old key, so anyone holding it and a
#    copy of the database can read them. This removes them, and touches only finished jobs.
docker compose exec postgres psql -U cronium -d cronium -c \
  "UPDATE jobs SET payload = payload - 'environment' WHERE status NOT IN ('queued', 'claimed', 'running') AND payload ? 'environment';"
```

This costs more downtime and some running work:

- **The app answers nothing from step 3 until step 5 finishes.** That's the driver's time
  on top of the restart. On a Mac, with the published compose file and the real image, it
  was about 7 seconds with a few hundred secrets and 12 with 20,000 variables, 6 of them
  the driver's. On a heavily loaded machine the driver alone took 5.5 minutes for those
  rows.
- **A script running at step 3 loses its result,** the same way as one running at step 6
  of the usual steps.
- **A job still queued at step 3 runs normally once the services are back,** because the
  driver moves its env var copies, unless the dry run named it in step 1. See
  [Before step 3](#before-step-3).

Rotating doesn't undo the leak. Anyone with the old key can still read a backup taken
before the rotation, and could use forged tokens until step 3, so replace the passwords,
SSH keys and API credentials your secrets hold too.

An older `docker-compose.yml`, with `env_file` under `cronium-orchestrator`, leaves the old
key in the environment of the orchestrator and runtime, though neither uses it. To clear
it, finish with a plain `docker compose up -d`, which recreates only those two. Running
container jobs carry on through that.

## Encrypting values saved before encryption at rest

Values saved before encryption at rest, or before the record-bound vault, stay as they
were until that exact field is next written: an edit to a webhook's URL leaves its
headers and secret as they are, and an edit to a variable's description leaves its
value.

| Column                                                    | Can still hold              | Afterwards, encrypted with               |
| --------------------------------------------------------- | --------------------------- | ---------------------------------------- |
| `webhooks.secret`, `webhooks.headers`                     | plaintext                   | the vault, bound to the webhook          |
| `user_variables.value`                                    | plaintext                   | the vault, bound to the owner and key    |
| `servers.ssh_key`, `servers.password`                     | older ciphertext, plaintext | the vault, bound to the owner and column |
| `env_vars.value`                                          | older ciphertext, plaintext | the vault, bound to the event and key    |
| `users.mfa_secret`                                        | older ciphertext, plaintext | the vault, bound to the user             |
| Sensitive `system_settings` values                        | older ciphertext, plaintext | the vault, bound to the setting          |
| `tool_credentials.credentials`                            | plaintext                   | the format reads already use, unbound    |
| `oauth_tokens.access_token`, `oauth_tokens.refresh_token` | plaintext                   | the format reads already use, unbound    |

Anyone with a copy of the database can read plaintext. Older ciphertext isn't bound to
its row, so anyone who can write to the database can move it to another row, and a key
change orphans it. The app keeps working either way, so nothing fails to tell you. The
worker logs a warning at boot while such rows exist.

To encrypt them, take a database backup, then:

```bash
# See what would change. Writes nothing.
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy --dry-run

# Encrypt. The app can stay up.
docker compose exec cronium-worker node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy
```

From a source checkout, the same flags go on
`pnpm --filter @cronium/app rotate:secrets`, with the instance's `.env` loaded and
its `DATABASE_URL` reachable from where you run it.

Nothing changes for what reads these values: signatures still use the same secret,
deliveries send the same headers, `cronium.getVariable()` returns the same value, SSH
logs in with the same key, scripts get the same env vars, authenticator apps keep
working, and tools and OAuth connections use the same credentials. The one exception is
older ciphertext under a key in `ENCRYPTION_KEYS_RETIRED`, which the app can't read at all
until this moves it.

The run is safe to repeat and to stop: each row is written once on its own, so a
second run changes nothing and a run after an interruption does what's left. It
doesn't overwrite a value someone changes while it runs.

**It checks the key first.** It stops before writing anything if `ENCRYPTION_KEY`
can't be used, or if the database holds encrypted values and the keys in the ring
can't read any of those it checks. That usually means a restored database next to a
newly generated `.env`. One value that fits is enough for it to go ahead. It looks at:

- Vault values (`crn.1...`) in any column, which name the key they use.
- Encrypted tool credentials and OAuth tokens, up to the 10 newest of each, which it
  decrypts.
- Older ciphertext in server credentials, event environment variables, MFA secrets,
  sensitive system settings and API tokens that haven't been hashed yet, which it also
  decrypts.

Plaintext doesn't count, in either direction. If nothing in the database is encrypted
there is nothing to check the key against, so make sure it's the one the app runs with:
a row encrypted with the wrong key can only be read again by adding that key to
`ENCRYPTION_KEYS_RETIRED` and rotating.

If it refuses, it names the columns it couldn't read, with no values. Use the key the
app runs with. If you're sure that's what you used, a long plaintext made only of
base64 characters looks like older ciphertext, and the app can't read one either. Save
that value again in the app, or create any webhook or variable there, then run this
again. Whatever the app saves uses its own key, so the next run has something to check
against.

It ends with `Legacy rows remaining: N`, and exits non-zero if that isn't 0 or if a
row failed. A failed row is named by id and column, and is left exactly as it was,
including any value in it that could have been encrypted. To fix one, replace the value
in the app: regenerate the webhook secret, save its headers, set the variable or env var
again, save the server's credentials or the tool's, enter the setting again in the admin
settings, connect the OAuth account again, or have the user enrol in MFA again. Then run
this again. The reasons it gives:

- `looks encrypted, but this keyring can't decrypt it for this row`. The app can't read
  this either: the read path treats anything starting with `crn.` as encrypted, so this
  can also be a plaintext value that happens to start that way.
- `has the shape of old ciphertext, but no key in this keyring opens it`. The app takes
  50 or more base64 characters to be older ciphertext, and can't read this either. It's
  ciphertext under a key you no longer have, or a long plaintext made only of those
  characters, and nothing can tell which. If you have the old key, add it to
  `ENCRYPTION_KEYS_RETIRED` and run this again.
- `marked as encrypted, but isn't in the encrypted format`,
  `marked as not encrypted, but holds encrypted data` and
  `not a JSON object of credentials`. A tool credential the app can't use.
- `did not read back unchanged after encrypting`. An OAuth token a read would change once
  encrypted, such as one that's also a JSON number, or anything else that didn't come
  back the same. Nothing was written.

**Values that read as ciphertext.** A line starting `NOTE:` names a value whose reads get
ciphertext instead of what someone saved, and did before this run. A value of 1 to 4 bytes
saved before the vault does this, because its ciphertext is too short for the app to
recognize, and so does a value encrypted twice, because an old edit form was handed
ciphertext and saved it back. So a script expecting `1` has been getting a string of base64.
The run doesn't change what reads return, so a script doesn't start behaving differently
because of it. It encrypts such a value as it reads, and these lines aren't failures and
don't count as remaining. To fix one, set the real value again. The run can't recover it
for you, and nothing can once the key it's under is gone.

**This doesn't erase the old values.** They were on disk for months and are still
there:

- **Table files.** Updated rows leave their old versions behind. A plain `VACUUM`
  clears most but can leave bytes in a page. This rewrites these tables, and blocks
  them while it runs:

  ```bash
  docker compose exec postgres psql -U cronium -d cronium -c "VACUUM FULL webhooks, user_variables, servers, env_vars, users, system_settings, tool_credentials, oauth_tokens;"
  ```

- **WAL.** Recycled by later checkpoints, unless you archive it.
- **Backups and dumps.** Every copy taken before this run still holds the plaintext.
  If any of those copies could have been read by someone who shouldn't have, rotate
  the credentials themselves: regenerate the webhook's secret, replace its custom
  headers at the service that issued them, replace any secret held in a variable or an
  env var, replace the servers' SSH keys and passwords, and reissue tool credentials and
  OAuth tokens. Have users enrol in MFA again if the secret was plaintext.

Rolling back to an image from before July 2026 after this has run doesn't work,
because those versions can't read encrypted values. Restore the backup instead.
