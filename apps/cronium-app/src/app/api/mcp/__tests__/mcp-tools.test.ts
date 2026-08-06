/**
 * @jest-environment node
 *
 * Unit tests for the MCP tool handlers (tools.ts): response summarization
 * (no script bodies in lists, env-var keys only), pagination clamps, log/step
 * output truncation, workflow-graph synthesis by event id, bundle rollback,
 * and one-time webhook-key surfacing. Handlers run against a stub tRPC caller.
 */

import { MCP_TOOL_BY_NAME, MCP_TOOLS } from "@/app/api/mcp/tools";
import type { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;

const BASE = "https://cronium.test";

function makeCaller() {
  return {
    mcp: {
      getCapabilities: jest.fn(),
      validatePlan: jest.fn(),
    },
    events: {
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
      execute: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      getLogs: jest.fn(),
    },
    workflows: {
      create: jest.fn(),
      update: jest.fn(),
      execute: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      getExecutions: jest.fn(),
      getExecution: jest.fn(),
    },
  };
}
type StubCaller = ReturnType<typeof makeCaller>;

async function call(
  caller: StubCaller,
  tool: string,
  args: Record<string, unknown> = {},
) {
  const t = MCP_TOOL_BY_NAME.get(tool);
  if (!t) throw new Error(`no such tool ${tool}`);
  return t.handler(caller as unknown as Caller, args, BASE);
}

function parsed(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe("tool registry", () => {
  it("exposes the full iterate-loop surface", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    for (const expected of [
      "get_capabilities",
      "validate_plan",
      "list_events",
      "get_event",
      "get_event_logs",
      "create_event",
      "update_event",
      "activate_event",
      "deactivate_event",
      "delete_event",
      "run_event",
      "list_workflows",
      "get_workflow",
      "get_executions",
      "get_execution",
      "create_workflow",
      "update_workflow",
      "delete_workflow",
      "run_workflow",
      "create_workflow_bundle",
    ]) {
      expect(names).toContain(expected);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool declares annotations", () => {
    for (const t of MCP_TOOLS) {
      expect(t.annotations).toBeDefined();
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
    }
  });
});

describe("list_events", () => {
  it("summarizes rows (no script bodies) and clamps pagination", async () => {
    const caller = makeCaller();
    caller.events.getAll.mockResolvedValue({
      events: [
        {
          id: 1,
          name: "Backup",
          type: "BASH",
          status: "ACTIVE",
          content: "echo SECRET-BODY",
          httpBody: "nope",
          toolActionConfig: null,
          customSchedule: "0 8 * * *",
          tags: ["ops"],
          source: "mcp",
        },
      ],
      total: 250,
      hasMore: true,
    });

    const res = await call(caller, "list_events", { limit: 5000, offset: 10 });
    expect(caller.events.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 10 }),
    );

    const body = parsed(res.text);
    expect(res.text).not.toContain("SECRET-BODY");
    expect(body.total).toBe(250);
    expect(body.nextOffset).toBe(11);
    const row = (body.events as Array<Record<string, unknown>>)[0]!;
    expect(row.name).toBe("Backup");
    expect(row.content).toBeUndefined();
    expect(row.customSchedule).toBe("0 8 * * *");
  });
});

describe("get_event", () => {
  it("returns full detail but env-var KEYS only", async () => {
    const caller = makeCaller();
    caller.events.getById.mockResolvedValue({
      id: 3,
      name: "Notify",
      type: "TOOL_ACTION",
      status: "DRAFT",
      toolActionConfig: '{"toolType":"slack"}',
      envVars: [
        { key: "API_KEY", value: "super-secret-value" },
        { key: "REGION", value: "us-east-1" },
      ],
      servers: [{ id: 6, name: "sandbox-a", sshKey: "PRIVATE" }],
      content: null,
    });

    const res = await call(caller, "get_event", { id: 3 });
    const body = parsed(res.text);
    expect(body.envVarKeys).toEqual(["API_KEY", "REGION"]);
    expect(res.text).not.toContain("super-secret-value");
    expect(res.text).not.toContain("PRIVATE");
    expect(body.servers).toEqual([{ id: 6, name: "sandbox-a" }]);
    expect(body.toolActionConfig).toBe('{"toolType":"slack"}');
  });
});

describe("get_event_logs", () => {
  it("tail-truncates long output and head-truncates errors", async () => {
    const caller = makeCaller();
    const bigOutput = `${"x".repeat(5000)}THE-END`;
    caller.events.getLogs.mockResolvedValue({
      logs: [
        {
          id: 11,
          status: "FAILURE",
          output: bigOutput,
          error: `boom${"y".repeat(1000)}`,
          duration: 42,
        },
      ],
      total: 1,
      hasMore: false,
    });

    const res = await call(caller, "get_event_logs", {
      id: 1,
      maxOutputChars: 200,
    });
    const body = parsed(res.text);
    const log = (body.logs as Array<Record<string, unknown>>)[0]!;
    expect(log.output as string).toContain("THE-END");
    expect(log.output as string).toContain(
      "[truncated: showing last 200 of 5007 chars]",
    );
    expect((log.error as string).length).toBeLessThan(600);
    expect(log.durationMs).toBe(42);
  });

  it("clamps limit into the router's accepted range", async () => {
    const caller = makeCaller();
    caller.events.getLogs.mockResolvedValue({
      logs: [],
      total: 0,
      hasMore: false,
    });
    await call(caller, "get_event_logs", { id: 1, limit: 9999 });
    expect(caller.events.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });
});

describe("run_event / run_workflow", () => {
  it("run_event reports jobId and logId for polling", async () => {
    const caller = makeCaller();
    caller.events.execute.mockResolvedValue({
      success: true,
      logId: 77,
      jobId: "job-abc",
    });
    const res = await call(caller, "run_event", { id: 5, input: { a: 1 } });
    expect(caller.events.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, input: { a: 1 } }),
    );
    expect(res.text).toContain("job-abc");
    expect(res.text).toContain("77");
    expect(res.isError).toBeUndefined();
  });

  it("run_workflow surfaces an engine refusal as an error result", async () => {
    const caller = makeCaller();
    caller.workflows.execute.mockResolvedValue({
      success: false,
      output: "Workflow has no nodes",
    });
    const res = await call(caller, "run_workflow", { id: 9 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Workflow has no nodes");
  });

  it("run_workflow reports the executionId for polling", async () => {
    const caller = makeCaller();
    caller.workflows.execute.mockResolvedValue({
      success: true,
      executionId: 123,
      status: "RUNNING",
    });
    const res = await call(caller, "run_workflow", { id: 9 });
    expect(res.text).toContain("executionId=123");
    expect(res.text).toContain("get_execution");
  });
});

describe("get_workflow", () => {
  it("maps the graph to event ids (and never leaks node event env vars)", async () => {
    const caller = makeCaller();
    caller.workflows.getById.mockResolvedValue({
      data: {
        id: 4,
        name: "Pipeline",
        status: "DRAFT",
        hasWebhookKey: false,
        nodes: [
          {
            id: 101,
            eventId: 1,
            event: {
              name: "Extract",
              type: "BASH",
              status: "DRAFT",
              envVars: [{ key: "K", value: "env-secret" }],
            },
          },
          {
            id: 102,
            eventId: 2,
            event: { name: "Load", type: "PYTHON", status: "DRAFT" },
          },
        ],
        connections: [
          {
            sourceNodeId: 101,
            targetNodeId: 102,
            connectionType: "ON_SUCCESS",
          },
        ],
      },
    });

    const res = await call(caller, "get_workflow", { id: 4 });
    const body = parsed(res.text);
    expect(body.nodes).toEqual([
      {
        nodeId: 101,
        eventId: 1,
        name: "Extract",
        type: "BASH",
        status: "DRAFT",
      },
      {
        nodeId: 102,
        eventId: 2,
        name: "Load",
        type: "PYTHON",
        status: "DRAFT",
      },
    ]);
    expect(body.connections).toEqual([
      { fromEventId: 1, toEventId: 2, connectionType: "ON_SUCCESS" },
    ]);
    expect(res.text).not.toContain("env-secret");
  });
});

describe("get_executions / get_execution", () => {
  it("normalizes the nested executions envelope and drops executionData", async () => {
    const caller = makeCaller();
    caller.workflows.getExecutions.mockResolvedValue({
      executions: {
        executions: [
          {
            id: 1,
            workflowId: 4,
            workflowName: "Pipeline",
            status: "SUCCESS",
            triggerType: "MANUAL",
            totalDuration: 900,
            executionData: { secret: "payload-blob" },
          },
        ],
        total: 41,
      },
      hasMore: true,
    });

    const res = await call(caller, "get_executions", { workflowId: 4 });
    expect(caller.workflows.getExecutions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4 }),
    );
    const body = parsed(res.text);
    const row = (body.executions as Array<Record<string, unknown>>)[0]!;
    expect(row.workflowName).toBe("Pipeline");
    expect(row.totalDurationMs).toBe(900);
    expect(res.text).not.toContain("payload-blob");
    expect(body.total).toBe(41);
  });

  it("summarizes per-step results with truncated output", async () => {
    const caller = makeCaller();
    caller.workflows.getExecution.mockResolvedValue({
      id: 55,
      workflowId: 4,
      status: "FAILURE",
      totalEvents: 2,
      successfulEvents: 1,
      failedEvents: 1,
      events: [
        {
          id: 900,
          eventId: 1,
          nodeId: 101,
          sequenceOrder: 1,
          status: "SUCCESS",
          duration: 100,
          output: `${"z".repeat(3000)}TAIL`,
        },
        {
          id: 901,
          eventId: 2,
          nodeId: 102,
          sequenceOrder: 2,
          status: "FAILURE",
          errorMessage: "exit 1",
          connectionType: "ON_SUCCESS",
        },
      ],
    });

    const res = await call(caller, "get_execution", {
      workflowId: 4,
      executionId: 55,
      maxOutputChars: 500,
    });
    const body = parsed(res.text);
    expect(body.failedEvents).toBe(1);
    const steps = body.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.output as string).toContain("TAIL");
    expect(steps[0]!.output as string).toContain("truncated");
    expect(steps[1]!.error).toBe("exit 1");
  });
});

describe("update_event", () => {
  it("forwards only the provided fields", async () => {
    const caller = makeCaller();
    caller.events.update.mockResolvedValue({
      id: 3,
      name: "Notify v2",
      status: "DRAFT",
    });
    const res = await call(caller, "update_event", {
      id: 3,
      content: "echo fixed",
    });
    expect(caller.events.update).toHaveBeenCalledWith({
      id: 3,
      content: "echo fixed",
    });
    expect(res.text).toContain("Notify v2");
  });
});

describe("update_workflow graph synthesis", () => {
  it("builds nodes/edges from event ids, fetching labels", async () => {
    const caller = makeCaller();
    caller.events.getById.mockImplementation(({ id }: { id: number }) =>
      Promise.resolve({
        id,
        name: `Event ${id}`,
        type: id === 1 ? "BASH" : "TOOL_ACTION",
      }),
    );
    caller.workflows.update.mockResolvedValue({ id: 4, name: "Pipeline" });

    await call(caller, "update_workflow", {
      id: 4,
      graph: {
        events: [1, 2],
        connections: [{ from: 1, to: 2, connectionType: "ON_FAILURE" }],
      },
    });

    const arg = caller.workflows.update.mock.calls[0]![0] as {
      nodes: Array<{ id: string; data: { eventId: number; label: string } }>;
      edges: Array<{
        source: string;
        target: string;
        data: { connectionType: string };
      }>;
    };
    expect(arg.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(arg.nodes[0]!.data).toMatchObject({ eventId: 1, label: "Event 1" });
    expect(arg.edges).toEqual([
      expect.objectContaining({
        source: "n1",
        target: "n2",
        data: { connectionType: "ON_FAILURE" },
      }),
    ]);
  });

  it("rejects duplicate event ids and connections to events outside the graph", async () => {
    const caller = makeCaller();

    const dup = await call(caller, "update_workflow", {
      id: 4,
      graph: { events: [1, 1], connections: [] },
    });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain("duplicate");

    const ghost = await call(caller, "update_workflow", {
      id: 4,
      graph: { events: [1], connections: [{ from: 1, to: 99 }] },
    });
    expect(ghost.isError).toBe(true);
    expect(ghost.text).toContain("99");
    expect(caller.workflows.update).not.toHaveBeenCalled();
  });

  it("leaves the graph untouched when `graph` is omitted", async () => {
    const caller = makeCaller();
    caller.workflows.update.mockResolvedValue({ id: 4, name: "Pipeline" });
    await call(caller, "update_workflow", { id: 4, name: "Renamed" });
    const arg = caller.workflows.update.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(arg.nodes).toBeUndefined();
    expect(arg.edges).toBeUndefined();
  });
});

describe("webhook keys", () => {
  it("create_workflow surfaces a newly minted key exactly once", async () => {
    const caller = makeCaller();
    caller.workflows.create.mockResolvedValue({
      data: { id: 8, webhookKey: "whk_plaintext_once" },
    });
    const res = await call(caller, "create_workflow", {
      name: "Hook",
      triggerType: "WEBHOOK",
    });
    expect(res.text).toContain("whk_plaintext_once");
    expect(res.text).toContain("SHOWN ONCE");
  });

  it("update_workflow surfaces a key minted by switching to WEBHOOK", async () => {
    const caller = makeCaller();
    caller.workflows.update.mockResolvedValue({
      id: 8,
      name: "Hook",
      webhookKey: "whk_minted_on_update",
    });
    const res = await call(caller, "update_workflow", {
      id: 8,
      triggerType: "WEBHOOK",
    });
    expect(res.text).toContain("whk_minted_on_update");
  });
});

describe("create_workflow_bundle", () => {
  it("rolls back created events when a later create fails", async () => {
    const caller = makeCaller();
    caller.events.create
      .mockResolvedValueOnce({ id: 1, name: "A", type: "BASH" })
      .mockRejectedValueOnce(new Error("second create failed"));
    caller.events.delete.mockResolvedValue({ success: true });

    const res = await call(caller, "create_workflow_bundle", {
      events: [
        { key: "a", name: "A", type: "BASH", content: "echo a" },
        { key: "b", name: "B", type: "BASH", content: "echo b" },
      ],
      workflow: { name: "Chain", connections: [{ from: "a", to: "b" }] },
    });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("second create failed");
    expect(caller.events.delete).toHaveBeenCalledWith({ id: 1 });
    expect(caller.workflows.create).not.toHaveBeenCalled();
  });

  it("creates events then the workflow wired by key, and points at the next steps", async () => {
    const caller = makeCaller();
    caller.events.create
      .mockResolvedValueOnce({ id: 1, name: "A", type: "BASH" })
      .mockResolvedValueOnce({ id: 2, name: "B", type: "TOOL_ACTION" });
    caller.workflows.create.mockResolvedValue({ data: { id: 30 } });

    const res = await call(caller, "create_workflow_bundle", {
      events: [
        { key: "a", name: "A", type: "BASH", content: "echo a" },
        { key: "b", name: "B", type: "TOOL_ACTION", toolActionConfig: "{}" },
      ],
      workflow: { name: "Chain", connections: [{ from: "a", to: "b" }] },
    });

    const wfArg = caller.workflows.create.mock.calls[0]![0] as {
      nodes: Array<{ id: string; data: { eventId: number } }>;
      edges: Array<{ source: string; target: string }>;
    };
    expect(wfArg.nodes.map((n) => n.data.eventId)).toEqual([1, 2]);
    expect(wfArg.edges[0]).toMatchObject({ source: "a", target: "b" });
    expect(res.text).toContain("Workflow #30");
    expect(res.text).toContain("run_workflow");
  });
});

describe("validate_plan formatting", () => {
  it("prints the summary alone when valid, bullets when not", async () => {
    const caller = makeCaller();
    caller.mcp.validatePlan.mockResolvedValue({
      valid: true,
      errors: [],
      summary: "Plan is valid: 2 event(s) + 1 workflow. Ready to create.",
    });
    const good = await call(caller, "validate_plan", {
      events: [{ key: "a", name: "A", type: "BASH", content: "x" }],
    });
    expect(good.text).toBe(
      "Plan is valid: 2 event(s) + 1 workflow. Ready to create.",
    );

    caller.mcp.validatePlan.mockResolvedValue({
      valid: false,
      errors: ["a broke", "b broke"],
      summary: "Plan has 2 issue(s) to fix before creating.",
    });
    const bad = await call(caller, "validate_plan", {
      events: [{ key: "a", name: "A", type: "BASH", content: "x" }],
    });
    expect(bad.text).toContain("• a broke");
    expect(bad.text).toContain("• b broke");
  });
});

describe("simple lifecycle tools", () => {
  it("activate/deactivate/delete forward the id and confirm", async () => {
    const caller = makeCaller();
    caller.events.activate.mockResolvedValue({ success: true });
    caller.events.deactivate.mockResolvedValue({ success: true });
    caller.events.delete.mockResolvedValue({ success: true });
    caller.workflows.delete.mockResolvedValue({ success: true });

    expect((await call(caller, "activate_event", { id: 1 })).text).toContain(
      "Activated event #1",
    );
    expect((await call(caller, "deactivate_event", { id: 1 })).text).toContain(
      "Paused event #1",
    );
    expect((await call(caller, "delete_event", { id: 1 })).text).toContain(
      "Deleted event #1",
    );
    expect((await call(caller, "delete_workflow", { id: 2 })).text).toContain(
      "Deleted workflow #2",
    );
    expect(caller.events.deactivate).toHaveBeenCalledWith({ id: 1 });
  });
});
