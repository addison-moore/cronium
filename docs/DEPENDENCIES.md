# Direct Dependency Inventory

Purpose/ownership record for every **direct production dependency** (security
plan Phase 4.2). Owner is the Cronium maintainers unless noted; this file is the
place to justify why each package ships. When adding a production dependency, add
a row here in the same PR. Dead/misplaced dependencies are pruned as they are
found (grep for imports + `tsc` + a production build before removal); a
`knip`/`depcheck` pass is the recommended local tool, with the caveat that this
monorepo's `@/*` path aliases and the shared `@cronium/ui` layer produce false
positives that must be verified by hand.

## apps/cronium-app (`@cronium/app`)

### Framework & data

| Package                                                           | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `next`                                                            | Application framework (App Router, API routes).     |
| `react`, `react-dom`                                              | UI runtime.                                         |
| `next-auth`                                                       | Authentication/session provider.                    |
| `next-themes`                                                     | Light/dark theme handling.                          |
| `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@trpc/next` | Typed API layer.                                    |
| `@tanstack/react-query`                                           | Async cache backing tRPC React hooks.               |
| `superjson`                                                       | tRPC transformer for rich types over the wire.      |
| `@t3-oss/env-nextjs`                                              | Typed, validated environment access.                |
| `zod`                                                             | Runtime schema validation (inputs, env, DTOs).      |
| `drizzle-orm`                                                     | Postgres ORM (schema in `src/shared/schema.ts`).    |
| `pg`, `pg-cursor`                                                 | Postgres driver + server-side cursor for streaming. |

### Execution, scheduling & integrations

| Package                                                                                | Purpose                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `express`                                                                              | HTTP server for the standalone socket process (`server.ts`).     |
| `ws`                                                                                   | WebSocket primitive used by the socket/terminal layer.           |
| `socket.io`, `socket.io-client`                                                        | Live log + terminal streaming transport.                         |
| `node-pty`                                                                             | PTY allocation for the interactive terminal.                     |
| `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-unicode11`, `@xterm/addon-web-links` | Browser terminal emulator.                                       |
| `node-schedule`, `cron-parser`                                                         | Schedule parsing/next-run computation.                           |
| `node-ssh`, `ssh2`                                                                     | Remote (SSH) execution + terminal transport.                     |
| `ioredis`                                                                              | Valkey/Redis client (rate limiting, socket tickets, revocation). |
| `lru-cache`                                                                            | In-process caches.                                               |
| `handlebars`                                                                           | Message/template rendering (`template-processor.ts`).            |
| `nodemailer`                                                                           | Email tool + notifications.                                      |
| `mysql2`, `mongodb`                                                                    | Drivers for the SQL/Mongo database tools.                        |
| `tar`                                                                                  | Archive handling for runner/payload packaging.                   |
| `axios`                                                                                | HTTP client used by server-side integrations.                    |
| `bcrypt`                                                                               | Password hashing.                                                |
| `nanoid`                                                                               | ID generation.                                                   |
| `dotenv`                                                                               | Env loading for scripts/standalone processes.                    |

### AI providers

| Package                                        | Purpose                               |
| ---------------------------------------------- | ------------------------------------- |
| `@anthropic-ai/sdk`, `openai`, `@google/genai` | Provider SDKs for the AI tool action. |

### UI (app-level)

| Package                                              | Purpose                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cronium/ui`                                        | Shared internal component library.                                                                                                                      |
| `@radix-ui/react-*`                                  | Accessible UI primitives (dialog, select, tabs, tooltip, …). Also declared by `@cronium/ui`; retained here for components rendered directly in the app. |
| `lucide-react`                                       | Icon set.                                                                                                                                               |
| `@monaco-editor/react`, `monaco-editor`              | Self-hosted code editor.                                                                                                                                |
| `@xyflow/react`                                      | Workflow graph canvas.                                                                                                                                  |
| `react-hook-form`, `@hookform/resolvers`             | Forms + zod resolver.                                                                                                                                   |
| `react-day-picker`                                   | Date picker.                                                                                                                                            |
| `prismjs`                                            | Syntax highlighting.                                                                                                                                    |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Class composition utilities.                                                                                                                            |
| `zustand`                                            | Client state store.                                                                                                                                     |

## packages/ui (`@cronium/ui`)

Shared component library. Depends on the `@radix-ui/react-*` primitives,
`lucide-react`, `prismjs`, `react-day-picker`, `react-hook-form` +
`@hookform/resolvers`, `class-variance-authority`/`clsx`/`tailwind-merge`,
`date-fns`, `next-themes`, and `zod` — each backing a specific exported
component. `react`/`react-dom` are peers provided by the consuming app.

## apps/cronium-info (`@cronium/info`)

Marketing/docs site. Direct production deps: `next`, `react`, `react-dom`,
`@cronium/ui`, `lucide-react`, `clsx`, `prismjs` (docs code highlighting), and
`nodemailer` (contact form). `@cronium/tailwind-config` supplies styling presets.

## Deprecated-package budget

Direct dependencies must not be deprecated. Transitive deprecated packages are
tracked here as a **budget** and only shrink as parents update their ranges — a
PR that grows this list should update a parent, add an override in
`pnpm-workspace.yaml`, or justify the addition here.

Current budget: **7** deprecated transitive packages (as of 2026-07-22):

| Package                         | Pulled in via                             |
| ------------------------------- | ----------------------------------------- |
| `@esbuild-kit/core-utils@3.3.2` | drizzle-kit (`@esbuild-kit/esm-loader`)   |
| `@esbuild-kit/esm-loader@2.6.5` | drizzle-kit                               |
| `glob@10.5.0`                   | build/test tooling                        |
| `glob@7.2.3`                    | legacy transitive (rimraf/inflight chain) |
| `inflight@1.0.6`                | legacy `glob@7` chain                     |
| `node-domexception@1.0.0`       | fetch/formdata polyfill chain             |
| `whatwg-encoding@3.1.1`         | jsdom (test env)                          |

A fully automated gate is not wired: pnpm only emits deprecation warnings on
fresh resolution (not on a warm store, i.e. most CI runs), and lockfile contents
do not carry deprecation status — reliable detection would need per-package
registry introspection. The budget is therefore enforced at review time against
this list; run `pnpm install --force` locally on a cold store to refresh it.

## Go services

`apps/orchestrator`, `apps/runner/cronium-runner`, `apps/runtime/cronium-runtime`
pin their modules in `go.mod`; the Go toolchain is pinned to `go 1.25.12` across
`go.work`, every `go.mod`, CI, and the Docker builders, and CI runs `govulncheck`
per module.
