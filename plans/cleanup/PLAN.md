# Cronium Codebase Cleanup Plan

## Overview

This plan outlines a comprehensive cleanup strategy for the Cronium codebase following the recent major architectural changes including containerized execution, performance optimizations, and runtime helper implementation. The goal is to remove deprecated code, identify technical debt, and improve overall code quality without adding new features.

## Goals

- [x] Identify deprecated or unused files
- [x] Identify unused exports
- [x] Identify redundant or duplicated code
- [x] Identify other tech debt
- [x] Identify deprecated tests
- [x] Identify deprecated or unneeded scripts
- [ ] Remove unused, deprecated or unnecessary code

## Phase 1: Remove Deprecated Files and Directories

### 1.2 Unused Source Files

- [x] Remove `/src/lib/ssh-compat.ts` - SSH compatibility module with no imports
- [x] Remove `/src/lib/ppr-config.ts` - Unused Partial Prerendering configuration
- [x] Remove `CACHE_INVALIDATION_REVIEW.md` from root (findings already implemented)

### 1.3 Empty Directories

- [x] Remove `/src/app/[lang]/dashboard/(main)/events/test-improved` - Empty test directory

## Phase 2: Clean Up Scripts

### 2.1 Deprecated Scripts Directory

- [x] Keep the `src/scripts/deprecated/` directory with README.md for documentation
- [x] Remove all deprecated runtime helper test scripts:
  - [x] `test-getvar.ts`
  - [x] `test-simple-helper.ts`
  - [x] `test-runtime-helpers.ts`
  - [x] `test-runtime-helper-debug.ts`
  - [x] `test-runtime-helpers-detailed.ts`
  - [x] `test-runtime-simple.ts`
  - [x] `test-single-runtime-helper.ts`
  - [x] `test-runtime-api.ts`
  - [x] `check-runtime-api-results.ts`
- [x] Remove old execution model scripts:
  - [x] `start-scheduler.ts`
  - [x] `test-tool-action.ts`
  - [x] `test-real-tools.ts`
  - [x] `e2e-tool-actions-test.ts`

### 2.2 Completed Migration Scripts

- [x] Archive to `src/scripts/migrations/archived/`:
  - [x] `add-event-relations-indexes.ts`
  - [x] `add-event-relations-indexes-standalone.ts`
  - [x] `run-index-migration.sh`
- [x] Remove from `_backups/scripts/`:
  - [x] `migrate-add-execution-fields.ts`
  - [x] `migrate-add-execution-tracking.ts`
  - [x] `migrate-add-security-columns.ts`
  - [x] `migrate-templates-to-tool-actions.ts`
  - [x] `encrypt-existing-data.ts`

### 2.3 One-Time Setup Scripts

- [x] Remove dangerous or redundant scripts:
  - [x] `src/scripts/test-new-db.ts`
  - [x] `src/scripts/recreate-db.ts`
  - [x] `src/scripts/test-db-schema.ts`
  - [x] `src/scripts/encrypt-existing-data.ts` (duplicate)

### 2.4 Package.json Scripts Cleanup

- [x] Remove broken npm scripts:
  - [x] `migrate:events`
  - [x] `migrate:events:test`
  - [x] `migrate:events:dry-run`

## Phase 3: Update Tests

### 3.1 Remove or Update Deprecated Tests

- [x] Update all tests referencing:
  - [x] `RunLocation.REMOTE` pattern
  - [x] `eventServers` pattern
  - [x] SSH-based execution
  - [x] Deleted `page-original` components

### 3.2 Add New Test Coverage

- [x] Create tests for containerized execution system
- [x] Create tests for job queue functionality
- [x] Create tests for orchestrator patterns
- [x] Create tests for runtime helpers

## Phase 4: Code Quality Improvements

### 4.1 Remove Unused Exports

- [x] Clean up `/src/lib/advanced-types.ts` - Remove unused utility types:
  - [x] `DeepPartial` (doesn't exist in file)
  - [x] `DeepReadonly`
  - [x] `Mutable` (doesn't exist in file)
  - [x] `RequireAtLeastOne` (doesn't exist in file)
  - [x] `RequireOnlyOne` (doesn't exist in file)
  - [x] `PromiseValue` (doesn't exist in file)
  - [x] `ArrayElement` (doesn't exist in file)
  - [x] `Entries` (doesn't exist in file)

### 4.2 Fix Critical Security Issues (skipping for now)

- [~] Implement proper Redis-based rate limiting (currently always allows)
- [~] Remove development authentication bypasses
- [~] Add proper IP validation and input sanitization
- [~] Complete webhook signature verification

### 4.3 Complete Unfinished Features (skipping for now)

- [~] Implement server usage statistics (currently returns zeros)
- [~] Implement server logs retrieval functionality
- [~] Complete rate limiting implementation
- [~] Fix 18 files with TODO/FIXME comments

### 4.4 Improve Error Handling

- [x] Add error logging to 50+ files with empty catch blocks
- [x] Implement centralized error handling middleware
- [x] Standardize error response formats
- [x] Add proper error boundaries where missing

### 4.5 Refactor Duplicated Code

- [x] Extract common authentication logic from routers
- [x] Consolidate database query patterns
- [x] Create reusable error handling utilities
- [x] Standardize API response patterns

### 4.6 Configuration Management

- [ ] Replace hardcoded localhost/IP values with config
- [ ] Implement centralized configuration service
- [ ] Separate development workarounds from production code
- [ ] Create environment-specific configurations

## Phase 5: Performance Optimizations

### 5.1 Database Query Optimization

- [ ] Add database indexes where needed
- [ ] Optimize N+1 query patterns (already started)
- [ ] Implement query result caching where appropriate
- [ ] Add query performance monitoring

### 5.2 Async Operations

- [ ] Convert synchronous operations to async where beneficial
- [ ] Implement proper connection pooling
- [ ] Add request batching for external APIs
- [ ] Optimize WebSocket message handling

## Phase 6: Documentation Updates

### 6.1 Update Documentation

- [ ] Remove references to old execution model
- [ ] Update API documentation for new patterns
- [ ] Document new containerized architecture
- [ ] Update deployment guides

### 6.2 Code Comments

- [ ] Add JSDoc comments to public APIs
- [ ] Document complex business logic
- [ ] Add inline comments for non-obvious code
- [ ] Update outdated comments

## Execution Order

1. **Week 1**: Phase 1 & 2 - Remove deprecated files and scripts
2. **Week 2**: Phase 3 - Update tests
3. **Week 3-4**: Phase 4.1-4.3 - Critical security and feature completion
4. **Week 5-6**: Phase 4.4-4.6 - Code quality improvements
5. **Week 7**: Phase 5 - Performance optimizations
6. **Week 8**: Phase 6 - Documentation updates

## Success Criteria

- [ ] All deprecated files and directories removed
- [ ] All broken npm scripts fixed or removed
- [ ] All tests updated to reflect current architecture
- [ ] Critical security issues resolved
- [ ] No empty catch blocks in production code
- [ ] All TODO/FIXME comments addressed or documented
- [ ] Codebase passes all linting and type checks
- [ ] Documentation reflects current implementation

## Notes

- This plan focuses solely on cleanup and technical debt reduction
- No new features or functionality should be added during this cleanup
- Each phase should be completed with proper testing
- Changes should be committed in logical groups with clear messages
- Consider creating a backup branch before starting major deletions
