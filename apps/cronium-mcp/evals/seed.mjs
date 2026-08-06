#!/usr/bin/env node
/**
 * Seed the deterministic EVAL-* fixture set for the MCP evaluations
 * (see eval.xml + README.md). Idempotent: deletes any existing EVAL-*
 * events/workflows first, recreates them through the MCP tools themselves,
 * and runs the two run-once flows so executions/logs exist.
 *
 * Usage:
 *   CRONIUM_BASE_URL=http://localhost:5001 CRONIUM_API_TOKEN=<mcp-scoped> \
 *     node apps/cronium-mcp/evals/seed.mjs
 */

const BASE = (process.env.CRONIUM_BASE_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.CRONIUM_API_TOKEN;
if (!BASE || !TOKEN) {
  console.error("set CRONIUM_BASE_URL and CRONIUM_API_TOKEN");
  process.exit(1);
}

let rpcId = 0;
async function callTool(name, args = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  const text = body.result.content[0].text;
  if (body.result.isError) throw new Error(`${name}: ${text}`);
  return text;
}
const asJson = (text) => JSON.parse(text);

async function cleanup() {
  const wfs = asJson(await callTool("list_workflows", { search: "EVAL-", limit: 100 }));
  for (const wf of wfs.workflows) {
    await callTool("delete_workflow", { id: wf.id });
    console.log(`deleted workflow #${wf.id} ${wf.name}`);
  }
  const evs = asJson(await callTool("list_events", { search: "EVAL-", limit: 100 }));
  for (const ev of evs.events) {
    await callTool("delete_event", { id: ev.id });
    console.log(`deleted event #${ev.id} ${ev.name}`);
  }
}

async function waitForExecution(workflowId, executionId, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    const ex = asJson(
      await callTool("get_execution", { workflowId, executionId }),
    );
    if (ex.status !== "RUNNING" && ex.status !== "PENDING") return ex;
    if (Date.now() - start > timeoutMs) throw new Error("execution timeout");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  await cleanup();

  // ── Standalone events ────────────────────────────────────────────────────
  console.log(
    await callTool("create_event", {
      name: "EVAL-Ping-Api",
      type: "HTTP_REQUEST",
      httpMethod: "GET",
      httpUrl: "https://example.com/health",
      tags: ["monitoring"],
      description: "Eval fixture: simple GET health check.",
    }),
  );
  console.log(
    await callTool("create_event", {
      name: "EVAL-Daily-Digest",
      type: "BASH",
      content: "echo digest",
      triggerType: "SCHEDULE",
      customSchedule: "0 7 * * 1-5",
      tags: ["reporting"],
      description: "Eval fixture: weekday-morning digest (kept DRAFT).",
    }),
  );
  console.log(
    await callTool("create_event", {
      name: "EVAL-Cleanup-Temp",
      type: "BASH",
      content: "echo cleanup",
      triggerType: "SCHEDULE",
      scheduleNumber: 6,
      scheduleUnit: "HOURS",
      tags: ["maintenance"],
      description: "Eval fixture: interval cleanup (kept DRAFT).",
    }),
  );

  // ── Orders pipeline (3 green steps) ──────────────────────────────────────
  const bundle1 = await callTool("create_workflow_bundle", {
    events: [
      {
        key: "extract",
        name: "EVAL-Extract-Orders",
        type: "BASH",
        content: "echo extracted 42 orders",
        tags: ["etl", "orders"],
      },
      {
        key: "transform",
        name: "EVAL-Transform-Orders",
        type: "BASH",
        content: "echo transformed",
        tags: ["etl"],
      },
      {
        key: "load",
        name: "EVAL-Load-Orders",
        type: "BASH",
        content: "echo loaded",
        tags: ["etl", "warehouse"],
      },
    ],
    workflow: {
      name: "EVAL-Orders-Pipeline",
      description: "Eval fixture: 3-step ETL chain.",
      triggerType: "MANUAL",
      connections: [
        { from: "extract", to: "transform", connectionType: "ON_SUCCESS" },
        { from: "transform", to: "load", connectionType: "ON_SUCCESS" },
      ],
    },
  });
  console.log(bundle1);

  // ── Failure-handler chain (fail → ON_FAILURE recovery step) ─────────────
  const bundle2 = await callTool("create_workflow_bundle", {
    events: [
      {
        key: "report",
        name: "EVAL-Broken-Report",
        type: "BASH",
        content: "echo report generation failed >&2\nexit 3",
        tags: ["reporting"],
      },
      {
        key: "fallback",
        name: "EVAL-Fallback-Notice",
        type: "BASH",
        content: "echo fallback notice sent",
        tags: ["reporting"],
      },
    ],
    workflow: {
      name: "EVAL-Failure-Handler",
      description: "Eval fixture: failing step with ON_FAILURE fallback.",
      triggerType: "MANUAL",
      connections: [
        { from: "report", to: "fallback", connectionType: "ON_FAILURE" },
      ],
    },
  });
  console.log(bundle2);

  // ── Run both workflows once so executions/logs exist ────────────────────
  const wfs = asJson(await callTool("list_workflows", { search: "EVAL-", limit: 10 }));
  const byName = new Map(wfs.workflows.map((w) => [w.name, w.id]));

  for (const name of ["EVAL-Orders-Pipeline", "EVAL-Failure-Handler"]) {
    const id = byName.get(name);
    const started = await callTool("run_workflow", { id });
    const executionId = Number(/executionId=(\d+)/.exec(started)?.[1]);
    const ex = await waitForExecution(id, executionId);
    console.log(
      `${name}: execution #${executionId} → ${ex.status} ` +
        `(${ex.successfulEvents}/${ex.totalEvents} ok)`,
    );
  }

  console.log("\nSeed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
