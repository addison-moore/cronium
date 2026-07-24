/**
 * FK-ordered delete tests — the CLAUDE.md-documented footgun ("Many FKs lack
 * onDelete cascades, so deletion methods must remove dependents in FK-safe
 * order") encoded as executable knowledge.
 *
 * For each delete method: seed a maximally-connected graph around the target,
 * call the delete, and assert
 *   (a) no FK violation is thrown,
 *   (b) zero orphans remain in every dependent table, and
 *   (c) an unrelated second user's identical graph survives untouched.
 *
 * These run against the real Postgres via the real storage singleton — the FK
 * constraints are enforced by the DB, so a missing dependent delete surfaces as
 * a genuine `23503 foreign_key_violation`, not a mock artifact.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  users,
  events,
  envVars,
  servers,
  serverGroups,
  serverGroupMembers,
  logs,
  scheduleIncidents,
  jobs,
  executions,
  eventServers,
  serverDeletionNotifications,
  toolActionLogs,
  workflows,
  workflowNodes,
  workflowConnections,
  workflowLogs,
  workflowExecutions,
  workflowExecutionEvents,
  workflowStepRuns,
  apiTokens,
  toolCredentials,
  userVariables,
  webhooks,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedFullGraph } from "./helpers/seed";

async function countWhere(table: unknown, where: unknown): Promise<number> {
  const rows = await db
    .select()
    .from(table as never)
    .where(where as never);
  return rows.length;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("deleteScript (event) — FK-ordered teardown", () => {
  it("removes the event and every dependent row, leaving no orphans", async () => {
    const g = await seedFullGraph();

    await expect(storage.deleteScript(g.eventId)).resolves.toBeUndefined();

    // The event and its direct dependents are gone.
    expect(await countWhere(events, eq(events.id, g.eventId))).toBe(0);
    expect(await countWhere(envVars, eq(envVars.eventId, g.eventId))).toBe(0);
    expect(await countWhere(logs, eq(logs.eventId, g.eventId))).toBe(0);
    expect(await countWhere(jobs, eq(jobs.eventId, g.eventId))).toBe(0);
    expect(await countWhere(executions, eq(executions.jobId, g.jobId))).toBe(0);
    expect(
      await countWhere(eventServers, eq(eventServers.eventId, g.eventId)),
    ).toBe(0);
    expect(
      await countWhere(toolActionLogs, eq(toolActionLogs.eventId, g.eventId)),
    ).toBe(0);
    expect(
      await countWhere(workflowNodes, eq(workflowNodes.eventId, g.eventId)),
    ).toBe(0);
  });

  it("leaves a second user's event untouched", async () => {
    const target = await seedFullGraph();
    const bystander = await seedFullGraph();

    await storage.deleteScript(target.eventId);

    expect(await countWhere(events, eq(events.id, bystander.eventId))).toBe(1);
    expect(await countWhere(jobs, eq(jobs.eventId, bystander.eventId))).toBe(1);
  });
});

describe("deleteWorkflow — FK-ordered teardown", () => {
  it("removes the workflow, its nodes, connections and logs", async () => {
    const g = await seedFullGraph();

    await expect(storage.deleteWorkflow(g.workflowId)).resolves.toBeUndefined();

    expect(await countWhere(workflows, eq(workflows.id, g.workflowId))).toBe(0);
    expect(
      await countWhere(
        workflowNodes,
        eq(workflowNodes.workflowId, g.workflowId),
      ),
    ).toBe(0);
    expect(
      await countWhere(
        workflowConnections,
        eq(workflowConnections.workflowId, g.workflowId),
      ),
    ).toBe(0);
    expect(
      await countWhere(workflowLogs, eq(workflowLogs.workflowId, g.workflowId)),
    ).toBe(0);
    // Workflow-scoped execution logs and schedule incidents have no ON DELETE
    // cascade, so deleteWorkflow must remove them explicitly.
    expect(await countWhere(logs, eq(logs.workflowId, g.workflowId))).toBe(0);
    expect(
      await countWhere(
        scheduleIncidents,
        eq(scheduleIncidents.workflowId, g.workflowId),
      ),
    ).toBe(0);
  });

  it("cascades to workflow_executions / execution_events / step_runs (FK ON DELETE CASCADE)", async () => {
    const g = await seedFullGraph();

    await storage.deleteWorkflow(g.workflowId);

    // workflow_executions.workflowId is ON DELETE CASCADE; its children
    // (execution_events, step_runs) cascade in turn. This is the cascade
    // behavior the workflow-persistence suite also relies on.
    expect(
      await countWhere(
        workflowExecutions,
        eq(workflowExecutions.workflowId, g.workflowId),
      ),
    ).toBe(0);
    expect(
      await countWhere(
        workflowExecutionEvents,
        eq(workflowExecutionEvents.workflowExecutionId, g.workflowExecutionId),
      ),
    ).toBe(0);
    expect(
      await countWhere(
        workflowStepRuns,
        eq(workflowStepRuns.workflowExecutionId, g.workflowExecutionId),
      ),
    ).toBe(0);
  });

  it("leaves the underlying event intact (workflow delete must not delete events)", async () => {
    const g = await seedFullGraph();
    await storage.deleteWorkflow(g.workflowId);
    expect(await countWhere(events, eq(events.id, g.eventId))).toBe(1);
  });
});

describe("deleteServer — FK-ordered teardown", () => {
  it("removes the server, unbinds events and nulls execution.serverId", async () => {
    const g = await seedFullGraph();

    await expect(storage.deleteServer(g.serverId)).resolves.toBeUndefined();

    expect(await countWhere(servers, eq(servers.id, g.serverId))).toBe(0);
    expect(
      await countWhere(eventServers, eq(eventServers.serverId, g.serverId)),
    ).toBe(0);
    // The event survives, its serverId reset to null.
    const [ev] = await db
      .select({ serverId: events.serverId })
      .from(events)
      .where(eq(events.id, g.eventId));
    expect(ev?.serverId).toBeNull();
    // server_group_members + deletion_notifications cascade on the FK.
    expect(
      await countWhere(
        serverGroupMembers,
        eq(serverGroupMembers.serverId, g.serverId),
      ),
    ).toBe(0);
    expect(
      await countWhere(
        serverDeletionNotifications,
        eq(serverDeletionNotifications.serverId, g.serverId),
      ),
    ).toBe(0);
  });

  it("leaves a second user's server untouched", async () => {
    const target = await seedFullGraph();
    const bystander = await seedFullGraph();
    await storage.deleteServer(target.serverId);
    expect(await countWhere(servers, eq(servers.id, bystander.serverId))).toBe(
      1,
    );
  });
});

describe("deleteServerGroup — FK-ordered teardown", () => {
  it("removes the group and its membership rows (members cascade), keeps servers", async () => {
    const g = await seedFullGraph();

    await expect(
      storage.deleteServerGroup(g.serverGroupId),
    ).resolves.toBeUndefined();

    expect(
      await countWhere(serverGroups, eq(serverGroups.id, g.serverGroupId)),
    ).toBe(0);
    expect(
      await countWhere(
        serverGroupMembers,
        eq(serverGroupMembers.groupId, g.serverGroupId),
      ),
    ).toBe(0);
    // The servers themselves must survive group deletion.
    expect(await countWhere(servers, eq(servers.id, g.serverId))).toBe(1);
  });
});

describe("deleteUser — FK-ordered teardown of everything a user owns", () => {
  it("removes the user and every owned row without an FK violation", async () => {
    const g = await seedFullGraph();

    await expect(storage.deleteUser(g.userId)).resolves.toBeUndefined();

    expect(await countWhere(users, eq(users.id, g.userId))).toBe(0);
    expect(await countWhere(events, eq(events.userId, g.userId))).toBe(0);
    expect(await countWhere(servers, eq(servers.userId, g.userId))).toBe(0);
    expect(await countWhere(jobs, eq(jobs.userId, g.userId))).toBe(0);
    expect(await countWhere(apiTokens, eq(apiTokens.userId, g.userId))).toBe(0);
    expect(
      await countWhere(toolCredentials, eq(toolCredentials.userId, g.userId)),
    ).toBe(0);
    expect(
      await countWhere(userVariables, eq(userVariables.userId, g.userId)),
    ).toBe(0);
    expect(await countWhere(webhooks, eq(webhooks.userId, g.userId))).toBe(0);
    expect(await countWhere(workflows, eq(workflows.userId, g.userId))).toBe(0);
    expect(
      await countWhere(serverGroups, eq(serverGroups.userId, g.userId)),
    ).toBe(0);
    // No dangling executions from the user's jobs.
    expect(await countWhere(executions, eq(executions.id, g.executionId))).toBe(
      0,
    );
  });

  it("leaves a second user and their entire graph untouched", async () => {
    const target = await seedFullGraph();
    const bystander = await seedFullGraph();

    await storage.deleteUser(target.userId);

    expect(await countWhere(users, eq(users.id, bystander.userId))).toBe(1);
    expect(await countWhere(events, eq(events.userId, bystander.userId))).toBe(
      1,
    );
    expect(
      await countWhere(servers, eq(servers.userId, bystander.userId)),
    ).toBe(1);
    expect(
      await countWhere(workflows, eq(workflows.userId, bystander.userId)),
    ).toBe(1);
  });
});
