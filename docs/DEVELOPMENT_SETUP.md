# Development Environment Setup

This guide provides step-by-step instructions for setting up the Cronium development environment on a new machine.

## Prerequisites

- Node.js 18+ and PNPM
- Docker and Docker Compose
- Go 1.21+ (for building orchestrator and runtime)
- PostgreSQL database (local or remote)

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/cronium

# Authentication
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=http://localhost:5001

# Encryption
ENCRYPTION_KEY=your-32-byte-encryption-key

# JWT for runtime services
JWT_SECRET=your-jwt-secret

# Internal API communication
INTERNAL_API_KEY=your-internal-api-key

# Orchestrator
ORCHESTRATOR_ID=dev-orchestrator-01

# Optional: External services
VALKEY_URL=redis://localhost:6379
```

## Setup Steps

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build Go Services

Build the orchestrator and runtime binaries:

```bash
pnpm build:go
```

### 3. Build Docker Images

Build all required Docker images including:

- Runtime API (sidecar for containerized execution)
- Execution environments (Bash, Node.js, Python)
- Orchestrator

```bash
pnpm docker:build
```

This command builds and tags:

- `cronium/runtime-api:latest` - Runtime API for helper functions
- `cronium/runner:bash-alpine` - Bash execution environment
- `cronium/runner:node-alpine` - Node.js execution environment
- `cronium/runner:python-alpine` - Python execution environment

### 4. Database Setup

Push the database schema:

```bash
pnpm db:push
```

(Optional) Open Drizzle Studio to view/manage database:

```bash
pnpm db:studio
```

### 5. Start Services

Start the application and Docker services:

```bash
# Terminal 1: Start the Next.js app
pnpm dev:app

# Terminal 2: Start Docker services (Orchestrator, Runtime API, Valkey)
pnpm docker:up
```

The following services will be running:

- **Cronium App**: http://localhost:5001
- **Orchestrator**: http://localhost:8080
- **Runtime API**: http://localhost:8089
- **Valkey (Redis)**: localhost:6379

## Verifying the Setup

### Test Remote Execution

1. Create a server configuration in the UI
2. Create an event with "Remote" execution
3. Execute the event - it should run on the configured server

### Test Containerized Execution

1. Create an event with "Local" execution
2. Choose Bash, Node.js, or Python as the script type
3. Execute the event - it should run in a Docker container

If you see an error about missing images, run:

```bash
# List Cronium images
docker images | grep cronium

# Rebuild if necessary
pnpm docker:build
```

## Common Issues

### "No such image: cronium/runtime-api:latest"

The runtime API image hasn't been built. Run:

```bash
pnpm docker:build
```

### "Cannot connect to Docker daemon"

Ensure Docker Desktop is running and the Docker socket is accessible:

```bash
docker ps
```

### Database connection errors

Verify your DATABASE_URL in `.env.local` and ensure PostgreSQL is running.

## Development Commands

```bash
# Start all services
pnpm dev              # Start everything
pnpm dev:app          # Start only the Next.js app
pnpm docker:up        # Start Docker services

# Building
pnpm build            # Build everything
pnpm build:go         # Build Go services
pnpm docker:build     # Build all Docker images

# Database
pnpm db:push          # Push schema changes
pnpm db:studio        # Open database UI
pnpm db:generate      # Generate migrations

# Docker management
pnpm docker:down      # Stop Docker services
pnpm docker:logs      # View Docker logs

# Testing & Linting
pnpm test             # Run tests
pnpm lint             # Lint code
pnpm typecheck        # Type checking
```

## Architecture Overview

- **Cronium App**: Next.js application (port 5001)
- **Orchestrator**: Go service that manages job queue and execution
- **Runtime API**: Provides helper functions for containerized scripts
- **Execution Environments**: Docker containers for running scripts
  - Bash scripts run in `cronium/runner:bash-alpine`
  - Node.js scripts run in `cronium/runner:node-alpine`
  - Python scripts run in `cronium/runner:python-alpine`
- **Valkey**: Redis-compatible cache for sessions and queuing

## Troubleshooting

### View logs

```bash
# Application logs
pnpm docker:logs

# Specific service
docker logs cronium-orchestrator-dev
docker logs cronium-runtime-api-dev
```

### Rebuild from scratch

```bash
# Stop everything
pnpm docker:down

# Clean Docker images
docker rmi $(docker images 'cronium/*' -q)

# Rebuild
pnpm build:go
pnpm docker:build
pnpm docker:up
```

### Reset database

```bash
# Drop and recreate schema
pnpm db:push
```
