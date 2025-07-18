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

- **DO NOT remove pages or components** - All existing pages and components should remain unless explicitly asked to remove them
- **DO NOT change the styling or layout of pages** - Maintain the existing visual design and layout structure
- **DO NOT remove features or functionality** - All existing features must be preserved unless removal is explicitly requested
- **DO NOT remove tabs, filters, or navigation elements** - Keep all UI elements that users rely on
- **DO NOT replace tables with lists or change data presentation formats** - Maintain the existing data display patterns
- **DO NOT remove bulk actions, sorting, or pagination** - These are essential features for data management

When converting components (e.g., for SSR/CSR split), ensure:
- The new component has **identical functionality** to the original
- The new component uses the **same styling and layout** as the original
- All features are preserved including filters, sorting, pagination, bulk actions, etc.
- Data is presented in the same format (tables remain tables, lists remain lists)

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
# Development
pnpm dev              # Start Next.js dev server on port 5001
pnpm dev:socket       # Start WebSocket server (server.ts)

# Building & Testing
pnpm build            # Build Next.js application
pnpm start            # Start production server on port 5001
pnpm test             # Run Jest tests (src/tests/)
pnpm lint             # Run Next.js linter

# Database Operations
pnpm db:push          # Push Drizzle schema to database
pnpm db:studio        # Open Drizzle Kit studio
pnpm db:generate      # Generate Drizzle migrations

# Utilities
pnpm clear            # Remove .next build directory
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

**Core Concepts:**

- **Events**: Scheduled scripts (bash, Node.js, Python) or HTTP requests
- **Workflows**: Multi-step event chains with conditional logic
- **Servers**: Remote execution targets via SSH
- **Variables**: Global/user-defined runtime variables
- **Tools**: Integration plugins (Slack, Discord, Email)

## Key Directories

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components organized by feature
- `src/lib/` - Core business logic and utilities
- `src/server/` - tRPC setup and server-side code
- `src/shared/` - Database schema and shared types

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

```typescript
@/*              // src/*
@shared/*        // src/shared/*
@components/*    // src/components/*
@server/*        // src/server/*
@lib/*           // src/lib/*
@scripts/*       // src/scripts/*
```

## Database Schema

Located in `src/shared/schema.ts` using Drizzle ORM.

## Database Migrations

**Completed Migration (2025-07-15)**: The database has been migrated to support containerized execution with 17 new tables for job queuing, OAuth, webhooks, and rate limiting.

**Migration Scripts**: All migration scripts have been archived to `src/scripts/migrations/archived/`. For future migrations:

1. Use Drizzle Kit for schema changes: `npx drizzle-kit generate` and `pnpm db:push`
2. Create new migration scripts in `src/scripts/migrations/` if data transformation is needed
3. Document all migrations in the changelog

## Security Considerations

- All local scripts run in isolated Docker containers
- Role-based access control throughout the application
- Encryption for sensitive data (API tokens, passwords)
- SSH key management for remote server access

## Package Management

- Use pnpm for package management
