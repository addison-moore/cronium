# @cronium/mcp-server

A local **stdio MCP server** that lets an AI app (Claude Desktop, Claude Code, or any
MCP client that runs local servers) create Cronium events and workflows on your behalf.

It authenticates to your Cronium instance with an **API token** — no OAuth, nothing exposed
to the internet. This is the Phase-2 (local) path from `_plans/mcp/PLAN.md`; a remote
OAuth-secured server for the claude.ai web app is a later phase.

## What it can do

Tools exposed to the model:

| Tool                     | Purpose                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `get_capabilities`       | **Call first.** Enums, defaults, scheduling guidance, tool types + actions, and your real tool-credential / server ids. |
| `validate_plan`          | Dry-run: check a draft (events + optional workflow) **without creating anything**.                                      |
| `create_event`           | Create one event (DRAFT by default).                                                                                    |
| `activate_event`         | Set a scheduled event ACTIVE (registers the live scheduler).                                                            |
| `create_workflow`        | Wire existing events into a workflow (DAG).                                                                             |
| `create_workflow_bundle` | Create several events **and** a workflow chaining them, in one call.                                                    |

Everything is created as **DRAFT** unless you say otherwise, so nothing runs until you review
and activate it in Cronium — the built-in approval gate. Records created through MCP are tagged
`source="mcp"` for provenance/audit.

## Setup

### 1. Mint a Cronium API token

In Cronium: **Settings → API Tokens → Create**. Copy the token (shown once). It acts as your
full user identity, so treat it like a password.

> Requires a Cronium build where tRPC accepts API-token bearer auth (the `sessionFromApiToken`
> change in `createTRPCContext`). Older builds only accept browser sessions.

### 2. Build

```bash
pnpm install
pnpm --filter @cronium/mcp-server build
```

### 3a. Claude Desktop

Add to `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "cronium": {
      "command": "node",
      "args": ["/absolute/path/to/apps/cronium-mcp/dist/index.js"],
      "env": {
        "CRONIUM_BASE_URL": "http://localhost:5001",
        "CRONIUM_API_TOKEN": "<your-token>"
      }
    }
  }
}
```

Restart Claude Desktop. Claude will ask permission before each tool call.

### 3b. Claude Code

```bash
claude mcp add cronium \
  --env CRONIUM_BASE_URL=http://localhost:5001 \
  --env CRONIUM_API_TOKEN=<your-token> \
  -- node /absolute/path/to/apps/cronium-mcp/dist/index.js
```

## Example

> "Create a workflow in Cronium: a SQL event that counts users in the `users` database, then a
> Slack event that posts the count to #general at 8am every day."

Claude will `get_capabilities` (to find your SQL + Slack credential ids and the action params),
draft the two events + workflow with defaults filled (Local execution, 30s timeout,
`customSchedule: "0 8 * * *"`), show you the draft, and — once you approve — call
`create_workflow_bundle`. The events land as DRAFT; review and activate them in Cronium.

## Configuration

| Env var             | Required | Notes                                             |
| ------------------- | -------- | ------------------------------------------------- |
| `CRONIUM_BASE_URL`  | ✅       | e.g. `http://localhost:5001` or your instance URL |
| `CRONIUM_API_TOKEN` | ✅       | a Cronium API token                               |

## Remote endpoint (claude.ai web app & other HTTP MCP clients)

Cronium also serves the **same tools over HTTP** at **`/api/mcp`** (in the app itself — no
separate process). Use this for the claude.ai **web** app, ChatGPT (Business+ dev mode), or any
MCP client that connects to a remote server.

- **URL:** `https://<your-cronium-host>/api/mcp` (must be HTTPS and reachable by the client).
- **Auth — two options:**
  - **OAuth 2.1 (recommended for claude.ai):** Cronium is a full OAuth 2.1 authorization server
    for this resource (PKCE, dynamic client registration, discovery). Just add the connector URL
    in claude.ai and click **Connect** — you'll be sent to Cronium to sign in and approve; no
    token to paste. Discovery lives at `/.well-known/oauth-authorization-server` and
    `/.well-known/oauth-protected-resource`; the `/api/mcp` `401` advertises them.
  - **Static bearer:** send a Cronium API token — `Authorization: Bearer <token>` (claude.ai
    "custom header" auth, or any client). Unauthenticated/invalid tokens get `401`.
- **Transport:** stateless JSON-RPC over `POST` (Streamable HTTP, JSON-response mode). `GET`
  returns `405` (no server-initiated stream needed).

Quick check with curl:

```bash
curl -s https://<host>/api/mcp \
  -H "authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

> **Security:** `/api/mcp` is internet-facing when your instance is. Serve it over HTTPS. Both an
> OAuth access token and a raw Cronium API token currently grant full user rights (per-token
> scopes are a planned follow-up, `_plans/mcp/PLAN.md` Phase 4).

## Notes & limits

- The stdio server (this package) is local-only; the remote `/api/mcp` endpoint covers the
  claude.ai web app.
- The token has full user rights (no per-token scopes yet — Phase 4).
- Neither server validates beyond shape; Cronium performs authoritative validation and returns
  errors the model can correct. In particular `toolId` is checked at execution, not creation —
  the model should use real ids from `get_capabilities`.
