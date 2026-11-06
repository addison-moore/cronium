/**
 * Duplicating an event from a list, through the real events router against real
 * Postgres: what the list holds goes through the same builder the UI uses, then
 * the real schema, the server checks and storage. The component tests can't show
 * what a copy ends up linked to, or what a refused one leaves behind.
 */
// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { buildDuplicateEventInput } from "@/components/event-list/duplicate-event";
import type { Event as ListEvent } from "@/components/event-list";
import { cacheService } from "@/lib/cache/cache-service";
import { parseToolActionConfig } from "@/lib/tools/tool-action-config";
import { eventsRouter } from "@/server/api/routers/events";
import { serversRouter } from "@/server/api/routers/servers";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  EventStatus,
  EventType,
  RunLocation,
  eventServers,
  events,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(30_000);

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

async function seedArchivedServer(userId: string, name: string) {
  return seedServer(userId, { name, isArchived: true, archivedAt: new Date() });
}

async function seedEventOnServers(
  userId: string,
  serverIds: number[],
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<number> {
  const eventId = await seedEvent(userId, {
    name: "Nightly job",
    runLocation: RunLocation.REMOTE,
    ...overrides,
  });
  if (serverIds.length > 0) {
    await db
      .insert(eventServers)
      .values(serverIds.map((serverId) => ({ eventId, serverId })));
  }
  return eventId;
}

async function linkedServerIds(eventId: number): Promise<number[]> {
  const rows = await db
    .select({ serverId: eventServers.serverId })
    .from(eventServers)
    .where(eq(eventServers.eventId, eventId));
  return rows.map((row) => row.serverId).sort((a, b) => a - b);
}

async function eventCount(): Promise<number> {
  return (await db.select({ id: events.id }).from(events)).length;
}

/** The Duplicate action: read the event as the list does, then send the copy. */
async function duplicate(userId: string, eventId: number) {
  const caller = callerFor(userId);
  const listed = (await caller.events.getAll({ limit: 100, offset: 0 })).events;
  const event = listed.find((row) => row.id === eventId);
  return caller.events.create(
    buildDuplicateEventInput(event as unknown as ListEvent),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("Duplicate from the events list", () => {
  describe("with usable servers", () => {
    it.each([RunLocation.REMOTE, RunLocation.LOCAL_AND_REMOTE])(
      "copies a %s event with its server links, as a draft",
      async (runLocation) => {
        const owner = await seedUser();
        const servers = [
          await seedServer(owner, { name: "box-a" }),
          await seedServer(owner, { name: "box-b" }),
        ];
        const eventId = await seedEventOnServers(owner, servers, {
          runLocation,
          status: EventStatus.ACTIVE,
        });

        const copy = await duplicate(owner, eventId);

        expect(copy).toMatchObject({
          name: "Nightly job (copy)",
          status: EventStatus.DRAFT,
          runLocation,
        });
        expect(await linkedServerIds(copy!.id)).toEqual(servers.sort());
        // The source is untouched.
        expect(await linkedServerIds(eventId)).toEqual(servers.sort());
      },
    );

    it("copies an event on a direct server", async () => {
      const owner = await seedUser();
      const serverId = await seedServer(owner);
      const eventId = await seedEventOnServers(owner, [], { serverId });

      const copy = await duplicate(owner, eventId);

      expect(copy).toMatchObject({
        runLocation: RunLocation.REMOTE,
        serverId,
      });
    });
  });

  describe("with an archived server", () => {
    it("refuses and leaves no draft, even when its other servers are fine", async () => {
      const owner = await seedUser();
      const fine = await seedServer(owner, { name: "box-a" });
      const archived = await seedArchivedServer(owner, "retired-box");
      const eventId = await seedEventOnServers(owner, [fine, archived]);

      await expect(duplicate(owner, eventId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await eventCount()).toBe(1);
    });

    it("refuses on a direct server too", async () => {
      const owner = await seedUser();
      const serverId = await seedArchivedServer(owner, "retired-box");
      const eventId = await seedEventOnServers(owner, [], { serverId });

      await expect(duplicate(owner, eventId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await eventCount()).toBe(1);
    });

    it("copies once the server is restored", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const eventId = await seedEventOnServers(owner, [archived]);
      await expect(duplicate(owner, eventId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await storage.updateServer(archived, {
        isArchived: false,
        archivedAt: null,
      });

      const copy = await duplicate(owner, eventId);
      expect(await linkedServerIds(copy!.id)).toEqual([archived]);
    });

    it("copies a LOCAL event with a stale link, which the copy doesn't keep", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const eventId = await seedEventOnServers(owner, [archived], {
        runLocation: RunLocation.LOCAL,
      });

      const copy = await duplicate(owner, eventId);

      expect(copy).toMatchObject({ runLocation: RunLocation.LOCAL });
      expect(await linkedServerIds(copy!.id)).toEqual([]);
    });
  });

  describe("of other kinds of event", () => {
    it.each([
      ["an object", { toolType: "EMAIL", toolId: 3, actionId: "send" }],
      // Older rows hold a JSON string in the jsonb column.
      ["a string", JSON.stringify({ toolType: "EMAIL", toolId: 3 })],
    ])("copies a tool action whose config is %s", async (_label, config) => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner, {
        name: "Mail",
        type: EventType.TOOL_ACTION,
        content: null,
        toolActionConfig: config,
      });

      const copy = await duplicate(owner, eventId);

      expect(parseToolActionConfig(copy!.toolActionConfig)).toEqual(
        parseToolActionConfig(config),
      );
    });

    it("copies an HTTP request", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner, {
        type: EventType.HTTP_REQUEST,
        content: null,
        httpMethod: "POST",
        httpUrl: "https://example.test/hook",
        httpHeaders: [{ key: "X-A", value: "1" }],
        httpBody: "{}",
      });

      const copy = await duplicate(owner, eventId);

      expect(copy).toMatchObject({
        httpMethod: "POST",
        httpUrl: "https://example.test/hook",
        httpHeaders: [{ key: "X-A", value: "1" }],
        httpBody: "{}",
      });
    });
  });
});

// The server's page lists its events through this. It failed on every call
// against real Postgres, and the page showed that as no events.
describe("servers.getEvents", () => {
  async function eventsOn(viewer: string, serverId: number) {
    const { events: listed } = await callerFor(viewer).servers.getEvents({
      id: serverId,
      limit: 100,
    });
    return listed;
  }

  it("lists an event linked to the server, with all its links", async () => {
    const owner = await seedUser();
    const here = await seedServer(owner);
    const there = await seedServer(owner);
    const eventId = await seedEventOnServers(owner, [here, there]);

    const listed = await eventsOn(owner, here);

    expect(listed.map((row) => row.id)).toEqual([eventId]);
    expect(listed[0]).toHaveProperty(
      "eventServers",
      expect.arrayContaining([here, there]),
    );
  });

  it("leaves out events linked only to another server", async () => {
    const owner = await seedUser();
    const here = await seedServer(owner);
    const there = await seedServer(owner);
    await seedEventOnServers(owner, [there]);

    expect(await eventsOn(owner, here)).toEqual([]);
  });

  it("gives a shared server's visitor only what's shared, without the owner's bindings", async () => {
    const owner = await seedUser();
    const visitor = await seedUser();
    const server = await seedServer(owner, { shared: true });
    const shared = await seedEventOnServers(owner, [server], {
      name: "Shared",
      shared: true,
    });
    await seedEventOnServers(owner, [server], { name: "Private" });

    const listed = await eventsOn(visitor, server);

    expect(listed.map((row) => row.id)).toEqual([shared]);
    expect(listed[0]).toHaveProperty("eventServers", []);
  });
});
