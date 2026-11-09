/**
 * The jobs page's filters, through the real jobs router against real Postgres.
 * Apply Filters used to change only the page's address: jobs.list took a status
 * but no type or search, and the page passed it nothing, so every filter showed
 * every job. The mocked suites check what reaches the service; only real SQL
 * shows which rows a search matches, that LIKE's wildcards in it match only
 * themselves, and that a search Postgres couldn't compare doesn't fail the list.
 */
// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import type { Session } from "next-auth";
import { cacheService } from "@/lib/cache/cache-service";
import { jobsRouter } from "@/server/api/routers/jobs";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import { JobSource, JobStatus, JobType } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(30_000);

// Mounted under the name root.ts uses, because the route-capability inventory
// is keyed by "jobs.<procedure>".
const createCaller = createCallerFactory(
  createTRPCRouter({ jobs: jobsRouter }),
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

interface Seeded {
  owner: string;
  scriptEvent: number;
  httpEvent: number;
  toolEvent: number;
}

/**
 * The owner's jobs, and another user's job whose id starts like two of them.
 * Events are numbered from 1 in the order they're made, since the reset
 * restarts every sequence.
 */
async function seed(): Promise<Seeded> {
  const owner = await seedUser();
  const other = await seedUser();
  const scriptEvent = await seedEvent(owner);
  const httpEvent = await seedEvent(owner);
  const toolEvent = await seedEvent(owner);
  const othersEvent = await seedEvent(other);

  const jobs: Array<
    [string, number, NonNullable<Parameters<typeof seedJob>[2]>]
  > = [
    ["job_Alpha01", scriptEvent, { status: JobStatus.COMPLETED }],
    [
      "job_alpha02",
      scriptEvent,
      { status: JobStatus.FAILED, source: JobSource.WORKFLOW_STEP },
    ],
    [
      "job_Beta001",
      httpEvent,
      {
        type: JobType.HTTP_REQUEST,
        status: JobStatus.FAILED,
        source: JobSource.MANUAL,
      },
    ],
    [
      "job_beta_02",
      toolEvent,
      {
        type: JobType.TOOL_ACTION,
        status: JobStatus.TIMED_OUT,
        source: JobSource.WORKFLOW_STEP,
      },
    ],
    [
      "job_betaX03",
      toolEvent,
      { type: JobType.TOOL_ACTION, status: JobStatus.QUEUED },
    ],
    [
      "job_100%_done",
      scriptEvent,
      { status: JobStatus.RUNNING, source: JobSource.EVENT },
    ],
    ["job_100xyz", scriptEvent, { status: JobStatus.CANCELLED }],
  ];
  for (const [id, eventId, overrides] of jobs) {
    await seedJob(eventId, owner, { id, ...overrides });
  }
  await seedJob(othersEvent, other, {
    id: "job_alpha99",
    status: JobStatus.FAILED,
  });

  return { owner, scriptEvent, httpEvent, toolEvent };
}

type ListInput = Parameters<ReturnType<typeof callerFor>["jobs"]["list"]>[0];

async function listIds(owner: string, input: ListInput = {}) {
  const result = await callerFor(owner).jobs.list(input);
  return {
    ids: result.items.map((job) => job.id).sort(),
    total: result.total,
  };
}

const OWNERS_JOBS = [
  "job_100%_done",
  "job_100xyz",
  "job_Alpha01",
  "job_Beta001",
  "job_alpha02",
  "job_beta_02",
  "job_betaX03",
].sort();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("jobs.list with the jobs page's filters", () => {
  it("lists all of the caller's jobs and only theirs without filters", async () => {
    const { owner } = await seed();

    expect(await listIds(owner)).toEqual({ ids: OWNERS_JOBS, total: 7 });
  });

  it("narrows the list to the chosen status", async () => {
    const { owner } = await seed();

    expect(await listIds(owner, { status: JobStatus.FAILED })).toEqual({
      ids: ["job_Beta001", "job_alpha02"],
      total: 2,
    });
    expect(await listIds(owner, { status: JobStatus.TIMED_OUT })).toEqual({
      ids: ["job_beta_02"],
      total: 1,
    });
  });

  it("narrows the list to the chosen type", async () => {
    const { owner } = await seed();

    expect(await listIds(owner, { type: JobType.HTTP_REQUEST })).toEqual({
      ids: ["job_Beta001"],
      total: 1,
    });
    expect(await listIds(owner, { type: JobType.TOOL_ACTION })).toEqual({
      ids: ["job_betaX03", "job_beta_02"].sort(),
      total: 2,
    });
    expect((await listIds(owner, { type: JobType.SCRIPT })).ids).toEqual([
      "job_100%_done",
      "job_100xyz",
      "job_Alpha01",
      "job_alpha02",
    ]);
  });

  it("narrows the list to the jobs a workflow started, whatever their type", async () => {
    const { owner } = await seed();

    expect(await listIds(owner, { source: JobSource.WORKFLOW_STEP })).toEqual({
      ids: ["job_alpha02", "job_beta_02"],
      total: 2,
    });
  });

  it("matches a job id prefix in the search, ignoring case", async () => {
    const { owner } = await seed();

    expect((await listIds(owner, { search: "JOB_ALPHA" })).ids).toEqual([
      "job_Alpha01",
      "job_alpha02",
    ]);
    expect((await listIds(owner, { search: "job_Alpha01" })).ids).toEqual([
      "job_Alpha01",
    ]);
    // A prefix, not anywhere in the id.
    expect((await listIds(owner, { search: "lpha" })).ids).toEqual([]);
  });

  it("matches an event's jobs when the search is its id", async () => {
    const { owner, httpEvent, toolEvent } = await seed();

    expect(await listIds(owner, { search: ` ${String(toolEvent)} ` })).toEqual({
      ids: ["job_betaX03", "job_beta_02"].sort(),
      total: 2,
    });
    expect((await listIds(owner, { search: String(httpEvent) })).ids).toEqual([
      "job_Beta001",
    ]);
  });

  it("makes _ and % in the search match only themselves", async () => {
    const { owner } = await seed();

    // As LIKE wildcards, `_` would match the X of job_betaX03, and `%` the rest
    // of job_100xyz.
    expect((await listIds(owner, { search: "job_beta_" })).ids).toEqual([
      "job_beta_02",
    ]);
    expect((await listIds(owner, { search: "job_100%" })).ids).toEqual([
      "job_100%_done",
    ]);
  });

  it("combines the filters", async () => {
    const { owner, scriptEvent } = await seed();

    expect(
      await listIds(owner, {
        status: JobStatus.FAILED,
        source: JobSource.WORKFLOW_STEP,
      }),
    ).toEqual({ ids: ["job_alpha02"], total: 1 });
    expect(
      await listIds(owner, {
        status: JobStatus.FAILED,
        type: JobType.SCRIPT,
        search: String(scriptEvent),
      }),
    ).toEqual({ ids: ["job_alpha02"], total: 1 });
    expect(
      await listIds(owner, {
        status: JobStatus.COMPLETED,
        type: JobType.HTTP_REQUEST,
      }),
    ).toEqual({ ids: [], total: 0 });
  });

  it("never shows another user's job, even when the search matches it", async () => {
    const { owner } = await seed();

    expect(
      await listIds(owner, { search: "job_alpha9", status: JobStatus.FAILED }),
    ).toEqual({ ids: [], total: 0 });
  });

  it("finds nothing, rather than failing, for a search Postgres couldn't compare", async () => {
    const { owner } = await seed();

    // One past the largest integer an event id can be. Compared with event_id,
    // it fails the query: integer out of range.
    expect(await listIds(owner, { search: "2147483648" })).toEqual({
      ids: [],
      total: 0,
    });
    // A text parameter with a NUL in it fails the whole query.
    expect(await listIds(owner, { search: "job_\u0000" })).toEqual({
      ids: [],
      total: 0,
    });
  });

  it("refuses a status, type or source it doesn't know", async () => {
    const { owner } = await seed();

    for (const input of [
      { status: "exploded" },
      { type: "workflow" },
      { source: "cron" },
    ]) {
      await expect(
        callerFor(owner).jobs.list(input as unknown as ListInput),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});
