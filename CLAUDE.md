# CLAUDE.md

IMPORTANT: After making changes to the codebase, log the changes to the changelog folder:

1. Check if a changelog file exists for today's date in the `changelog/` folder (e.g., `changelog/2025-07-07.md`)
2. If no file exists for today, create one with the filename `YYYY-MM-DD.md`
3. Add your changes to the appropriate file in the format:

```
- [YYYY-MM-DD] [Change Type] [Change Description]
```

Change types include: Feature, Bug Fix, Refactor, Documentation, Testing, etc.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📚 Documentation

- [AUTH.md](AUTH.md) - Authentication and user management
- [CONTEXT.md](CONTEXT.md) - Project context and guidelines
- [tRPC_API.md](tRPC_API.md) - tRPC API patterns and conventions
- [EXECUTION.md](EXECUTION.md) - Event execution and workflow management
- [TYPE_SAFETY_GUIDELINES.md](TYPE_SAFETY_GUIDELINES.md) - Type safety guidelines

* additional documentation can be found in the docs directory

## Planning

- [plans/](plans/)

Plans are contained in the plans directory. Completed plans should be moved to the plans/completed directory.
Plans should be updated as needed. As progress is made, update the plans to reflect the current state of the project.

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
pnpm clear-logs       # Clear all application logs
```

## Architecture Overview

**Tech Stack:**

- Next.js 15 (App Router) with TypeScript
- TailwindCSS 4 for styling
- Drizzle ORM with PostgreSQL/Neon
- Next-Auth for authentication
- tRPC for type-safe APIs (gradual migration)
- Socket.IO/WebSockets for real-time features
- React Hook Form + Zod for forms (migration in progress)

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
- `src/runtime-helpers/` - Helper scripts for event execution (cronium.js/py/sh)

## Important Implementation Notes

**Authentication:**

- Uses Next-Auth with email/password
- Role-based permissions (admin, user, viewer)
- Admin dashboard for user management

**Script Execution:**

- Currently executes directly on host (security concern)
- Planned migration to Docker/LXC containers for isolation
- Terminal via xterm.js + WebSockets

**Runtime Helpers:**

- `cronium.input()` / `cronium.output()` - Pass data between events
- `cronium.getVariable()` / `cronium.setVariable()` - Manage variables
- `cronium.event()` - Access current event metadata

**Forms Migration:**

- Transitioning from local state to React Hook Form + Zod
- New forms should use this pattern

**API Migration:**

- Gradually migrating from Next.js API routes to tRPC
- New endpoints should use tRPC when possible

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

Located in `src/shared/schema.ts` using Drizzle ORM. Run `pnpm db:studio` to explore the database structure.

## Security Considerations

- All user scripts should be containerized (not yet implemented)
- Role-based access control throughout the application
- Encryption for sensitive data (API tokens, passwords)
- SSH key management for remote server access
