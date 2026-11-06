/**
 * A script event set to REMOTE runs only on its servers. With none left it used
 * to run in a local container on the Cronium host, with only a console warning.
 * Real Postgres and the real routers, because what matters here is what ends up
 * in the rows: whether a job was queued, and what happened to the event.
 *
 * How an event gets there: a draft that never had a server, an edit or REST call
 * that removes the last one, a delete of its last server (by hand or through the
 * 30-day cleanup), or a row already like that from before this rule.
 */
// The callers and requests below carry their own identity. The real NextAuth
// stack needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import {
  PATCH as patchEvent,
  PUT as putEvent,
} from "@/app/api/events/[id]/route";
import { POST as executeEvent } from "@/app/api/events/[id]/execute/route";
import { POST as createEvent } from "@/app/api/events/route";
import { DELETE as deleteServerRoute } from "@/app/api/servers/[id]/route";
import { cacheService } from "@/lib/cache/cache-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { runDispatchTick } from "@/lib/scheduling/dispatcher";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { ServerCleanupService } from "@/lib/services/server-cleanup-service";
import { eventsRouter } from "@/server/api/routers/events";
import { serversRouter } from "@/server/api/routers/servers";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  EventType,
  RunLocation,
  ScheduleIncidentKind,
  TimeUnit,
  WorkflowStepStatus,
  WorkflowTriggerType,
  eventServers,
  events,
  jobs,
  logs,
  scheduleIncidents,
  workflowNodes,
  workflowStepRuns,
  workflows,
  type Event,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(30_000);

const REFUSAL =
  "This event runs only on servers and has none. Choose a server, or set it to run locally.";

// Mounted under the names root.ts uses, because the route-capability inventory
// is keyed by "events.<procedure>".
const createCaller = createCallerFactory(
  createTRPCRouter({ events: eventsRouter, servers: serversRouter }),
);

function callerFor(userId: string) {
  return createCaller({
    session: {
      user: { id: userId, sessionVersion: 1 },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

async function seedToken(userId: string): Promise<string> {
  const token = `test-token-${randomUUID()}`;
  await storage.createApiToken({
    userId,
    name: "ci",
    token,
    scopes: ["full"],
  } as never);
  return token;
}

function restRequest(
  path: string,
  method: string,
  token: string,
  body?: unknown,
) {
  return new NextRequest(`http://localhost:5001/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const routeParams = (id: number) => ({
  params: Promise.resolve({ id: String(id) }),
});

/** A REMOTE script event linked to these servers, or to none. */
async function seedRemoteEvent(
  userId: string,
  serverIds: number[] = [],
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<number> {
  const eventId = await seedEvent(userId, {
    runLocation: RunLocation.REMOTE,
    status: EventStatus.ACTIVE,
    ...overrides,
  });
  if (serverIds.length > 0) {
    await db
      .insert(eventServers)
      .values(serverIds.map((serverId) => ({ eventId, serverId })));
  }
  return eventId;
}

/** Due now, so the next dispatch tick picks it up. */
const dueOnSchedule = () => ({
  status: EventStatus.ACTIVE,
  triggerType: EventTriggerType.SCHEDULE,
  scheduleNumber: 5,
  scheduleUnit: TimeUnit.MINUTES,
  nextRunAt: new Date(Date.now() - 1000),
});

async function eventRow(eventId: number): Promise<Event> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row!;
}

async function linkedServerIds(eventId: number): Promise<number[]> {
  const rows = await db
    .select({ serverId: eventServers.serverId })
    .from(eventServers)
    .where(eq(eventServers.eventId, eventId));
  return rows.map((row) => row.serverId).sort((a, b) => a - b);
}

async function incidentsOf(eventId: number) {
  return db
    .select()
    .from(scheduleIncidents)
    .where(eq(scheduleIncidents.eventId, eventId));
}

async function reasonsOf(eventId: number) {
  return (await incidentsOf(eventId)).map(
    (incident) => (incident.details as { reason?: string } | null)?.reason,
  );
}

async function allJobs() {
  return db.select().from(jobs);
}

/** A run was refused only if it left nothing behind. */
async function expectNothingQueued() {
  expect(await allJobs()).toEqual([]);
  expect(await db.select().from(logs)).toEqual([]);
}

function loaded(eventId: number) {
  return storage.getEventWithRelations(eventId).then((event) => event!);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("running a REMOTE script event with no servers", () => {
  describe("on a schedule", () => {
    it("queues nothing, pauses the event, and records why", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], dueOnSchedule());

      const tick = await runDispatchTick();

      expect(tick.dispatched).toBe(0);
      await expectNothingQueued();
      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.PAUSED);
      expect(after.nextRunAt).toBeNull();
      // Pausing is not converting: the event still says where it means to run.
      expect(after.runLocation).toBe(RunLocation.REMOTE);

      const incidents = await incidentsOf(eventId);
      expect(incidents).toHaveLength(1);
      expect(incidents[0]!.kind).toBe(ScheduleIncidentKind.NO_SERVERS);
      expect((incidents[0]!.details as { reason: string }).reason).toBe(
        "This event runs only on servers and has none, so it was paused. Choose a server or set it to run locally, then reactivate it.",
      );
    });

    it("records one incident, not one per tick", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], dueOnSchedule());

      await runDispatchTick();
      await runDispatchTick();

      expect(await incidentsOf(eventId)).toHaveLength(1);
    });

    it("stops at the first tick of a catch-up batch", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        ...dueOnSchedule(),
        scheduleNumber: 1,
        catchupPolicy: CatchupPolicy.RUN_ALL,
        nextRunAt: new Date(Date.now() - 10 * 60_000),
      });

      await runDispatchTick();

      await expectNothingQueued();
      expect(await incidentsOf(eventId)).toHaveLength(1);
    });

    it("treats a row that was already like this before the rule the same way", async () => {
      // No migration: an event that has been running in a container for months
      // stops at its next scheduled run, and the incident says why.
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        ...dueOnSchedule(),
        lastRunAt: new Date(Date.now() - 86_400_000),
        executionCount: 40,
      });

      await runDispatchTick();

      await expectNothingQueued();
      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
    });
  });

  describe("by hand", () => {
    it("refuses over tRPC with the reason, and changes nothing", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner);

      await expect(
        callerFor(owner).events.execute({ id: eventId }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: REFUSAL });

      await expectNothingQueued();
      expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
      expect(await incidentsOf(eventId)).toEqual([]);
    });

    it("answers 409 over REST with the reason", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner);
      const token = await seedToken(owner);

      const response = await executeEvent(
        restRequest(`events/${eventId}/execute`, "POST", token),
        routeParams(eventId),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: REFUSAL });
      await expectNothingQueued();
    });
  });

  describe("as a workflow step", () => {
    it("fails the step with the reason, even though workflow steps ignore pause", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });
      const [workflow] = await db
        .insert(workflows)
        .values({ userId: owner, name: "Nightly" })
        .returning({ id: workflows.id });
      await db
        .insert(workflowNodes)
        .values({ workflowId: workflow!.id, eventId });

      const started = await startWorkflowRun(workflow!.id, {
        userId: owner,
        triggerType: WorkflowTriggerType.MANUAL,
      });

      expect(started).toMatchObject({ success: true });
      await expectNothingQueued();
      const [step] = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.workflowExecutionId, started.executionId!));
      expect(step!.status).toBe(WorkflowStepStatus.FAILED);
      expect(step!.error).toBe(REFUSAL);
    });
  });

  describe("what keeps running", () => {
    it("still sends an event with a server to that server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId]);

      await callerFor(owner).events.execute({ id: eventId });

      const [job] = await allJobs();
      expect(job!.payload).toMatchObject({ target: { serverId } });
    });

    it("still runs the local half of a LOCAL_AND_REMOTE event with no servers", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        runLocation: RunLocation.LOCAL_AND_REMOTE,
      });

      await callerFor(owner).events.execute({ id: eventId });

      const [job] = await allJobs();
      expect(job!.payload).toMatchObject({
        target: { containerImage: "cronium/bash:latest" },
      });
    });

    it.each([
      [
        "an HTTP request",
        {
          type: EventType.HTTP_REQUEST,
          content: "",
          httpMethod: "GET",
          httpUrl: "https://example.test/hook",
        },
      ],
      [
        "a tool action",
        {
          type: EventType.TOOL_ACTION,
          content: "",
          toolActionConfig: { toolType: "SLACK" } as never,
        },
      ],
    ])(
      "still runs %s, which runs in the worker wherever it's set to run",
      async (_name, fields) => {
        const owner = await seedUser();
        const eventId = await seedRemoteEvent(owner, [], fields);

        const result = await dispatchEventJob(await loaded(eventId), {
          triggeredBy: "schedule",
        });

        expect(result.skipped).toBeUndefined();
        expect(await allJobs()).toHaveLength(1);
        expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
      },
    );
  });
});

describe("setting up a REMOTE event with no servers", () => {
  describe("events.activate", () => {
    it("refuses a draft with no servers and leaves it a draft", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.DRAFT,
      });

      await expect(
        callerFor(owner).events.activate({ id: eventId }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: REFUSAL });

      expect((await eventRow(eventId)).status).toBe(EventStatus.DRAFT);
    });

    it("activates once the event has a server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });
      const caller = callerFor(owner);

      await caller.events.update({
        id: eventId,
        selectedServerIds: [serverId],
      });
      await caller.events.activate({ id: eventId });

      expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
    });

    it("activates a LOCAL_AND_REMOTE event with no servers, which still runs locally", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        runLocation: RunLocation.LOCAL_AND_REMOTE,
        status: EventStatus.PAUSED,
      });

      await callerFor(owner).events.activate({ id: eventId });

      expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
    });
  });

  describe("events.update", () => {
    it("refuses to remove the last server, and keeps it", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId]);

      await expect(
        callerFor(owner).events.update({ id: eventId, selectedServerIds: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: REFUSAL });

      expect(await linkedServerIds(eventId)).toEqual([serverId]);
      expect((await eventRow(eventId)).runLocation).toBe(RunLocation.REMOTE);
    });

    it("refuses to clear the direct server of an event with no others", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [], { serverId });

      await expect(
        callerFor(owner).events.update({ id: eventId, serverId: null }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: REFUSAL });

      expect((await eventRow(eventId)).serverId).toBe(serverId);
    });

    it.each([RunLocation.REMOTE, RunLocation.LOCAL_AND_REMOTE])(
      "refuses to move a local event with no servers to %s, as events.create does",
      async (runLocation) => {
        const owner = await seedUser();
        const eventId = await seedEvent(owner, {
          runLocation: RunLocation.LOCAL,
        });

        await expect(
          callerFor(owner).events.update({ id: eventId, runLocation }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: REFUSAL });

        expect((await eventRow(eventId)).runLocation).toBe(RunLocation.LOCAL);
      },
    );

    it("refuses to activate an event with no servers", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });

      await expect(
        callerFor(owner).events.update({
          id: eventId,
          status: EventStatus.ACTIVE,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: REFUSAL });

      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
    });

    it("lets an edit through that doesn't touch where the event runs", async () => {
      // A row already in this state has to stay editable, or its owner couldn't
      // even rename it.
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });

      await callerFor(owner).events.update({ id: eventId, name: "Renamed" });

      expect((await eventRow(eventId)).name).toBe("Renamed");
    });

    it("lets the owner fix it by choosing a server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });

      await callerFor(owner).events.update({
        id: eventId,
        selectedServerIds: [serverId],
        status: EventStatus.ACTIVE,
      });

      expect(await linkedServerIds(eventId)).toEqual([serverId]);
      expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
    });

    it("lets the owner fix it by running it locally, the way the form saves it", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId]);

      await callerFor(owner).events.update({
        id: eventId,
        runLocation: RunLocation.LOCAL,
        serverId: null,
        selectedServerIds: [],
      });

      expect((await eventRow(eventId)).runLocation).toBe(RunLocation.LOCAL);
      expect(await linkedServerIds(eventId)).toEqual([]);
    });

    it("lets a save swap a direct server for linked ones, as the form does", async () => {
      const owner = await seedUser();
      const direct = await seedServer(owner);
      const linked = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [], { serverId: direct });

      await callerFor(owner).events.update({
        id: eventId,
        serverId: null,
        selectedServerIds: [linked],
      });

      expect(await linkedServerIds(eventId)).toEqual([linked]);
    });
  });

  describe("over REST", () => {
    const body = {
      name: "Remote",
      type: EventType.BASH,
      content: "echo hi",
      status: EventStatus.DRAFT,
      scheduleUnit: TimeUnit.MINUTES,
      runLocation: RunLocation.REMOTE,
      timeoutValue: 30,
      timeoutUnit: TimeUnit.SECONDS,
      retries: 0,
    };

    it("POST /api/events refuses it, as events.create does", async () => {
      const owner = await seedUser();
      const token = await seedToken(owner);

      const response = await createEvent(
        restRequest("events", "POST", token, body),
      );

      expect(response.status).toBe(400);
      expect(await db.select().from(events)).toEqual([]);
    });

    it("POST /api/events takes it with a server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const token = await seedToken(owner);

      const direct = await createEvent(
        restRequest("events", "POST", token, { ...body, serverId }),
      );
      const linked = await createEvent(
        restRequest("events", "POST", token, {
          ...body,
          selectedServerIds: [serverId],
        }),
      );

      expect(direct.status).toBe(201);
      expect(linked.status).toBe(201);
    });

    it("PATCH /api/events/{id} refuses to remove the last server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId]);
      const token = await seedToken(owner);

      const response = await patchEvent(
        restRequest(`events/${eventId}`, "PATCH", token, {
          selectedServerIds: [],
        }),
        routeParams(eventId),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: REFUSAL });
      expect(await linkedServerIds(eventId)).toEqual([serverId]);
    });

    it("PATCH /api/events/{id} refuses to activate an event with no servers", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });
      const token = await seedToken(owner);

      const response = await patchEvent(
        restRequest(`events/${eventId}`, "PATCH", token, {
          status: EventStatus.ACTIVE,
        }),
        routeParams(eventId),
      );

      expect(response.status).toBe(400);
      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
    });

    it("PATCH /api/events/{id} lets the owner fix it by choosing a server, and nothing else", async () => {
      // The way out the refusal names.
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });
      const token = await seedToken(owner);

      const response = await patchEvent(
        restRequest(`events/${eventId}`, "PATCH", token, {
          selectedServerIds: [serverId],
        }),
        routeParams(eventId),
      );

      expect(response.status).toBe(200);
      expect(await linkedServerIds(eventId)).toEqual([serverId]);
    });

    it("PUT /api/events/{id} lets a client send unchanged fields back", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner, [], {
        status: EventStatus.PAUSED,
      });
      const token = await seedToken(owner);

      const response = await putEvent(
        restRequest(`events/${eventId}`, "PUT", token, {
          name: "Renamed",
          runLocation: RunLocation.REMOTE,
          serverId: null,
          selectedServerIds: [],
          status: EventStatus.PAUSED,
        }),
        routeParams(eventId),
      );

      expect(response.status).toBe(200);
      expect((await eventRow(eventId)).name).toBe("Renamed");
    });

    it("PATCH /api/events/{id} lets a rename through", async () => {
      const owner = await seedUser();
      const eventId = await seedRemoteEvent(owner);
      const token = await seedToken(owner);

      const response = await patchEvent(
        restRequest(`events/${eventId}`, "PATCH", token, { name: "Renamed" }),
        routeParams(eventId),
      );

      expect(response.status).toBe(200);
      expect((await eventRow(eventId)).name).toBe("Renamed");
    });
  });
});

describe("deleting a server", () => {
  describe("that was a REMOTE script event's last", () => {
    it("pauses one linked through event_servers, and names the server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner, { name: "web-1" });
      const eventId = await seedRemoteEvent(owner, [serverId], dueOnSchedule());

      await storage.deleteServer(serverId);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.PAUSED);
      expect(after.nextRunAt).toBeNull();
      expect(after.runLocation).toBe(RunLocation.REMOTE);
      expect(await linkedServerIds(eventId)).toEqual([]);

      const incidents = await incidentsOf(eventId);
      expect(incidents).toHaveLength(1);
      expect(incidents[0]!.kind).toBe(ScheduleIncidentKind.NO_SERVERS);
      expect(incidents[0]!.details).toEqual({
        serverId,
        serverName: "web-1",
        reason:
          'Server "web-1" was deleted and this event has no servers left, so it was paused. Choose a server or set it to run locally, then reactivate it.',
      });
    });

    it("pauses one with a direct server the same way, and no longer makes it LOCAL", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner, { name: "web-1" });
      const eventId = await seedRemoteEvent(owner, [], { serverId });

      await storage.deleteServer(serverId);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.PAUSED);
      expect(after.runLocation).toBe(RunLocation.REMOTE);
      expect(after.serverId).toBeNull();
      expect(await reasonsOf(eventId)).toEqual([
        'Server "web-1" was deleted and this event has no servers left, so it was paused. Choose a server or set it to run locally, then reactivate it.',
      ]);
    });

    it("pauses one with the same server both ways, recording it once", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId], { serverId });

      await storage.deleteServer(serverId);

      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
      expect(await incidentsOf(eventId)).toHaveLength(1);
    });

    it.each([EventStatus.PAUSED, EventStatus.DRAFT])(
      "leaves a %s event's status alone, and still says what happened",
      async (status) => {
        const owner = await seedUser();
        const serverId = await seedServer(owner, { name: "web-1" });
        const eventId = await seedRemoteEvent(owner, [serverId], { status });

        await storage.deleteServer(serverId);

        expect((await eventRow(eventId)).status).toBe(status);
        expect(await reasonsOf(eventId)).toEqual([
          'Server "web-1" was deleted and this event has no servers left. Choose a server or set it to run locally before activating it.',
        ]);
      },
    );

    it("refuses the run that follows", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId]);
      await storage.deleteServer(serverId);

      await expect(
        callerFor(owner).events.execute({ id: eventId }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: REFUSAL });

      await expectNothingQueued();
    });
  });

  describe("when the event has another server left", () => {
    it("leaves one on two linked servers running on the other", async () => {
      const owner = await seedUser();
      const gone = await seedServer(owner);
      const kept = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [gone, kept]);

      await storage.deleteServer(gone);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.ACTIVE);
      expect(after.runLocation).toBe(RunLocation.REMOTE);
      expect(await linkedServerIds(eventId)).toEqual([kept]);
      expect(await incidentsOf(eventId)).toEqual([]);
    });

    it("keeps one on a direct server and a linked one REMOTE", async () => {
      // This event used to go LOCAL, leaving the linked server unused.
      const owner = await seedUser();
      const gone = await seedServer(owner);
      const kept = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [kept], { serverId: gone });

      await storage.deleteServer(gone);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.ACTIVE);
      expect(after.runLocation).toBe(RunLocation.REMOTE);
      expect(after.serverId).toBeNull();
      expect(await incidentsOf(eventId)).toEqual([]);
    });

    it("leaves one whose direct server is the one left", async () => {
      const owner = await seedUser();
      const gone = await seedServer(owner);
      const kept = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [gone], { serverId: kept });

      await storage.deleteServer(gone);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.ACTIVE);
      expect(after.serverId).toBe(kept);
      expect(await incidentsOf(eventId)).toEqual([]);
    });

    it("keeps a LOCAL_AND_REMOTE event as it is", async () => {
      const owner = await seedUser();
      const gone = await seedServer(owner);
      const kept = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [gone, kept], {
        runLocation: RunLocation.LOCAL_AND_REMOTE,
      });

      await storage.deleteServer(gone);

      expect((await eventRow(eventId)).runLocation).toBe(
        RunLocation.LOCAL_AND_REMOTE,
      );
      expect(await incidentsOf(eventId)).toEqual([]);
    });
  });

  describe("that was a LOCAL_AND_REMOTE script event's last", () => {
    it.each([
      ["linked through event_servers", "link"],
      ["set directly", "direct"],
    ])(
      "makes one %s LOCAL, keeps it active, and says the remote half is gone",
      async (_name, how) => {
        const owner = await seedUser();
        const serverId = await seedServer(owner, { name: "web-1" });
        const eventId = await seedRemoteEvent(
          owner,
          how === "link" ? [serverId] : [],
          {
            runLocation: RunLocation.LOCAL_AND_REMOTE,
            ...(how === "direct" && { serverId }),
          },
        );

        await storage.deleteServer(serverId);

        const after = await eventRow(eventId);
        expect(after.runLocation).toBe(RunLocation.LOCAL);
        expect(after.status).toBe(EventStatus.ACTIVE);
        const incidents = await incidentsOf(eventId);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]!.kind).toBe(ScheduleIncidentKind.NO_SERVERS);
        expect(await reasonsOf(eventId)).toEqual([
          'Server "web-1" was deleted. It was this event\'s last server, so the event now runs locally only.',
        ]);
      },
    );
  });

  describe("of events that never ran on it", () => {
    it.each([
      [
        "an HTTP request",
        {
          type: EventType.HTTP_REQUEST,
          content: "",
          httpMethod: "GET",
          httpUrl: "https://example.test/hook",
        },
      ],
      [
        "a tool action",
        {
          type: EventType.TOOL_ACTION,
          content: "",
          toolActionConfig: { toolType: "SLACK" } as never,
        },
      ],
    ])(
      "keeps %s active and makes it LOCAL, with nothing to report",
      async (_name, fields) => {
        // These run in the worker wherever they're set to run, so losing the
        // server changes nothing about the run.
        const owner = await seedUser();
        const serverId = await seedServer(owner);
        const eventId = await seedRemoteEvent(owner, [serverId], fields);

        await storage.deleteServer(serverId);

        const after = await eventRow(eventId);
        expect(after.status).toBe(EventStatus.ACTIVE);
        expect(after.runLocation).toBe(RunLocation.LOCAL);
        expect(await incidentsOf(eventId)).toEqual([]);
      },
    );

    it("leaves a LOCAL event with a stale link alone", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [serverId], {
        runLocation: RunLocation.LOCAL,
        serverId,
      });

      await storage.deleteServer(serverId);

      const after = await eventRow(eventId);
      expect(after.status).toBe(EventStatus.ACTIVE);
      expect(after.runLocation).toBe(RunLocation.LOCAL);
      expect(after.serverId).toBeNull();
      expect(await incidentsOf(eventId)).toEqual([]);
    });

    it("doesn't touch an event linked to a different server", async () => {
      const owner = await seedUser();
      const gone = await seedServer(owner);
      const other = await seedServer(owner);
      const eventId = await seedRemoteEvent(owner, [other]);

      await storage.deleteServer(gone);

      expect((await eventRow(eventId)).status).toBe(EventStatus.ACTIVE);
      expect(await incidentsOf(eventId)).toEqual([]);
    });
  });

  describe("by hand", () => {
    async function seedArchivedServerWithEvent() {
      const owner = await seedUser();
      const serverId = await seedServer(owner, {
        isArchived: true,
        archivedAt: new Date(),
      });
      const eventId = await seedRemoteEvent(owner, [serverId]);
      return { owner, serverId, eventId };
    }

    async function expectPausedWithOneIncident(eventId: number) {
      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
      expect(await incidentsOf(eventId)).toHaveLength(1);
    }

    it("applies through servers.delete", async () => {
      const { owner, serverId, eventId } = await seedArchivedServerWithEvent();

      await callerFor(owner).servers.delete({ id: serverId });

      await expectPausedWithOneIncident(eventId);
    });

    it("applies through servers.permanentDelete", async () => {
      const { owner, serverId, eventId } = await seedArchivedServerWithEvent();

      await callerFor(owner).servers.permanentDelete({ id: serverId });

      await expectPausedWithOneIncident(eventId);
    });

    it("applies through servers.bulkOperation", async () => {
      const { owner, serverId, eventId } = await seedArchivedServerWithEvent();

      await callerFor(owner).servers.bulkOperation({
        serverIds: [serverId],
        operation: "delete",
      });

      await expectPausedWithOneIncident(eventId);
    });

    it("applies through DELETE /api/servers/{id}", async () => {
      const { owner, serverId, eventId } = await seedArchivedServerWithEvent();
      const token = await seedToken(owner);

      const response = await deleteServerRoute(
        restRequest(`servers/${serverId}`, "DELETE", token),
        routeParams(serverId),
      );

      expect(response.status).toBe(200);
      await expectPausedWithOneIncident(eventId);
    });
  });

  describe("through the 30-day cleanup", () => {
    // Off unless SERVER_CLEANUP_ENABLED=true, which only stops the service
    // starting: the cycle itself is what deletes the server.
    const runCleanup = () =>
      ServerCleanupService.getInstance().runCleanupCycle();

    const archivedForAMonth = () => ({
      isArchived: true,
      archivedAt: new Date(Date.now() - 31 * 86_400_000),
      deletionScheduledAt: new Date(Date.now() - 86_400_000),
    });

    it("doesn't unblock an event the archived server was holding back", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner, archivedForAMonth());
      const eventId = await seedRemoteEvent(owner, [serverId]);
      const caller = callerFor(owner);

      await expect(
        caller.events.execute({ id: eventId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await runCleanup();

      expect(await storage.getServer(serverId)).toBeUndefined();
      await expect(
        caller.events.execute({ id: eventId }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: REFUSAL });
      await expectNothingQueued();
      expect((await eventRow(eventId)).status).toBe(EventStatus.PAUSED);
    });

    it("doesn't move an event with a direct server to LOCAL", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner, archivedForAMonth());
      const eventId = await seedRemoteEvent(owner, [], { serverId });

      await runCleanup();

      const after = await eventRow(eventId);
      expect(after.runLocation).toBe(RunLocation.REMOTE);
      expect(after.status).toBe(EventStatus.PAUSED);
      await expect(
        callerFor(owner).events.execute({ id: eventId }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: REFUSAL });
      await expectNothingQueued();
    });

    it("doesn't stop the local half of a LOCAL_AND_REMOTE event", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner, archivedForAMonth());
      const eventId = await seedRemoteEvent(owner, [serverId], {
        runLocation: RunLocation.LOCAL_AND_REMOTE,
      });

      await runCleanup();

      await callerFor(owner).events.execute({ id: eventId });
      const [job] = await allJobs();
      expect(job!.payload).toMatchObject({
        target: { containerImage: "cronium/bash:latest" },
      });
    });
  });

  it("leaves the dialog's numbers matching what the delete does", async () => {
    const owner = await seedUser();
    const serverId = await seedServer(owner);
    const stranded = await seedRemoteEvent(owner, [serverId], {
      name: "stranded",
    });
    await seedRemoteEvent(owner, [], { serverId, name: "stranded-direct" });
    await seedRemoteEvent(owner, [serverId], {
      status: EventStatus.DRAFT,
      name: "stranded-draft",
    });
    const other = await seedServer(owner);
    await seedRemoteEvent(owner, [serverId, other], { name: "has-another" });
    await seedRemoteEvent(owner, [serverId], {
      runLocation: RunLocation.LOCAL_AND_REMOTE,
      name: "local-half",
    });
    await seedRemoteEvent(owner, [serverId], {
      type: EventType.HTTP_REQUEST,
      content: "",
      httpMethod: "GET",
      httpUrl: "https://example.test/hook",
      name: "http",
    });

    const impact = await callerFor(owner).servers.getDeletionImpact({
      id: serverId,
    });

    // Only ACTIVE events are paused, so only they count here.
    expect(impact.eventsToPause).toBe(2);
    expect(impact.eventsToRunLocallyOnly).toBe(1);
    expect((await eventRow(stranded)).status).toBe(EventStatus.ACTIVE);
    // The dialog names the active ones however they're linked.
    expect(impact.activeEvents.map((event) => event.name).sort()).toEqual([
      "has-another",
      "http",
      "local-half",
      "stranded",
      "stranded-direct",
    ]);

    await storage.deleteServer(serverId);

    const paused = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.status, EventStatus.PAUSED));
    expect(paused).toHaveLength(impact.eventsToPause);
    const localOnly = (await db.select().from(events)).filter(
      (event) =>
        event.type === EventType.BASH &&
        event.runLocation === RunLocation.LOCAL,
    );
    expect(localOnly).toHaveLength(impact.eventsToRunLocallyOnly);
  });
});
