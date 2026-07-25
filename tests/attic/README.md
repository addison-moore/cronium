# Attic — retired test suites

Suites here are **not run anywhere** (the `.attic` suffix keeps them out of
every jest `testMatch`). They predate the scheduling overhaul (CAS job state
machine, event-sourced workflow engine) and no longer compile or assert against
APIs that still exist. They are kept as reference material for the testing
improvement plan (`_plans/testing/PLAN.md`), which replaces them:

- ~~`job-execution-flow.test.ts.attic`~~ — DELETED 2026-07-25: superseded by
  the Phase 5 e2e pipeline suite (`tests/e2e/`, `pnpm test:e2e`), which runs
  the REAL orchestrator/worker/containers instead of simulating them.
- `benchmark.test.ts.attic` — performance benchmarks against a live app/DB.
  Phase 5 decision (2026-07-25): stays retired. Its wall-clock threshold
  asserts are machine-dependent and target the pre-overhaul design. For
  manual performance probing, boot the disposable full stack and keep it up
  (`E2E_KEEP_STACK=1 pnpm test:e2e`), then measure against it; a purpose-built
  perf suite can start from that harness if ever needed.
- `job-service.test.ts.attic` — mocked-db unit test written against the
  pre-overhaul JobService (`cleanupOldJobs` is gone; claim/complete/fail now go
  through `transitionJob`). Superseded by Phase 1 job-service tests.
- `logs-websocket.test.ts.attic` — written against a removed handler API
  (`broadcastJobUpdate`, `mapJobStatusToLogStatus`; log fetching no longer goes
  through `storage`). Superseded by Phase 1 coverage of `logs-websocket.ts`.

When a replacement suite lands, delete the corresponding attic file.
