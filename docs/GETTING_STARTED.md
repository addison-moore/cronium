# Getting Started with Cronium Development

This guide will help you set up a minimal development environment for Cronium monorepo and run the development containers.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (version 18.x or higher)
- **PNPM** (version 8.x or higher)
  ```bash
  npm install -g pnpm
  ```
- **Go** (version 1.23 or higher) for Go services
- **Docker Desktop** (version 20.10 or higher)
  - [Download for Mac](https://www.docker.com/products/docker-desktop/)
  - [Download for Windows](https://www.docker.com/products/docker-desktop/)
  - [Download for Linux](https://docs.docker.com/desktop/install/linux-install/)
- **Docker Compose** (usually included with Docker Desktop)
- **Git** for cloning the repository
- **A text editor** (VS Code, Sublime Text, etc.)

### Required System Resources

- At least 4GB of free RAM
- 10GB of free disk space
- Ports 5001, 5002, and 6379 available

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/addison-moore/cronium.git
cd cronium
```

### 2. Install Dependencies

```bash
# Install all dependencies for the monorepo
pnpm install

# Build shared packages
pnpm build --filter @cronium/ui --filter @cronium/config-*
```

### 3. Set Up Your Development Environment

#### Create the development environment file:

```bash
# Copy the environment example into place
cp env/.env.example env/.env.local
```

Both `pnpm dev` and `pnpm dev:docker:up` read `env/.env.local`.

#### Generate secure secrets:

Run these commands to generate secure values for your environment:

```bash
# Generate AUTH_SECRET
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> env/.env.local

# Generate ENCRYPTION_KEY
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> env/.env.local

# Generate INTERNAL_API_KEY
echo "INTERNAL_API_KEY=$(openssl rand -base64 32)" >> env/.env.local

# Generate JWT_SECRET
echo "JWT_SECRET=$(openssl rand -base64 32)" >> env/.env.local
```

### 4. Configure Your Database

The development environment expects an external PostgreSQL database. You have two options:

#### Option A: Use a Local PostgreSQL Instance

If you have PostgreSQL installed locally, update the `DATABASE_URL` in `env/.env.local`:

```bash
DATABASE_URL=postgresql://your_user:your_password@host.docker.internal:5432/cronium_dev
```

Note: `host.docker.internal` allows Docker containers to connect to your host machine.

#### Option B: Use a Cloud PostgreSQL Service

For services like Neon, Supabase, or AWS RDS, use the provided connection string:

```bash
DATABASE_URL=postgresql://user:password@host.neon.tech:5432/cronium_dev?sslmode=require
```

### 5. Configure Optional Services

Edit `env/.env.local` to configure optional services:

```bash
# For email functionality (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
SMTP_FROM_EMAIL=noreply@your-domain.com

# For AI features (optional)
OPENAI_API_KEY=sk-your-openai-api-key
```

### 6. Start the Development Environment

#### Option A: Run Everything Locally (Recommended)

```bash
# Start all services concurrently
pnpm dev
```

This will start:

- Next.js web app on http://localhost:5001
- WebSocket server on ws://localhost:5002
- Orchestrator service on http://localhost:8080
- Runtime service on http://localhost:8081

Also start the scheduling worker in its own terminal — schedules and
tool-action/HTTP jobs do not run without it:

```bash
pnpm dev:worker
```

#### Option B: Run with Docker

```bash
# Build the worker, runtime, orchestrator, and execution images
pnpm dev:docker:build

# Start the Docker development infrastructure
pnpm dev:docker:up
```

This will start:

- **cronium-worker-dev**: Scheduling worker with health endpoint on port 5003
- **cronium-orchestrator-dev**: Orchestrator service with Air (Go hot reloading)
- **cronium-runtime-api-dev**: Runtime API on port 8089
- **cronium-valkey-dev**: Redis-compatible cache/queue service

Run the host processes separately; do not also run `pnpm dev:worker` when the
Docker worker is active:

```bash
pnpm dev:app
pnpm dev:socket
```

The helper reads `env/.env.local` and rewrites a loopback `DATABASE_URL` host
to `host.docker.internal` for the worker container. Hosted database URLs are
passed through unchanged.

### 7. Verify Services are Running

For local development:

- Check terminal output from `pnpm dev`

For Docker:

```bash
docker compose -f infra/docker/docker-compose.dev.local-app.yml ps
```

You should see all services with "Up" status.

### 8. Access the Application

- **Web Application**: http://localhost:5001
- **WebSocket Server**: http://localhost:5002
- **Scheduling Worker Health**: http://localhost:5003/health
- **Orchestrator Health**: http://localhost:8080/health

## Development Workflow

### Monorepo Structure

```
cronium/
├── apps/
│   ├── cronium-app/      # Next.js application
│   ├── cronium-info/     # Marketing/docs site
│   ├── orchestrator/     # Go orchestrator service
│   ├── runtime/          # Go runtime service
│   └── runner/           # Go SSH runner binary
├── packages/
│   ├── ui/               # Shared UI components
│   └── config-*/         # Shared configurations
└── infra/                # Infrastructure files
```

### Hot Reloading

All services support hot reloading:

- **Next.js**: Changes to files in `apps/cronium-app/src` automatically trigger rebuilds
- **Go Services**: Air watches for changes and restarts services automatically

### Viewing Logs

For local development, logs appear in your terminal.

For Docker:

```bash
# View all logs
pnpm dev:docker:logs

# View specific service logs
docker compose -f infra/docker/docker-compose.dev.local-app.yml logs -f cronium-worker
docker compose -f infra/docker/docker-compose.dev.local-app.yml logs -f cronium-orchestrator
```

### Stopping Services

For local development:

- Press `Ctrl+C` in the terminal running `pnpm dev`

For Docker:

```bash
# Stop all services
pnpm dev:docker:down

# Stop and remove volumes (clean slate)
docker compose -f infra/docker/docker-compose.dev.local-app.yml down -v
```

## Common Development Tasks

### Running Database Migrations

```bash
# From project root
cd apps/cronium-app && pnpm db:push

# Or in Docker
docker-compose -f infra/docker/docker-compose.dev.local-app.yml exec cronium-app-dev pnpm db:push
```

### Accessing the Database Studio

```bash
# From project root
cd apps/cronium-app && pnpm db:studio

# Or in Docker
docker-compose -f infra/docker/docker-compose.dev.local-app.yml exec cronium-app-dev pnpm db:studio
```

### Running Tests

```bash
# Run all tests across monorepo
pnpm test

# Run tests for specific app
pnpm test --filter @cronium/app

# Or in Docker
docker-compose -f infra/docker/docker-compose.dev.local-app.yml exec cronium-app-dev pnpm test
```

### Installing New Dependencies

```bash
# Install package to specific app
pnpm add package-name --filter @cronium/app

# Install package to shared UI library
pnpm add package-name --filter @cronium/ui

# Install dev dependency to root
pnpm add -D package-name -w

# Install Go modules
cd apps/orchestrator && go get package-name
```

## Troubleshooting

### Port Already in Use

If you get a "port already allocated" error:

```bash
# Find what's using port 5001
lsof -i :5001  # On Mac/Linux
netstat -ano | findstr :5001  # On Windows

# Kill the process or change the port in env/.env.local
APP_PORT=5003  # Use a different port
```

### Database Connection Issues

1. Verify your database is accessible:

   ```bash
   # Test connection from your host
   psql -h localhost -U your_user -d cronium_dev
   ```

2. For local databases, ensure PostgreSQL is configured to accept connections:
   - Check `postgresql.conf` for `listen_addresses = '*'`
   - Check `pg_hba.conf` for appropriate access rules

### Container Won't Start

1. Check logs for specific errors:

   ```bash
   docker compose -f infra/docker/docker-compose.dev.local-app.yml logs cronium-app-dev
   ```

2. Verify environment variables:

   ```bash
   docker compose -f infra/docker/docker-compose.dev.local-app.yml config
   ```

3. Ensure Docker has enough resources:
   - Docker Desktop → Settings → Resources
   - Allocate at least 4GB RAM

### Hot Reloading Not Working

1. Verify volume mounts are correct:

   ```bash
   docker compose -f infra/docker/docker-compose.dev.local-app.yml exec cronium-app-dev ls -la /app
   ```

2. Check file permissions:
   ```bash
   # Fix permissions if needed
   chmod -R 755 ./src
   chmod -R 755 ./orchestrator
   ```

## Environment Variables Reference

See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) for a complete list of available environment variables.

### Key Development Variables

| Variable           | Purpose                      | Required    |
| ------------------ | ---------------------------- | ----------- |
| `DATABASE_URL`     | PostgreSQL connection string | Yes         |
| `AUTH_SECRET`      | Session encryption           | Yes         |
| `ENCRYPTION_KEY`   | Data encryption              | Yes         |
| `INTERNAL_API_KEY` | Service-to-service auth      | Yes         |
| `JWT_SECRET`       | JWT token signing            | Yes         |
| `NODE_ENV`         | Set to "development"         | Yes         |
| `LOG_LEVEL`        | Set to "debug" for dev       | Recommended |

## Next Steps

1. **Create your first event**: Navigate to http://localhost:5001/dashboard/events
2. **Set up a server**: Add a local or SSH server for running events
3. **Explore the codebase**:
   - `apps/cronium-app/src` - Next.js application code
   - `apps/orchestrator` - Go orchestrator service
   - `apps/runtime` - Go runtime API and per-language helper libraries
   - `docs/` - Additional documentation

## Getting Help

- Check the [troubleshooting guide](#troubleshooting) above
- Review logs for error messages
- Consult the [full documentation](./README.md)
- Open an issue on GitHub

## Additional Resources

- [Documentation Index](./README.md)
- [Execution Flow](./Execution_Flow.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Tool Actions API](./tools/TOOL_ACTIONS_API.md)
- [Security Policy](../SECURITY.md)
