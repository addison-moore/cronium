# Changelog

All notable user-facing changes to Cronium are documented here. This file
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Detailed, dated development logs live in the [`changelog/`](changelog/) directory;
this file summarizes them per release.

## [Unreleased]

Cronium is pre-1.0 and preparing for its first public release. Recent work
(see `changelog/` for detail):

### Added

- SSH host-key verification and Ed25519 payload signing for the execution path.
- First-boot admin seeding, real tool "Test Connection" checks, admin
  "send test email", and a working Google Sheets + OAuth flow.
- Persisted orchestrator heartbeat/metrics/health telemetry.
- Job retries with exponential backoff; performance-index migration.
- Logs full-text search and date-range filtering.
- CI workflow (lint/typecheck/test for Node and Go); open-source governance
  files (CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates).

### Fixed

- Paused/deleted/rescheduled events now correctly unschedule.
- Workflow engine: event-driven prerequisite waits, merge-node double-execution
  guard, correct trigger-type labeling, and fixed "every N days" scheduling.
- Automated email notifications now actually send (were simulated).
- Monitoring dashboard shows real data instead of random values.

### Removed

- Mocked webhook management router and its orphaned UI.
- Committed binary artifacts and dead dependencies from the repository.
