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
import { getSupportedToolTypes, getManifest } from "@/lib/tools/tool-registry";
import { serverQuerySchema } from "@shared/schemas/servers";

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
});
