/**
 * MCP tool definitions for the remote (Streamable HTTP) endpoint. Handlers call
 * the app's tRPC procedures in-process via a server-side caller — no HTTP hop,
 * no schema duplication of the create logic (the routers validate). This mirrors
 * the local stdio server in apps/cronium-mcp, adapted to run inside the app.
 */
import type { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;

export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    caller: Caller,
    args: Record<string, unknown>,
    baseUrl: string,
  ) => Promise<McpToolResult>;
}

// ── JSON Schema fragments (mirror the app's createEventSchema; the router
// performs authoritative validation + default-filling) ──────────────────────
const EVENT_PROPS: Record<string, unknown> = {
  name: { type: "string", description: "Event name." },
  type: {
    type: "string",
    enum: ["NODEJS", "PYTHON", "BASH", "HTTP_REQUEST", "TOOL_ACTION"],
  },
  description: { type: "string" },
  content: { type: "string", description: "Script body (NODEJS/PYTHON/BASH)." },
  httpMethod: { type: "string" },
  httpUrl: { type: "string" },
  httpBody: { type: "string" },
  toolActionConfig: {
    type: "string",
    description:
      "TOOL_ACTION only. JSON string: {toolType, toolId, actionId, parameters}. " +
      "toolType is the lowercase manifest type; toolId is a credentials[].id from get_capabilities.",
  },
  status: { type: "string", enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"] },
  triggerType: { type: "string", enum: ["SCHEDULE", "MANUAL"] },
  scheduleNumber: { type: "number" },
  scheduleUnit: {
    type: "string",
    enum: ["SECONDS", "MINUTES", "HOURS", "DAYS"],
  },
  customSchedule: {
    type: "string",
    description: "Cron for a specific time, e.g. '0 8 * * *' for 8am daily.",
  },
  runLocation: {
    type: "string",
    enum: ["LOCAL", "REMOTE", "LOCAL_AND_REMOTE"],
  },
  serverId: { type: "number" },
  selectedServerIds: { type: "array", items: { type: "number" } },
  timeoutValue: { type: "number" },
  timeoutUnit: {
    type: "string",
    enum: ["SECONDS", "MINUTES", "HOURS", "DAYS"],
  },
  retries: { type: "number" },
  tags: { type: "array", items: { type: "string" } },
  envVars: {
    type: "array",
    items: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
};

const CONNECTION_TYPE = {
  type: "string",
  enum: ["ALWAYS", "ON_SUCCESS", "ON_FAILURE", "ON_CONDITION"],
} as const;

function eventIcon(type: string): string {
  if (type === "TOOL_ACTION") return "tool";
  if (type === "HTTP_REQUEST") return "http";
  return type.toLowerCase();
}
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
function ok(text: string): McpToolResult {
  return { text };
}
function errText(err: unknown): McpToolResult {
  return {
    text: `Error: ${err instanceof Error ? err.message : String(err)}`,
    isError: true,
  };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_capabilities",
    title: "Get Cronium capabilities",
    description:
      "ALWAYS CALL THIS FIRST. Returns the enums, defaults, scheduling guidance, the " +
      "available tool types + their actions (with parameter metadata), and the user's " +
      "real tool-credential ids (for toolActionConfig.toolId) and server ids.",
    inputSchema: { type: "object", properties: {} },
    handler: async (caller) => {
      const caps = await caller.mcp.getCapabilities();
      return ok(JSON.stringify(caps, null, 2));
    },
  },
  {
    name: "create_event",
    title: "Create a Cronium event",
    description:
      "Create a single event (DRAFT by default; nothing runs until activated). For a " +
      "scheduled event set triggerType=SCHEDULE, status=ACTIVE, customSchedule (cron), then " +
      "call activate_event. Present a draft for approval before calling this.",
    inputSchema: {
      type: "object",
      properties: EVENT_PROPS,
      required: ["name", "type"],
    },
    handler: async (caller, args, baseUrl) => {
      const ev = (await caller.events.create(compact(args) as never)) as {
        id: number;
        name: string;
      };
      return ok(
        `Created event #${ev.id} "${ev.name}".\n${baseUrl}/dashboard/events/${ev.id}`,
      );
    },
  },
  {
    name: "activate_event",
    title: "Activate a Cronium event",
    description:
      "Set an event ACTIVE and register it with the live scheduler. Call after create_event " +
      "for a scheduled event you want to start firing.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        resetCounter: { type: "boolean" },
      },
      required: ["id"],
    },
    handler: async (caller, args) => {
      await caller.events.activate(compact(args) as never);
      return ok(`Activated event #${String(args.id)}.`);
    },
  },
  {
    name: "create_workflow",
    title: "Create a Cronium workflow",
    description:
      "Wire EXISTING events into a workflow (nodes reference eventId). Must be a DAG with at " +
      "most one incoming edge per node. Prefer create_workflow_bundle when also creating events.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        triggerType: {
          type: "string",
          enum: ["SCHEDULE", "WEBHOOK", "MANUAL"],
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"],
        },
        useCronScheduling: { type: "boolean" },
        customSchedule: { type: "string" },
        scheduleNumber: { type: "number" },
        scheduleUnit: {
          type: "string",
          enum: ["SECONDS", "MINUTES", "HOURS", "DAYS"],
        },
        runLocation: {
          type: "string",
          enum: ["LOCAL", "REMOTE", "LOCAL_AND_REMOTE"],
        },
        webhookKey: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        nodes: { type: "array", items: { type: "object" } },
        edges: { type: "array", items: { type: "object" } },
      },
      required: ["name", "triggerType"],
    },
    handler: async (caller, args, baseUrl) => {
      const res = (await caller.workflows.create(compact(args) as never)) as {
        data?: { id?: number };
      };
      const id = res?.data?.id;
      return ok(
        `Created workflow${id ? ` #${id}` : ""} "${String(args.name)}".` +
          (id ? `\n${baseUrl}/dashboard/workflows/${id}` : ""),
      );
    },
  },
  {
    name: "validate_plan",
    title: "Validate a draft plan (no changes made)",
    description:
      "Dry-run: check a proposed events (+ optional workflow) plan WITHOUT creating " +
      "anything — event schemas, tool credentials/actions/params, and workflow graph " +
      "(DAG, no fan-in). Call this to validate a draft before showing it to the user " +
      "for approval, then create_workflow_bundle once it's valid.",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { key: { type: "string" }, ...EVENT_PROPS },
            required: ["key", "name", "type"],
          },
        },
        workflow: {
          type: "object",
          properties: {
            name: { type: "string" },
            connections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  connectionType: CONNECTION_TYPE,
                },
                required: ["from", "to"],
              },
            },
          },
        },
      },
      required: ["events"],
    },
    handler: async (caller, args) => {
      const res = (await caller.mcp.validatePlan(args as never)) as {
        valid: boolean;
        errors: string[];
        summary: string;
      };
      const body = res.valid
        ? res.summary
        : `${res.summary}\n${res.errors.map((e) => `  • ${e}`).join("\n")}`;
      return ok(body);
    },
  },
  {
    name: "create_workflow_bundle",
    title: "Create events + a workflow together",
    description:
      "One-shot: create several events (each with a local `key`) and a workflow chaining them " +
      "by key ({from, to, connectionType?}). Events are created DRAFT; on failure created " +
      "events are best-effort deleted. Present a draft for approval before calling.",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { key: { type: "string" }, ...EVENT_PROPS },
            required: ["key", "name", "type"],
          },
        },
        workflow: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            triggerType: {
              type: "string",
              enum: ["SCHEDULE", "WEBHOOK", "MANUAL"],
            },
            status: {
              type: "string",
              enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"],
            },
            useCronScheduling: { type: "boolean" },
            customSchedule: { type: "string" },
            scheduleNumber: { type: "number" },
            scheduleUnit: {
              type: "string",
              enum: ["SECONDS", "MINUTES", "HOURS", "DAYS"],
            },
            runLocation: {
              type: "string",
              enum: ["LOCAL", "REMOTE", "LOCAL_AND_REMOTE"],
            },
            webhookKey: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            connections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  connectionType: CONNECTION_TYPE,
                },
                required: ["from", "to"],
              },
            },
          },
          required: ["name"],
        },
      },
      required: ["events"],
    },
    handler: async (caller, args, baseUrl) => {
      const events = (args.events ?? []) as Array<Record<string, unknown>>;
      const workflow = args.workflow as Record<string, unknown> | undefined;
      const createdIds: number[] = [];
      const keyToInfo = new Map<
        string,
        { id: number; name: string; type: string }
      >();
      try {
        for (const ev of events) {
          const { key, ...fields } = ev;
          const created = (await caller.events.create(
            compact(fields) as never,
          )) as {
            id: number;
            name: string;
            type: string;
          };
          createdIds.push(created.id);
          keyToInfo.set(String(key), {
            id: created.id,
            name: created.name,
            type: created.type,
          });
        }

        let workflowId: number | undefined;
        if (workflow) {
          const nodes = events.map((ev, i) => {
            const info = keyToInfo.get(String(ev.key))!;
            return {
              id: String(ev.key),
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
          const connections = (workflow.connections ?? []) as Array<{
            from: string;
            to: string;
            connectionType?: string;
          }>;
          const edges = connections.map((c, i) => ({
            id: `e${i}`,
            source: c.from,
            target: c.to,
            type: "connectionEdge",
            animated: true,
            data: { connectionType: c.connectionType ?? "ON_SUCCESS" },
          }));
          const res = (await caller.workflows.create(
            compact({
              name: workflow.name,
              description: workflow.description,
              triggerType: workflow.triggerType ?? "MANUAL",
              status: workflow.status ?? "DRAFT",
              useCronScheduling: workflow.useCronScheduling,
              customSchedule: workflow.customSchedule,
              scheduleNumber: workflow.scheduleNumber,
              scheduleUnit: workflow.scheduleUnit,
              runLocation: workflow.runLocation,
              webhookKey: workflow.webhookKey,
              tags: workflow.tags,
              nodes,
              edges,
            }) as never,
          )) as { data?: { id?: number } };
          workflowId = res?.data?.id;
        }

        const lines = [...keyToInfo.entries()].map(
          ([key, v]) =>
            `  • ${key} → event #${v.id} "${v.name}" — ${baseUrl}/dashboard/events/${v.id}`,
        );
        return ok(
          `Created ${createdIds.length} event(s) as DRAFT:\n${lines.join("\n")}` +
            (workflowId
              ? `\nWorkflow #${workflowId} — ${baseUrl}/dashboard/workflows/${workflowId}`
              : workflow
                ? `\nWorkflow created (id unavailable in response).`
                : "") +
            `\n\nReview and activate them in Cronium.`,
        );
      } catch (err) {
        for (const id of createdIds) {
          try {
            await caller.events.delete({ id });
          } catch {
            /* best-effort */
          }
        }
        return errText(err);
      }
    },
  },
];

export const MCP_TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));
