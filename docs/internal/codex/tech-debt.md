# Technical Debt & Recommendations

This backlog aggregates the most pressing issues observed during the review. Priorities reflect potential impact on stability, scalability, or maintainability.

## High Priority

- **Replace mock data sources.** Webhook (`apps/cronium-app/src/server/api/routers/webhooks.ts`) and monitoring routers currently return fabricated data, masking real health issues and blocking production usage. Wire these endpoints to the storage modules already present in `src/server/storage/modules` and add pagination at the database level.
- **Complete tool connector backends.** Slack, Discord, Google Sheets, Teams, Notion, and Trello routes return success placeholders rather than calling their respective APIs. Implement credential validation, error handling, and auditing or hide unfinished connectors from the UI until completed.
- **Move filtering/pagination into SQL.** Several routers (`events`, `workflows`, `variables`, `servers`, `admin`) fetch entire datasets into memory before filtering, which will not scale with large tenants. Extend storage modules to expose filtered queries and apply limits directly in Drizzle.
- **Resolve lint failures and migrate lint runner.** `logs/lint.log` shows numerous `@typescript-eslint` errors plus a deprecation warning for `next lint`. Fix offending code, switch to the ESLint CLI, and enforce lint checks in CI to prevent regressions.

## Medium Priority

- **Stabilise monitoring metrics.** `monitoringRouter` generates pseudo-random CPU and activity data. Instrument real system metrics (database health, queue depth, orchestrator heartbeat) and surface recent activity rather than static placeholders.
- **Finish quota enforcement.** Quota management services expose APIs but omit enforcement rules and export functionality. Define production thresholds, connect usage counters, and add alerting when quotas are exceeded.
- **Improve automated testing.** Jest suites under `tests/` rely on external services (Postgres, Redis, runtime API). Introduce lightweight mocks or a docker-compose test harness, and expand coverage for workflow branching, tool actions, and webhook delivery.
- **Reduce console logging in critical paths.** Scheduler and workflow executors log verbosely with `console.log`, which complicates observability. Standardise on a structured logger and consolidate log levels.
- **Address storage module visibility issues.** Workarounds noted in `serversRouter` mention missing storage methods due to bundler/type resolution problems. Investigate the module export pattern to avoid bypassing shared logic.

## Low Priority

- **Upgrade to Next.js 16 readiness.** Follow the codemod instructions printed by the lint runner to migrate to the new ESLint integration before the framework upgrade.
- **Consolidate documentation.** Some legacy docs in `docs/` conflict with current behaviour. Once new Codex docs are validated, archive or update outdated files to avoid confusion.
- **Tighten secret handling.** Verify that all sensitive settings (SMTP, API keys) are stored encrypted; the current implementation decrypts values opportunistically but lacks secret rotation guidance. Document operational steps for rotations.

## Suggested Next Steps

1. Prioritise the webhook and monitoring feature completions so that enterprise integrations and uptime dashboards reflect real data.
2. Schedule a refactor sprint to push in-memory filters down into the storage layer and add regression tests that cover pagination.
3. Establish CI gates for linting, type-checking, and targeted Jest suites to keep debt from resurfacing.
4. Publish a roadmap entry clarifying which tool plugins are fully supported versus experimental to set accurate user expectations.
