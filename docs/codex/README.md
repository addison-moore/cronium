# Cronium Project Overview

Cronium is an automation and orchestration platform that combines a Next.js control plane with Go-based worker services to execute scheduled and event-driven workloads. The system allows users to author scripts, assemble workflows, launch executions on containerized or remote targets, and observe results through rich dashboards.

## Component Inventory

| Component            | Location                       | Notes                                                                                                                                        |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cronium App          | `apps/cronium-app`             | Next.js 15 App Router application that provides the primary UI, tRPC API layer, job scheduling logic, and database access via Drizzle ORM.   |
| Cronium Orchestrator | `apps/orchestrator`            | Go service that polls the internal job queue, provisions container or SSH jobs, streams logs, and reports execution results back to the API. |
| Runtime Service      | `apps/runtime/cronium-runtime` | Go HTTP API that script runtimes call for variables, tool actions, and workflow control; backed by Valkey for caching.                       |
| Runner CLI           | `apps/runner/cronium-runner`   | Go executable that unpacks signed payloads and runs scripts inside provisioned environments.                                                 |
| UI Toolkit           | `packages/ui`                  | Shared component library (Radix + Tailwind) used across Next.js applications.                                                                |
| Config Packages      | `packages/config-*`            | Shareable ESLint, Tailwind, and TypeScript configurations for the monorepo.                                                                  |
| Infrastructure       | `infra` and `scripts`          | Docker Compose topologies, development helpers, and build scripts for orchestrator/runtime images.                                           |
| Marketing Site       | `apps/cronium-info`            | Public documentation and marketing pages that reuse the shared UI package.                                                                   |

## System Flow at a Glance

1. Users sign in through NextAuth credentials and interact with the dashboard to manage events, workflows, tools, servers, and variables.
2. tRPC routers in `apps/cronium-app` validate requests, persist data via Drizzle, and enqueue jobs through `jobService` when executions are triggered.
3. Internal `/api/internal/jobs` endpoints expose the queue to registered orchestrators. The Go orchestrator claims work, prepares runtimes (Docker or SSH), and streams back status.
4. Scripts run with helper libraries and, when deployed in containers, communicate with the Runtime Service to fetch variables, emit outputs, and call tool actions.
5. Execution metadata and log records are written back to Postgres. WebSocket gateways surface real-time terminal feeds and log updates in the UI.

## Project State Snapshot

| Domain                   | Status           | Highlights                                                                                                                                                     |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events & Jobs            | Production ready | Script scheduling, retries, multi-server support, and job orchestration are end-to-end implemented.                                                            |
| Workflows                | Production ready | Graph-based workflow builder with execution history and scheduled/manual triggers.                                                                             |
| Remote Servers & Console | Production ready | SSH credential management with encrypted storage and an interactive terminal.                                                                                  |
| Tools & Integrations     | Mixed            | Email actions are functional; several plugins (Slack, Microsoft Teams, Google Sheets, Trello, Notion) expose UI but server routes still return mock responses. |
| Logs & Monitoring        | Mixed            | Event/workflow logs are backed by storage; monitoring dashboards aggregate limited metrics and still rely on placeholder data.                                 |
| Webhooks                 | In progress      | Database models exist, but the public router currently serves mock webhook data.                                                                               |
| Admin & Settings         | Production ready | User management, invitations, API tokens, and system settings persist to Postgres with encryption for sensitive values.                                        |
| AI Assistance            | In progress      | OpenAI-powered script generation gated behind feature flags; requires runtime configuration to operate.                                                        |
| Rate Limiting & Quotas   | In progress      | Foundational services exist (QuotaManager, RateLimiter) but several APIs return TODO placeholders.                                                             |

## Key Recommendations

- Replace mock responses in monitoring, webhook, and tool connectors with real data sources to reach production parity.
- Push filtering and pagination into database queries across events, workflows, servers, and admin routers to avoid unbounded in-memory processing.
- Address outstanding lint violations (`logs/lint.log`) and migrate away from the deprecated `next lint` runner before upgrading to Next.js 16.
- Harden test coverage by extracting lighter-weight unit tests that do not require the full Docker/dev stack, and add orchestrator/runtime integration checks.

## Further Reading

- [Architecture](./architecture.md) — detailed component and data-flow breakdowns.
- [Feature Breakdown](./features.md) — deep dive into every functional area with readiness notes.
- [Technical Debt & Recommendations](./tech-debt.md) — prioritized backlog of fixes and improvements.
