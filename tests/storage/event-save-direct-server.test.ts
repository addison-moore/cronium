/**
 * Saving an event set up through the deprecated direct server (`serverId`), which
 * the REST API, MCP and JSON import can all write, from the event form. The form
 * only ever writes links, so a save moves the event's server to `event_servers`.
 *
 * What's under test is whether that moves the script. So each save here is built
 * from the form's own functions and the real events.getById and events.update, and
 * each run goes through the real dispatch and the real job preparation against real
 * Postgres, because where a job goes is decided in two places (buildJobPayload and
 * enhancedTransformJobForOrchestrator) that don't agree on an event with both.
 */
// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import {
  buildEventFormDefaults,
  extractServerIds,
  linkedServers,
} from "@/components/event-form/lib/event-form-defaults";
import { buildEventPayload } from "@/components/event-form/lib/event-payload";
import { eventFormSchema } from "@/components/event-form/lib/event-form-schema";
import { cacheService } from "@/lib/cache/cache-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { prepareJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import { jobService } from "@/lib/services/job-service";
import { eventsRouter } from "@/server/api/routers/events";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { RunLocation, eventServers, events } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(60_000);

// Mounted under the name root.ts uses, because the route-capability inventory is
// keyed by "events.<procedure>".
const createCaller = createCallerFactory(
  createTRPCRouter({ events: eventsRouter }),
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

/**
 * Sends what the form sends. `ticked` is what's selected once someone has changed
 * it, and leaving it out is someone opening the event and pressing Update Event.
 */
async function saveFromForm(
  userId: string,
  eventId: number,
  ticked?: (selected: number[]) => number[],
) {
  const caller = callerFor(userId);
  const event = await caller.events.getById({ id: eventId });
  const selected = extractServerIds(linkedServers(event));
  const values = eventFormSchema.parse({
    ...buildEventFormDefaults(event),
    selectedServerIds: ticked ? ticked(selected) : selected,
  });
  await caller.events.update({ id: eventId, ...buildEventPayload(values) });
}

/** Where a run goes: dispatched and prepared for the orchestrator as a real one is. */
async function whereARunGoes(eventId: number): Promise<string[]> {
  const event = await storage.getEventWithRelations(eventId);
  await dispatchEventJob(event!, { triggeredBy: "manual" });
  const { ready, failed } = await prepareJobsForOrchestrator(
    await jobService.claimJobs("orchestrator-1", 1),
  );
  expect(failed).toEqual([]);

  // As MultiServerExecutor reads it: the fan-out list when there is one, and it
  // replaces the job's own target. Otherwise SSH goes to the target alone, and
  // anything else runs in a local container.
  const { type, execution, metadata } = ready[0]!.transformed;
  const { servers, runLocal } = metadata as {
    servers?: Array<{ name: string }>;
    runLocal?: boolean;
  };
  if (servers?.length) {
    return [
      ...(runLocal ? ["local"] : []),
      ...servers.map((server) => server.name),
    ].sort();
  }
  return [type === "ssh" ? execution.target.serverDetails!.name : "local"];
}

/** What's stored, with servers by name. */
async function stored(eventId: number, names: Map<number, string>) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  const links = await db
    .select({ serverId: eventServers.serverId })
    .from(eventServers)
    .where(eq(eventServers.eventId, eventId));
  return {
    runLocation: row!.runLocation,
    serverId: row!.serverId,
    links: links.map(({ serverId }) => names.get(serverId)).sort(),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

/**
 * An event on `direct-box`, its direct server, linked to the named servers. Those
 * are `direct-box`, `box-one` and `box-two`.
 */
async function seedDirectEvent(
  runLocation: RunLocation,
  linkNames: string[] = [],
) {
  const owner = await seedUser();
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  for (const name of ["direct-box", "box-one", "box-two"]) {
    const id = await seedServer(owner, { name });
    ids.set(name, id);
    names.set(id, name);
  }
  const eventId = await seedEvent(owner, {
    name: "Nightly job",
    runLocation,
    serverId: ids.get("direct-box")!,
  });
  if (linkNames.length > 0) {
    await db
      .insert(eventServers)
      .values(linkNames.map((name) => ({ eventId, serverId: ids.get(name)! })));
  }
  return { owner, eventId, ids, names };
}

describe("an untouched save from the event form", () => {
  it("keeps a LOCAL_AND_REMOTE event on its direct server, as a link", async () => {
    const { owner, eventId, names } = await seedDirectEvent(
      RunLocation.LOCAL_AND_REMOTE,
    );

    await saveFromForm(owner, eventId);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.LOCAL_AND_REMOTE,
      serverId: null,
      links: ["direct-box"],
    });
    expect(await whereARunGoes(eventId)).toContain("direct-box");
  });

  it("keeps a REMOTE event on its direct server, as a link", async () => {
    const { owner, eventId, names } = await seedDirectEvent(RunLocation.REMOTE);

    await saveFromForm(owner, eventId);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.REMOTE,
      serverId: null,
      links: ["direct-box"],
    });
    expect(await whereARunGoes(eventId)).toEqual(["direct-box"]);
  });

  it("changes nothing the second time, now the server is a link", async () => {
    const { owner, eventId, names } = await seedDirectEvent(
      RunLocation.LOCAL_AND_REMOTE,
    );

    await saveFromForm(owner, eventId);
    const afterOneSave = await stored(eventId, names);
    await saveFromForm(owner, eventId);

    expect(await stored(eventId, names)).toEqual(afterOneSave);
  });

  // A run reaches the local half only through the fan-out, which reads links alone.
  // So a LOCAL_AND_REMOTE event on a direct server has only ever run on the server.
  it("starts the local half of a LOCAL_AND_REMOTE event, which a direct server skips", async () => {
    const { owner, eventId } = await seedDirectEvent(
      RunLocation.LOCAL_AND_REMOTE,
    );
    expect(await whereARunGoes(eventId)).toEqual(["direct-box"]);

    await saveFromForm(owner, eventId);

    expect(await whereARunGoes(eventId)).toEqual(["direct-box", "local"]);
  });

  describe("doesn't change where a run goes", () => {
    it.each<
      [
        string,
        RunLocation,
        string[],
        { runsOn: string[]; linksAfter: string[] },
      ]
    >([
      [
        "REMOTE, on a direct server only",
        RunLocation.REMOTE,
        [],
        { runsOn: ["direct-box"], linksAfter: ["direct-box"] },
      ],
      // The lone link gets no run: the job targets the direct server, and it takes
      // two links to fan out. Keeping the link would start running there.
      [
        "REMOTE, on a direct server and a lone link",
        RunLocation.REMOTE,
        ["box-one"],
        { runsOn: ["direct-box"], linksAfter: ["direct-box"] },
      ],
      // Here it's the direct server that gets no run: the fan-out replaces the
      // target. Ticking it would start running there.
      [
        "REMOTE, on a direct server and two links",
        RunLocation.REMOTE,
        ["box-one", "box-two"],
        { runsOn: ["box-one", "box-two"], linksAfter: ["box-one", "box-two"] },
      ],
      [
        "LOCAL_AND_REMOTE, on a direct server and a link",
        RunLocation.LOCAL_AND_REMOTE,
        ["box-one"],
        { runsOn: ["box-one", "local"], linksAfter: ["box-one"] },
      ],
      [
        "LOCAL_AND_REMOTE, on a direct server and two links",
        RunLocation.LOCAL_AND_REMOTE,
        ["box-one", "box-two"],
        {
          runsOn: ["box-one", "box-two", "local"],
          linksAfter: ["box-one", "box-two"],
        },
      ],
      [
        "REMOTE, on a server that's both direct and the only link",
        RunLocation.REMOTE,
        ["direct-box"],
        { runsOn: ["direct-box"], linksAfter: ["direct-box"] },
      ],
      [
        "LOCAL_AND_REMOTE, on a server that's both direct and the only link",
        RunLocation.LOCAL_AND_REMOTE,
        ["direct-box"],
        { runsOn: ["direct-box", "local"], linksAfter: ["direct-box"] },
      ],
      [
        "REMOTE, on a server that's both direct and one of two links",
        RunLocation.REMOTE,
        ["direct-box", "box-one"],
        {
          runsOn: ["box-one", "direct-box"],
          linksAfter: ["box-one", "direct-box"],
        },
      ],
    ])("for %s", async (_label, runLocation, linkNames, expected) => {
      const { owner, eventId, names } = await seedDirectEvent(
        runLocation,
        linkNames,
      );
      expect(await whereARunGoes(eventId)).toEqual(expected.runsOn);

      await saveFromForm(owner, eventId);

      expect(await stored(eventId, names)).toEqual({
        runLocation,
        serverId: null,
        links: expected.linksAfter,
      });
      expect(await whereARunGoes(eventId)).toEqual(expected.runsOn);
    });
  });

  it("doesn't add a LOCAL event's leftover direct server", async () => {
    const { owner, eventId, names } = await seedDirectEvent(RunLocation.LOCAL);
    expect(await whereARunGoes(eventId)).toEqual(["local"]);

    await saveFromForm(owner, eventId);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.LOCAL,
      serverId: null,
      links: [],
    });
    expect(await whereARunGoes(eventId)).toEqual(["local"]);
  });
});

describe("a save from the event form after a change", () => {
  it("makes a LOCAL_AND_REMOTE event local when its direct server is unticked", async () => {
    const { owner, eventId, names } = await seedDirectEvent(
      RunLocation.LOCAL_AND_REMOTE,
    );

    await saveFromForm(owner, eventId, () => []);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.LOCAL,
      serverId: null,
      links: [],
    });
    expect(await whereARunGoes(eventId)).toEqual(["local"]);
  });

  it("moves a REMOTE event when another server is ticked in its place", async () => {
    const { owner, eventId, ids, names } = await seedDirectEvent(
      RunLocation.REMOTE,
    );

    await saveFromForm(owner, eventId, () => [ids.get("box-one")!]);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.REMOTE,
      serverId: null,
      links: ["box-one"],
    });
    expect(await whereARunGoes(eventId)).toEqual(["box-one"]);
  });

  it("runs on both when another server is ticked beside it", async () => {
    const { owner, eventId, ids, names } = await seedDirectEvent(
      RunLocation.REMOTE,
    );

    await saveFromForm(owner, eventId, (selected) => [
      ...selected,
      ids.get("box-one")!,
    ]);

    expect(await stored(eventId, names)).toEqual({
      runLocation: RunLocation.REMOTE,
      serverId: null,
      links: ["box-one", "direct-box"],
    });
    expect(await whereARunGoes(eventId)).toEqual(["box-one", "direct-box"]);
  });
});
