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

- [plans/](plans/)

Plans are contained in the plans directory. Plans should be updated as needed. As progress is made, update the plans to reflect the current state of the project.
IMPORTANT: Cronium is meant to be an open-source, self-hosted application. This is not a large enterprise product. The app is in early development and hasn't been released publicly yet. Keep this in mind when making plans.

## Common Commands

```bash
# Development - Monorepo Root
pnpm dev              # Start all services concurrently
pnpm dev:web          # Start Next.js dev server only
pnpm dev:socket       # Start WebSocket server only
pnpm dev:services     # Start Go services (orchestrator + runtime)

# Building & Testing - Monorepo Root
pnpm build            # Build all packages and apps
pnpm build:web        # Build Next.js application only
pnpm build:go         # Build Go services
pnpm test             # Run all tests across monorepo
pnpm lint             # Lint all packages and apps
pnpm format           # Format all code
pnpm typecheck        # Type check all TypeScript packages

# Database Operations - From apps/web
cd apps/web && pnpm db:push      # Push Drizzle schema to database
cd apps/web && pnpm db:studio    # Open Drizzle Kit studio
cd apps/web && pnpm db:generate  # Generate Drizzle migrations
cd apps/web && pnpm seed         # Seed all database tables
cd apps/web && pnpm seed:db      # Seed only core tables

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
cronium-dev/
├── apps/
│   ├── web/              # Next.js application
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

**Core Concepts:**

- **Events**: Scheduled scripts (bash, Node.js, Python) or HTTP requests
- **Workflows**: Multi-step event chains with conditional logic
- **Servers**: Remote execution targets via SSH
- **Variables**: Global/user-defined runtime variables
- **Tools**: Integration plugins (Slack, Discord, Email)

## Key Directories

**Monorepo Root:**

- `apps/` - All applications (web, orchestrator, runtime)
- `packages/` - Shared packages and configurations
- `infra/` - Infrastructure and deployment files
- `plans/` - Project planning documents
- `changelog/` - Daily change logs

**Web Application (apps/web):**

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components organized by feature
- `src/lib/` - Core business logic and utilities
- `src/server/` - tRPC setup and server-side code
- `src/shared/` - Database schema and shared types

**Go Services:**

- `apps/orchestrator/` - Orchestrator service for job management
- `apps/runtime/cronium-runtime/` - Runtime service for script execution

## Important Implementation Notes

**Authentication:**

- Uses Next-Auth with email/password
- Role-based permissions (admin, user, viewer)
- Admin dashboard for user management

**Script Execution:**

- Local execution runs in isolated Docker containers via orchestrator
- SSH execution does not support runtime helpers (will be added with signed runner)
- Terminal via xterm.js + WebSockets

**Runtime Helpers:**

- `cronium.input()` / `cronium.output()` - Pass data between events
- `cronium.getVariable()` / `cronium.setVariable()` - Manage variables
- `cronium.event()` - Access current event metadata

## Path Aliases

**Web Application (apps/web):**

```typescript
@/*              // apps/web/src/*
@shared/*        // apps/web/src/shared/*
@components/*    // apps/web/src/components/*
@server/*        // apps/web/src/server/*
@lib/*           // apps/web/src/lib/*
@scripts/*       // apps/web/src/scripts/*
```

**Shared Packages:**

```typescript
@cronium/ui          // packages/ui
@cronium/config-typescript  // packages/config-typescript
@cronium/config-eslint      // packages/config-eslint
@cronium/config-tailwind    // packages/config-tailwind
```

## Database Schema

Located in `apps/web/src/shared/schema.ts` using Drizzle ORM.

## Database Migrations

**Completed Migration (2025-07-15)**: The database has been migrated to support containerized execution with 17 new tables for job queuing, OAuth, webhooks, and rate limiting.

**Migration Scripts**: All migration scripts have been archived to `apps/web/src/scripts/migrations/archived/`. For future migrations:

1. Use Drizzle Kit for schema changes: `cd apps/web && npx drizzle-kit generate` and `pnpm db:push`
2. Create new migration scripts in `apps/web/src/scripts/migrations/` if data transformation is needed
3. Document all migrations in the changelog

## Security Considerations

- All local scripts run in isolated Docker containers
- Role-based access control throughout the application
- Encryption for sensitive data (API tokens, passwords)
- SSH key management for remote server access

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
   pnpm dev:web       # Web app only
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
