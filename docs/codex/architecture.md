# Architecture

This document describes how the Cronium platform is assembled across the monorepo, how requests flow through the system, and which services participate in script execution.

## Application Topology

Cronium ships as a polyglot mono-repository with four primary runtime components and several shared packages:

- **Cronium App (`apps/cronium-app`)** – Next.js 15 App Router project that serves both UI and backend concerns. It exposes a tRPC API (`src/server/api`) backed by Drizzle ORM models (`src/shared/schema`), manages authentication, queues jobs, and streams WebSockets for logs and terminals.
- **Cronium Orchestrator (`apps/orchestrator`)** – Go daemon (Cobra CLI) that authenticates against the internal job queue, provisions execution environments (Docker containers or SSH payloads), collects logs, and reports execution lifecycle events.
- **Runtime Service (`apps/runtime/cronium-runtime`)** – Go REST API that scripts call during execution to fetch variables, push outputs, and execute tool actions. It relies on Valkey for caching and JWT-scoped authentication.
- **Cronium Runner (`apps/runner/cronium-runner`)** – Go binary invoked inside controlled environments. It verifies payload signatures, hydrates helper libraries, and runs user code with stdout/stderr streaming.
- **Shared Packages (`packages/ui`, `packages/config-*`)** – Provide React component kits and lint/build configuration reused by the UI-facing apps.
- **Marketing Site (`apps/cronium-info`)** – Separate Next.js app for public documentation; consumes the shared UI library but is largely static.

## Frontend & API Layer

The control plane in `apps/cronium-app` is responsible for both rendering the dashboard and exposing API endpoints:

- **Routing & Localisation** – Leverages the App Router (`src/app/[lang]/...`) with `next-intl` for locale-aware routes and translations.
- **Authentication** – `src/lib/auth.ts` wires NextAuth credential logins, updates last-login timestamps, and surfaces roles for access checks.
- **tRPC Routers** – Defined under `src/server/api/routers`, covering domains such as events, workflows, tools, monitoring, servers, admin, quota management, and AI. Each procedure validates input with Zod schemas from `src/shared/schemas` before calling storage services.
- **Database Access** – Drizzle ORM models defined in `src/shared/schema.ts` map to Postgres tables. `src/server/storage` wraps these models with domain-specific modules, centralising CRUD logic.
- **Schedulers & Services** – `src/lib/scheduler` and `src/lib/services` implement cron-like scheduling, job queue operations, and job payload transformations.
- **Realtime Channels** – WebSocket managers (`src/server/logs-websocket.ts`, `src/server/terminal-websocket.ts`) stream execution logs and terminal IO to the UI.

## Execution Pipeline

Cronium’s runtime pipeline orchestrates the following sequence:

1. **Authoring & Triggering** – Users configure events (scripts, HTTP actions, tool actions) or workflows in the dashboard. Manual runs and schedule toggles call `events.execute` / `workflows.execute` tRPC endpoints.
2. **Job Enqueueing** – `jobService` persists a `jobs` row with payload, target, and priority metadata. Logs records are initialised to capture execution telemetry.
3. **Orchestrator Polling** – External workers authenticate against `/api/internal/jobs/queue`, claim work (`jobService.claimJobs`), and receive enriched payloads via the enhanced job transformer (adds SSH server details, workflow context).
4. **Environment Provisioning** – Depending on configuration, the orchestrator runs jobs inside Docker (container executor) or over SSH (multi-server executor). Each job streams logs back via `logger.Streamer` and posts heartbeats and status updates using the internal `/api/internal/jobs/{id}` routes.
5. **Runtime Helpers** – The Runner CLI executes payloads using helper scripts (`apps/runtime/runtime-helpers`) while, for container jobs, the Runtime Service exposes HTTP endpoints to interact with Cronium state (variables, tool actions, condition flags).
6. **Completion & Cleanup** – Execution status, outputs, and per-phase timing are persisted. Schedulers handle retries, conditional follow-up actions, and workflow progression. Integrity services reconcile logs and executions to avoid orphaned records.

## Supporting Services

- **Scheduler** – `ScriptScheduler` (`src/lib/scheduler/scheduler.ts`) loads active events from storage, schedules them with `node-schedule`, and ensures single-flight execution with duplicate run protection.
- **Workflow Executor** – (`src/lib/workflow-executor.ts`) coordinates workflow graph traversal, node execution, conditional routing, and scheduled workflow triggers.
- **Tool Plugins** – UI and server code under `src/tools` registers built-in connectors (email, Slack, Discord, Google Sheets, Microsoft Teams, Notion, Trello). Plugin metadata is used both for credential management and job-time tool execution.
- **Security Utilities** – Credential encryption (`src/lib/security/credential-encryption.ts`), audit logging, rate limiting, and API token management underpin access control.

## Persistence & Messaging

- **Database** – PostgreSQL, accessed through Drizzle. Schemas cover users, events, workflows, logs, jobs, servers, variables, tool credentials, webhooks, and system settings. Migrations reside in `apps/cronium-app/drizzle`.
- **Caching** – Valkey (Redis-compatible) is used by the Runtime Service for execution-scoped caching and rate limiting.
- **Message Protocols** – HTTP (tRPC/app routes) for control interactions, WebSockets for streaming logs and terminal sessions.

## Infrastructure & Deployment

- **Docker Compose** – `infra/docker/docker-compose.*.yml` defines local and stack deployments, including Valkey, orchestrator, runtime API, and prebuilt execution images (Node.js, Python, Bash).
- **Build & Bootstrap Scripts** – `infra/scripts` and top-level `scripts` automate environment setup, Docker image builds, orchestrator/local dev loops, and linting of Go services.
- **Go Tooling** – The Go workspaces (`go.work`) tie orchestrator, runtime, and runner modules together for unified builds and tests.

## Security & Access Control

- Credentials for servers and tool integrations are stored in Postgres with optional encryption; server creation validates SSH connectivity before persisting.
- API tokens are user-scoped, revocable, and surfaced in the dashboard (`settings/api-tokens`). Internal orchestrator endpoints require `INTERNAL_API_KEY` authorization.
- Rate limiting and quota enforcement helpers exist (`src/lib/rate-limiting`) to guard API usage, though several enforcement endpoints still require completion.

## Observability

- Execution logs and workflow logs are persisted and exposed through dedicated routers for UI consumption.
- Monitoring dashboards (`src/components/monitoring/MonitoringClient.tsx`) currently surface aggregate counts collected by `dashboardService`, supplemented by placeholder system metrics. The orchestrator and runtime services export Prometheus-compatible metrics and HTTP health probes.
