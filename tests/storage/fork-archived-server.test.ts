/**
 * Forking an event whose server has been archived, through the real events
 * router against real Postgres. The mocked suite
 * (apps/cronium-app/src/server/api/routers/__tests__/events.test.ts) can't show
 * what a refused fork leaves behind, or that the ways out the refusal names
 * really let the fork through past storage's own server checks.
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
import { storage } from "@/server/storage";
import {
  EventStatus,
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

async function eventCount(): Promise<number> {
  return (await db.select({ id: events.id }).from(events)).length;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("events.fork with an archived server", () => {
  describe("on your own event", () => {
    it("refuses when a linked server is archived, says which, and leaves no draft", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [archived]);
      await storage.updateScript(
        source,
        {},
        { envVars: [{ key: "TOKEN", value: "x" }], userId: owner },
      );

      await expect(
        callerFor(owner).events.fork({ id: source }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message:
          "This event can't be forked while it's linked to an archived server: retired-box. Restore it or remove it from the event, then try again.",
      });

      // A draft left behind would be a REMOTE event with no servers, which runs
      // in a container if anyone activates it.
      expect(await eventCount()).toBe(1);
      // The refusal changes nothing on the source either.
      expect(await linkedServerIds(source)).toEqual([archived]);
    });

    it("refuses when the event's direct server is archived", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [], {
        serverId: archived,
      });

      await expect(
        callerFor(owner).events.fork({ id: source }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("retired-box"),
      });
      expect(await eventCount()).toBe(1);
    });

    it("refuses when only some of its servers are archived, and names only those", async () => {
      const owner = await seedUser();
      const active = await seedServer(owner, { name: "live-box" });
      const first = await seedArchivedServer(owner, "retired-one");
      const second = await seedArchivedServer(owner, "retired-two");
      const source = await seedEventOnServers(owner, [active, first, second]);

      const error = await callerFor(owner)
        .events.fork({ id: source })
        .catch((caught: unknown) => caught as Error);

      expect(error).toMatchObject({ code: "CONFLICT" });
      const { message } = error as Error;
      expect(message).toContain(
        "archived servers: retired-one, retired-two. Restore them or remove them",
      );
      expect(message).not.toContain("live-box");
      expect(await eventCount()).toBe(1);
    });

    it("names a server once when it is both the direct server and a link", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [archived], {
        serverId: archived,
      });

      await expect(
        callerFor(owner).events.fork({ id: source }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "an archived server: retired-box. Restore it",
        ),
      });
    });

    it("refuses on a LOCAL event too, because the link is still there", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [archived], {
        runLocation: RunLocation.LOCAL,
      });

      await expect(
        callerFor(owner).events.fork({ id: source }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("the ways out the refusal names", () => {
    it("forks once the server is restored", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [archived]);
      const caller = callerFor(owner);

      await caller.servers.restore({ id: archived });
      const fork = await caller.events.fork({ id: source });

      expect(await linkedServerIds(fork!.id)).toEqual([archived]);
      expect((await eventRow(fork!.id)).status).toBe(EventStatus.DRAFT);
    });

    it("forks once a linked server is swapped for another", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const replacement = await seedServer(owner, { name: "new-box" });
      const source = await seedEventOnServers(owner, [archived]);
      const caller = callerFor(owner);

      await caller.events.update({
        id: source,
        selectedServerIds: [replacement],
      });
      const fork = await caller.events.fork({ id: source });

      expect(await linkedServerIds(fork!.id)).toEqual([replacement]);
    });

    it("forks once the direct server is cleared", async () => {
      const owner = await seedUser();
      const archived = await seedArchivedServer(owner, "retired-box");
      const source = await seedEventOnServers(owner, [], {
        serverId: archived,
        runLocation: RunLocation.LOCAL,
      });
      const caller = callerFor(owner);

      await caller.events.update({ id: source, serverId: null });
      const fork = await caller.events.fork({ id: source });

      expect((await eventRow(fork!.id)).serverId).toBeNull();
    });
  });

  describe("when no archived server is involved", () => {
    it("still copies variables, server links and the run location to a draft", async () => {
      const owner = await seedUser();
      const linked = await seedServer(owner, { name: "live-box" });
      const direct = await seedServer(owner, { name: "other-box" });
      const source = await seedEventOnServers(owner, [linked], {
        serverId: direct,
        status: EventStatus.ACTIVE,
      });
      await storage.updateScript(
        source,
        {},
        { envVars: [{ key: "TOKEN", value: "s3cret" }], userId: owner },
      );

      const fork = await callerFor(owner).events.fork({ id: source });

      const row = await eventRow(fork!.id);
      expect(row).toMatchObject({
        name: "Nightly job (fork)",
        status: EventStatus.DRAFT,
        runLocation: RunLocation.REMOTE,
        serverId: direct,
      });
      expect(await linkedServerIds(fork!.id)).toEqual([linked]);
      // Decrypted from the fork's own row: a value still encrypted under the
      // source's id couldn't be read back here.
      expect(fork!.envVars.map(({ key, value }) => ({ key, value }))).toEqual([
        { key: "TOKEN", value: "s3cret" },
      ]);
    });
  });

  describe("on someone else's shared event", () => {
    it("forks without the owner's servers, and doesn't name them", async () => {
      const owner = await seedUser();
      const viewer = await seedUser();
      const archived = await seedArchivedServer(owner, "owners-retired-box");
      const source = await seedEventOnServers(owner, [archived], {
        serverId: archived,
        shared: true,
      });

      const fork = await callerFor(viewer).events.fork({ id: source });

      expect(await eventRow(fork!.id)).toMatchObject({
        userId: viewer,
        status: EventStatus.DRAFT,
        runLocation: RunLocation.LOCAL,
        serverId: null,
      });
      expect(await linkedServerIds(fork!.id)).toEqual([]);
      expect(JSON.stringify(fork)).not.toContain("owners-retired-box");
    });
  });
});
