/**
 * Router tests for jobsRouter (src/server/api/routers/jobs.ts).
 *
 * The REAL router runs through the REAL protectedProcedure middleware chain
 * (live-principal re-validation, deny-by-default route capabilities); the
 * database is mocked at the driver boundary and the job service is mocked so
 * the tests assert the router's passthrough contract — including that valid
 * falsy filter values (eventId: 0) reach the service unchanged.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Module mocks — physically first, before any imports: the factories must be
// registered before the import chain pulls in @/server/db, whose t3-env
// validation crashes under jest.
// ---------------------------------------------------------------------------

const dbState: {
  userRows: Array<Record<string, unknown>>;
  logsTable: unknown;
  logsResults: unknown[][];
} = { userRows: [], logsTable: null, logsResults: [] };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => {
      let result: unknown = [];
      const chain: Record<string, unknown> = {};
      for (const m of ["where", "orderBy", "limit", "offset"]) {
        chain[m] = jest.fn(() => chain);
      }
      chain.from = jest.fn((table: unknown) => {
        // The principal re-validation selects from users; the logs procedure
        // selects from logs (rows, then count). Route by table.
        result =
          dbState.logsTable !== null && table === dbState.logsTable
            ? (dbState.logsResults.shift() ?? [])
            : dbState.userRows;
        return chain;
      });
      (chain as { then?: unknown }).then = (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(onFulfilled, onRejected);
      return chain;
    }),
  },
}));

jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(true)),
    delete: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: {
    checkLimit: jest.fn(() => Promise.resolve()),
    tryCheckLimit: jest.fn(() => Promise.resolve({ allowed: true })),
  },
}));

jest.mock("@/lib/services/job-service", () => ({
  jobService: {
    getJob: jest.fn(),
    listJobs: jest.fn(),
    getJobStats: jest.fn(),
    cancelJob: jest.fn(),
  },
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { jobsRouter } from "../jobs";
import { jobService } from "@/lib/services/job-service";
import {
  type Job,
  JobStatus,
  JobType,
  JobPriority,
  logs,
  UserRole,
  UserStatus,
} from "@/shared/schema";
import { db } from "@/server/db";

// Route paths must match the app router ("jobs.cancel" etc.) so the
// deny-by-default capability inventory applies exactly as in production.
const testRouter = createTRPCRouter({ jobs: jobsRouter });
const createCaller = createCallerFactory(testRouter);

const mockJobService = jobService as unknown as {
  getJob: jest.Mock;
  listJobs: jest.Mock;
  getJobStats: jest.Mock;
  cancelJob: jest.Mock;
};

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function dbRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: USER_ID,
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mfaEnabled: false,
    ...overrides,
  };
}

function sessionFor(overrides: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: USER_ID,
      email: "user@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerWith(session: Session | null) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

function userCaller() {
  dbState.userRows = [dbRow()];
  return callerWith(sessionFor());
}

function viewerCaller() {
  dbState.userRows = [dbRow({ role: UserRole.VIEWER, roleId: 3 })];
  return callerWith(sessionFor({ role: UserRole.VIEWER }));
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_abc",
    eventId: 1,
    userId: USER_ID,
    type: JobType.SCRIPT,
    status: JobStatus.QUEUED,
    priority: JobPriority.NORMAL,
    payload: {},
    metadata: {},
    attempts: 0,
    createdAt: new Date("2026-07-22T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    ...overrides,
  } as unknown as Job;
}

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  dbState.userRows = [dbRow()];
  dbState.logsTable = logs;
  dbState.logsResults = [];
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// jobs.get
// ---------------------------------------------------------------------------

describe("jobs.get", () => {
  it("returns the caller's job as a resource response", async () => {
    const job = makeJob();
    mockJobService.getJob.mockResolvedValueOnce(job);

    const result = await userCaller().jobs.get({ jobId: "job_abc" });

    expect(mockJobService.getJob).toHaveBeenCalledWith("job_abc");
    expect(result).toEqual({ data: job });
  });

  it("throws NOT_FOUND when the job does not exist", async () => {
    mockJobService.getJob.mockResolvedValueOnce(null);
    await expect(
      userCaller().jobs.get({ jobId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for another user's job (ownership scoping)", async () => {
    mockJobService.getJob.mockResolvedValueOnce(
      makeJob({ userId: OTHER_USER_ID }),
    );
    await expect(
      userCaller().jobs.get({ jobId: "job_abc" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-string jobId (zod)", async () => {
    await expect(
      userCaller().jobs.get({ jobId: 42 as unknown as string }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockJobService.getJob).not.toHaveBeenCalled();
  });

  it("allows a Viewer to read (queries are view-capability)", async () => {
    const job = makeJob();
    mockJobService.getJob.mockResolvedValueOnce(job);
    await expect(
      viewerCaller().jobs.get({ jobId: "job_abc" }),
    ).resolves.toEqual({ data: job });
  });
});

// ---------------------------------------------------------------------------
// jobs.list
// ---------------------------------------------------------------------------

describe("jobs.list", () => {
  it("always scopes to the session user and applies default pagination", async () => {
    const rows = [makeJob({ id: "a" }), makeJob({ id: "b" })];
    mockJobService.listJobs.mockResolvedValueOnce({ jobs: rows, total: 2 });

    const result = await userCaller().jobs.list({});

    // Ownership scoping: the filter's userId comes from the session, never
    // from the input.
    expect(mockJobService.listJobs).toHaveBeenCalledWith(
      { userId: USER_ID },
      50,
      0,
    );
    expect(result).toEqual({
      items: rows,
      total: 2,
      limit: 50,
      offset: 0,
      hasMore: false,
      filters: {},
    });
  });

  it("passes status and eventId filters through and echoes them", async () => {
    mockJobService.listJobs.mockResolvedValueOnce({
      jobs: [],
      total: 12,
    });

    const result = await userCaller().jobs.list({
      status: JobStatus.RUNNING,
      eventId: 7,
      limit: 10,
      offset: 5,
    });

    expect(mockJobService.listJobs).toHaveBeenCalledWith(
      { userId: USER_ID, status: JobStatus.RUNNING, eventId: 7 },
      10,
      5,
    );
    expect(result.filters).toEqual({ status: "running", eventId: 7 });
    expect(result.hasMore).toBe(true); // 5 + 0 < 12
  });

  it("passes the falsy filter value eventId: 0 through to the service", async () => {
    // Regression guard for the truthiness-drop family: an explicitly provided
    // falsy filter must reach the service (which now checks !== undefined)
    // rather than being silently discarded anywhere along the path.
    mockJobService.listJobs.mockResolvedValueOnce({ jobs: [], total: 0 });

    const result = await userCaller().jobs.list({ eventId: 0 });

    expect(mockJobService.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 0 }),
      50,
      0,
    );
    expect(result.filters).toEqual({ eventId: 0 });
  });

  it("rejects out-of-range pagination (zod)", async () => {
    await expect(userCaller().jobs.list({ limit: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(userCaller().jobs.list({ limit: 101 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(userCaller().jobs.list({ offset: -1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockJobService.listJobs).not.toHaveBeenCalled();
  });

  it("rejects an unknown status value (zod)", async () => {
    await expect(
      userCaller().jobs.list({
        status: "exploded" as unknown as JobStatus.QUEUED,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("surfaces service failures as INTERNAL_SERVER_ERROR", async () => {
    mockJobService.listJobs.mockRejectedValueOnce(new Error("db down"));
    await expect(userCaller().jobs.list({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

// ---------------------------------------------------------------------------
// jobs.stats
// ---------------------------------------------------------------------------

describe("jobs.stats", () => {
  it("returns the user-scoped stats in a stats response", async () => {
    const stats = {
      total: 5,
      queued: 1,
      running: 1,
      completed: 2,
      failed: 1,
      cancelled: 0,
    };
    mockJobService.getJobStats.mockResolvedValueOnce(stats);

    const result = await userCaller().jobs.stats();

    expect(mockJobService.getJobStats).toHaveBeenCalledWith(USER_ID);
    expect(result.metrics).toEqual(stats);
    // 30-day period, ISO formatted.
    expect(new Date(result.period.end).getTime()).toBeGreaterThan(
      new Date(result.period.start).getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// jobs.cancel
// ---------------------------------------------------------------------------

describe("jobs.cancel", () => {
  it.each([JobStatus.QUEUED, JobStatus.CLAIMED, JobStatus.RUNNING])(
    "cancels an owned %s job and returns a mutation response",
    async (status) => {
      const job = makeJob({ status });
      const cancelled = makeJob({ status: JobStatus.CANCELLED });
      mockJobService.getJob.mockResolvedValueOnce(job);
      mockJobService.cancelJob.mockResolvedValueOnce(cancelled);

      const result = await userCaller().jobs.cancel({ jobId: "job_abc" });

      expect(mockJobService.cancelJob).toHaveBeenCalledWith("job_abc");
      expect(result).toEqual({
        success: true,
        data: cancelled,
        message: "Job cancelled successfully",
      });
    },
  );

  it.each([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED])(
    "refuses to cancel a %s job with BAD_REQUEST",
    async (status) => {
      mockJobService.getJob.mockResolvedValueOnce(makeJob({ status }));

      await expect(
        userCaller().jobs.cancel({ jobId: "job_abc" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Job cannot be cancelled in its current state",
      });
      expect(mockJobService.cancelJob).not.toHaveBeenCalled();
    },
  );

  it("throws NOT_FOUND for a missing job", async () => {
    mockJobService.getJob.mockResolvedValueOnce(null);
    await expect(
      userCaller().jobs.cancel({ jobId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockJobService.cancelJob).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when cancelling another user's job", async () => {
    mockJobService.getJob.mockResolvedValueOnce(
      makeJob({ userId: OTHER_USER_ID }),
    );
    await expect(
      userCaller().jobs.cancel({ jobId: "job_abc" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockJobService.cancelJob).not.toHaveBeenCalled();
  });

  it("throws INTERNAL_SERVER_ERROR when the cancel CAS is rejected", async () => {
    mockJobService.getJob.mockResolvedValueOnce(makeJob());
    mockJobService.cancelJob.mockResolvedValueOnce(null);
    await expect(
      userCaller().jobs.cancel({ jobId: "job_abc" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to cancel job",
    });
  });

  it("denies a Viewer before the service is ever consulted (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().jobs.cancel({ jobId: "job_abc" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockJobService.getJob).not.toHaveBeenCalled();
    expect(mockJobService.cancelJob).not.toHaveBeenCalled();
  });

  it("rejects a missing jobId (zod)", async () => {
    await expect(
      userCaller().jobs.cancel({} as { jobId: string }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockJobService.cancelJob).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      callerWith(null).jobs.cancel({ jobId: "job_abc" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// jobs.logs
// ---------------------------------------------------------------------------

describe("jobs.logs", () => {
  it("returns paginated log rows for an owned job", async () => {
    mockJobService.getJob.mockResolvedValueOnce(makeJob());
    const logRows = [
      { id: 1, output: "line 1", error: null, timestamp: new Date() },
      { id: 2, output: null, error: "boom", timestamp: new Date() },
    ];
    // First logs-table select: the page of rows; second: the count query.
    dbState.logsResults = [logRows, [{ count: 1 }, { count: 2 }]];

    const result = await userCaller().jobs.logs({ jobId: "job_abc" });

    expect(result).toEqual({
      items: logRows,
      total: 2,
      limit: 100,
      offset: 0,
      hasMore: false,
    });
  });

  it("throws NOT_FOUND when the job does not exist", async () => {
    mockJobService.getJob.mockResolvedValueOnce(null);
    await expect(
      userCaller().jobs.logs({ jobId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for logs of another user's job", async () => {
    mockJobService.getJob.mockResolvedValueOnce(
      makeJob({ userId: OTHER_USER_ID }),
    );
    await expect(
      userCaller().jobs.logs({ jobId: "job_abc" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects out-of-range limits (zod)", async () => {
    await expect(
      userCaller().jobs.logs({ jobId: "job_abc", limit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userCaller().jobs.logs({ jobId: "job_abc", limit: 1001 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
