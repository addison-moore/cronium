#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CroniumClient } from "./cronium.js";

const BASE_URL = process.env.CRONIUM_BASE_URL;
const API_TOKEN = process.env.CRONIUM_API_TOKEN;

if (!BASE_URL || !API_TOKEN) {
  console.error(
    "cronium-mcp: set CRONIUM_BASE_URL (e.g. http://localhost:5001) and " +
      "CRONIUM_API_TOKEN (create one in Cronium → Settings → API Tokens).",
  );
  process.exit(1);
}

const cronium = new CroniumClient(BASE_URL, API_TOKEN);

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// Icon hint for a workflow node, derived from the event type.
function eventIcon(type: string): string {
  switch (type) {
    case "TOOL_ACTION":
      return "tool";
    case "HTTP_REQUEST":
      return "http";
    default:
      return type.toLowerCase();
  }
}

// ── Shared input shapes ────────────────────────────────────────────────────
const EVENT_TYPE = z.enum([
  "NODEJS",
  "PYTHON",
  "BASH",
  "HTTP_REQUEST",
  "TOOL_ACTION",
]);
const TIME_UNIT = z.enum(["SECONDS", "MINUTES", "HOURS", "DAYS"]);
const EVENT_STATUS = z.enum(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"]);
const RUN_LOCATION = z.enum(["LOCAL", "REMOTE", "LOCAL_AND_REMOTE"]);
const EVENT_TRIGGER = z.enum(["SCHEDULE", "MANUAL"]);
const CONNECTION_TYPE = z.enum([
  "ALWAYS",
  "ON_SUCCESS",
  "ON_FAILURE",
  "ON_CONDITION",
]);

// The forwardable event fields (mirrors the app's createEventSchema; the app
// performs authoritative validation + default-filling).
const eventFields = {
  name: z.string().describe("Event name."),
  type: EVENT_TYPE.describe("Event type."),
  description: z.string().optional(),
  content: z.string().optional().describe("Script body (NODEJS/PYTHON/BASH)."),
  httpMethod: z.string().optional(),
  httpUrl: z.string().optional(),
  httpBody: z.string().optional(),
  toolActionConfig: z
    .string()
    .optional()
    .describe(
      "TOOL_ACTION only. JSON string: {toolType, toolId, actionId, parameters}. " +
        "toolType is the lowercase manifest type; toolId is a credentials[].id from get_capabilities.",
    ),
  status: EVENT_STATUS.optional().describe("Default DRAFT."),
  triggerType: EVENT_TRIGGER.optional().describe(
    "Default MANUAL. Use SCHEDULE for cron/interval.",
  ),
  scheduleNumber: z.number().int().positive().optional(),
  scheduleUnit: TIME_UNIT.optional(),
  customSchedule: z
    .string()
    .optional()
    .describe(
      "Cron expression for a specific time, e.g. '0 8 * * *' for 8am daily.",
    ),
  runLocation: RUN_LOCATION.optional().describe("Default LOCAL."),
  serverId: z.number().int().optional(),
  selectedServerIds: z.array(z.number().int()).optional(),
  timeoutValue: z.number().int().positive().optional().describe("Default 30."),
  timeoutUnit: TIME_UNIT.optional().describe("Default MINUTES."),
  retries: z.number().int().min(0).max(10).optional(),
  tags: z.array(z.string()).optional(),
  envVars: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
};

// Drop undefined keys so we forward a clean payload.
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const server = new McpServer({ name: "cronium", version: "0.1.0" });

// ── get_capabilities ───────────────────────────────────────────────────────
server.registerTool(
  "get_capabilities",
  {
    title: "Get Cronium capabilities",
    description:
      "ALWAYS CALL THIS FIRST. Returns the enums, defaults, scheduling guidance, " +
      "the available tool types + their actions (with parameter metadata), and the " +
      "user's real tool-credential ids (for toolActionConfig.toolId) and server ids. " +
      "Use it to draft valid events before creating anything.",
    inputSchema: {},
  },
  async () => {
    try {
      const caps = await cronium.query("mcp.getCapabilities");
      return ok(json(caps));
    } catch (err) {
      return fail(err);
    }
  },
);

// ── create_event ─────────────────────────────────────────────────────────
server.registerTool(
  "create_event",
  {
    title: "Create a Cronium event",
    description:
      "Create a single event. Defaults to status DRAFT (nothing runs until activated). " +
      "For a scheduled event, set triggerType=SCHEDULE, status=ACTIVE, and customSchedule " +
      "(cron) — then call activate_event so it registers with the live scheduler. " +
      "Present a draft to the user for approval before calling this.",
    inputSchema: eventFields,
  },
  async (args) => {
    try {
      const created = await cronium.mutate<{ id: number; name: string }>(
        "events.create",
        compact(args),
      );
      return ok(
        `Created event #${created.id} "${created.name}" (DRAFT unless status was set).\n` +
          `${BASE_URL}/dashboard/events/${created.id}`,
      );
    } catch (err) {
      return fail(err);
    }
  },
);

// ── activate_event ─────────────────────────────────────────────────────────
server.registerTool(
  "activate_event",
  {
    title: "Activate a Cronium event",
    description:
      "Set an event ACTIVE and register it with the live scheduler. Call this after " +
      "create_event for a scheduled event you want to start firing.",
    inputSchema: {
      id: z.number().int().positive(),
      resetCounter: z.boolean().optional(),
    },
  },
  async (args) => {
    try {
      await cronium.mutate("events.activate", compact(args));
      return ok(`Activated event #${args.id}.`);
    } catch (err) {
      return fail(err);
    }
  },
);

// ── create_workflow ─────────────────────────────────────────────────────────
const nodeSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.object({
    eventId: z.number().int(),
    label: z.string().optional(),
    type: z.string().optional(),
    eventTypeIcon: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});
const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  data: z.object({ connectionType: CONNECTION_TYPE }),
});

server.registerTool(
  "create_workflow",
  {
    title: "Create a Cronium workflow",
    description:
      "Create a workflow wiring EXISTING events (nodes reference eventId). The graph must " +
      "be a DAG (no cycles) with at most one incoming edge per node (fan-out ok). Prefer " +
      "create_workflow_bundle when you also need to create the events.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      triggerType: z.enum(["SCHEDULE", "WEBHOOK", "MANUAL"]),
      status: EVENT_STATUS.optional(),
      useCronScheduling: z.boolean().optional(),
      customSchedule: z.string().optional(),
      scheduleNumber: z.number().int().positive().optional(),
      scheduleUnit: TIME_UNIT.optional(),
      runLocation: RUN_LOCATION.optional(),
      webhookKey: z.string().optional(),
      tags: z.array(z.string()).optional(),
      nodes: z.array(nodeSchema).optional(),
      edges: z.array(edgeSchema).optional(),
    },
  },
  async (args) => {
    try {
      const res = await cronium.mutate<{ data?: { id?: number } }>(
        "workflows.create",
        compact(args),
      );
      const id = res?.data?.id;
      return ok(
        `Created workflow${id ? ` #${id}` : ""} "${args.name}".` +
          (id ? `\n${BASE_URL}/dashboard/workflows/${id}` : ""),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

// ── validate_plan ─────────────────────────────────────────────────────────
server.registerTool(
  "validate_plan",
  {
    title: "Validate a draft plan (no changes made)",
    description:
      "Dry-run: check a proposed events (+ optional workflow) plan WITHOUT creating " +
      "anything — event schemas, tool credentials/actions/params, and workflow graph " +
      "(DAG, no fan-in). Validate a draft before showing it to the user, then call " +
      "create_workflow_bundle once it's valid.",
    inputSchema: {
      events: z.array(z.object({ key: z.string() }).extend(eventFields)).min(1),
      workflow: z
        .object({
          name: z.string().optional(),
          connections: z
            .array(
              z.object({
                from: z.string(),
                to: z.string(),
                connectionType: CONNECTION_TYPE.optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    },
  },
  async (args) => {
    try {
      const res = await cronium.mutate<{
        valid: boolean;
        errors: string[];
        summary: string;
      }>("mcp.validatePlan", args);
      const body = res.valid
        ? res.summary
        : `${res.summary}\n${res.errors.map((e) => `  • ${e}`).join("\n")}`;
      return ok(body);
    } catch (err) {
      return fail(err);
    }
  },
);

// ── create_workflow_bundle ───────────────────────────────────────────────────
server.registerTool(
  "create_workflow_bundle",
  {
    title: "Create events + a workflow together",
    description:
      "One-shot: create several events (each with a local `key`) and a workflow chaining " +
      "them by key. Events are created as DRAFT; the workflow references them by eventId. " +
      "Connections are a simple {from, to, connectionType?} list. On failure, created " +
      "events are best-effort deleted. Present a draft for approval before calling.",
    inputSchema: {
      events: z
        .array(z.object({ key: z.string() }).extend(eventFields))
        .min(1)
        .describe("Events to create, each with a unique local `key`."),
      workflow: z
        .object({
          name: z.string(),
          description: z.string().optional(),
          triggerType: z.enum(["SCHEDULE", "WEBHOOK", "MANUAL"]).optional(),
          status: EVENT_STATUS.optional(),
          useCronScheduling: z.boolean().optional(),
          customSchedule: z.string().optional(),
          scheduleNumber: z.number().int().positive().optional(),
          scheduleUnit: TIME_UNIT.optional(),
          runLocation: RUN_LOCATION.optional(),
          webhookKey: z.string().optional(),
          tags: z.array(z.string()).optional(),
          connections: z
            .array(
              z.object({
                from: z.string(),
                to: z.string(),
                connectionType: CONNECTION_TYPE.optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    },
  },
  async (args) => {
    const createdIds: number[] = [];
    const keyToId = new Map<
      string,
      { id: number; name: string; type: string }
    >();
    try {
      // 1. Create the events (as given; default DRAFT).
      let x = 0;
      for (const ev of args.events) {
        const { key, ...eventFieldsOnly } = ev;
        const created = await cronium.mutate<{
          id: number;
          name: string;
          type: string;
        }>("events.create", compact(eventFieldsOnly));
        createdIds.push(created.id);
        keyToId.set(key, {
          id: created.id,
          name: created.name,
          type: created.type,
        });
        x += 1;
      }

      // 2. Optionally create the workflow chaining them.
      let workflowId: number | undefined;
      if (args.workflow) {
        const wf = args.workflow;
        const nodes = args.events.map((ev, i) => {
          const info = keyToId.get(ev.key)!;
          return {
            id: ev.key,
            type: "eventNode",
            position: { x: i * 240, y: 0 },
            data: {
              eventId: info.id,
              label: info.name,
              type: info.type,
              eventTypeIcon: eventIcon(info.type),
              tags: [] as string[],
            },
          };
        });
        const edges = (wf.connections ?? []).map((c, i) => ({
          id: `e${i}`,
          source: c.from,
          target: c.to,
          type: "connectionEdge",
          animated: true,
          data: { connectionType: c.connectionType ?? "ON_SUCCESS" },
        }));
        const res = await cronium.mutate<{ data?: { id?: number } }>(
          "workflows.create",
          compact({
            name: wf.name,
            description: wf.description,
            triggerType: wf.triggerType ?? "MANUAL",
            status: wf.status ?? "DRAFT",
            useCronScheduling: wf.useCronScheduling,
            customSchedule: wf.customSchedule,
            scheduleNumber: wf.scheduleNumber,
            scheduleUnit: wf.scheduleUnit,
            runLocation: wf.runLocation,
            webhookKey: wf.webhookKey,
            tags: wf.tags,
            nodes,
            edges,
          }),
        );
        workflowId = res?.data?.id;
      }

      const lines = [...keyToId.entries()].map(
        ([key, v]) =>
          `  • ${key} → event #${v.id} "${v.name}" — ${BASE_URL}/dashboard/events/${v.id}`,
      );
      return ok(
        `Created ${createdIds.length} event(s) as DRAFT:\n${lines.join("\n")}` +
          (workflowId
            ? `\nWorkflow #${workflowId} — ${BASE_URL}/dashboard/workflows/${workflowId}`
            : args.workflow
              ? `\nWorkflow created (id unavailable in response).`
              : "") +
          `\n\nReview and activate them in Cronium.`,
      );
    } catch (err) {
      // Best-effort rollback of created events.
      for (const id of createdIds) {
        try {
          await cronium.mutate("events.delete", { id });
        } catch {
          /* ignore cleanup failure */
        }
      }
      return fail(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("cronium-mcp: connected over stdio.");
}

main().catch((err) => {
  console.error("cronium-mcp: fatal:", err);
  process.exit(1);
});
