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

| Variable                   | Description                                                                                                                         | Type                    | Required | Example                                 | Service |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- | --------------------------------------- | ------- |
| `AUTH_URL`                 | NextAuth base URL                                                                                                                   | `string` (URL)          | Yes      | `http://localhost:3000`                 | 📱      |
| `AUTH_SECRET`              | NextAuth encryption secret                                                                                                          | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32` | 📱      |
| `ENCRYPTION_KEY`           | Data encryption key                                                                                                                 | `string` (32 chars)     | Yes      | Generate with `openssl rand -hex 32`    | 📱      |
| `JWT_SECRET`               | JWT signing secret                                                                                                                  | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32` |
| `CRONIUM_ORCHESTRATOR_KEY` | Orchestrator service-identity credential — the app verifies it on the orchestrator-facing routes (claim, heartbeat, health/metrics) | `string`                | Yes      | Generate with `openssl rand -base64 32` |
| `SOCKET_BROADCAST_KEY`     | Authenticates internal broadcasts from the app/worker to the socket server                                                          | `string`                | Yes      | Generate with `openssl rand -base64 32` |

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

| Variable             | Description                                                                                                                                                                                                                                                                                                                                       | Type           | Default                    | Required | Service |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------- | -------- | ------- |
| `ORCHESTRATOR_URL`   | Orchestrator service URL                                                                                                                                                                                                                                                                                                                          | `string` (URL) | `http://orchestrator:8080` | Yes      | 📱      |
| `VALKEY_URL`         | Valkey/Redis connection URL (for caching static resources, sessions, and rate limiting). With a password-protected Valkey, embed it: `valkey://:PASSWORD@valkey:6379`                                                                                                                                                                             | `string` (URL) | `valkey://valkey:6379`     | Yes      | 📱 🎯   |
| `VALKEY_PASSWORD`    | Valkey `requirepass`. Required by the production compose files (they run `valkey-server --requirepass` and every service authenticates). The orchestrator passes it to per-job runtime sidecars (`CRONIUM_CONTAINER_RUNTIME_VALKEY_PASSWORD`) and the runtime reads it directly (`RUNTIME_VALKEY_PASSWORD`). Generate with `openssl rand -hex 24` | `string`       | _(empty)_                  | Compose  | 🎯 🐳   |
| `BACKEND_URL`        | Backend service URL (for orchestrator)                                                                                                                                                                                                                                                                                                            | `string` (URL) | `http://cronium-app:3000`  | Yes      | 🎯      |
| `TRUSTED_PROXY_HOPS` | Number of trusted reverse-proxy hops in front of the app. Controls how the client IP is derived from `X-Forwarded-For` for rate limiting and IP checks. `0` (default) ignores forwarding headers; set to `1` behind a single TLS proxy.                                                                                                           | `number`       | `0`                        | No       | 📱      |

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

| Variable         | Description                    | Type     | Default | Required |
| ---------------- | ------------------------------ | -------- | ------- | -------- |
| `OPENAI_API_KEY` | OpenAI API key for AI features | `string` | -       | No       |

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

| Variable   | Description           | Type     | Default | Required |
| ---------- | --------------------- | -------- | ------- | -------- |
| `APP_PORT` | Application HTTP port | `number` | `5001`  | No       |

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

| Variable                      | Description                                        | Type     | Default             | Required |
| ----------------------------- | -------------------------------------------------- | -------- | ------------------- | -------- |
| `WORKER_ID`                   | Stable worker identity (leases, audit actor)       | `string` | `worker-<hostname>` | No       |
| `WORKER_HEALTH_PORT`          | HTTP health endpoint port (container healthcheck)  | `number` | `5003`              | No       |
| `WORKER_DISPATCH_INTERVAL_MS` | Schedule dispatcher tick interval                  | `number` | `5000`              | No       |
| `WORKER_CLAIM_INTERVAL_MS`    | In-process job claim interval                      | `number` | `2000`              | No       |
| `WORKER_MAX_CONCURRENT`       | Max concurrent in-process (tool/HTTP) executions   | `number` | `10`                | No       |
| `CRONIUM_JOB_RETENTION_DAYS`  | Days before terminal job queue records are deleted | `number` | `30`                | No       |

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
