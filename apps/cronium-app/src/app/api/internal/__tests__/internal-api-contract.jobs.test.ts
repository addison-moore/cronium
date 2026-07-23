/**
 * @jest-environment node
 *
 * Contract tests for the orchestrator-facing job routes:
 *   POST /api/internal/jobs/claim
 *   POST /api/internal/jobs/heartbeat
 *   POST /api/internal/jobs/[jobId]/complete
 *   POST /api/internal/jobs/[jobId]/fail
 *   POST+GET /api/internal/jobs/[jobId]/logs
 *   PUT  /api/internal/jobs/[jobId]/status
 *
 * Response shapes are pinned by the JSON fixtures in
 * tests/fixtures/internal-api/ (the source of truth, shared with the Go-side
 * tests). Dynamic fields are compared through sentinel placeholders — see the
 * fixture README.
 */

jest.mock("@/lib/services/job-service", () => ({
  jobService: {
    claimJobs: jest.fn(),
    heartbeatJobs: jest.fn(),
    getJob: jest.fn(),
    updateJobStatus: jest.fn(),
  },
}));

jest.mock("@/lib/services/enhanced-job-transformer", () => ({
  enhancedTransformJobsForOrchestrator: jest.fn(),
}));

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    execute: jest.fn(),
    transaction: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { enhancedTransformJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import { db } from "@/server/db";
import { JobStatus } from "@/shared/schema";
import {
  mintJobCapability,
  verifyJobCapability,
  __resetJobCapabilityKeyForTests,
} from "@/lib/security/job-capability";
import { POST as claimPOST } from "@/app/api/internal/jobs/claim/route";
import { POST as heartbeatPOST } from "@/app/api/internal/jobs/heartbeat/route";
import { POST as completePOST } from "@/app/api/internal/jobs/[jobId]/complete/route";
import { POST as failPOST } from "@/app/api/internal/jobs/[jobId]/fail/route";
import {
  POST as logsPOST,
  GET as logsGET,
} from "@/app/api/internal/jobs/[jobId]/logs/route";
import { PUT as statusPUT } from "@/app/api/internal/jobs/[jobId]/status/route";

// ---------------------------------------------------------------------------
// Fixture harness (sentinel convention documented in the fixture README)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(
  __dirname,
  "../../../../../../../tests/fixtures/internal-api",
);

interface FixtureResponse {
  status: number;
  body: unknown;
}
interface Fixture {
  route: string;
  auth: string;
  responses: Record<string, FixtureResponse>;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as Fixture;
}

const SENTINELS: Record<string, (value: unknown) => boolean> = {
  "<id>": (v) => typeof v === "string" && v.length > 0,
  "<number>": (v) => typeof v === "number" && Number.isFinite(v),
  "<iso-date>": (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)),
  "<token>": (v) => typeof v === "string" && v.startsWith("cap.1."),
};

/** Replace dynamic actual values with the fixture's sentinels (validated). */
function substituteDynamics(actual: unknown, expected: unknown): unknown {
  if (typeof expected === "string" && expected in SENTINELS) {
    return SENTINELS[expected]!(actual) ? expected : actual;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return actual.map((item, i) =>
      i < expected.length ? substituteDynamics(item, expected[i]) : item,
    );
  }
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object"
  ) {
    const exp = expected as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(actual as Record<string, unknown>).map(([k, v]) => [
        k,
        k in exp ? substituteDynamics(v, exp[k]) : v,
      ]),
    );
  }
  return actual;
}

async function expectContract(
  res: Response,
  fixture: FixtureResponse,
): Promise<unknown> {
  expect(res.status).toBe(fixture.status);
  const body: unknown = await res.json();
  expect(substituteDynamics(body, fixture.body)).toEqual(fixture.body);
  return body;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const ORCH_KEY = "test-orchestrator-key";
const ENC_KEY =
  "6666666666666666666666666666666666666666666666666666666666666666";
const ORCH_ID = "orch-A";
const JOB_ID = "job-1";
const USER_ID = "user-1";
const T0 = "2026-01-01T00:00:00.000Z";

process.env.CRONIUM_ORCHESTRATOR_KEY = ORCH_KEY;
process.env.ENCRYPTION_KEY = ENC_KEY;

const nowSec = () => Math.floor(Date.now() / 1000);
const capToken = () =>
  mintJobCapability(
    { jobId: JOB_ID, userId: USER_ID, serverId: "7" },
    nowSec(),
  );
const wrongJobToken = () =>
  mintJobCapability({ jobId: "job-other", userId: USER_ID }, nowSec());

const mockJobService = jobService as unknown as Record<string, jest.Mock>;
const mockTransform = enhancedTransformJobsForOrchestrator as jest.Mock;
const mockDb = db as unknown as Record<string, jest.Mock>;

/** Thenable Drizzle-style chain: every builder method returns itself. */
function dbChain(result: unknown) {
  const c: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "limit",
    "orderBy",
    "for",
    "values",
    "set",
    "onConflictDoUpdate",
    "returning",
  ];
  for (const m of methods) {
    c[m] = jest.fn().mockImplementation(() => c);
  }
  c.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return c as Record<string, jest.Mock> & PromiseLike<unknown>;
}

function req(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://internal.test${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", ...headers },
  });
}

const orchAuth = { authorization: `Bearer ${ORCH_KEY}` };
const jobParams = { params: Promise.resolve({ jobId: JOB_ID }) };

const claimedJob = () => ({
  id: JOB_ID,
  eventId: 42,
  userId: USER_ID,
  type: "script",
  status: "claimed",
  priority: 1,
  attempts: 1,
  payload: {},
  metadata: {},
  result: null as unknown,
  orchestratorId: ORCH_ID,
  scheduledFor: new Date(T0),
  createdAt: new Date(T0),
  updatedAt: new Date(T0),
  startedAt: null as Date | null,
  completedAt: null as Date | null,
  leaseExpiresAt: new Date(T0),
  cancelRequested: false,
  output: null as string | null,
  error: null as string | null,
  exitCode: null as number | null,
});

const completedJob = () => ({
  ...claimedJob(),
  status: "completed",
  startedAt: new Date(T0),
  completedAt: new Date(T0),
  output: "hello world",
  exitCode: 0,
  result: { exitCode: 0, scriptOutput: { greeting: "hi" } },
});

const orchJob = () => ({
  id: JOB_ID,
  type: "container",
  priority: 1,
  createdAt: new Date(T0),
  scheduledFor: new Date(T0),
  attempts: 1,
  execution: {
    environment: { CRONIUM_EVENT: "demo" },
    timeout: 60_000_000_000, // 60s in nanoseconds
    inputData: {},
    variables: {},
    target: { type: "local", serverId: "7" },
    script: {
      type: "bash",
      content: "echo hello",
      workingDirectory: "/workspace",
    },
  },
  metadata: {},
});

beforeAll(() => {
  __resetJobCapabilityKeyForTests();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
  __resetJobCapabilityKeyForTests();
});
beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/claim
// ---------------------------------------------------------------------------

describe("POST /api/internal/jobs/claim", () => {
  const fx = loadFixture("jobs-claim");
  const url = "/api/internal/jobs/claim";
  const body = { orchestratorId: ORCH_ID };

  it("401s without the orchestrator key", async () => {
    const res = await claimPOST(req(url, "POST", body));
    await expectContract(res, fx.responses.unauthorized!);
    expect(mockJobService.claimJobs).not.toHaveBeenCalled();
  });

  it("401s with a wrong orchestrator key", async () => {
    const res = await claimPOST(
      req(url, "POST", body, { authorization: "Bearer wrong-key" }),
    );
    await expectContract(res, fx.responses.unauthorized!);
  });

  it("400s when orchestratorId is missing", async () => {
    const res = await claimPOST(req(url, "POST", {}, orchAuth));
    await expectContract(res, fx.responses.badRequest!);
  });

  it("claims a batch and mints a per-job capability token (fixture: success)", async () => {
    mockJobService.claimJobs!.mockResolvedValue([claimedJob()]);
    mockTransform.mockResolvedValue([orchJob()]);

    const res = await claimPOST(req(url, "POST", body, orchAuth));
    const json = (await expectContract(res, fx.responses.success!)) as {
      jobs: Array<{ capabilityToken: string }>;
    };

    // Claim-is-ack: the claim call itself is the acknowledgment (no ack route).
    expect(mockJobService.claimJobs).toHaveBeenCalledTimes(1);
    expect(mockJobService.claimJobs).toHaveBeenCalledWith(
      ORCH_ID,
      10,
      undefined,
    );

    // The minted token is real, verifiable, and scoped to job/user/server,
    // with lifetime = job timeout (60s) + 5min reporting buffer.
    const cap = verifyJobCapability(json.jobs[0]!.capabilityToken, nowSec());
    expect(cap.jobId).toBe(JOB_ID);
    expect(cap.userId).toBe(USER_ID);
    expect(cap.serverId).toBe("7");
    expect(cap.expiresAt).toBeGreaterThanOrEqual(nowSec() + 355);
    expect(cap.expiresAt).toBeLessThanOrEqual(nowSec() + 365);
  });

  it("returns an empty batch (fixture: empty)", async () => {
    mockJobService.claimJobs!.mockResolvedValue([]);
    mockTransform.mockResolvedValue([]);
    const res = await claimPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.empty!);
  });

  it("clamps batchSize to 1..50 and leaseSeconds to 15..600", async () => {
    mockJobService.claimJobs!.mockResolvedValue([]);
    mockTransform.mockResolvedValue([]);

    await claimPOST(
      req(url, "POST", { ...body, batchSize: 999, leaseSeconds: 5 }, orchAuth),
    );
    expect(mockJobService.claimJobs).toHaveBeenLastCalledWith(
      ORCH_ID,
      50,
      15_000,
    );

    await claimPOST(
      req(
        url,
        "POST",
        { ...body, batchSize: -3, leaseSeconds: 9_999 },
        orchAuth,
      ),
    );
    expect(mockJobService.claimJobs).toHaveBeenLastCalledWith(
      ORCH_ID,
      1,
      600_000,
    );
  });

  it("500s without leaking internals when the service fails", async () => {
    mockJobService.claimJobs!.mockRejectedValue(
      new Error("pg: connection refused at 10.0.0.5"),
    );
    const res = await claimPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/heartbeat
// ---------------------------------------------------------------------------

describe("POST /api/internal/jobs/heartbeat", () => {
  const fx = loadFixture("jobs-heartbeat");
  const url = "/api/internal/jobs/heartbeat";
  const body = { orchestratorId: ORCH_ID, jobIds: ["job-1", "job-2"] };

  it("401s without / with a wrong orchestrator key", async () => {
    await expectContract(
      await heartbeatPOST(req(url, "POST", body)),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await heartbeatPOST(
        req(url, "POST", body, { authorization: "Bearer nope" }),
      ),
      fx.responses.unauthorized!,
    );
  });

  it("400s when orchestratorId is missing", async () => {
    const res = await heartbeatPOST(
      req(url, "POST", { jobIds: ["job-1"] }, orchAuth),
    );
    await expectContract(res, fx.responses.badRequest!);
  });

  it("extends leases and reports cancellation (fixture: success)", async () => {
    mockJobService.heartbeatJobs!.mockResolvedValue({
      extended: ["job-1", "job-2"],
      cancelRequested: ["job-2"],
    });
    const res = await heartbeatPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.success!);
    expect(mockJobService.heartbeatJobs).toHaveBeenCalledWith(
      ORCH_ID,
      ["job-1", "job-2"],
      undefined,
    );
  });

  it("caps jobIds at 200 and clamps leaseSeconds", async () => {
    mockJobService.heartbeatJobs!.mockResolvedValue({
      extended: [],
      cancelRequested: [],
    });
    const many = Array.from({ length: 250 }, (_, i) => `job-${i}`);
    await heartbeatPOST(
      req(
        url,
        "POST",
        { orchestratorId: ORCH_ID, jobIds: many, leaseSeconds: 5 },
        orchAuth,
      ),
    );
    const [, jobIds, leaseMs] = mockJobService.heartbeatJobs!.mock.calls[0] as [
      string,
      string[],
      number,
    ];
    expect(jobIds).toHaveLength(200);
    expect(leaseMs).toBe(15_000);
  });

  it("500s without leaking internals when the service fails", async () => {
    mockJobService.heartbeatJobs!.mockRejectedValue(new Error("boom sql"));
    const res = await heartbeatPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/[jobId]/complete
// ---------------------------------------------------------------------------

describe("POST /api/internal/jobs/[jobId]/complete", () => {
  const fx = loadFixture("jobs-complete");
  const url = `/api/internal/jobs/${JOB_ID}/complete`;
  const body = {
    status: "completed",
    output: "hello world",
    exitCode: 0,
    timestamp: T0,
  };
  const capHeaders = () => ({
    "x-job-capability": capToken(),
    "x-orchestrator-id": ORCH_ID,
  });

  it("401s when the capability token is missing", async () => {
    const res = await completePOST(req(url, "POST", body), jobParams);
    await expectContract(res, fx.responses.unauthorized!);
  });

  it("403s on a garbage token and on a token lacking the capability", async () => {
    await expectContract(
      await completePOST(
        req(url, "POST", body, { "x-job-capability": "cap.1.garbage.sig" }),
        jobParams,
      ),
      fx.responses.forbidden!,
    );
    const readOnly = mintJobCapability(
      { jobId: JOB_ID, userId: USER_ID, capabilities: ["variable:read"] },
      nowSec(),
    );
    await expectContract(
      await completePOST(
        req(url, "POST", body, { "x-job-capability": readOnly }),
        jobParams,
      ),
      fx.responses.forbidden!,
    );
  });

  it("403s on an expired token", async () => {
    const expired = mintJobCapability(
      { jobId: JOB_ID, userId: USER_ID, ttlSeconds: 20 },
      nowSec() - 120,
    );
    const res = await completePOST(
      req(url, "POST", body, { "x-job-capability": expired }),
      jobParams,
    );
    await expectContract(res, fx.responses.forbidden!);
  });

  it("403s when the token is scoped to a different job", async () => {
    const res = await completePOST(
      req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
      jobParams,
    );
    await expectContract(res, fx.responses.forbiddenScope!);
    expect(mockJobService.updateJobStatus).not.toHaveBeenCalled();
  });

  it("404s for an unknown job", async () => {
    mockJobService.getJob!.mockResolvedValue(null);
    const res = await completePOST(
      req(url, "POST", body, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.notFound!);
  });

  it("409s when another orchestrator owns the job", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const res = await completePOST(
      req(url, "POST", body, {
        "x-job-capability": capToken(),
        "x-orchestrator-id": "orch-B",
      }),
      jobParams,
    );
    await expectContract(res, fx.responses.ownershipConflict!);
  });

  it("records completion and promotes stored scriptOutput (fixture: success)", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    // The runtime already stored cronium.output() on job.result.
    mockDb.select!.mockReturnValue(
      dbChain([{ result: { output: { greeting: "hi" } } }]),
    );
    mockJobService.updateJobStatus!.mockResolvedValue(completedJob());

    const res = await completePOST(
      req(url, "POST", body, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.success!);

    expect(mockJobService.updateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      JobStatus.COMPLETED,
      expect.objectContaining({
        exitCode: 0,
        output: "hello world",
        result: expect.objectContaining({
          exitCode: 0,
          scriptOutput: { greeting: "hi" },
        }),
      }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("maps timeout/cancel statuses and exit-code fallbacks", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockDb.select!.mockReturnValue(dbChain([{ result: null }]));
    mockJobService.updateJobStatus!.mockResolvedValue(completedJob());

    await completePOST(
      req(url, "POST", { ...body, status: "timed_out" }, capHeaders()),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.TIMED_OUT,
      expect.objectContaining({ error: "Job execution timed out" }),
      `orchestrator:${ORCH_ID}`,
    );

    await completePOST(
      req(
        url,
        "POST",
        { exitCode: -2, timestamp: T0, output: "x" },
        capHeaders(),
      ),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.CANCELLED,
      expect.objectContaining({ error: "Job cancelled" }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("routes {stdout,stderr} output to error on failure", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockDb.select!.mockReturnValue(dbChain([{ result: null }]));
    mockJobService.updateJobStatus!.mockResolvedValue(completedJob());

    await completePOST(
      req(
        url,
        "POST",
        {
          status: "failed",
          exitCode: 3,
          output: { stdout: "so far", stderr: "kaboom" },
          timestamp: T0,
        },
        capHeaders(),
      ),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.FAILED,
      expect.objectContaining({ output: "so far", error: "kaboom" }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("is idempotent on a repeated terminal report (fixture: idempotentNoop)", async () => {
    mockJobService
      .getJob!.mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce(completedJob());
    mockDb.select!.mockReturnValue(
      dbChain([{ result: { output: { greeting: "hi" } } }]),
    );
    mockJobService.updateJobStatus!.mockResolvedValue(null); // CAS reject

    const res = await completePOST(
      req(url, "POST", body, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.idempotentNoop!);
  });

  it("409s a conflicting late completion (fixture: casConflict)", async () => {
    mockJobService
      .getJob!.mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce({ ...claimedJob(), status: "failed" });
    mockDb.select!.mockReturnValue(dbChain([{ result: null }]));
    mockJobService.updateJobStatus!.mockResolvedValue(null);

    const res = await completePOST(
      req(url, "POST", body, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.casConflict!);
  });

  it("500s without leaking internals when the service fails", async () => {
    mockJobService.getJob!.mockRejectedValue(new Error("SELECT * FROM jobs"));
    const res = await completePOST(
      req(url, "POST", body, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/[jobId]/fail
// ---------------------------------------------------------------------------

describe("POST /api/internal/jobs/[jobId]/fail", () => {
  const fx = loadFixture("jobs-fail");
  const url = `/api/internal/jobs/${JOB_ID}/fail`;
  const body = { error: "boom", exitCode: 1, timestamp: T0 };
  const capHeaders = () => ({
    "x-job-capability": capToken(),
    "x-orchestrator-id": ORCH_ID,
  });
  const failedJob = () => ({
    ...claimedJob(),
    status: "failed",
    startedAt: new Date(T0),
    completedAt: new Date(T0),
    error: "boom",
    exitCode: 1,
  });

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await failPOST(req(url, "POST", body), jobParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await failPOST(
        req(url, "POST", body, { "x-job-capability": "nonsense" }),
        jobParams,
      ),
      fx.responses.forbidden!,
    );
    await expectContract(
      await failPOST(
        req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
        jobParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("400s when the error message is missing", async () => {
    const res = await failPOST(
      req(url, "POST", { timestamp: T0 }, capHeaders()),
      jobParams,
    );
    await expectContract(res, fx.responses.badRequest!);
  });

  it("404s for an unknown job", async () => {
    mockJobService.getJob!.mockResolvedValue(null);
    const res = await failPOST(req(url, "POST", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.notFound!);
  });

  it("409s when another orchestrator owns the job", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const res = await failPOST(
      req(url, "POST", body, {
        "x-job-capability": capToken(),
        "x-orchestrator-id": "orch-B",
      }),
      jobParams,
    );
    await expectContract(res, fx.responses.ownershipConflict!);
  });

  it("marks the job failed (fixture: success)", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockJobService.updateJobStatus!.mockResolvedValue(failedJob());
    const res = await failPOST(req(url, "POST", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.success!);
    expect(mockJobService.updateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      JobStatus.FAILED,
      expect.objectContaining({ error: "boom", exitCode: 1 }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("409s a conflicting late fail report (fixture: casConflict)", async () => {
    mockJobService
      .getJob!.mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce(completedJob());
    mockJobService.updateJobStatus!.mockResolvedValue(null);
    const res = await failPOST(req(url, "POST", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.casConflict!);
  });

  it("500s without leaking internals when the service fails", async () => {
    mockJobService.getJob!.mockRejectedValue(new Error("pg: whoops"));
    const res = await failPOST(req(url, "POST", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST+GET /api/internal/jobs/[jobId]/logs
// ---------------------------------------------------------------------------

describe("POST+GET /api/internal/jobs/[jobId]/logs", () => {
  const fx = loadFixture("jobs-logs");
  const url = `/api/internal/jobs/${JOB_ID}/logs`;
  const logLines = [
    { timestamp: T0, level: "info", message: "line 1", source: "stdout" },
    { timestamp: T0, level: "error", message: "line 2", source: "stderr" },
  ];
  const body = { logs: logLines, orchestratorId: ORCH_ID };
  const capHeader = () => ({ "x-job-capability": capToken() });

  it("401s / 403s on missing, garbage, and wrong-job tokens (POST)", async () => {
    await expectContract(
      await logsPOST(req(url, "POST", body), jobParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await logsPOST(
        req(url, "POST", body, { "x-job-capability": "cap.1.x.y" }),
        jobParams,
      ),
      fx.responses.forbidden!,
    );
    await expectContract(
      await logsPOST(
        req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
        jobParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("400s when logs is not an array", async () => {
    const res = await logsPOST(
      req(url, "POST", { logs: "nope", orchestratorId: ORCH_ID }, capHeader()),
      jobParams,
    );
    await expectContract(res, fx.responses.badRequest!);
  });

  it("404s for an unknown job", async () => {
    mockJobService.getJob!.mockResolvedValue(null);
    const res = await logsPOST(req(url, "POST", body, capHeader()), jobParams);
    await expectContract(res, fx.responses.notFound!);
  });

  it("403s when the claiming orchestrator does not match", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const res = await logsPOST(
      req(url, "POST", { ...body, orchestratorId: "orch-B" }, capHeader()),
      jobParams,
    );
    await expectContract(res, fx.responses.notOwner!);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("appends log entries (fixture: appendSuccess)", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const insertChain = dbChain(undefined);
    mockDb.insert!.mockReturnValue(insertChain);

    const res = await logsPOST(req(url, "POST", body, capHeader()), jobParams);
    await expectContract(res, fx.responses.appendSuccess!);

    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        eventId: 42,
        userId: USER_ID,
        jobId: JOB_ID,
        output: "line 1",
        error: null,
        successful: true,
      }),
      expect.objectContaining({
        output: "line 2",
        error: "line 2",
        successful: false,
      }),
    ]);
  });

  it("accepts an empty batch without inserting (fixture: appendEmpty)", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const res = await logsPOST(
      req(url, "POST", { logs: [], orchestratorId: ORCH_ID }, capHeader()),
      jobParams,
    );
    await expectContract(res, fx.responses.appendEmpty!);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("GET requires a job-scoped capability", async () => {
    await expectContract(
      await logsGET(req(url, "GET"), jobParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await logsGET(
        req(url, "GET", undefined, { "x-job-capability": wrongJobToken() }),
        jobParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("GET returns the job's logs (fixture: getSuccess)", async () => {
    mockDb.select!.mockReturnValue(
      dbChain([
        {
          id: 1,
          eventId: 42,
          userId: USER_ID,
          jobId: JOB_ID,
          output: "line 1",
          error: null,
          startTime: new Date(T0),
          endTime: null,
          status: "running",
          successful: true,
        },
        {
          id: 2,
          eventId: 42,
          userId: USER_ID,
          jobId: JOB_ID,
          output: "line 2",
          error: "line 2",
          startTime: new Date(T0),
          endTime: null,
          status: "running",
          successful: false,
        },
      ]),
    );
    const res = await logsGET(
      req(url, "GET", undefined, capHeader()),
      jobParams,
    );
    await expectContract(res, fx.responses.getSuccess!);
  });

  it("500s without leaking internals when the insert fails", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockDb.insert!.mockImplementation(() => {
      throw new Error("INSERT INTO logs exploded");
    });
    const res = await logsPOST(req(url, "POST", body, capHeader()), jobParams);
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/internal/jobs/[jobId]/status
// ---------------------------------------------------------------------------

describe("PUT /api/internal/jobs/[jobId]/status", () => {
  const fx = loadFixture("jobs-status");
  const url = `/api/internal/jobs/${JOB_ID}/status`;
  const body = { status: "running", timestamp: T0 };
  const capHeaders = () => ({
    "x-job-capability": capToken(),
    "x-orchestrator-id": ORCH_ID,
  });
  const runningJob = () => ({
    ...claimedJob(),
    status: "running",
    startedAt: new Date(T0),
  });

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await statusPUT(req(url, "PUT", body), jobParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await statusPUT(
        req(url, "PUT", body, { "x-job-capability": "bad" }),
        jobParams,
      ),
      fx.responses.forbidden!,
    );
    await expectContract(
      await statusPUT(
        req(url, "PUT", body, { "x-job-capability": wrongJobToken() }),
        jobParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("400s when status is missing or unknown", async () => {
    await expectContract(
      await statusPUT(
        req(url, "PUT", { timestamp: T0 }, capHeaders()),
        jobParams,
      ),
      fx.responses.badRequestMissingStatus!,
    );
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    await expectContract(
      await statusPUT(
        req(url, "PUT", { status: "warp-speed", timestamp: T0 }, capHeaders()),
        jobParams,
      ),
      fx.responses.badRequestInvalidStatus!,
    );
  });

  it("404s for an unknown job", async () => {
    mockJobService.getJob!.mockResolvedValue(null);
    const res = await statusPUT(req(url, "PUT", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.notFound!);
  });

  it("409s when another orchestrator owns the job", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    const res = await statusPUT(
      req(url, "PUT", body, {
        "x-job-capability": capToken(),
        "x-orchestrator-id": "orch-B",
      }),
      jobParams,
    );
    await expectContract(res, fx.responses.ownershipConflict!);
  });

  it("reports RUNNING progress (fixture: success)", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockJobService.updateJobStatus!.mockResolvedValue(runningJob());
    const res = await statusPUT(req(url, "PUT", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.success!);
    expect(mockJobService.updateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      JobStatus.RUNNING,
      expect.objectContaining({ startedAt: expect.any(Date) }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("maps terminal statuses to CAS transitions with their defaults", async () => {
    mockJobService.getJob!.mockResolvedValue(claimedJob());
    mockJobService.updateJobStatus!.mockResolvedValue(runningJob());

    await statusPUT(
      req(url, "PUT", { status: "failed", timestamp: T0 }, capHeaders()),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.FAILED,
      expect.objectContaining({ error: "Unknown error", exitCode: 1 }),
      `orchestrator:${ORCH_ID}`,
    );

    await statusPUT(
      req(url, "PUT", { status: "timed_out", timestamp: T0 }, capHeaders()),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.TIMED_OUT,
      expect.objectContaining({
        error: "Job execution timed out",
        exitCode: -1,
      }),
      `orchestrator:${ORCH_ID}`,
    );

    await statusPUT(
      req(url, "PUT", { status: "cancelled", timestamp: T0 }, capHeaders()),
      jobParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenLastCalledWith(
      JOB_ID,
      JobStatus.CANCELLED,
      expect.objectContaining({ error: "Job cancelled" }),
      `orchestrator:${ORCH_ID}`,
    );
  });

  it("is idempotent when the terminal state already matches", async () => {
    mockJobService
      .getJob!.mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce(runningJob());
    mockJobService.updateJobStatus!.mockResolvedValue(null);
    const res = await statusPUT(req(url, "PUT", body, capHeaders()), jobParams);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { noop?: boolean };
    expect(json.noop).toBe(true);
  });

  it("409s a rejected transition (fixture: casConflict)", async () => {
    mockJobService
      .getJob!.mockResolvedValueOnce(claimedJob())
      .mockResolvedValueOnce(completedJob());
    mockJobService.updateJobStatus!.mockResolvedValue(null);
    const res = await statusPUT(req(url, "PUT", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.casConflict!);
  });

  it("500s without leaking internals when the service fails", async () => {
    mockJobService.getJob!.mockRejectedValue(new Error("stack trace here"));
    const res = await statusPUT(req(url, "PUT", body, capHeaders()), jobParams);
    await expectContract(res, fx.responses.serverError!);
  });
});
