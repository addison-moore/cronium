/**
 * Saving an event linked to an archived server, through the real events router
 * against real Postgres. What the event form sends is what's under test: it
 * keeps the archived id selected until someone unticks it, so a save either says
 * why it can't go through or repoints the event. The mocked suite
 * (apps/cronium-app/src/server/api/routers/__tests__/events.test.ts) can't show
 * what a refusal leaves behind, or that these saves get past storage's own
 * server checks.
 */
// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { cacheService } from "@/lib/cache/cache-service";
import { eventsRouter } from "@/server/api/routers/events";
import { serversRouter } from "@/server/api/routers/servers";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
  EventType,
  RunLocation,
  eventServers,
  events,
  type Event,
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

const GENERIC_REFUSAL =
  "You do not have the required capability for this server relationship";

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

async function eventRow(eventId: number): Promise<Event> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row!;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("events.update with an archived server still selected", () => {
  it("says which one and what to do, and changes nothing", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");
    const eventId = await seedEventOnServers(owner, [archived]);

    await expect(
      callerFor(owner).events.update({
        id: eventId,
        name: "Renamed",
        runLocation: RunLocation.REMOTE,
        serverId: null,
        selectedServerIds: [archived],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "An archived server can't be used: retired-box. Restore it or choose another server, then try again.",
    });

    expect(await eventRow(eventId)).toMatchObject({
      name: "Nightly job",
      runLocation: RunLocation.REMOTE,
    });
    expect(await linkedServerIds(eventId)).toEqual([archived]);
  });

  it("names only the archived ones when some are live", async () => {
    const owner = await seedUser();
    const live = await seedServer(owner, { name: "live-box" });
    const first = await seedArchivedServer(owner, "retired-one");
    const second = await seedArchivedServer(owner, "retired-two");
    const eventId = await seedEventOnServers(owner, [live, first, second]);

    const error = await callerFor(owner)
      .events.update({
        id: eventId,
        selectedServerIds: [live, first, second],
      })
      .catch((caught: unknown) => caught as Error);

    expect(error).toMatchObject({ code: "FORBIDDEN" });
    const { message } = error as Error;
    expect(message).toContain("Archived servers can't be used: ");
    expect(message).toContain("retired-one");
    expect(message).toContain("retired-two");
    expect(message).toContain("Restore them or choose other servers");
    expect(message).not.toContain("live-box");
  });

  it("says nothing about someone else's archived server", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const theirs = await seedServer(other, {
      name: "their-box",
      shared: true,
      isArchived: true,
      archivedAt: new Date(),
    });
    const mine = await seedArchivedServer(owner, "retired-box");
    const eventId = await seedEventOnServers(owner, [mine]);

    await expect(
      callerFor(owner).events.update({
        id: eventId,
        selectedServerIds: [mine, theirs],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: GENERIC_REFUSAL });
    expect(await linkedServerIds(eventId)).toEqual([mine]);
  });

  it("says nothing about a server that doesn't exist", async () => {
    const owner = await seedUser();
    const mine = await seedArchivedServer(owner, "retired-box");
    const eventId = await seedEventOnServers(owner, [mine]);

    await expect(
      callerFor(owner).events.update({
        id: eventId,
        selectedServerIds: [mine, mine + 1000],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: GENERIC_REFUSAL });
  });
});

describe("the ways out the refusal names", () => {
  it("removing it: a save without it repoints the event", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");
    const live = await seedServer(owner, { name: "live-box" });
    const eventId = await seedEventOnServers(owner, [archived]);

    await callerFor(owner).events.update({
      id: eventId,
      name: "Repointed",
      runLocation: RunLocation.REMOTE,
      serverId: null,
      selectedServerIds: [live],
    });

    expect(await eventRow(eventId)).toMatchObject({
      name: "Repointed",
      runLocation: RunLocation.REMOTE,
    });
    expect(await linkedServerIds(eventId)).toEqual([live]);
  });

  it("removing it: a direct server goes too, which the form's serverId: null does", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");
    const live = await seedServer(owner, { name: "live-box" });
    const eventId = await seedEventOnServers(owner, [], { serverId: archived });

    await callerFor(owner).events.update({
      id: eventId,
      runLocation: RunLocation.REMOTE,
      serverId: null,
      selectedServerIds: [live],
    });

    expect((await eventRow(eventId)).serverId).toBeNull();
    expect(await linkedServerIds(eventId)).toEqual([live]);
  });

  it("restoring it: the same save then goes through", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");
    const eventId = await seedEventOnServers(owner, [archived]);
    const save = () =>
      callerFor(owner).events.update({
        id: eventId,
        name: "Renamed",
        runLocation: RunLocation.REMOTE,
        serverId: null,
        selectedServerIds: [archived],
      });
    await expect(save()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await callerFor(owner).servers.restore({ id: archived });
    await save();

    expect((await eventRow(eventId)).name).toBe("Renamed");
    expect(await linkedServerIds(eventId)).toEqual([archived]);
  });

  it("the form's read of the event carries what it labels the row with", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");
    const direct = await seedArchivedServer(owner, "retired-direct");
    const eventId = await seedEventOnServers(owner, [archived], {
      serverId: direct,
    });

    const event = await callerFor(owner).events.getById({ id: eventId });

    expect(event.servers).toEqual([
      expect.objectContaining({
        id: archived,
        name: "retired-box",
        address: "10.0.0.1",
        isArchived: true,
      }),
    ]);
    expect(event.server).toMatchObject({
      id: direct,
      name: "retired-direct",
      isArchived: true,
    });
  });
});

describe("events.create with an archived server", () => {
  it("refuses with the same explanation and writes nothing", async () => {
    const owner = await seedUser();
    const archived = await seedArchivedServer(owner, "retired-box");

    await expect(
      callerFor(owner).events.create({
        name: "New job",
        type: EventType.BASH,
        content: "echo hi",
        runLocation: RunLocation.REMOTE,
        selectedServerIds: [archived],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("retired-box"),
    });

    expect(await db.select({ id: events.id }).from(events)).toEqual([]);
  });
});
