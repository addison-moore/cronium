# @cronium/mcp-server

A local **stdio MCP bridge** that lets an AI app (Claude Desktop, Claude Code, or any
MCP client that runs local servers) build automations in your Cronium instance:
draft, create, **run, inspect, fix, and activate** events and workflows.

It is a thin bridge: every JSON-RPC message from the client is forwarded to your
instance's **`/api/mcp`** endpoint with your API token, and the response is streamed
back. The tools themselves are defined once, inside the app
(`apps/cronium-app/src/app/api/mcp/tools.ts`), so local and remote clients always see
the identical tool surface. No runtime dependencies (Node 18+).

## The tool surface

| Group               | Tools                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Discover & validate | `get_capabilities` (call first), `validate_plan` (dry-run, creates nothing)                                       |
| Read                | `list_events`, `get_event`, `get_event_logs`, `list_workflows`, `get_workflow`, `get_executions`, `get_execution` |
| Write               | `create_event`, `update_event`, `create_workflow`, `update_workflow`, `create_workflow_bundle`                    |
| Lifecycle           | `activate_event`, `deactivate_event`, `delete_event`, `delete_workflow`                                           |
| Run & verify        | `run_event`, `run_workflow` (execute real code — the client asks for approval)                                    |

The intended loop: **discover → validate → create (DRAFT) → run → read logs/executions
→ fix with update → activate.** Everything is created as DRAFT unless you say
otherwise. Records created through MCP are tagged `source="mcp"` for provenance, and
every tool carries MCP annotations (`readOnlyHint`/`destructiveHint`/…) so clients can
gate approvals. Env-var **values**, credential secrets, and stored webhook keys are
never returned; a newly minted webhook key is shown exactly once.

## Setup

### 1. Mint an MCP-scoped Cronium API token

In Cronium: **Settings → API Tokens → Create**, and enable **"Limit to MCP"**. Scopes
are required and tokens expire (≤90 days) — the `mcp` scope permits exactly the tool
surface above and nothing else. Copy the token (shown once).

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

Restart Claude Desktop. Claude asks permission before each tool call. A bad URL or
token fails at connect time (the bridge probes `/api/mcp` on startup).

### 3b. Claude Code

```bash
claude mcp add cronium \
  --env CRONIUM_BASE_URL=http://localhost:5001 \
  --env CRONIUM_API_TOKEN=<your-token> \
  -- node /absolute/path/to/apps/cronium-mcp/dist/index.js
```

> Claude Code (and other clients with remote-server support) can also skip the bridge
> entirely and connect straight to `https://<your-instance>/api/mcp` with an
> `Authorization: Bearer <token>` header — the bridge exists for stdio-only clients
> and localhost instances.

## Example

> "Create a workflow in Cronium: a SQL event that counts users in the `users` database,
> then a Slack event that posts the count to #general at 8am every day. Run it once to
> make sure it works."

Claude will `get_capabilities` (your SQL + Slack credential ids and action params),
`validate_plan`, show you the draft, `create_workflow_bundle` on your approval,
`run_workflow`, poll `get_execution` for the step results, fix anything broken via
`update_event`, and activate once green — all without leaving the conversation.

## Configuration

| Env var             | Required | Notes                                             |
| ------------------- | -------- | ------------------------------------------------- |
| `CRONIUM_BASE_URL`  | ✅       | e.g. `http://localhost:5001` or your instance URL |
| `CRONIUM_API_TOKEN` | ✅       | an MCP-scoped Cronium API token                   |

## Remote endpoint (claude.ai web app & other HTTP MCP clients)

Cronium serves the **same tools over HTTP** at **`/api/mcp`** (in the app itself — no
separate process). Use this for the claude.ai **web** app, ChatGPT (Business+ dev
mode), or any MCP client that connects to a remote server.

- **URL:** `https://<your-cronium-host>/api/mcp` (must be HTTPS and reachable by the client).
- **Auth — two options:**
  - **OAuth 2.1 (recommended for claude.ai):** Cronium is a full OAuth 2.1 authorization
    server for this resource (PKCE, dynamic client registration, discovery). Add the
    connector URL in claude.ai and click **Connect** — you sign in to Cronium and
    approve; no token to paste. OAuth access tokens carry the `mcp` scope, so a
    connector is inherently limited to MCP operations. Discovery lives at
    `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
  - **Static bearer:** send a Cronium API token — `Authorization: Bearer <token>`
    (claude.ai "custom header" auth, or any client). Unauthenticated/invalid tokens get `401`.
- **Transport:** stateless JSON-RPC over `POST` (Streamable HTTP, JSON-response mode).
  `GET` returns `405` (no server-initiated stream needed).

Quick check with curl:

```bash
curl -s https://<host>/api/mcp \
  -H "authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

> **Security:** `/api/mcp` is internet-facing when your instance is. Serve it over
> HTTPS. Tokens require an explicit scope and expiry; prefer **"Limit to MCP"** over
> `full` so a leaked connector token can't act beyond automation building.

## Notes & limits

- Tests: `pnpm --filter @cronium/mcp-server test` (round-trip against a mock endpoint).
- The bridge only validates configuration; Cronium performs authoritative validation
  and returns errors the model can read and correct. `toolId` is checked at
  execution/validation, not creation — the model should use real ids from
  `get_capabilities` and check drafts with `validate_plan`.
- Active plan for this surface: `_plans/mcp/PLAN.md` (npm publishing of this package
  is the planned next distribution step).
