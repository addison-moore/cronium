# Environment Variables Documentation

This document provides comprehensive documentation for all environment variables used by the Cronium application and its services.

## Service Architecture

Cronium consists of multiple services:

- **Next.js Application** (`cronium-app`) - The main web application
- **Orchestrator Service** (`cronium-agent`) - Handles job execution in containers
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
  - [External Monitoring](#external-monitoring)
  - [Docker Registry](#docker-registry)
- [Service-Specific Configuration](#service-specific-configuration)
  - [Main Application (cronium-app)](#main-application-cronium-app)
  - [WebSocket Server](#websocket-server)
  - [Orchestrator Service (cronium-agent)](#orchestrator-service-cronium-agent)
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
| `PUBLIC_APP_URL` | Public URL of the application | `string` (URL) | -            | `http://localhost:5001`             | 📱       |
| `BUILD_VERSION`  | Docker image version tag      | `string`       | `latest`     | `1.2.3`                             | 📱 🎯    |
| `LOG_LEVEL`      | Logging level                 | `string`       | `info`       | `debug`, `info`, `warn`, `error`    | 📱 🎯 🏃 |

**Notes:**

- `PUBLIC_APP_URL` is used for client-side components, webhook URLs, and OAuth callbacks
- Must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser

### Authentication & Security

| Variable                | Description                              | Type                    | Required | Example                                               | Service |
| ----------------------- | ---------------------------------------- | ----------------------- | -------- | ----------------------------------------------------- | ------- |
| `AUTH_URL`              | NextAuth base URL                        | `string` (URL)          | Yes      | `http://localhost:5001`                               | 📱      |
| `AUTH_SECRET`           | NextAuth encryption secret               | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32`               | 📱      |
| `ENCRYPTION_KEY`        | Data encryption key                      | `string` (32 chars)     | Yes      | Generate with `openssl rand -hex 16`                  | 📱      |
| `ENCRYPTION_MASTER_KEY` | Master key for encrypting sensitive data | `string` (32 chars)     | Yes      | Generate with `openssl rand -base64 24 \| head -c 32` |
| `JWT_SECRET`            | JWT signing secret                       | `string` (min 32 chars) | Yes      | Generate with `openssl rand -base64 32`               |
| `INTERNAL_API_KEY`      | Internal service authentication key      | `string`                | Yes      | Generate with `openssl rand -base64 32`               |

**Notes:**

- Never commit secrets to version control
- Use strong, randomly generated secrets
- `ENCRYPTION_KEY` and `ENCRYPTION_MASTER_KEY` serve similar purposes - consolidate in production
- The app is migrating from `NEXTAUTH_*` to `AUTH_*` prefixed variables

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

| Variable           | Description                            | Type           | Default                    | Required | Service |
| ------------------ | -------------------------------------- | -------------- | -------------------------- | -------- | ------- |
| `ORCHESTRATOR_URL` | Orchestrator service URL               | `string` (URL) | `http://orchestrator:8080` | Yes      | 📱      |
| `VALKEY_URL`       | Valkey/Redis connection URL            | `string` (URL) | `valkey://valkey:6379`     | Yes      | 📱 🎯   |
| `BACKEND_URL`      | Backend service URL (for orchestrator) | `string` (URL) | `http://cronium-app:5001`  | Yes      | 🎯      |

## Optional Variables

### Email Configuration

| Variable          | Description          | Type     | Default                 | Required |
| ----------------- | -------------------- | -------- | ----------------------- | -------- |
| `SMTP_HOST`       | SMTP server hostname | `string` | -                       | No       |
| `SMTP_PORT`       | SMTP server port     | `string` | `587`                   | No       |
| `SMTP_USER`       | SMTP username        | `string` | -                       | No       |
| `SMTP_PASSWORD`   | SMTP password        | `string` | -                       | No       |
| `SMTP_FROM_EMAIL` | Default sender email | `string` | `noreply@cronium.local` | No       |

**Example configurations:**

- Gmail: Port `465` (SSL) or `587` (TLS), use app-specific password
- SendGrid: Port `587`, username `apikey`, password is your API key

### AI Integration

| Variable               | Description                    | Type     | Default | Required |
| ---------------------- | ------------------------------ | -------- | ------- | -------- |
| `OPENAI_API_KEY`       | OpenAI API key for AI features | `string` | -       | No       |
| `GEMINI_MODEL`         | Google Gemini model identifier | `string` | -       | No       |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID        | `string` | -       | No       |

### External Monitoring

| Variable         | Description             | Type           | Default | Required |
| ---------------- | ----------------------- | -------------- | ------- | -------- |
| `PROMETHEUS_URL` | External Prometheus URL | `string` (URL) | -       | No       |
| `GRAFANA_URL`    | External Grafana URL    | `string` (URL) | -       | No       |

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

| Variable                  | Description                | Type           | Default                 | Required |
| ------------------------- | -------------------------- | -------------- | ----------------------- | -------- |
| `SOCKET_PORT`             | WebSocket server port      | `number`       | `5002`                  | No       |
| `NEXT_PUBLIC_SOCKET_PORT` | Client-side WebSocket port | `number`       | `5002`                  | No       |
| `NEXT_PUBLIC_SOCKET_URL`  | Client-side WebSocket URL  | `string` (URL) | `http://localhost:5002` | No       |

### Orchestrator Service (cronium-agent)

#### Orchestrator-Only Variables

These variables are only used by the orchestrator service and should NOT be included in env.mjs:

| Variable              | Description                       | Type                | Default                                 | Required |
| --------------------- | --------------------------------- | ------------------- | --------------------------------------- | -------- |
| `CONFIG_FILE`         | Configuration file path           | `string`            | `/app/config/cronium-orchestrator.yaml` | Yes      |
| `ORCHESTRATOR_ID`     | Unique orchestrator identifier    | `string`            | `prod-orchestrator-01`                  | Yes      |
| `MAX_CONCURRENT_JOBS` | Maximum concurrent job executions | `number`            | `10`                                    | No       |
| `JOB_POLL_INTERVAL`   | Job queue polling interval        | `string`            | `5s`                                    | No       |
| `DOCKER_HOST`         | Docker daemon socket              | `string`            | `unix:///var/run/docker.sock`           | Yes      |
| `JWT_SECRET`          | JWT secret for container auth     | `string` (32 chars) | -                                       | Yes      |
| `INTERNAL_API_KEY`    | Internal service auth key         | `string`            | -                                       | Yes      |

**Note:** The orchestrator expects environment variables with `CRONIUM_` prefix. Docker Compose should map unprefixed variables to prefixed ones (e.g., `CRONIUM_POSTGRES_URL: ${POSTGRES_URL}`).

### Valkey/Redis

| Variable            | Description               | Type     | Default | Required |
| ------------------- | ------------------------- | -------- | ------- | -------- |
| `VALKEY_PORT`       | Valkey/Redis port         | `number` | `6379`  | No       |
| `VALKEY_MAX_MEMORY` | Maximum memory allocation | `string` | `256mb` | No       |

## Development Variables

| Variable              | Description                          | Type     | Default | Required |
| --------------------- | ------------------------------------ | -------- | ------- | -------- |
| `SKIP_ENV_VALIDATION` | Skip environment variable validation | `string` | -       | No       |

**Warning:** Only use `SKIP_ENV_VALIDATION` in development. Any non-empty value will skip validation.

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
INTERNAL_API_KEY="dev-internal-api-key-32-chars-ok"

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
INTERNAL_API_KEY="<generate-with: openssl rand -base64 32>"

# Database
DATABASE_URL="postgresql://user:password@db.neon.tech/cronium?sslmode=require"
POSTGRES_MAX_CONNECTIONS="50"
DB_SSL_MODE="require"

# Services
ORCHESTRATOR_URL="http://cronium-agent:8080"
VALKEY_URL="valkey://valkey:6379"
BACKEND_URL="http://cronium-app:5001"

# WebSocket
SOCKET_PORT="5002"
NEXT_PUBLIC_SOCKET_PORT="443"  # If using reverse proxy
NEXT_PUBLIC_SOCKET_URL="wss://cronium.yourdomain.com"

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
PROMETHEUS_URL="http://prometheus:9090"
GRAFANA_URL="http://grafana:3000"
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
openssl rand -base64 32  # For INTERNAL_API_KEY
```

## Notes

1. **Validation**: Environment variables are validated using `@t3-oss/env-nextjs` in `src/env.mjs`
2. **Client Variables**: Browser-accessible variables must be prefixed with `NEXT_PUBLIC_`
3. **Consolidation**: Some variables serve similar purposes (e.g., `ENCRYPTION_KEY` and `ENCRYPTION_MASTER_KEY`) and should be consolidated
4. **Containerization**: Container-related variables are prepared for future isolation features
5. **Service Architecture**: The application uses multiple services (app, websocket, orchestrator) that communicate via internal URLs
