# MCP — building events & workflows from an AI app

Cronium exposes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server so AI apps (Claude, and any MCP client) can **build automations end to
end** from natural language: draft events + workflows, create them as drafts,
**run them, read the results, fix what's broken, and activate** — the full
iterate loop, without leaving the conversation.

User-facing docs: <https://cronium.app/docs/mcp>.

## One tool surface, two transports

The tools are defined once, in
`apps/cronium-app/src/app/api/mcp/tools.ts`, and served two ways:

| Transport                                                                        | Where                               | Auth                           | Use                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| **Remote** `/api/mcp` (in-process Next route, Streamable HTTP / stateless JSON)  | `apps/cronium-app/src/app/api/mcp/` | OAuth 2.1, or bearer API token | claude.ai web app, ChatGPT (Business+), any remote MCP client |
| **Local stdio bridge** `@cronium/mcp-server` (npm, `npx -y @cronium/mcp-server`) | `apps/cronium-mcp/`                 | bearer API token (env)         | Claude Desktop / Claude Code and other stdio-only clients     |

The bridge is ~180 dependency-free lines: it forwards each stdin JSON-RPC
message to `POST <CRONIUM_BASE_URL>/api/mcp` with the token and writes the
response back, probing the endpoint at startup so a bad URL/token fails at
connect time. There is deliberately no second tool implementation.

## The tools

- **Discover/validate:** `get_capabilities` (enums, defaults, scheduling +
  iterate-loop guidance, tool actions with param metadata, the user's real
  credential/server ids), `validate_plan` (dry-run a keyed events+workflow
  plan: schemas, toolActionConfig against real credentials, DAG/fan-in/cycle).
- **Read:** `list_events`, `get_event`, `get_event_logs`, `list_workflows`,
  `get_workflow`, `get_executions`, `get_execution`. Summarized + paginated;
  list rows carry no script bodies; log/step output is tail-truncated
  (`maxOutputChars`); graphs are expressed by event id, not ReactFlow JSON.
- **Write:** `create_event`, `update_event`, `create_workflow`,
  `update_workflow` (its `graph` REPLACES the node/edge set, synthesized
  server-side from `{events: [ids], connections: [{from,to,connectionType}]}`),
  `create_workflow_bundle` (events + workflow in one call, best-effort rollback).
- **Lifecycle:** `activate_event`, `deactivate_event`, `delete_event`,
  `delete_workflow`.
- **Run:** `run_event` (→ `{jobId, logId}`, poll `get_event_logs`),
  `run_workflow` (→ `{executionId}`, poll `get_execution`). Both work on DRAFT
  — running is the verify step before activation.

Every tool carries MCP `annotations` (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`) in `tools/list` so clients can gate approval.

## Auth

`createTRPCContext` (`src/server/api/trpc.ts`) accepts, in order: a NextAuth
cookie session, then an `Authorization: Bearer <api-token>`; the `/api/mcp`
route additionally accepts an OAuth 2.1 access token. API tokens are the
encrypted-at-rest `api_tokens` rows; mint one under **Settings → API Tokens**,
or use **Settings → Connect AI** (`McpConnectManager`) — the onboarding tab
that shows the endpoint URL, mints an `mcp`-scoped token in one click, and
emits ready-to-paste client snippets.

**OAuth 2.1** (for the claude.ai connector) — Cronium is the authorization server:
`src/lib/mcp-oauth/` + `src/app/api/mcp/oauth/*` (PKCE, RFC 7591 dynamic client
registration — rate-limited and bounded, RFC 8414/9728 discovery served at
`/.well-known/*` via `next.config.mjs` rewrites). Distinct from `/api/oauth/*`,
which is **outbound** tool OAuth (Cronium as a client to Google/Slack).

## Least privilege (token scopes)

Scopes are **mandatory** (security plan Phase 1.5): every API/OAuth bearer
token carries an explicit scope list, legacy unscoped tokens are deny-all, and
broad access requires the explicit `full` scope. The `mcp` scope
(`src/server/token-scopes.ts`) permits exactly the tRPC paths the MCP tools
need — the create/read/update/run/activate loop plus discovery — and nothing
else; `enforceTokenScopes` middleware on `protectedProcedure` rejects the rest
with `FORBIDDEN`. OAuth access tokens carry the `mcp` scope the same way. The
API-tokens UI has a **"Limit to MCP"** toggle. Cookie sessions are never
scope-limited (`null` scopes exist only for them).

Secret hygiene on this surface: env-var **values**, credential secrets, and
stored webhook keys are never readable through any MCP tool; a newly minted
webhook key is surfaced exactly once at create/update, mirroring the UI.

## Provenance & audit

Events and workflows created via MCP are tagged `source = "mcp"` (nullable
`source` column on both tables) and emit a `[MCP-AUDIT]` server log line.
`ctx.requestSource` is set from the `x-cronium-source: mcp` header or directly
by the `/api/mcp` route; only the value `"mcp"` is honored.

## Tests

- `src/app/api/mcp/__tests__/mcp-route-contract.test.ts` — JSON-RPC protocol +
  auth contract for the route.
- `src/app/api/mcp/__tests__/mcp-tools.test.ts` — handler behavior:
  summarization, clamps, truncation, graph synthesis, rollback, webhook-key
  surfacing.
- `src/server/api/routers/__tests__/mcp.test.ts` — `getCapabilities` /
  `validatePlan` through the real middleware chain.
- `apps/cronium-mcp/test/bridge.test.mjs` — bridge round-trip against a mock
  endpoint (`pnpm --filter @cronium/mcp-server test`).

## Key files

- `src/app/api/mcp/route.ts`, `.../tools.ts` — remote JSON-RPC endpoint + the
  single tool-surface definition.
- `src/app/api/mcp/oauth/*`, `src/lib/mcp-oauth/*` — OAuth 2.1 server.
- `src/server/api/routers/mcp.ts` — `getCapabilities` + `validatePlan`.
- `src/server/token-scopes.ts` — scope catalog + enforcement helper.
- `src/server/api/trpc.ts` — token auth, `tokenScopes`, `requestSource`, `enforceTokenScopes`.
- `apps/cronium-mcp/` — the local stdio bridge package.

Releases: tag `mcp-server-v<version>` → `.github/workflows/npm-publish.yml`
publishes to npm with provenance (OIDC trusted publishing; see the package
README's "Releasing" section for the one-time npmjs.com setup).

Active plan: `_plans/mcp/PLAN.md`.
