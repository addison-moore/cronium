# Database Migration Completion Plan

## Overview

This plan outlines the steps to complete the database migration for Cronium's containerized execution system. The migration involves updating the database schema with new tables that have already been defined in `src/shared/schema.ts` but need to be properly migrated to the database.

## Current State

- **Schema Status**: All new tables are defined in `src/shared/schema.ts`
- **Migration Questions**: 17 new tables need to be created (not renamed from existing tables)
- **Existing Data**: Test events, workflows, and logs that may need migration to new structure
- **Migration Scripts**: Multiple scripts exist for various migration tasks

## Goals

1. Successfully migrate the database schema to include all new tables
2. Clean up and organize migration scripts
3. Execute necessary data migrations for existing test data
4. Remove deprecated code and references
5. Ensure database is ready for containerized execution

## Phase 1: Pre-Migration Preparation

### 1.1 Backup and Safety Checks

- [ ] Create database backup (if production data exists)
- [ ] Review current database state with `pnpm db:studio`
- [ ] Document any existing test data that needs preservation

### 1.2 Migration Script Analysis

- [x] Review all migration scripts in `src/scripts/migrations/`
- [x] Identify which scripts have been run (check for idempotency)
- [x] Mark deprecated scripts for removal
- [x] Ensure migration utils are up to date

### 1.3 Schema Cleanup

- [x] Remove backwards compatibility type aliases (Script -> Event)
- [x] Verify all foreign key relationships are correct
- [x] Ensure all indexes are properly defined

## Phase 2: Database Schema Migration

### 2.1 Generate Drizzle Migration

- [x] Run `npx drizzle-kit generate` with correct answers:
  - All 17 tables should be marked as "create" (not rename)
  - No source tables exist for any of the new tables
- [x] Review generated SQL migration files
- [x] Verify migration includes all tables and indexes

### 2.2 Apply Schema Migration

- [x] Run `pnpm db:push` to apply schema changes
- [x] Verify all tables created successfully
- [x] Check foreign key constraints are applied
- [x] Confirm indexes are created

### Human Intervention Required:

- [x] Answer Drizzle Kit migration questions when running `npx drizzle-kit generate`

## Phase 3: Data Migration

### 3.1 Event Migration

- [x] Run `migrate-events-to-api.ts` to update event scripts for new API
- [x] Verify events use runtime helpers correctly
- [x] Update any hardcoded script paths

### 3.2 Job System Migration

- [x] Run `migrate-to-job-system.ts` to create job entries for events
- [x] Verify job scheduling configuration
- [x] Update workflow nodes to use job-based execution

### 3.3 Workflow Migration

- [x] Run `migrate-workflows.ts` to update workflow structure
- [x] Ensure workflow execution tables are populated correctly
- [x] Verify workflow connections reference correct node types

### 3.4 Tool Action Migration

- [x] Run `migrate-templates-to-tool-actions.ts` if templates exist
- [x] Create default tool action templates
- [x] Set up tool credentials for existing integrations

## Phase 4: Post-Migration Cleanup

### 4.1 Remove Deprecated Scripts

- [x] Delete old migration scripts that are no longer needed:
  - `src/scripts/migrate-add-execution-fields.ts` (deprecated)
  - `src/scripts/migrate-add-execution-tracking.ts` (deprecated)
  - `src/scripts/migrate-add-security-columns.ts` (deprecated)

### 4.2 Update References

- [x] Remove backwards compatibility type aliases from schema
- [x] Update any code still using old "Script" terminology
- [x] Clean up old execution code if containerized system is active

### 4.3 Verify Data Integrity

- [x] Check all events have corresponding job entries
- [x] Verify workflows can execute through job system
- [x] Ensure logs are properly linked to jobs
- [x] Confirm OAuth tokens are encrypted

## Phase 5: Validation

### 5.1 Schema Validation

- [x] Run `pnpm db:studio` to inspect final schema
- [x] Verify all 17 new tables exist with correct columns
- [x] Check all foreign key relationships
- [x] Confirm indexes are present

### 5.2 Functional Testing

- [x] Create test event and verify job creation
- [x] Execute test workflow through job system
- [x] Test OAuth flow with new tables
- [x] Verify rate limiting functionality
- [x] Test webhook delivery system

### 5.3 Migration Script Cleanup

- [x] Archive successful migration scripts
- [x] Document migration completion in changelog
- [x] Update CLAUDE.md with new migration procedures

## Migration Checklist Summary

### Tables to Create (17 total):

- [x] conditional_actions
- [x] jobs
- [x] oauth_states
- [x] oauth_tokens
- [x] quota_usage
- [x] rate_limit_buckets
- [x] tool_action_logs
- [x] tool_action_templates
- [x] tool_audit_logs
- [x] tool_rate_limits
- [x] tool_usage_metrics
- [x] user_quotas
- [x] user_tool_quotas
- [x] webhook_deliveries
- [x] webhook_events
- [x] webhook_logs
- [x] webhooks

### Migration Scripts to Run (in order):

1. [ ] `run-migration.ts` (main migration orchestrator)
2. [x] `migrate-events-to-api.ts`
3. [x] `migrate-to-job-system.ts`
4. [x] `migrate-workflows.ts`
5. [x] `migrate-templates-to-tool-actions.ts` (if applicable)

### Scripts to Remove After Migration:

- [x] `src/scripts/migrate-add-execution-fields.ts`
- [x] `src/scripts/migrate-add-execution-tracking.ts`
- [x] `src/scripts/migrate-add-security-columns.ts`

## Success Criteria

- All 17 new tables exist in the database
- Existing events and workflows function correctly
- Job-based execution system is operational
- No data loss from existing test data
- Clean codebase with deprecated items removed

## Notes

- Since this is pre-production with no users, breaking changes are acceptable
- Focus on getting the schema correct rather than preserving test data
- The containerized execution system is the priority
- Migration should enable all new features (OAuth, webhooks, rate limiting, etc.)
