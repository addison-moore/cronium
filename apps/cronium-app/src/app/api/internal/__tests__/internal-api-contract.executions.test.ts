/**
 * @jest-environment node
 *
 * Contract tests for the execution-scoped internal routes (called by the
 * runtime service on behalf of running scripts) plus the audit sink:
 *   POST /api/internal/executions/[executionId]/create
 *   PUT  /api/internal/executions/[executionId]/update
 *   POST /api/internal/executions/[executionId]/output
 *   GET  /api/internal/executions/[executionId]/context
 *   POST /api/internal/executions/[executionId]/condition
 *   POST /api/internal/audit
 *
 * Response shapes are pinned by the JSON fixtures in
 * tests/fixtures/internal-api/ (source of truth, shared with Go-side tests).
 */

jest.mock("@/lib/services/execution-service", () => ({
  executionService: {
    createExecution: jest.fn(),
    getExecution: jest.fn(),
    updateExecution: jest.fn(),
  },
}));

jest.mock("@/lib/services/job-service", () => ({
  jobService: {
    getJob: jest.fn(),
    updateJobStatus: jest.fn(),
  },
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

jest.mock("@/lib/websocket-broadcaster", () => ({
  getWebSocketBroadcaster: jest.fn(() => ({
    broadcastExecutionUpdate: jest.fn().mockResolvedValue(undefined),
  })),
}));

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { jobService } from "@/lib/services/job-service";
import { db } from "@/server/db";
import { JobStatus } from "@/shared/schema";
import {
  mintJobCapability,
  __resetJobCapabilityKeyForTests,
} from "@/lib/security/job-capability";
import { POST as createPOST } from "@/app/api/internal/executions/[executionId]/create/route";
import { PUT as updatePUT } from "@/app/api/internal/executions/[executionId]/update/route";
import { POST as outputPOST } from "@/app/api/internal/executions/[executionId]/output/route";
import { GET as contextGET } from "@/app/api/internal/executions/[executionId]/context/route";
import { POST as conditionPOST } from "@/app/api/internal/executions/[executionId]/condition/route";
import { POST as auditPOST } from "@/app/api/internal/audit/route";

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

const ENC_KEY =
  "6666666666666666666666666666666666666666666666666666666666666666";
const JOB_ID = "job-1";
const USER_ID = "user-1";
const EXEC_ID = "exec_job-1_1700000000";
const T0 = "2026-01-01T00:00:00.000Z";

process.env.ENCRYPTION_KEY = ENC_KEY;

const nowSec = () => Math.floor(Date.now() / 1000);
const capToken = () =>
  mintJobCapability({ jobId: JOB_ID, userId: USER_ID }, nowSec());
const wrongJobToken = () =>
  mintJobCapability({ jobId: "job-other", userId: USER_ID }, nowSec());
const capHeader = () => ({ "x-job-capability": capToken() });

const mockExecService = executionService as unknown as Record<
  string,
  jest.Mock
>;
const mockJobService = jobService as unknown as Record<string, jest.Mock>;
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

const execParams = { params: Promise.resolve({ executionId: EXEC_ID }) };

const queuedExecution = () => ({
  id: EXEC_ID,
  jobId: JOB_ID,
  serverId: null as number | null,
  serverName: null as string | null,
  status: "queued",
  metadata: {},
  createdAt: new Date(T0),
  updatedAt: new Date(T0),
  startedAt: null as Date | null,
  completedAt: null as Date | null,
  exitCode: null as number | null,
  output: null as string | null,
  error: null as string | null,
});

const runningExecution = () => ({
  ...queuedExecution(),
  status: "running",
  startedAt: new Date(T0),
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
// POST /api/internal/executions/[executionId]/create
// ---------------------------------------------------------------------------

describe("POST /api/internal/executions/[executionId]/create", () => {
  const fx = loadFixture("executions-create");
  const url = `/api/internal/executions/${EXEC_ID}/create`;
  const body = { jobId: JOB_ID };

  it("401s when the capability token is missing (before any body oracle)", async () => {
    // Even a body that would fail validation must yield 401, not 400.
    await expectContract(
      await createPOST(req(url, "POST", {}), execParams),
      fx.responses.unauthorized!,
    );
    expect(mockExecService.createExecution).not.toHaveBeenCalled();
  });

  it("403s on garbage and wrong-job tokens", async () => {
    await expectContract(
      await createPOST(
        req(url, "POST", body, { "x-job-capability": "cap.1.junk.sig" }),
        execParams,
      ),
      fx.responses.forbidden!,
    );
    await expectContract(
      await createPOST(
        req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
        execParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("400s when jobId is missing (authenticated)", async () => {
    const res = await createPOST(req(url, "POST", {}, capHeader()), execParams);
    await expectContract(res, fx.responses.badRequest!);
  });

  it("creates the execution (fixture: success)", async () => {
    mockExecService.createExecution!.mockResolvedValue(queuedExecution());
    const res = await createPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.success!);
    expect(mockExecService.createExecution).toHaveBeenCalledWith({
      id: EXEC_ID,
      jobId: JOB_ID,
      serverId: null,
      serverName: null,
      status: JobStatus.QUEUED,
      metadata: {},
    });
  });

  it("passes serverId/serverName/metadata through", async () => {
    mockExecService.createExecution!.mockResolvedValue(queuedExecution());
    await createPOST(
      req(
        url,
        "POST",
        {
          jobId: JOB_ID,
          serverId: 7,
          serverName: "sandbox-1",
          metadata: { a: 1 },
        },
        capHeader(),
      ),
      execParams,
    );
    expect(mockExecService.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 7,
        serverName: "sandbox-1",
        metadata: { a: 1 },
      }),
    );
  });

  it("500s without leaking internals when the service fails", async () => {
    mockExecService.createExecution!.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "executions_pkey"',
      ),
    );
    const res = await createPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    const json = (await expectContract(
      res,
      fx.responses.serverError!,
    )) as Record<string, unknown>;
    expect(json).not.toHaveProperty("details");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/internal/executions/[executionId]/update
// ---------------------------------------------------------------------------

describe("PUT /api/internal/executions/[executionId]/update", () => {
  const fx = loadFixture("executions-update");
  const url = `/api/internal/executions/${EXEC_ID}/update`;
  const body = { status: "running", startedAt: T0 };

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await updatePUT(req(url, "PUT", body), execParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await updatePUT(
        req(url, "PUT", body, { "x-job-capability": "nope" }),
        execParams,
      ),
      fx.responses.forbidden!,
    );
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    await expectContract(
      await updatePUT(
        req(url, "PUT", body, { "x-job-capability": wrongJobToken() }),
        execParams,
      ),
      fx.responses.forbiddenScope!,
    );
    expect(mockExecService.updateExecution).not.toHaveBeenCalled();
  });

  it("404s for an unknown execution", async () => {
    mockExecService.getExecution!.mockResolvedValue(null);
    const res = await updatePUT(req(url, "PUT", body, capHeader()), execParams);
    await expectContract(res, fx.responses.notFound!);
  });

  it("updates the execution (fixture: success)", async () => {
    mockExecService.getExecution!.mockResolvedValue(queuedExecution());
    mockExecService.updateExecution!.mockResolvedValue(runningExecution());
    const res = await updatePUT(req(url, "PUT", body, capHeader()), execParams);
    await expectContract(res, fx.responses.success!);
    expect(mockExecService.updateExecution).toHaveBeenCalledWith(
      EXEC_ID,
      expect.objectContaining({
        status: "running",
        startedAt: new Date(T0),
      }),
    );
    // Non-terminal update must not touch the job.
    expect(mockJobService.updateJobStatus).not.toHaveBeenCalled();
  });

  it("404s when the update targets a vanished execution", async () => {
    mockExecService.getExecution!.mockResolvedValue(queuedExecution());
    mockExecService.updateExecution!.mockResolvedValue(null);
    const res = await updatePUT(req(url, "PUT", body, capHeader()), execParams);
    await expectContract(res, fx.responses.notFound!);
  });

  it("syncs the owning job on completion, promoting runtime output", async () => {
    const completed = {
      ...runningExecution(),
      status: "completed",
      completedAt: new Date(T0),
      exitCode: 0,
      output: "done",
      executionDuration: 5,
      setupDuration: 2,
    };
    mockExecService.getExecution!.mockResolvedValue(queuedExecution());
    mockExecService.updateExecution!.mockResolvedValue(completed);
    mockJobService.getJob!.mockResolvedValue({
      id: JOB_ID,
      result: { output: { greeting: "hi" }, condition: true },
    });
    mockJobService.updateJobStatus!.mockResolvedValue({ id: JOB_ID });

    const res = await updatePUT(
      req(
        url,
        "PUT",
        { status: "completed", completedAt: T0, exitCode: 0 },
        capHeader(),
      ),
      execParams,
    );
    expect(res.status).toBe(200);

    expect(mockJobService.updateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      JobStatus.COMPLETED,
      expect.objectContaining({
        exitCode: 0,
        output: "done",
        completedAt: new Date(T0),
        executionDuration: 5,
        setupDuration: 2,
        result: expect.objectContaining({
          output: { greeting: "hi" },
          scriptOutput: { greeting: "hi" },
          condition: true,
        }),
      }),
      "execution-sync",
    );
  });

  it("derives cancelled/timed-out job status from sentinel exit codes", async () => {
    mockExecService.getExecution!.mockResolvedValue(queuedExecution());
    mockExecService.updateExecution!.mockResolvedValue({
      ...runningExecution(),
      status: "failed",
      completedAt: new Date(T0),
      exitCode: -2,
    });
    mockJobService.getJob!.mockResolvedValue({ id: JOB_ID, result: null });
    mockJobService.updateJobStatus!.mockResolvedValue({ id: JOB_ID });

    await updatePUT(
      req(
        url,
        "PUT",
        { status: "failed", completedAt: T0, exitCode: -2 },
        capHeader(),
      ),
      execParams,
    );
    expect(mockJobService.updateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      JobStatus.CANCELLED,
      expect.anything(),
      "execution-sync",
    );
  });

  it("500s without leaking internals when the service fails", async () => {
    mockExecService.getExecution!.mockRejectedValue(
      new Error("pg: SELECT * FROM executions failed"),
    );
    const res = await updatePUT(req(url, "PUT", body, capHeader()), execParams);
    const json = (await expectContract(
      res,
      fx.responses.serverError!,
    )) as Record<string, unknown>;
    expect(json).not.toHaveProperty("details");
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/executions/[executionId]/output
// ---------------------------------------------------------------------------

describe("POST /api/internal/executions/[executionId]/output", () => {
  const fx = loadFixture("executions-output");
  const url = `/api/internal/executions/${EXEC_ID}/output`;
  const body = { output: { a: 1 }, timestamp: T0 };

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await outputPOST(req(url, "POST", body), execParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await outputPOST(
        req(url, "POST", body, { "x-job-capability": "zzz" }),
        execParams,
      ),
      fx.responses.forbidden!,
    );
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    await expectContract(
      await outputPOST(
        req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
        execParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("413s on an oversized Content-Length before reading the body", async () => {
    const res = await outputPOST(
      req(url, "POST", body, {
        ...capHeader(),
        "content-length": String(6 * 1024 * 1024),
      }),
      execParams,
    );
    await expectContract(res, fx.responses.payloadTooLarge!);
  });

  it("413s when the serialized output exceeds the limit", async () => {
    const huge = "x".repeat(5 * 1024 * 1024 + 16);
    const res = await outputPOST(
      req(url, "POST", { output: huge, timestamp: T0 }, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.payloadTooLarge!);
  });

  it("404s for an unknown execution", async () => {
    mockExecService.getExecution!.mockResolvedValue(null);
    const res = await outputPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.notFound!);
  });

  it("stores output on execution metadata and job.result (fixture: success)", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockExecService.updateExecution!.mockResolvedValue(runningExecution());
    const txSelect = dbChain([{ result: { condition: true } }]);
    const txUpdate = dbChain([]);
    mockDb.transaction!.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: jest.fn(() => txSelect),
          update: jest.fn(() => txUpdate),
        }),
    );

    const res = await outputPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.success!);

    expect(mockExecService.updateExecution).toHaveBeenCalledWith(EXEC_ID, {
      metadata: expect.objectContaining({
        output: { a: 1 },
        outputTimestamp: T0,
      }),
    });
    // Row-locked merge preserves what was already on job.result.
    expect(txSelect.for).toHaveBeenCalledWith("update");
    expect(txUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          condition: true,
          output: { a: 1 },
          outputTimestamp: T0,
        }),
      }),
    );
  });

  it("500s without leaking internals when the transaction fails", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockExecService.updateExecution!.mockResolvedValue(runningExecution());
    mockDb.transaction!.mockRejectedValue(new Error("deadlock detected"));
    const res = await outputPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// GET /api/internal/executions/[executionId]/context
// ---------------------------------------------------------------------------

describe("GET /api/internal/executions/[executionId]/context", () => {
  const fx = loadFixture("executions-context");
  const url = `/api/internal/executions/${EXEC_ID}/context`;

  const jobRow = () => ({
    id: JOB_ID,
    eventId: 42,
    userId: USER_ID,
    metadata: { foo: "bar" },
    payload: { input: { a: 1 } },
    priority: 1,
    status: "running",
  });
  const eventRow = () => ({
    id: 42,
    name: "Demo Event",
    type: "BASH",
    content: "echo hello",
    runLocation: "LOCAL",
    serverId: null,
  });

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await contextGET(req(url, "GET"), execParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await contextGET(
        req(url, "GET", undefined, { "x-job-capability": "bad" }),
        execParams,
      ),
      fx.responses.forbidden!,
    );
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    await expectContract(
      await contextGET(
        req(url, "GET", undefined, { "x-job-capability": wrongJobToken() }),
        execParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("404s for an unknown execution and for a vanished job", async () => {
    mockExecService.getExecution!.mockResolvedValue(null);
    await expectContract(
      await contextGET(req(url, "GET", undefined, capHeader()), execParams),
      fx.responses.notFoundExecution!,
    );

    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockDb.select!.mockReturnValue(dbChain([]));
    await expectContract(
      await contextGET(req(url, "GET", undefined, capHeader()), execParams),
      fx.responses.notFoundJob!,
    );
  });

  it("returns the merged execution context (fixture: success)", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockDb
      .select!.mockReturnValueOnce(dbChain([jobRow()]))
      .mockReturnValueOnce(dbChain([eventRow()]));
    const res = await contextGET(
      req(url, "GET", undefined, capHeader()),
      execParams,
    );
    const json = (await expectContract(res, fx.responses.success!)) as Record<
      string,
      unknown
    >;
    // No PII beyond userId (intentionally no email/name).
    expect(json).not.toHaveProperty("userEmail");
    expect(json).not.toHaveProperty("userName");
  });

  it("returns a null event when the job has no eventId (fixture: successNoEvent)", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockDb.select!.mockReturnValueOnce(
      dbChain([
        {
          id: JOB_ID,
          eventId: null,
          userId: USER_ID,
          metadata: {},
          payload: {},
          priority: 1,
          status: "running",
        },
      ]),
    );
    const res = await contextGET(
      req(url, "GET", undefined, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.successNoEvent!);
  });

  it("500s without leaking internals when the db fails", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockDb.select!.mockImplementation(() => {
      throw new Error("relation jobs does not exist");
    });
    const res = await contextGET(
      req(url, "GET", undefined, capHeader()),
      execParams,
    );
    const json = (await expectContract(
      res,
      fx.responses.serverError!,
    )) as Record<string, unknown>;
    expect(json).not.toHaveProperty("details");
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/executions/[executionId]/condition
// ---------------------------------------------------------------------------

describe("POST /api/internal/executions/[executionId]/condition", () => {
  const fx = loadFixture("executions-condition");
  const url = `/api/internal/executions/${EXEC_ID}/condition`;
  const body = { condition: true };

  it("401s / 403s on missing, garbage, and wrong-job tokens", async () => {
    await expectContract(
      await conditionPOST(req(url, "POST", body), execParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await conditionPOST(
        req(url, "POST", body, { "x-job-capability": "bad" }),
        execParams,
      ),
      fx.responses.forbidden!,
    );
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    await expectContract(
      await conditionPOST(
        req(url, "POST", body, { "x-job-capability": wrongJobToken() }),
        execParams,
      ),
      fx.responses.forbiddenScope!,
    );
  });

  it("400s when condition is missing or not a boolean (fixture: badRequest)", async () => {
    for (const bad of [{}, { condition: "true" }, { condition: 1 }]) {
      await expectContract(
        await conditionPOST(req(url, "POST", bad, capHeader()), execParams),
        fx.responses.badRequest!,
      );
    }
    // Rejected at the boundary — nothing is looked up or written.
    expect(mockExecService.getExecution).not.toHaveBeenCalled();
    expect(mockExecService.updateExecution).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("404s for an unknown execution", async () => {
    mockExecService.getExecution!.mockResolvedValue(null);
    const res = await conditionPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.notFound!);
  });

  it("mirrors the condition onto job.result under a row lock (fixture: success)", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockExecService.updateExecution!.mockResolvedValue(runningExecution());
    const txSelect = dbChain([{ result: { output: { a: 1 } } }]);
    const txUpdate = dbChain([]);
    mockDb.transaction!.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: jest.fn(() => txSelect),
          update: jest.fn(() => txUpdate),
        }),
    );

    const res = await conditionPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.success!);

    expect(mockExecService.updateExecution).toHaveBeenCalledWith(EXEC_ID, {
      metadata: expect.objectContaining({ condition: true }),
    });
    expect(txSelect.for).toHaveBeenCalledWith("update");
    expect(txUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          output: { a: 1 }, // pre-existing result preserved
          condition: true,
        }),
      }),
    );
  });

  it("500s without leaking internals when the transaction fails", async () => {
    mockExecService.getExecution!.mockResolvedValue(runningExecution());
    mockExecService.updateExecution!.mockResolvedValue(runningExecution());
    mockDb.transaction!.mockRejectedValue(new Error("could not serialize"));
    const res = await conditionPOST(
      req(url, "POST", body, capHeader()),
      execParams,
    );
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/audit
// ---------------------------------------------------------------------------

describe("POST /api/internal/audit", () => {
  const fx = loadFixture("audit");
  const url = "/api/internal/audit";
  const body = {
    executionId: EXEC_ID,
    action: "variable:read",
    metadata: { key: "MY_KEY" },
  };

  it("401s when the capability token is missing", async () => {
    await expectContract(
      await auditPOST(req(url, "POST", body)),
      fx.responses.unauthorized!,
    );
  });

  it("403s on an invalid token", async () => {
    await expectContract(
      await auditPOST(
        req(url, "POST", body, { "x-job-capability": "cap.1.bad.sig" }),
      ),
      fx.responses.forbidden!,
    );
  });

  it("accepts and structured-logs the event (fixture: success)", async () => {
    const infoSpy = jest
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const res = await auditPOST(req(url, "POST", body, capHeader()));
    await expectContract(res, fx.responses.success!);
    expect(infoSpy).toHaveBeenCalledWith(
      "[audit]",
      expect.stringContaining(EXEC_ID),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "[audit]",
      expect.stringContaining("variable:read"),
    );
    infoSpy.mockRestore();
  });

  it("accepts the exact runtime wire shape (timestamp, null metadata)", async () => {
    // BackendClient.AuditLog sends executionId/action/metadata/timestamp;
    // metadata JSON-marshals to null when the action carries none (get_input).
    const infoSpy = jest
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const res = await auditPOST(
      req(
        url,
        "POST",
        {
          executionId: EXEC_ID,
          action: "get_input",
          metadata: null,
          timestamp: "2026-07-25T12:00:00.123456789Z",
        },
        capHeader(),
      ),
    );
    await expectContract(res, fx.responses.success!);
    infoSpy.mockRestore();
  });

  it("400s on garbage bodies instead of accepting anything (fixture: badRequest)", async () => {
    const infoSpy = jest
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const garbage = [
      {},
      { executionId: EXEC_ID }, // missing action
      { executionId: 42, action: "variable:read" }, // wrong type
      { executionId: EXEC_ID, action: "x", metadata: "not-an-object" },
      "just-a-string",
    ];
    for (const bad of garbage) {
      await expectContract(
        await auditPOST(req(url, "POST", bad, capHeader())),
        fx.responses.badRequest!,
      );
    }
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it("500s on a malformed (non-JSON) body without leaking internals", async () => {
    const raw = new NextRequest(`http://internal.test${url}`, {
      method: "POST",
      body: "not-json{{{",
      headers: { "content-type": "application/json", ...capHeader() },
    });
    const res = await auditPOST(raw);
    await expectContract(res, fx.responses.serverError!);
  });
});
