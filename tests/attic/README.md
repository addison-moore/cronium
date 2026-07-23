# Attic — retired test suites

Suites here are **not run anywhere** (the `.attic` suffix keeps them out of
every jest `testMatch`). They predate the scheduling overhaul (CAS job state
machine, event-sourced workflow engine) and no longer compile or assert against
APIs that still exist. They are kept as reference material for the testing
improvement plan (`_plans/testing/PLAN.md`), which replaces them:

- `job-execution-flow.test.ts.attic` — end-to-end schedule→execute→stream flow
  against a live app/DB. References `JobType`/`JobPriority` without importing
  them; simulates the orchestrator instead of running it. Superseded by the
  Phase 5 e2e pipeline job.
- `benchmark.test.ts.attic` — performance benchmarks against a live app/DB.
  Revisit in Phase 5 as a manually-run suite.
- `job-service.test.ts.attic` — mocked-db unit test written against the
  pre-overhaul JobService (`cleanupOldJobs` is gone; claim/complete/fail now go
  through `transitionJob`). Superseded by Phase 1 job-service tests.
- `logs-websocket.test.ts.attic` — written against a removed handler API
  (`broadcastJobUpdate`, `mapJobStatusToLogStatus`; log fetching no longer goes
  through `storage`). Superseded by Phase 1 coverage of `logs-websocket.ts`.

When a replacement suite lands, delete the corresponding attic file.
