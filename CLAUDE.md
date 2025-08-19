# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Changelog

IMPORTANT: After making changes to the codebase, log the changes to the changelog folder:

1. Check if a changelog file exists for today's date in the `changelog/` folder (e.g., `changelog/2025-07-07.md`)
2. If no file exists for today, create one with the filename `YYYY-MM-DD.md`
3. Add your changes to the appropriate file in the format:

```
- [YYYY-MM-DD] [Change Type] [Change Description]
```

Change types include: Feature, Bug Fix, Refactor, Documentation, Testing, etc.

## Code Style

- Use TypeScript for type safety, following the documentation in TYPE_SAFETY.md
- To avoid linting errors, use the eslint.config.js file as a reference
- Format code using Prettier
- Run `pnpm format` to automatically format code
- Run `pnpm lint` to check for linting errors
- Write concise, readable, and maintainable code
- Use descriptive variable and function names
- Follow the established coding patterns and conventions
- Document complex logic and non-obvious code paths
- Use meaningful error messages and logging

## IMPORTANT: UI/UX Guidelines

**DO NOT make any of the following changes without explicit approval:**

- **DO NOT remove pages or components** - All existing pages and components should remain unless explicitly asked to remove them. You can rename unused pages and components (e.g., component-old.tsx).
- **DO NOT change the styling or layout of pages** - Maintain the existing visual design and layout structure unless asked to change it
- **DO NOT remove features or functionality** - All existing features must be preserved unless removal is explicitly requested
- **DO NOT remove tabs, filters, or navigation elements** - Keep all UI elements that users rely on unless asked to remove them
- **DO NOT change data presentation formats** - Maintain the existing data display patterns unless asked to change it

If you believe one of these changes is necessary, ask for approval.

When converting components (e.g., for SSR/CSR split), ensure:

- The new component has **identical functionality** to the original
- The new component uses the **same styling and layout** as the original
- All features are preserved including filters, sorting, pagination, bulk actions, etc.
- Data is presented in the same format (tables remain tables, lists remain lists)

When changing functionality or fixing errors, consider the side-effects that your changes might have. For example, if your updating a component and need to update the API route that the component uses ensure that you don't break other components that may use the same API route.

## 📚 Documentation

- [GETTING_STARTED.md](docs/GETTING_STARTED.md) - Quick start guide for development setup
- [AUTH.md](docs/AUTH.md) - Authentication and user management
- [CONTEXT.md](docs/CONTEXT.md) - Project context and guidelines
- [TRPC.md](docs/TRPC.md) - tRPC API patterns and conventions
- [TYPE_SAFETY.md](docs/TYPE_SAFETY.md) - Type safety guidelines
- [ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) - Complete environment variable reference

* additional documentation can be found in the docs directory

## Planning

- [\_plans/](_plans/)

Plans are contained in the plans directory. Plans should be updated as needed. As progress is made, update the plans to reflect the current state of the project.
IMPORTANT: Cronium is meant to be an open-source, self-hosted application. This is not a large enterprise product. The app is in early development and hasn't been released publicly yet. Keep this in mind when making plans.

## Common Commands

```bash
# Development - Monorepo Root
pnpm dev              # Start all services concurrently
pnpm dev:app          # Start Cronium app (port 5001)
pnpm dev:info         # Start Cronium info site (port 3001)
pnpm dev:socket       # Start WebSocket server only
pnpm dev:services     # Start Go services (orchestrator + runtime)

# Building & Testing - Monorepo Root
pnpm build            # Build all packages and apps
pnpm build:web        # Build Cronium app only
pnpm build:info       # Build Cronium info site only
pnpm build:go         # Build Go services
pnpm test             # Run all tests across monorepo
pnpm lint             # Lint all packages and apps
pnpm format           # Format all code
pnpm typecheck        # Type check all TypeScript packages

# Database Operations - From apps/cronium-app
cd apps/cronium-app && pnpm db:push      # Push Drizzle schema to database
cd apps/cronium-app && pnpm db:studio    # Open Drizzle Kit studio
cd apps/cronium-app && pnpm db:generate  # Generate Drizzle migrations
cd apps/cronium-app && pnpm seed         # Seed all database tables
cd apps/cronium-app && pnpm seed:db      # Seed only core tables

# Docker & Deployment
pnpm docker:up        # Start all services with Docker Compose
pnpm docker:down      # Stop all Docker services
pnpm docker:build     # Build Docker images
./infra/scripts/deploy.sh    # Full deployment script

# Utilities
pnpm clean            # Clean all build outputs
```

## Monorepo Structure

The project is organized as a monorepo using Turborepo and PNPM workspaces:

```
cronium/
├── apps/
│   ├── cronium-app/      # Main Cronium application (self-hosted)
│   ├── cronium-info/     # Marketing/docs site (static export)
│   ├── orchestrator/     # Go orchestrator service
│   └── runtime/          # Go runtime service
├── packages/
│   ├── ui/               # Shared UI components
│   ├── config-typescript/# Shared TypeScript configs
│   ├── config-eslint/    # Shared ESLint configs
│   └── config-tailwind/  # Shared Tailwind configs
├── infra/
│   ├── docker/           # Docker configurations
│   └── scripts/          # Deployment scripts
├── turbo.json            # Turborepo configuration
├── pnpm-workspace.yaml   # PNPM workspace config
└── go.work               # Go workspace config
```

## Architecture Overview

**Tech Stack:**

- Next.js 15 (App Router) with TypeScript
- TailwindCSS 4 for styling
- Drizzle ORM with PostgreSQL/Neon
- Next-Auth for authentication
- tRPC for type-safe APIs
- Socket.IO/WebSockets for real-time features
- React Hook Form + Zod for forms
- Turborepo for monorepo orchestration
- PNPM for package management
- Go for orchestrator and runtime services
- Docker for containerized execution

**Applications:**

- **cronium-app**: The main self-hosted Cronium application
  - Full-featured automation platform
  - Requires database, authentication, and backend services
  - Runs on port 3000 in development
- **cronium-info**: Public marketing and documentation site
  - Static export for easy hosting (Vercel, Netlify, etc.)
  - No authentication required
  - Runs on port 3001 in development
  - Contains landing page and documentation
- **orchestrator**: Go service for job queue management
  - Polls jobs from database queue
  - Manages container and SSH executors
  - Handles job lifecycle and status updates
  - Runs on port 8088 in development
- **runtime**: Go service for SSH runner execution
  - Provides signed runner binaries for SSH servers
  - Handles helper function execution
  - Manages payload distribution
  - Runs on port 8089 in development

**Core Concepts:**

- **Events**: Scheduled scripts (bash, Node.js, Python) or HTTP requests
- **Jobs**: Queued execution tasks created from events
- **Executions**: Records of job runs with status and logs
- **Workflows**: Multi-step event chains with conditional logic
- **Servers**: Remote execution targets via SSH
- **Variables**: Global/user-defined runtime variables
- **Tools**: Integration plugins (Slack, Discord, Email)
- **Payloads**: Packaged scripts and metadata for execution

## Key Directories

**Monorepo Root:**

- `apps/` - All applications (web, orchestrator, runtime)
- `packages/` - Shared packages and configurations
- `infra/` - Infrastructure and deployment files
- `plans/` - Project planning documents
- `changelog/` - Daily change logs

**Cronium App (apps/cronium-app):**

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components organized by feature
- `src/lib/` - Core business logic and utilities
- `src/server/` - tRPC setup and server-side code
- `src/shared/` - Database schema and shared types

**Cronium Info Site (apps/cronium-info):**

- `app/` - Next.js App Router pages (landing, docs)
- `components/` - React components (landing, docs, error)
- `public/` - Static assets (logos, icons)
- `messages/` - Internationalization files
- `lib/` - Utility functions

**Go Services:**

- `apps/orchestrator/` - Orchestrator service for job management
  - `internal/executors/` - Container and SSH execution engines
  - `internal/api/` - API client for cronium-app communication
  - `internal/payload/` - Payload creation and management
  - `pkg/types/` - Shared type definitions
- `apps/runtime/cronium-runtime/` - Runtime service for script execution
  - Provides signed runner binaries
  - Handles helper API endpoints

## Important Implementation Notes

**Authentication:**

- Uses Next-Auth with email/password
- Role-based permissions (admin, user, viewer)
- Admin dashboard for user management

**Execution Flow:**

1. **Event Trigger**: User creates/schedules an event in cronium-app
2. **Job Creation**: Event creates a job in the database queue
3. **Job Polling**: Orchestrator polls and claims jobs from the queue
4. **Execution Routing**: Based on job type, routes to appropriate executor:
   - **Container Executor**: For local/containerized execution
   - **SSH Executor**: For remote server execution (single or multi-server)
5. **Status Updates**: Real-time updates via WebSocket to UI
6. **Completion**: Job results and logs stored in database

**Script Execution Types:**

- **Containerized (Local)**:
  - Runs in isolated Docker containers
  - Full runtime helper support
  - Resource limits and isolation
  - Automatic cleanup after execution
- **SSH (Remote)**:
  - Deploys signed runner binary to remote servers
  - Supports single and multi-server execution
  - Runtime helpers via API callbacks
  - Payload-based script distribution
  - Automatic runner and payload cleanup
- **Terminal**: Interactive shell via xterm.js + WebSockets

**Runtime Helpers:**

- `cronium.input()` / `cronium.output()` - Pass data between events
- `cronium.getVariable()` / `cronium.setVariable()` - Manage variables
- `cronium.event()` - Access current event metadata
- `cronium.log()` - Structured logging with levels
- `cronium.sleep()` - Delay execution
- `cronium.fetch()` - HTTP requests with authentication

**Payload System:**

- **Creation**: Scripts packaged as tar.gz with manifest
- **Distribution**: Uploaded to SSH servers for execution
- **Cleanup**: Automatic removal after job completion
- **Retention**: Configurable retention period (default 24h)
- **Periodic Cleanup**: Background process removes old payloads

## Path Aliases

**Cronium App (apps/cronium-app):**

```typescript
@/*              // apps/cronium-app/src/*
@shared/*        // apps/cronium-app/src/shared/*
@components/*    // apps/cronium-app/src/components/*
@server/*        // apps/cronium-app/src/server/*
@lib/*           // apps/cronium-app/src/lib/*
@scripts/*       // apps/cronium-app/src/scripts/*
```

**Cronium Info Site (apps/cronium-info):**

```typescript
@/*              // apps/cronium-info/*
```

**Shared Packages:**

```typescript
@cronium/ui          // packages/ui
@cronium/config-typescript  // packages/config-typescript
@cronium/config-eslint      // packages/config-eslint
@cronium/config-tailwind    // packages/config-tailwind
```

## Database Schema

Located in `apps/cronium-app/src/shared/schema.ts` using Drizzle ORM.

## Database Migrations

**Completed Migration (2025-07-15)**: The database has been migrated to support containerized execution with 17 new tables for job queuing, OAuth, webhooks, and rate limiting.

**Migration Scripts**: All migration scripts have been archived to `apps/cronium-app/src/scripts/migrations/archived/`. For future migrations:

1. Use Drizzle Kit for schema changes: `cd apps/cronium-app && npx drizzle-kit generate` and `pnpm db:push`
2. Create new migration scripts in `apps/cronium-app/src/scripts/migrations/` if data transformation is needed
3. Document all migrations in the changelog

## Security Considerations

- All local scripts run in isolated Docker containers
- Role-based access control throughout the application
- Encryption for sensitive data (API tokens, passwords)
- SSH key management for remote server access
- Signed runner binaries prevent tampering
- JWT authentication for service-to-service communication
- Payload checksums ensure integrity

## Key Configuration

**Orchestrator Environment Variables:**

- `DATABASE_URL` - PostgreSQL connection string
- `API_TOKEN` - Authentication token for cronium-app API
- `RUNTIME_HOST` - Runtime service hostname (default: runtime-api)
- `RUNTIME_PORT` - Runtime service port (default: 8089)
- `CLEANUP_PAYLOADS` - Enable payload cleanup (default: false)
- `PAYLOAD_RETENTION_PERIOD` - How long to keep payloads (default: 24h)
- `PAYLOAD_CLEANUP_INTERVAL` - Cleanup frequency (default: 1h)

**Runtime Environment Variables:**

- `JWT_SECRET` - Secret for signing runner tokens
- `PORT` - Service port (default: 8089)

## Package Management

- Use pnpm for all package management
- Install dependencies from root: `pnpm install`
- Add workspace dependencies: `pnpm add <package> --workspace`
- Add app-specific dependencies: `pnpm add <package> --filter @cronium/web`

## Development Workflow

1. **Starting Development:**

   ```bash
   # From project root
   pnpm install        # Install all dependencies
   pnpm dev           # Start all services
   ```

2. **Working on Specific Apps:**

   ```bash
   pnpm dev:app       # Cronium app only (port 5001)
   pnpm dev:socket    # WebSocket server only (port 5002)
   pnpm docker:up     # Start orchestrator + runtime and Valkey/Redis in Docker
   pnpm dev:info      # Info site only (port 3001)
   pnpm dev:services  # Go services only
   ```

3. **Building for Production:**

   ```bash
   pnpm build         # Build everything
   ./infra/scripts/deploy.sh  # Deploy with Docker
   ```

4. **Adding New Shared Components:**
   - Add to `packages/ui/src/`
   - Export from `packages/ui/src/index.ts`
   - Run `pnpm build --filter @cronium/ui`
   - Import in apps as `import { Component } from '@cronium/ui'`

## Recent Architecture Improvements

**Job Queue System:**

- Database-backed job queue for reliability
- Atomic job claiming prevents duplicate processing
- Automatic retry with exponential backoff
- Dead letter queue for failed jobs
- Job status tracking: pending → claimed → running → completed/failed

**Execution-Log Integrity:**

- Foreign key relationships ensure data consistency
- Execution records track job runs with proper status flow
- Log entries linked to executions for traceability
- Exit codes properly captured and stored

**Multi-Server Execution:**

- Parallel execution across multiple SSH servers
- Unified execution tracking with unique IDs
- Aggregated status reporting
- Independent failure handling per server

**Payload Management:**

- Automatic cleanup after job completion
- Configurable retention periods
- Periodic background cleanup process
- Support for both inline scripts and file-based payloads
- Checksum verification for integrity
