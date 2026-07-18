# MCP — creating events & workflows from an AI app

Cronium exposes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server so AI apps (Claude, and any MCP client) can **draft and create events and
workflows** from natural language. The user describes the automation; the agent
reads Cronium's capabilities, drafts events + a workflow (filling defaults), and
— once the user approves — creates them as **drafts**.

User-facing docs: <https://cronium.app/docs/mcp>.

## Two servers, same tools

| Server                                        | Where                               | Auth                           | Use                                                           |
| --------------------------------------------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| **Remote** `/api/mcp` (in-process Next route) | `apps/cronium-app/src/app/api/mcp/` | OAuth 2.1, or bearer API token | claude.ai web app, ChatGPT (Business+), any remote MCP client |
| **Local stdio** `@cronium/mcp-server`         | `apps/cronium-mcp/`                 | bearer API token (env)         | Claude Desktop / Claude Code                                  |

Both expose the same tools: `get_capabilities`, `validate_plan`, `create_event`,
`activate_event`, `create_workflow`, `create_workflow_bundle`. The remote route
calls the tRPC app router in-process via `createCaller`; the stdio server calls
`/api/trpc` over HTTP with a hand-rolled superjson client (`apps/cronium-mcp/src/cronium.ts`).

## How creation works

- **Discovery** — `mcp.getCapabilities` (`src/server/api/routers/mcp.ts`) returns
  enums, defaults, scheduling guidance, each tool type's actions + param metadata,
  and the user's real tool-credential and server ids. The agent needs these to
  build a valid `toolActionConfig` (`toolType`/`toolId`/`actionId`/`parameters`).
- **Dry-run** — `mcp.validatePlan` validates a proposed plan (events keyed
  locally + an optional workflow chaining them by key) **without persisting**:
  event schemas, `toolActionConfig`, and the workflow graph (unknown keys,
  self-loops, fan-in, cycles).
- **Create** — reuses the existing `events.create` / `events.activate` /
  `workflows.create` procedures (no duplicate create logic). Events default to
  `DRAFT`. `create_workflow_bundle` creates the events then the workflow (nodes
  reference the new event ids), with best-effort rollback.
- **Scheduling** — a specific time (e.g. 8am daily) requires
  `customSchedule: "0 8 * * *"`; `events.create` does not register the live
  scheduler, so a scheduled event needs `events.activate`.

## Auth

`createTRPCContext` (`src/server/api/trpc.ts`) accepts, in order: a NextAuth
cookie session, then an `Authorization: Bearer <api-token>`; the `/api/mcp` route
additionally accepts an OAuth 2.1 access token. API tokens are the
encrypted-at-rest `api_tokens` rows; mint one under **Settings → API Tokens**.

**OAuth 2.1** (for the claude.ai connector) — Cronium is the authorization server:
`src/lib/mcp-oauth/` + `src/app/api/mcp/oauth/*` (PKCE, RFC 7591 dynamic client
registration, RFC 8414/9728 discovery served at `/.well-known/*` via
`next.config.mjs` rewrites). Distinct from `/api/oauth/*`, which is **outbound**
tool OAuth (Cronium as a client to Google/Slack).

## Least privilege (token scopes)

`api_tokens.scopes` (`jsonb string[] | null`; `null` = full rights). The `mcp`
scope (`src/server/token-scopes.ts`) permits only the tRPC paths the MCP tools
need. `enforceTokenScopes` middleware on `protectedProcedure` forbids anything
else for a scoped token; OAuth access tokens carry the `mcp` scope the same way.
The API-tokens UI has a **"Limit to MCP"** toggle.

## Provenance & audit

Events and workflows created via MCP are tagged `source = "mcp"` (nullable
`source` column on both tables) and emit a `[MCP-AUDIT]` server log line.
`ctx.requestSource` is set from the `x-cronium-source: mcp` header (stdio server)
or directly by the `/api/mcp` route; only the value `"mcp"` is honored.

## Key files

- `src/app/api/mcp/route.ts`, `.../tools.ts` — remote JSON-RPC endpoint + tools.
- `src/app/api/mcp/oauth/*`, `src/lib/mcp-oauth/*` — OAuth 2.1 server.
- `src/server/api/routers/mcp.ts` — `getCapabilities` + `validatePlan`.
- `src/server/token-scopes.ts` — scope catalog + enforcement helper.
- `src/server/api/trpc.ts` — token auth, `tokenScopes`, `requestSource`, `enforceTokenScopes`.
- `apps/cronium-mcp/` — the local stdio server package.
