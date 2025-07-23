# Deprecated Scripts

This directory contains scripts that have been deprecated due to architectural changes in Cronium.

## Migration to Containerized Execution

The following scripts were deprecated when Cronium moved from a file-based helper system to a containerized execution model with sidecar-based runtime APIs:

### Template System Migration (Completed)

- `migrate-templates-to-tool-actions.ts` - Migration from templates to tool actions API (templates table removed)

### Old Scheduler System

- `start-scheduler.ts` - Old scheduler initialization (replaced by job queue with orchestrator)

### File-Based Runtime Helpers

These scripts tested the old file-based helper system that used `/usr/local/bin/cronium.sh`:

- `test-getvar.ts` - Old variable getter using shell script
- `test-simple-helper.ts` - Basic script execution without new runtime system
- `test-runtime-helpers.ts` - Old file-based runtime helper tests
- `test-runtime-helper-debug.ts` - Debug version of old runtime helpers
- `test-runtime-helpers-detailed.ts` - Detailed tests of old helper system
- `test-runtime-simple.ts` - Simple runtime helper tests
- `test-single-runtime-helper.ts` - Single helper test
- `test-runtime-api.ts` - Still uses old shell-based helpers instead of HTTP API
- `check-runtime-api-results.ts` - Results checker for deprecated test-runtime-api.ts

### Deprecated Tool Action System

These scripts use the old `executeToolAction` function which doesn't align with the new job-based execution:

- `test-tool-action.ts` - Old tool action execution tests
- `test-real-tools.ts` - Real tool integration tests using old executor
- `e2e-tool-actions-test.ts` - End-to-end tests using old tool action system

## Current Architecture

The new architecture uses:

1. **Containerized execution** with Docker containers managed by the orchestrator
2. **Job queue system** for scheduling and execution
3. **Sidecar-based runtime API** serving helpers via HTTP instead of shell scripts
4. **Tool actions API** integrated with the job execution system

## Note on SSH Execution

SSH execution currently does not support runtime helpers. This functionality will be added in a future update with a signed runner implementation.
