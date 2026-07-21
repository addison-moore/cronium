import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/server/db";
import {
  eventServers,
  events,
  servers,
  workflowNodes,
  workflows,
} from "@/shared/schema";

/**
 * Resource capabilities are intentionally more specific than the legacy
 * `shared` boolean. Until explicit grants are persisted, sharing grants only
 * view/fork access. Editing, execution, and secret use remain owner-only.
 */
export type ResourceCapability =
  "view" | "fork" | "edit" | "execute" | "use-secret";

type SharedResource = {
  userId: string;
  shared?: boolean | null;
};

export function hasResourceCapability(
  resource: SharedResource,
  userId: string,
  capability: ResourceCapability,
): boolean {
  if (resource.userId === userId) return true;
  return (
    resource.shared === true && (capability === "view" || capability === "fork")
  );
}

export function allRequestedResourcesHaveCapability<
  T extends SharedResource & { id: number },
>(
  requestedIds: readonly number[],
  resources: readonly T[],
  userId: string,
  capability: ResourceCapability,
): boolean {
  const ids = [...new Set(requestedIds)];
  return (
    resources.length === ids.length &&
    resources.every(
      (resource) =>
        ids.includes(resource.id) &&
        hasResourceCapability(resource, userId, capability),
    )
  );
}

function deny(resourceName: string): never {
  // Do not disclose whether an inaccessible relationship ID exists.
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `You do not have the required capability for this ${resourceName}`,
  });
}

function notFound(resourceName: string): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: `${resourceName} not found`,
  });
}

export async function assertEventCapability(
  eventId: number,
  userId: string,
  capability: ResourceCapability,
): Promise<{
  id: number;
  userId: string;
  shared: boolean;
  serverId: number | null;
}> {
  const [event] = await db
    .select({
      id: events.id,
      userId: events.userId,
      shared: events.shared,
      serverId: events.serverId,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) notFound("Event");
  if (!hasResourceCapability(event, userId, capability)) deny("event");
  return event;
}

export async function assertEventCapabilities(
  eventIds: readonly number[],
  userId: string,
  capability: ResourceCapability,
): Promise<void> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return;

  const rows = await db
    .select({ id: events.id, userId: events.userId, shared: events.shared })
    .from(events)
    .where(inArray(events.id, ids));

  if (!allRequestedResourcesHaveCapability(ids, rows, userId, capability)) {
    deny("event relationship");
  }
}

export async function assertServerCapabilities(
  serverIds: readonly number[],
  userId: string,
  capability: ResourceCapability,
): Promise<void> {
  const ids = [...new Set(serverIds)];
  if (ids.length === 0) return;

  const rows = await db
    .select({
      id: servers.id,
      userId: servers.userId,
      shared: servers.shared,
      isArchived: servers.isArchived,
    })
    .from(servers)
    .where(inArray(servers.id, ids));

  if (
    rows.some((server) => server.isArchived) ||
    !allRequestedResourcesHaveCapability(ids, rows, userId, capability)
  ) {
    deny("server relationship");
  }
}

export async function assertEventRelations(
  eventId: number,
  userId: string,
  capability: "view" | "execute",
): Promise<void> {
  const event = await assertEventCapability(eventId, userId, capability);

  // A shared viewer receives a sanitized template. They do not gain the
  // ability to inspect or use the owner's server relationships.
  if (event.userId !== userId) return;

  const related = await db
    .select({ serverId: eventServers.serverId })
    .from(eventServers)
    .where(eq(eventServers.eventId, eventId));
  const serverIds = related.map((row) => row.serverId);
  if (event.serverId !== null) serverIds.push(event.serverId);

  await assertServerCapabilities(serverIds, userId, "use-secret");
}

export async function assertWorkflowCapability(
  workflowId: number,
  userId: string,
  capability: ResourceCapability,
): Promise<{
  id: number;
  userId: string;
  shared: boolean;
  overrideServerIds: unknown;
}> {
  const [workflow] = await db
    .select({
      id: workflows.id,
      userId: workflows.userId,
      shared: workflows.shared,
      overrideServerIds: workflows.overrideServerIds,
    })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (!workflow) notFound("Workflow");
  if (!hasResourceCapability(workflow, userId, capability)) deny("workflow");
  return workflow;
}

function numericIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => Number.isInteger(item) && item > 0,
  );
}

/**
 * Validate every workflow edge to an event on reads and again immediately
 * before execution. Execution additionally validates each event's server
 * relationships and workflow-level server overrides.
 */
export async function assertWorkflowGraphCapability(
  workflowId: number,
  userId: string,
  capability: "view" | "execute",
): Promise<void> {
  const workflow = await assertWorkflowCapability(
    workflowId,
    userId,
    capability,
  );
  const nodes = await db
    .select({ eventId: workflowNodes.eventId })
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));
  const eventIds = [...new Set(nodes.map((node) => node.eventId))];

  if (capability === "view") {
    await assertEventCapabilities(eventIds, userId, "view");
    await Promise.all(
      eventIds.map((eventId) => assertEventRelations(eventId, userId, "view")),
    );
    return;
  }

  // Workflows can execute only resources owned by the execution principal.
  await assertEventCapabilities(eventIds, userId, "execute");
  await assertServerCapabilities(
    numericIds(workflow.overrideServerIds),
    userId,
    "use-secret",
  );
  await Promise.all(
    eventIds.map((eventId) => assertEventRelations(eventId, userId, "execute")),
  );
}

/** Validate a proposed graph before any rows are written or replaced. */
export async function assertWorkflowDefinition(
  userId: string,
  eventIds: readonly number[],
  overrideServerIds: readonly number[],
): Promise<void> {
  await Promise.all([
    assertEventCapabilities(eventIds, userId, "execute"),
    assertServerCapabilities(overrideServerIds, userId, "use-secret"),
  ]);
  await Promise.all(
    [...new Set(eventIds)].map((eventId) =>
      assertEventRelations(eventId, userId, "execute"),
    ),
  );
}

/**
 * Centralized validation for direct and many-to-many event server inputs.
 */
export async function assertProposedEventServers(
  userId: string,
  serverId: number | null | undefined,
  selectedServerIds: readonly number[] | undefined,
): Promise<void> {
  const ids = eventServerRelationshipIds(serverId, selectedServerIds);
  await assertServerCapabilities(ids, userId, "use-secret");
}

export function eventServerRelationshipIds(
  serverId: number | null | undefined,
  selectedServerIds: readonly number[] | undefined,
): number[] {
  const ids = [...(selectedServerIds ?? [])];
  if (serverId !== null && serverId !== undefined) ids.push(serverId);
  return [...new Set(ids)];
}

export function resourceAccessHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof TRPCError)) return undefined;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "BAD_REQUEST") return 400;
  return undefined;
}
