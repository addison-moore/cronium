import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { storage } from "@/server/storage";
import {
  toolCredentials,
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  WorkflowTriggerType,
  ConnectionType,
} from "@/shared/schema";
import {
  getSupportedToolTypes,
  getManifest,
  getServerActionById,
} from "@/lib/tools/tool-registry";
import { serverQuerySchema } from "@shared/schemas/servers";
import { createEventSchema } from "@shared/schemas/events";

// A plan the agent proposes before creating: events keyed locally, plus an
// optional workflow chaining them by key. validatePlan checks it WITHOUT
// persisting so a draft can be shown to the user for approval.
const validatePlanSchema = z.object({
  events: z
    .array(z.object({ key: z.string().min(1) }).catchall(z.unknown()))
    .min(1),
  workflow: z
    .object({
      name: z.string().optional(),
      connections: z
        .array(
          z.object({
            from: z.string(),
            to: z.string(),
            connectionType: z.nativeEnum(ConnectionType).optional(),
          }),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

/**
 * MCP support router. `getCapabilities` returns everything an AI agent (via the
 * Cronium MCP server) needs to draft valid events/workflows in a single call:
 * the enums + defaults, scheduling guidance, the tool types and their actions
 * (with parameter metadata), and the user's real tool-credential and server ids.
 *
 * Creation itself reuses the existing procedures (events.create / events.activate
 * / workflows.create) — this router is read-only discovery.
 */
export const mcpRouter = createTRPCRouter({
  getCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Tool types + actions from the registry. Zod schemas aren't serializable,
    // so expose the derived `parameters` metadata (name/type/required/enum/desc)
    // plus helpText/examples instead.
    const toolTypes = getSupportedToolTypes().map((type) => {
      const manifest = getManifest(type);
      return {
        type,
        actions: (manifest?.actions ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          actionType: a.actionType,
          producesOutput: a.producesOutput ?? false,
          parameters: a.parameters,
          helpText: a.helpText,
          examples: a.examples,
        })),
      };
    });

    // The user's configured tool credentials — the real `toolId`s a TOOL_ACTION
    // event references. Stored `type` is UPPERCASE; toolActionConfig.toolType is
    // the lowercase manifest type, so normalize here.
    const creds = await ctx.db
      .select({
        id: toolCredentials.id,
        type: toolCredentials.type,
        name: toolCredentials.name,
        isActive: toolCredentials.isActive,
      })
      .from(toolCredentials)
      .where(eq(toolCredentials.userId, userId));

    const serversResult = await storage.queryServers(
      userId,
      serverQuerySchema.parse({}),
    );

    return {
      eventTypes: Object.values(EventType),
      eventStatuses: Object.values(EventStatus),
      runLocations: Object.values(RunLocation),
      timeUnits: Object.values(TimeUnit),
      triggerTypes: Object.values(EventTriggerType),
      workflowTriggerTypes: Object.values(WorkflowTriggerType),
      connectionTypes: Object.values(ConnectionType),

      defaults: {
        runLocation: RunLocation.LOCAL,
        timeoutValue: 30,
        timeoutUnit: TimeUnit.MINUTES,
        status: EventStatus.DRAFT,
        triggerType: EventTriggerType.MANUAL,
        retries: 0,
      },

      scheduling: {
        specificTime:
          "To run at a specific time (e.g. 8am daily), set triggerType=SCHEDULE, " +
          "status=ACTIVE, and customSchedule to a cron expression, e.g. '0 8 * * *'. " +
          "The scheduleNumber/scheduleUnit interval CANNOT express a specific hour " +
          "(the DAYS interval only fires at midnight).",
        interval:
          "For 'every N minutes/hours/days', use scheduleNumber + scheduleUnit " +
          "(no customSchedule).",
        activation:
          "events.create does not register the live scheduler. After creating a " +
          "scheduled event, call events.activate to make it fire. For a workflow, " +
          "schedule the WORKFLOW (not its member events) — the workflow executor " +
          "drives the chain.",
      },

      guidance: {
        iterateLoop:
          "Typical flow: get_capabilities → validate_plan → create_workflow_bundle " +
          "(events land as DRAFT) → run_workflow or run_event to verify (works on " +
          "DRAFT) → get_execution / get_event_logs to inspect results → update_event " +
          "/ update_workflow to fix → re-run → activate once green.",
        verification:
          "run_event returns {jobId, logId}: poll get_event_logs until the newest " +
          "log leaves RUNNING. run_workflow returns {executionId}: poll " +
          "get_execution until it completes. Runs execute the real event " +
          "code/action — get the user's approval before running.",
        updating:
          "update_event patches only the fields you pass (schedule changes " +
          "re-materialize automatically). update_workflow's `graph` REPLACES the " +
          "entire node/edge set — pass the complete desired graph; get_workflow " +
          "shows the current one. Deletes are irreversible; confirm with the user.",
        reading:
          "List tools return summaries (no script bodies) with limit/offset " +
          "pagination. Log/step output is tail-truncated — raise maxOutputChars " +
          "(up to 20000) when you need more. Env-var VALUES are never returned.",
      },

      toolTypes,

      credentials: creds.map((c) => ({
        id: c.id,
        toolType: c.type.toLowerCase(),
        name: c.name,
        isActive: c.isActive,
      })),

      servers: serversResult.items.map((s) => ({ id: s.id, name: s.name })),

      shapes: {
        event:
          "events.create input: { name (required), type (EventType, required), " +
          "for scripts: content; for HTTP_REQUEST: httpUrl+httpMethod; for " +
          "TOOL_ACTION: toolActionConfig (JSON string). Optional: description, " +
          "status (default DRAFT), triggerType (default MANUAL), customSchedule " +
          "(cron), scheduleNumber/scheduleUnit, runLocation (default LOCAL), " +
          "serverId/selectedServerIds (required when runLocation!=LOCAL), " +
          "timeoutValue (default 30), timeoutUnit (default MINUTES), retries, " +
          "envVars, tags }.",
        toolActionConfig:
          "A JSON string: { toolType (lowercase manifest type, e.g. 'sql'), " +
          "toolId (a credentials[].id above), actionId (a toolTypes[].actions[].id), " +
          "parameters (that action's params) }.",
        workflow:
          "workflows.create input: { name (required), triggerType (required: " +
          "SCHEDULE|WEBHOOK|MANUAL), status (default DRAFT), nodes: [{ id, type: " +
          "'eventNode', position:{x,y}, data:{ eventId (an existing event id), " +
          "label, type, eventTypeIcon, tags } }], edges: [{ id, source, target, " +
          "type:'connectionEdge', animated, data:{ connectionType } }] }. Events " +
          "must be created first; nodes reference them by eventId. Graph must be a " +
          "DAG (no cycles) and each node has at most one incoming edge (fan-out ok).",
      },
    };
  }),

  // Dry-run: validate a proposed events+workflow plan without persisting, so the
  // agent can show a checked draft before calling the create tools. Read-only
  // (a mutation only to keep large plans out of the URL).
  validatePlan: protectedProcedure
    .input(validatePlanSchema)
    .mutation(async ({ ctx, input }) => {
      const errors: string[] = [];

      // Event keys must be unique.
      const keys = new Set<string>();
      for (const ev of input.events) {
        if (keys.has(ev.key)) errors.push(`Duplicate event key "${ev.key}".`);
        keys.add(ev.key);
      }

      // The user's real tool-credential ids (for toolActionConfig.toolId).
      const creds = await ctx.db
        .select({ id: toolCredentials.id, type: toolCredentials.type })
        .from(toolCredentials)
        .where(eq(toolCredentials.userId, ctx.session.user.id));
      const credType = new Map(creds.map((c) => [c.id, c.type.toLowerCase()]));

      for (const ev of input.events) {
        const { key, ...fields } = ev;
        const parsed = createEventSchema.safeParse(fields);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push(
              `event "${key}": ${issue.path.join(".") || "(root)"}: ${issue.message}`,
            );
          }
          continue;
        }
        if (parsed.data.type === EventType.TOOL_ACTION) {
          let cfg: {
            toolType?: unknown;
            toolId?: unknown;
            actionId?: unknown;
            parameters?: unknown;
          } | null = null;
          try {
            cfg =
              typeof parsed.data.toolActionConfig === "string"
                ? (JSON.parse(parsed.data.toolActionConfig) as typeof cfg)
                : null;
          } catch {
            errors.push(`event "${key}": toolActionConfig is not valid JSON.`);
          }
          if (cfg) {
            const { toolType, toolId, actionId, parameters } = cfg;
            if (typeof toolId !== "number" || !credType.has(toolId)) {
              errors.push(
                `event "${key}": toolId ${String(toolId)} is not one of your tool credentials (see get_capabilities).`,
              );
            } else if (credType.get(toolId) !== toolType) {
              errors.push(
                `event "${key}": toolType "${String(toolType)}" doesn't match credential #${String(toolId)} (${credType.get(toolId) ?? "unknown"}).`,
              );
            }
            const action =
              typeof actionId === "string"
                ? getServerActionById(actionId)
                : undefined;
            if (!action) {
              errors.push(
                `event "${key}": unknown actionId "${String(actionId)}".`,
              );
            } else {
              const pr = action.inputSchema.safeParse(parameters ?? {});
              if (!pr.success) {
                for (const issue of pr.error.issues) {
                  errors.push(
                    `event "${key}" parameters: ${issue.path.join(".") || "(root)"}: ${issue.message}`,
                  );
                }
              }
            }
          }
        }
      }

      // Workflow graph: keys resolve, no self-loop, no fan-in, no cycles.
      const conns = input.workflow?.connections ?? [];
      const incoming = new Map<string, number>();
      const adj = new Map<string, string[]>();
      for (const c of conns) {
        if (!keys.has(c.from)) {
          errors.push(
            `workflow connection from unknown event key "${c.from}".`,
          );
        }
        if (!keys.has(c.to)) {
          errors.push(`workflow connection to unknown event key "${c.to}".`);
        }
        if (c.from === c.to) {
          errors.push(`workflow has a self-loop on "${c.from}".`);
        }
        incoming.set(c.to, (incoming.get(c.to) ?? 0) + 1);
        const out = adj.get(c.from) ?? [];
        if (!adj.has(c.from)) adj.set(c.from, out);
        out.push(c.to);
      }
      for (const [k, n] of incoming) {
        if (n > 1) {
          errors.push(
            `workflow node "${k}" has ${n} incoming edges (fan-in is not allowed).`,
          );
        }
      }
      // Cycle detection (DFS, white/gray/black).
      const color = new Map<string, number>();
      const hasCycle = (n: string): boolean => {
        color.set(n, 1);
        for (const m of adj.get(n) ?? []) {
          const c = color.get(m) ?? 0;
          if (c === 1) return true;
          if (c === 0 && hasCycle(m)) return true;
        }
        color.set(n, 2);
        return false;
      };
      for (const k of keys) {
        if ((color.get(k) ?? 0) === 0 && hasCycle(k)) {
          errors.push("workflow contains a cycle (must be a DAG).");
          break;
        }
      }

      const valid = errors.length === 0;
      return {
        valid,
        errors,
        eventCount: input.events.length,
        hasWorkflow: !!input.workflow,
        summary: valid
          ? `Plan is valid: ${input.events.length} event(s)` +
            (input.workflow ? " + 1 workflow" : "") +
            ". Ready to create."
          : `Plan has ${errors.length} issue(s) to fix before creating.`,
      };
    }),
});
