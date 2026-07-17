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
| `create_event`           | Create one event (DRAFT by default).                                                                                    |
| `activate_event`         | Set a scheduled event ACTIVE (registers the live scheduler).                                                            |
| `create_workflow`        | Wire existing events into a workflow (DAG).                                                                             |
| `create_workflow_bundle` | Create several events **and** a workflow chaining them, in one call.                                                    |

Everything is created as **DRAFT** unless you say otherwise, so nothing runs until you review
and activate it in Cronium — the built-in approval gate.

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

## Notes & limits

- Local only (stdio). For the claude.ai **web** app you need the remote server (Phase 3).
- The token has full user rights (no per-token scopes yet — Phase 4).
- The server does no validation of its own beyond shape; Cronium performs authoritative
  validation and returns errors the model can correct.
