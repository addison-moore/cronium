# Cronium MCP evaluations

Ten independent, **read-only**, multi-tool questions (`eval.xml`, mcp-builder
`<evaluation>/<qa_pair>` format) that test whether an agent can actually use
the Cronium MCP surface: finding events by tag/schedule, reading workflow
graphs and connection types, and digging through executions and logs for
step results and error messages.

## Prerequisites

A running Cronium instance with the deterministic `EVAL-*` fixture set. Seed
(or restore) it with:

```bash
CRONIUM_BASE_URL=http://localhost:5001 \
CRONIUM_API_TOKEN=<mcp-scoped-token> \
node apps/cronium-mcp/evals/seed.mjs
```

The seed is idempotent — it deletes any existing `EVAL-*` events/workflows and
recreates them **through the MCP tools themselves**, then runs the two
workflows once so executions and logs exist:

| Fixture                | Shape                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `EVAL-Ping-Api`        | HTTP_REQUEST GET (DRAFT)                                                                |
| `EVAL-Daily-Digest`    | BASH, cron `0 7 * * 1-5` (DRAFT)                                                        |
| `EVAL-Cleanup-Temp`    | BASH, every 6 HOURS (DRAFT)                                                             |
| `EVAL-Orders-Pipeline` | Extract → Transform → Load (ON_SUCCESS×2); run once → SUCCESS 3/3                       |
| `EVAL-Failure-Handler` | Broken-Report (exit 3) → Fallback-Notice (ON_FAILURE); run once → FAILURE, fallback ran |

Everything stays DRAFT/MANUAL, so nothing fires on a schedule; the fixtures are
inert between eval runs. Answers key off names and stable outcomes, not ids,
so reseeding does not change them.

## Running

Point an MCP-capable agent at the instance (remote `/api/mcp` connector, or
the stdio bridge in this package) with an **mcp-scoped token**, ask each
`<question>`, and compare the agent's final answer against `<answer>` (string
containment is sufficient — answers are single tokens or exact names).

Answers were verified by driving the tools directly against a seeded live
instance (2026-08-06). If a fixture's observed behavior ever changes (e.g. the
workflow engine's overall-status semantics), re-verify before blaming the
agent.
