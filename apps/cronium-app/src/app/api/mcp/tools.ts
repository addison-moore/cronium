/**
 * MCP tool definitions — the single tool surface for both transports: the
 * remote Streamable-HTTP endpoint (route.ts) and the local stdio bridge
 * (apps/cronium-mcp, which just forwards JSON-RPC here). Handlers call the
 * app's tRPC procedures in-process via a server-side caller — no HTTP hop, no
 * schema duplication of the business logic (the routers validate).
 *
 * Conventions:
 * - Reads return summarized, paginated JSON — never full router payloads
 *   (list rows drop script bodies; log/step output is tail-truncated).
 * - Env-var VALUES are never returned (keys only); credential secrets and
 *   webhook keys are never readable (a newly minted webhook key is surfaced
 *   exactly once, at create/update time, mirroring the UI).
 * - Every tool carries MCP annotations (readOnlyHint/destructiveHint/…) so
 *   clients can gate approval appropriately.
 */
import type { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;

export interface McpToolResult {
  text: string;
  isError?: boolean;
}

/** MCP spec tool annotations (all hints; clients may use them for approval UX). */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
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

const PAGINATION_PROPS: Record<string, unknown> = {
  limit: { type: "number", description: "Page size (default 25, max 100)." },
  offset: { type: "number", description: "Rows to skip (default 0)." },
};

const MAX_OUTPUT_CHARS = {
  type: "number",
  description:
    "Max characters of each output field to return, keeping the END " +
    "(default 2000, max 20000). Longer output is marked truncated.",
} as const;

// ── Annotation presets ──────────────────────────────────────────────────────
const READ: McpToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const CREATE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const UPDATE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true, // overwrites existing fields / graph
  idempotentHint: true,
  openWorldHint: false,
};
const DELETE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
const RUN: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true, // executes user code with real side effects
  idempotentHint: false,
  openWorldHint: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
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
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

/**
 * Keep the END of long output (errors and final results live there), with an
 * explicit truncation marker so the model knows content is missing.
 */
function tailTruncate(
  text: string | null | undefined,
  maxChars: number,
): string | null {
  if (text == null) return null;
  if (text.length <= maxChars) return text;
  return `…[truncated: showing last ${maxChars} of ${text.length} chars]\n${text.slice(text.length - maxChars)}`;
}

function headTruncate(
  text: string | null | undefined,
  maxChars: number,
): string | null {
  if (text == null) return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated: ${text.length} chars total]`;
}

// ── Structural row types for summarizing router results ─────────────────────
interface EventRowLike {
  id: number;
  name: string;
  description?: string | null;
  type: string;
  status: string;
  triggerType?: string | null;
  scheduleNumber?: number | null;
  scheduleUnit?: string | null;
  customSchedule?: string | null;
  runLocation?: string | null;
  serverId?: number | null;
  timeoutValue?: number | null;
  timeoutUnit?: string | null;
  retries?: number | null;
  tags?: unknown;
  source?: string | null;
  shared?: boolean | null;
  executionCount?: number | null;
  maxExecutions?: number | null;
  lastRunAt?: Date | string | null;
  nextRunAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function summarizeEvent(ev: EventRowLike) {
  return compact({
    id: ev.id,
    name: ev.name,
    type: ev.type,
    status: ev.status,
    triggerType: ev.triggerType ?? undefined,
    scheduleNumber: ev.scheduleNumber ?? undefined,
    scheduleUnit: ev.scheduleUnit ?? undefined,
    customSchedule: ev.customSchedule ?? undefined,
    runLocation: ev.runLocation ?? undefined,
    tags: ev.tags ?? undefined,
    source: ev.source ?? undefined,
    shared: ev.shared ?? undefined,
    executionCount: ev.executionCount ?? undefined,
    lastRunAt: ev.lastRunAt ?? undefined,
    nextRunAt: ev.nextRunAt ?? undefined,
    updatedAt: ev.updatedAt ?? undefined,
  });
}

interface WorkflowRowLike {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  triggerType?: string | null;
  useCronScheduling?: boolean | null;
  customSchedule?: string | null;
  scheduleNumber?: number | null;
  scheduleUnit?: string | null;
  runLocation?: string | null;
  tags?: unknown;
  source?: string | null;
  shared?: boolean | null;
  hasWebhookKey?: boolean;
  updatedAt?: Date | string | null;
}

function summarizeWorkflow(wf: WorkflowRowLike) {
  return compact({
    id: wf.id,
    name: wf.name,
    description: wf.description ?? undefined,
    status: wf.status,
    triggerType: wf.triggerType ?? undefined,
    useCronScheduling: wf.useCronScheduling ?? undefined,
    customSchedule: wf.customSchedule ?? undefined,
    scheduleNumber: wf.scheduleNumber ?? undefined,
    scheduleUnit: wf.scheduleUnit ?? undefined,
    runLocation: wf.runLocation ?? undefined,
    tags: wf.tags ?? undefined,
    source: wf.source ?? undefined,
    shared: wf.shared ?? undefined,
    hasWebhookKey: wf.hasWebhookKey,
    updatedAt: wf.updatedAt ?? undefined,
  });
}

interface LogRowLike {
  id: number;
  status: string;
  successful?: boolean | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  duration?: number | null;
  exitCode?: number | null;
  retries?: number | null;
  jobId?: string | null;
  executionId?: string | null;
  workflowId?: number | null;
  error?: string | null;
  output?: string | null;
}

function summarizeLog(log: LogRowLike, maxOutputChars: number) {
  return compact({
    id: log.id,
    status: log.status,
    successful: log.successful ?? undefined,
    startTime: log.startTime ?? undefined,
    endTime: log.endTime ?? undefined,
    durationMs: log.duration ?? undefined,
    exitCode: log.exitCode ?? undefined,
    retries: log.retries ?? undefined,
    jobId: log.jobId ?? undefined,
    executionId: log.executionId ?? undefined,
    workflowId: log.workflowId ?? undefined,
    error: headTruncate(log.error, 500) ?? undefined,
    output: tailTruncate(log.output, maxOutputChars) ?? undefined,
  });
}

interface ExecutionRowLike {
  id: number;
  workflowId: number;
  workflowName?: string | null;
  status: string;
  triggerType?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  totalDuration?: number | null;
  totalEvents?: number | null;
  successfulEvents?: number | null;
  failedEvents?: number | null;
}

function summarizeExecution(ex: ExecutionRowLike) {
  return compact({
    id: ex.id,
    workflowId: ex.workflowId,
    workflowName: ex.workflowName ?? undefined,
    status: ex.status,
    triggerType: ex.triggerType ?? undefined,
    startedAt: ex.startedAt ?? undefined,
    completedAt: ex.completedAt ?? undefined,
    totalDurationMs: ex.totalDuration ?? undefined,
    totalEvents: ex.totalEvents ?? undefined,
    successfulEvents: ex.successfulEvents ?? undefined,
    failedEvents: ex.failedEvents ?? undefined,
  });
}

interface StepRowLike {
  id: number;
  eventId: number;
  nodeId?: number | null;
  sequenceOrder?: number | null;
  status: string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  duration?: number | null;
  connectionType?: string | null;
  errorMessage?: string | null;
  output?: string | null;
}

/** Workflow graph nodes/edges synthesized from an eventId-keyed description. */
async function graphFromEventIds(
  caller: Caller,
  eventIds: number[],
  connections: Array<{ from: number; to: number; connectionType?: string }>,
): Promise<{
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}> {
  const unique = new Set(eventIds);
  if (unique.size !== eventIds.length) {
    throw new Error(
      "graph.events contains duplicate event ids — each event may appear once.",
    );
  }
  for (const c of connections) {
    if (!unique.has(c.from) || !unique.has(c.to)) {
      throw new Error(
        `graph connection ${c.from}→${c.to} references an event id not in graph.events.`,
      );
    }
  }
  const nodes = await Promise.all(
    eventIds.map(async (eventId, i) => {
      const ev = (await caller.events.getById({ id: eventId })) as {
        id: number;
        name: string;
        type: string;
      };
      return {
        id: `n${eventId}`,
        type: "eventNode",
        position: { x: i * 240, y: 0 },
        data: {
          eventId: ev.id,
          label: ev.name,
          type: ev.type,
          eventTypeIcon: eventIcon(ev.type),
          tags: [] as string[],
        },
      };
    }),
  );
  const edges = connections.map((c, i) => ({
    id: `e${i}`,
    source: `n${c.from}`,
    target: `n${c.to}`,
    type: "connectionEdge",
    animated: true,
    data: { connectionType: c.connectionType ?? "ON_SUCCESS" },
  }));
  return { nodes, edges };
}

/** One-time webhook key line, when a create/update just minted one. */
function webhookKeyLine(dto: { webhookKey?: string | null } | undefined) {
  return dto?.webhookKey
    ? `\nWebhook key (SHOWN ONCE — store it now): ${dto.webhookKey}`
    : "";
}

export const MCP_TOOLS: McpTool[] = [
  // ── Discovery & validation ────────────────────────────────────────────────
  {
    name: "get_capabilities",
    title: "Get Cronium capabilities",
    description:
      "ALWAYS CALL THIS FIRST. Returns the enums, defaults, scheduling guidance, the " +
      "available tool types + their actions (with parameter metadata), the user's " +
      "real tool-credential ids (for toolActionConfig.toolId) and server ids, and " +
      "guidance for the build→run→inspect→fix→activate loop.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
    handler: async (caller) => {
      const caps = await caller.mcp.getCapabilities();
      return ok(json(caps));
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
    annotations: READ,
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

  // ── Events: read ──────────────────────────────────────────────────────────
  {
    name: "list_events",
    title: "List Cronium events",
    description:
      "List the user's events as summaries (no script bodies). Paginated; " +
      "filter by status, type, or a search string. Use get_event for full detail.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGINATION_PROPS,
        search: { type: "string" },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"],
        },
        type: {
          type: "string",
          enum: ["NODEJS", "PYTHON", "BASH", "HTTP_REQUEST", "TOOL_ACTION"],
        },
      },
    },
    annotations: READ,
    handler: async (caller, args) => {
      const limit = clampInt(args.limit, 25, 1, 100);
      const offset = clampInt(args.offset, 0, 0, 1_000_000);
      const res = (await caller.events.getAll(
        compact({
          limit,
          offset,
          search: args.search,
          status: args.status,
          type: args.type,
        }) as never,
      )) as { events: EventRowLike[]; total: number; hasMore: boolean };
      return ok(
        json({
          events: res.events.map(summarizeEvent),
          total: res.total,
          hasMore: res.hasMore,
          nextOffset: res.hasMore ? offset + res.events.length : undefined,
        }),
      );
    },
  },
  {
    name: "get_event",
    title: "Get one Cronium event (full detail)",
    description:
      "Full detail for one event: script content / HTTP request / toolActionConfig, " +
      "schedule, servers, and env-var KEYS (values are never returned).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (caller, args) => {
      const ev = (await caller.events.getById({
        id: args.id as number,
      })) as EventRowLike & {
        content?: string | null;
        httpMethod?: string | null;
        httpUrl?: string | null;
        httpBody?: string | null;
        toolActionConfig?: string | null;
        envVars?: Array<{ key: string }>;
        servers?: Array<{ id: number; name: string }>;
        createdAt?: Date | string | null;
      };
      return ok(
        json({
          ...summarizeEvent(ev),
          description: ev.description ?? undefined,
          content: ev.content ?? undefined,
          httpMethod: ev.httpMethod ?? undefined,
          httpUrl: ev.httpUrl ?? undefined,
          httpBody: ev.httpBody ?? undefined,
          toolActionConfig: ev.toolActionConfig ?? undefined,
          serverId: ev.serverId ?? undefined,
          servers: (ev.servers ?? []).map((s) => ({ id: s.id, name: s.name })),
          timeoutValue: ev.timeoutValue ?? undefined,
          timeoutUnit: ev.timeoutUnit ?? undefined,
          retries: ev.retries ?? undefined,
          maxExecutions: ev.maxExecutions ?? undefined,
          envVarKeys: (ev.envVars ?? []).map((v) => v.key),
          createdAt: ev.createdAt ?? undefined,
        }),
      );
    },
  },
  {
    name: "get_event_logs",
    title: "Get an event's execution logs",
    description:
      "Recent runs of one event, newest first: status, timing, exit code, error, " +
      "and tail-truncated output. Use after run_event to verify a run.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        ...PAGINATION_PROPS,
        maxOutputChars: MAX_OUTPUT_CHARS,
      },
      required: ["id"],
    },
    annotations: READ,
    handler: async (caller, args) => {
      const limit = clampInt(args.limit, 10, 1, 50);
      const offset = clampInt(args.offset, 0, 0, 1_000_000);
      const maxOut = clampInt(args.maxOutputChars, 2000, 100, 20_000);
      const res = (await caller.events.getLogs({
        id: args.id,
        limit,
        offset,
      } as never)) as { logs: LogRowLike[]; total: number; hasMore: boolean };
      return ok(
        json({
          logs: res.logs.map((l) => summarizeLog(l, maxOut)),
          total: res.total,
          hasMore: res.hasMore,
          nextOffset: res.hasMore ? offset + res.logs.length : undefined,
        }),
      );
    },
  },

  // ── Events: write ─────────────────────────────────────────────────────────
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
    annotations: CREATE,
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
    name: "update_event",
    title: "Update a Cronium event",
    description:
      "Patch fields on an existing event (the fix-a-draft tool): content, schedule, " +
      "toolActionConfig, envVars, etc. Only provided fields change; schedule changes " +
      "re-materialize automatically. Prefer activate_event/deactivate_event for " +
      "starting/stopping.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        ...EVENT_PROPS,
        resetCounterOnActive: { type: "boolean" },
      },
      required: ["id"],
    },
    annotations: UPDATE,
    handler: async (caller, args, baseUrl) => {
      const ev = (await caller.events.update(compact(args) as never)) as
        { id: number; name: string; status: string } | undefined;
      const id = ev?.id ?? (args.id as number);
      return ok(
        `Updated event #${id}${ev ? ` "${ev.name}" (status ${ev.status})` : ""}.` +
          `\n${baseUrl}/dashboard/events/${id}`,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (caller, args) => {
      await caller.events.activate(compact(args) as never);
      return ok(`Activated event #${String(args.id)}.`);
    },
  },
  {
    name: "deactivate_event",
    title: "Deactivate (pause) a Cronium event",
    description:
      "Set an event PAUSED and unregister its live schedule so it stops firing. " +
      "Counterpart to activate_event.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (caller, args) => {
      await caller.events.deactivate({ id: args.id } as never);
      return ok(`Paused event #${String(args.id)} (schedule unregistered).`);
    },
  },
  {
    name: "delete_event",
    title: "Delete a Cronium event",
    description:
      "Permanently delete an event and its logs/env vars. IRREVERSIBLE — confirm with " +
      "the user before calling. Fails if you lack edit rights.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    annotations: DELETE,
    handler: async (caller, args) => {
      await caller.events.delete({ id: args.id as number });
      return ok(`Deleted event #${String(args.id)}.`);
    },
  },
  {
    name: "run_event",
    title: "Run a Cronium event now",
    description:
      "Manually trigger one event (works on DRAFT — this is the verify step before " +
      "activating). EXECUTES THE EVENT'S REAL CODE/ACTION — get user approval first. " +
      "Returns {jobId, logId}; poll get_event_logs until the run finishes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        serverId: {
          type: "number",
          description: "Optional specific server for REMOTE events.",
        },
        input: {
          type: "object",
          description:
            "Optional input payload the script reads via cronium.input().",
        },
      },
      required: ["id"],
    },
    annotations: RUN,
    handler: async (caller, args) => {
      const res = (await caller.events.execute(
        compact({
          id: args.id,
          serverId: args.serverId,
          input: args.input,
        }) as never,
      )) as { success: boolean; logId?: number; jobId?: string };
      return ok(
        `Started event #${String(args.id)}: jobId=${res.jobId ?? "?"}, logId=${res.logId ?? "?"}.\n` +
          `Poll get_event_logs (id=${String(args.id)}) until the newest log finishes.`,
      );
    },
  },

  // ── Workflows: read ───────────────────────────────────────────────────────
  {
    name: "list_workflows",
    title: "List Cronium workflows",
    description:
      "List the user's workflows as summaries. Paginated; filter by status, " +
      "triggerType, or a search string. Use get_workflow for the graph.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGINATION_PROPS,
        search: { type: "string" },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"],
        },
        triggerType: {
          type: "string",
          enum: ["SCHEDULE", "WEBHOOK", "MANUAL"],
        },
      },
    },
    annotations: READ,
    handler: async (caller, args) => {
      const limit = clampInt(args.limit, 25, 1, 100);
      const offset = clampInt(args.offset, 0, 0, 1_000_000);
      const res = (await caller.workflows.getAll(
        compact({
          limit,
          offset,
          search: args.search,
          status: args.status,
          triggerType: args.triggerType,
        }) as never,
      )) as { workflows: WorkflowRowLike[]; total: number; hasMore: boolean };
      return ok(
        json({
          workflows: res.workflows.map(summarizeWorkflow),
          total: res.total,
          hasMore: res.hasMore,
          nextOffset: res.hasMore ? offset + res.workflows.length : undefined,
        }),
      );
    },
  },
  {
    name: "get_workflow",
    title: "Get one Cronium workflow (graph)",
    description:
      "One workflow with its graph: nodes (eventId, name, type, status) and " +
      "connections expressed by event id ({fromEventId, toEventId, connectionType}).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (caller, args) => {
      const res = (await caller.workflows.getById({
        id: args.id as number,
      })) as {
        data: WorkflowRowLike & {
          nodes: Array<{
            id: number;
            eventId: number;
            event?: { name?: string; type?: string; status?: string };
          }>;
          connections: Array<{
            sourceNodeId: number;
            targetNodeId: number;
            connectionType: string;
          }>;
        };
      };
      const wf = res.data;
      const byNodeId = new Map(wf.nodes.map((n) => [n.id, n]));
      return ok(
        json({
          ...summarizeWorkflow(wf),
          nodes: wf.nodes.map((n) => ({
            nodeId: n.id,
            eventId: n.eventId,
            name: n.event?.name,
            type: n.event?.type,
            status: n.event?.status,
          })),
          connections: wf.connections.map((c) => ({
            fromEventId: byNodeId.get(c.sourceNodeId)?.eventId,
            toEventId: byNodeId.get(c.targetNodeId)?.eventId,
            connectionType: c.connectionType,
          })),
        }),
      );
    },
  },
  {
    name: "get_executions",
    title: "List workflow executions (runs)",
    description:
      "Execution history: pass workflowId for one workflow's runs, omit it for the " +
      "user's recent runs across all workflows. Use get_execution for per-step detail.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "number" },
        ...PAGINATION_PROPS,
        status: {
          type: "string",
          description: "Filter by run status (e.g. RUNNING, SUCCESS, FAILURE).",
        },
      },
    },
    annotations: READ,
    handler: async (caller, args) => {
      const limit = clampInt(args.limit, 20, 1, 50);
      const offset = clampInt(args.offset, 0, 0, 1_000_000);
      const res = (await caller.workflows.getExecutions(
        compact({
          id: args.workflowId,
          limit,
          offset,
          status: args.status,
        }) as never,
      )) as {
        executions: { executions: ExecutionRowLike[]; total: number };
        hasMore: boolean;
      };
      const rows = res.executions.executions;
      return ok(
        json({
          executions: rows.map(summarizeExecution),
          total: res.executions.total,
          hasMore: res.hasMore,
          nextOffset: res.hasMore ? offset + rows.length : undefined,
        }),
      );
    },
  },
  {
    name: "get_execution",
    title: "Get one workflow execution (per-step detail)",
    description:
      "One workflow run with per-step results: each step's event, status, timing, " +
      "connection type, error, and tail-truncated output. Poll after run_workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "number" },
        executionId: { type: "number" },
        maxOutputChars: MAX_OUTPUT_CHARS,
      },
      required: ["workflowId", "executionId"],
    },
    annotations: READ,
    handler: async (caller, args) => {
      const maxOut = clampInt(args.maxOutputChars, 2000, 100, 20_000);
      const res = (await caller.workflows.getExecution({
        workflowId: args.workflowId as number,
        executionId: args.executionId as number,
      })) as ExecutionRowLike & { events: StepRowLike[] };
      return ok(
        json({
          ...summarizeExecution(res),
          steps: res.events.map((s) =>
            compact({
              eventId: s.eventId,
              nodeId: s.nodeId ?? undefined,
              sequenceOrder: s.sequenceOrder ?? undefined,
              status: s.status,
              startedAt: s.startedAt ?? undefined,
              completedAt: s.completedAt ?? undefined,
              durationMs: s.duration ?? undefined,
              connectionType: s.connectionType ?? undefined,
              error: headTruncate(s.errorMessage, 500) ?? undefined,
              output: tailTruncate(s.output, maxOut) ?? undefined,
            }),
          ),
        }),
      );
    },
  },

  // ── Workflows: write ──────────────────────────────────────────────────────
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
        tags: { type: "array", items: { type: "string" } },
        nodes: { type: "array", items: { type: "object" } },
        edges: { type: "array", items: { type: "object" } },
      },
      required: ["name", "triggerType"],
    },
    annotations: CREATE,
    handler: async (caller, args, baseUrl) => {
      const res = (await caller.workflows.create(compact(args) as never)) as {
        data?: { id?: number; webhookKey?: string | null };
      };
      const id = res?.data?.id;
      return ok(
        `Created workflow${id ? ` #${id}` : ""} "${String(args.name)}".` +
          (id ? `\n${baseUrl}/dashboard/workflows/${id}` : "") +
          webhookKeyLine(res?.data),
      );
    },
  },
  {
    name: "update_workflow",
    title: "Update a Cronium workflow",
    description:
      "Patch a workflow's fields and/or REPLACE its graph. `graph` (when given) is the " +
      "COMPLETE desired node/edge set as event ids: {events: [eventId…], connections: " +
      "[{from, to, connectionType?}]} — get_workflow shows the current graph. Omitting " +
      "`graph` leaves the graph unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        description: { type: "string" },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"],
        },
        triggerType: {
          type: "string",
          enum: ["SCHEDULE", "WEBHOOK", "MANUAL"],
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
        tags: { type: "array", items: { type: "string" } },
        graph: {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: { type: "number" },
              description: "ALL event ids in the workflow, in display order.",
            },
            connections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "number" },
                  to: { type: "number" },
                  connectionType: CONNECTION_TYPE,
                },
                required: ["from", "to"],
              },
            },
          },
          required: ["events"],
        },
      },
      required: ["id"],
    },
    annotations: UPDATE,
    handler: async (caller, args, baseUrl) => {
      const { graph, ...fields } = args as {
        graph?: {
          events: number[];
          connections?: Array<{
            from: number;
            to: number;
            connectionType?: string;
          }>;
        };
      } & Record<string, unknown>;
      let nodesEdges: {
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
      } = {};
      if (graph) {
        try {
          nodesEdges = await graphFromEventIds(
            caller,
            graph.events,
            graph.connections ?? [],
          );
        } catch (err) {
          // Graph-shape problems are tool-input errors the model can fix —
          // return them as an isError result (same contract as the bundle).
          return errText(err);
        }
      }
      const res = (await caller.workflows.update(
        compact({ ...fields, ...nodesEdges }) as never,
      )) as { id?: number; name?: string; webhookKey?: string | null } | null;
      const id = res?.id ?? (args.id as number);
      return ok(
        `Updated workflow #${id}${res?.name ? ` "${res.name}"` : ""}` +
          (graph ? ` (graph replaced: ${graph.events.length} node(s))` : "") +
          `.\n${baseUrl}/dashboard/workflows/${id}` +
          webhookKeyLine(res ?? undefined),
      );
    },
  },
  {
    name: "delete_workflow",
    title: "Delete a Cronium workflow",
    description:
      "Permanently delete a workflow (its events remain). IRREVERSIBLE — confirm with " +
      "the user before calling.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    annotations: DELETE,
    handler: async (caller, args) => {
      await caller.workflows.delete({ id: args.id } as never);
      return ok(`Deleted workflow #${String(args.id)} (member events kept).`);
    },
  },
  {
    name: "run_workflow",
    title: "Run a Cronium workflow now",
    description:
      "Manually trigger a workflow run (works on DRAFT — the verify step before " +
      "activating). EXECUTES THE MEMBER EVENTS' REAL CODE — get user approval first. " +
      "Returns {executionId}; poll get_execution until it completes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        payload: {
          type: "object",
          description:
            "Optional input payload available to the first step via cronium.input().",
        },
      },
      required: ["id"],
    },
    annotations: RUN,
    handler: async (caller, args) => {
      const res = await caller.workflows.execute(
        compact({ id: args.id, payload: args.payload }) as never,
      );
      if (!res.success) {
        return {
          text: `Workflow #${String(args.id)} did not start: ${res.output ?? "unknown reason"}`,
          isError: true,
        };
      }
      return ok(
        `Started workflow #${String(args.id)}: executionId=${res.executionId ?? "?"}` +
          `${res.status ? ` (status ${res.status})` : ""}.\n` +
          `Poll get_execution (workflowId=${String(args.id)}, executionId=${res.executionId ?? "?"}) until it completes.`,
      );
    },
  },

  // ── Bundle ────────────────────────────────────────────────────────────────
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
    annotations: CREATE,
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
        let createdWorkflow: { webhookKey?: string | null } | undefined;
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
              tags: workflow.tags,
              nodes,
              edges,
            }) as never,
          )) as { data?: { id?: number; webhookKey?: string | null } };
          workflowId = res?.data?.id;
          createdWorkflow = res?.data;
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
            webhookKeyLine(createdWorkflow) +
            `\n\nNext: run_workflow (or run_event) to verify, inspect with ` +
            `get_execution / get_event_logs, fix with update_event, then activate.`,
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
