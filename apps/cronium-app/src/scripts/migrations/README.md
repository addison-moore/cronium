# Database Migrations

## Required Migration: Add Payload Version Support

The events page is currently failing because the database is missing the `payload_version` column that was added for the runner payload system.

### Quick Fix

Run one of the following to add the missing column:

#### Option 1: Using TypeScript Migration Script (Recommended)

```bash
cd apps/cronium-app
pnpm tsx src/scripts/migrations/add-payload-version.ts
```

#### Option 2: Using SQL directly

```bash
# Connect to your database and run:
psql $DATABASE_URL < src/scripts/migrations/add-payload-version.sql
```

#### Option 3: Using Drizzle Push

```bash
cd apps/cronium-app
pnpm db:push
```

### What This Migration Does

1. Adds `payload_version` column to the `events` table (default value: 1)
2. Creates `runner_payloads` table for tracking generated payloads
3. Adds necessary indexes for performance

### Why This Is Needed

The SSH runner implementation (Phase 2) introduced a payload system that generates and caches script payloads for execution. The `payload_version` column tracks which version of the payload format each event uses, allowing for future upgrades without breaking existing events.

### After Migration

Once the migration is complete, the events page should load without errors.
