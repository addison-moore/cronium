# Feature Breakdown

This guide catalogues the major capabilities exposed across the Cronium platform and documents their current maturity.

## Events & Script Automation _(Production Ready)_

- Supports Node.js, Python, Bash, HTTP requests, and tool-action executions (`apps/cronium-app/src/shared/schema.ts`).
- Event editor (`src/components/event-form`) enables schedule configuration, retry policies, environment variables, and conditional follow-up actions.
- Scheduler (`src/lib/scheduler/scheduler.ts`) enforces single-flight runs, respects future start times, and reloads active events at startup.
- Manual executions enqueue jobs via `events.execute`, capturing job IDs and log handles for downstream tracking.

## Workflows _(Production Ready)_

- Workflow builder UI (`src/components/workflows`) lets users assemble graphs of event nodes, annotate connections (success/failure/conditional), and manage shared workflows.
- TRPC workflow router (`src/server/api/routers/workflows.ts`) handles CRUD, execution history retrieval, log download (JSON), and execution streaming.
- Workflow executor (`src/lib/workflow-executor.ts`) schedules recurring workflows, records workflow-level logs, and progresses through graph edges based on node outcomes.

## Job Queue & Runtime Execution _(Production Ready)_

- Queue managed by `jobService` (`src/lib/services/job-service.ts`) with priority ordering, retries, and state transitions.
- Internal `/api/internal/jobs/*` routes expose claim/ack/update endpoints for orchestrators, secured by `INTERNAL_API_KEY`.
- Orchestrator (`apps/orchestrator`) provisions container or SSH jobs, streams logs, gathers metrics, and recovers inflight work on startup.
- Runner CLI (`apps/runner/cronium-runner`) verifies payload signatures and injects runtime helpers, while the Runtime Service supplies execution-scoped APIs.

## Remote Servers & Console _(Production Ready)_

- Server management UI (`src/app/[lang]/dashboard/(main)/servers`) with validation via SSH test connections before persistence.
- `serversRouter` enforces ownership checks, archives/restores servers, and serves aggregated usage metadata.
- Live console (`src/app/[lang]/dashboard/(main)/console/page.tsx`) opens SSH terminal sessions through the WebSocket terminal manager.

## Variables & Secrets _(Production Ready)_

- User-level variable management (`src/server/api/routers/variables.ts`) with validation for reserved prefixes and exports/imports.
- Execution helpers expose `cronium.getVariable` and `cronium.setVariable`; remote runtime stores data in Valkey and Postgres.

## Tool Integrations _(Mixed Readiness)_

- Plugin registry (`src/tools/plugins/index.ts`) registers built-in integrations (Email, Slack, Discord, Google Sheets, Microsoft Teams, Notion, Trello).
- Email connector is fully implemented with nodemailer send/test flows (`src/server/api/routers/tools/email-routes.ts`).
- Other connectors currently surface UI and input validation but return mock responses server-side (e.g. Slack at `tools/slack-routes.ts`, Teams/Notion/Trello/Google Sheets routes).
- Tool action logs router provides recent history, though aggregated stats remain TODO.

## Logs & Monitoring _(Mixed Readiness)_

- Execution logs are queryable with filtering, pagination, and workflow pivots (`src/server/api/routers/logs.ts`).
- Workflow execution history renders detailed event breakdowns (`src/components/workflows/WorkflowExecutionHistory.tsx`).
- Monitoring dashboard surfaces counts from `dashboardService`, but system metrics (CPU, uptime, health) currently use placeholder values (`src/server/api/routers/monitoring.ts`).

## Webhooks _(In Progress)_

- Storage layer models webhooks, deliveries, and events (`src/server/storage/modules/webhooks.ts`).
- Public tRPC router still serves mock webhook listings and execution history (`src/server/api/routers/webhooks.ts`), pending integration with storage.
- REST hooks under `src/app/api/webhooks` provide routing scaffolding but need full implementation for production use.

## API Tokens & External Access _(Production Ready)_

- Dashboard exposes token issuance, revocation, and audit (`src/components/dashboard/ApiTokensManager.tsx`).
- `authRouter` persists hashed tokens with revoke/delete flows and enforces scope through internal middleware.
- Documentation tab includes cURL examples and references to public APIs.

## Admin & System Settings _(Production Ready)_

- Admin area (`src/app/[lang]/dashboard/(admin)`) covers SMTP setup, registration policies, AI controls, user management, and role changes.
- System settings stored in Postgres with encryption for sensitive values (`src/lib/email.ts`, `src/lib/encryption-service.ts`).
- Bulk operations (invite/resend/disable/promote) leverage `adminRouter` with tRPC admin guard.

## AI Assistance _(In Progress)_

- `aiRouter.generateScript` provides OpenAI-based code suggestions when `aiEnabled` is true and an API key is configured (`src/lib/ai.ts`).
- No UI gating beyond feature flag; requires rate-limit enforcement and user feedback loops before production rollout.

## Rate Limiting & Quotas _(In Progress)_

- Foundational services (`src/lib/rate-limiting`) implement quota tracking, rate limiter primitives, and usage reporting.
- `quotaManagementRouter` exposes APIs for status and configuration, but several outputs reference TODO or placeholder data.

## Documentation & Public Site _(Production Ready)_

- `apps/cronium-info` distributes marketing pages, quick-start guides, and runtime helper docs using the shared UI kit.
- Supports partial prerendering and incremental static regeneration for documentation updates.
