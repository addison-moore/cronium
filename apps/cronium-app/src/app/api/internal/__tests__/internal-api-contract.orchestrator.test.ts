/**
 * @jest-environment node
 *
 * Contract tests for the orchestrator-identity and resource-lookup routes:
 *   GET+POST /api/internal/orchestrator/health
 *   POST     /api/internal/orchestrator/heartbeat
 *   POST     /api/internal/orchestrator/metrics
 *   GET      /api/internal/servers/[serverId]
 *   GET+PUT  /api/internal/variables/[userId]/[key]
 *
 * Response shapes are pinned by the JSON fixtures in
 * tests/fixtures/internal-api/ (source of truth, shared with Go-side tests).
 */

jest.mock("@/server/storage", () => ({
  storage: {
    upsertSetting: jest.fn(),
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

jest.mock("@/lib/security/variable-secret", () => ({
  encryptVariableValue: jest.fn((value: string) => `enc:${value}`),
  decryptVariableValue: jest.fn((stored: string) =>
    stored.startsWith("enc:") ? stored.slice(4) : stored,
  ),
}));

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";
import {
  mintJobCapability,
  __resetJobCapabilityKeyForTests,
} from "@/lib/security/job-capability";
import {
  GET as healthGET,
  POST as healthPOST,
} from "@/app/api/internal/orchestrator/health/route";
import { POST as orchHeartbeatPOST } from "@/app/api/internal/orchestrator/heartbeat/route";
import { POST as metricsPOST } from "@/app/api/internal/orchestrator/metrics/route";
import { GET as serverGET } from "@/app/api/internal/servers/[serverId]/route";
import {
  GET as variableGET,
  PUT as variablePUT,
} from "@/app/api/internal/variables/[userId]/[key]/route";

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
const capHeader = () => ({ "x-job-capability": capToken() });

const mockStorage = storage as unknown as Record<string, jest.Mock>;
const mockDb = db as unknown as Record<string, jest.Mock>;
const mockEncrypt = encryptVariableValue as jest.Mock;
const mockDecrypt = decryptVariableValue as jest.Mock;

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
// GET+POST /api/internal/orchestrator/health
// ---------------------------------------------------------------------------

describe("GET+POST /api/internal/orchestrator/health", () => {
  const fx = loadFixture("orchestrator-health");
  const url = "/api/internal/orchestrator/health";

  it("GET 401s without / with a wrong orchestrator key", async () => {
    await expectContract(await healthGET(req(url, "GET")), {
      status: 401,
      body: { error: "Unauthorized" },
    });
    await expectContract(
      await healthGET(
        req(url, "GET", undefined, { authorization: "Bearer no" }),
      ),
      fx.responses.unauthorized!,
    );
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("GET reports healthy when the database responds (fixture: healthy)", async () => {
    mockDb.execute!.mockResolvedValue([{ "?column?": 1 }]);
    const res = await healthGET(req(url, "GET", undefined, orchAuth));
    await expectContract(res, fx.responses.healthy!);
  });

  it("GET reports 503 unhealthy when the database is down (fixture: unhealthy)", async () => {
    mockDb.execute!.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));
    const res = await healthGET(req(url, "GET", undefined, orchAuth));
    const json = (await expectContract(res, fx.responses.unhealthy!)) as Record<
      string,
      unknown
    >;
    // The 503 must not echo connection details.
    expect(JSON.stringify(json)).not.toContain("ECONNREFUSED");
  });

  it("POST 401s without the orchestrator key", async () => {
    const res = await healthPOST(
      req(url, "POST", { orchestratorId: ORCH_ID, status: "healthy" }),
    );
    await expectContract(res, fx.responses.unauthorized!);
  });

  it("POST 400s when orchestratorId is missing", async () => {
    const res = await healthPOST(
      req(url, "POST", { status: "healthy" }, orchAuth),
    );
    await expectContract(res, fx.responses.badRequest!);
  });

  it("POST persists the health report (fixture: reportSuccess)", async () => {
    mockStorage.upsertSetting!.mockResolvedValue(undefined);
    const res = await healthPOST(
      req(
        url,
        "POST",
        {
          orchestratorId: ORCH_ID,
          status: "degraded",
          timestamp: T0,
          metrics: { cpuUsage: 0.5, activeJobs: 3 },
          errors: ["docker slow"],
        },
        orchAuth,
      ),
    );
    await expectContract(res, fx.responses.reportSuccess!);

    expect(mockStorage.upsertSetting).toHaveBeenCalledTimes(1);
    const [key, value] = mockStorage.upsertSetting!.mock.calls[0] as [
      string,
      string,
    ];
    expect(key).toBe(`orchestrator:${ORCH_ID}:health`);
    const stored = JSON.parse(value) as Record<string, unknown>;
    expect(stored).toMatchObject({
      orchestratorId: ORCH_ID,
      status: "degraded",
      metrics: { cpuUsage: 0.5, activeJobs: 3 },
      errors: ["docker slow"],
    });
  });

  it("POST 500s without leaking internals when persistence fails", async () => {
    mockStorage.upsertSetting!.mockRejectedValue(new Error("pg down"));
    const res = await healthPOST(
      req(
        url,
        "POST",
        { orchestratorId: ORCH_ID, status: "healthy" },
        orchAuth,
      ),
    );
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/orchestrator/heartbeat
// ---------------------------------------------------------------------------

describe("POST /api/internal/orchestrator/heartbeat", () => {
  const fx = loadFixture("orchestrator-heartbeat");
  const url = "/api/internal/orchestrator/heartbeat";
  const body = {
    orchestratorId: ORCH_ID,
    timestamp: T0,
    runningJobs: ["job-1"],
    capacity: { maxJobs: 10, currentJobs: 1, availableSlots: 9 },
  };

  it("401s without / with a wrong orchestrator key", async () => {
    await expectContract(
      await orchHeartbeatPOST(req(url, "POST", body)),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await orchHeartbeatPOST(
        req(url, "POST", body, { authorization: "Bearer wrong" }),
      ),
      fx.responses.unauthorized!,
    );
  });

  it("400s when orchestratorId is missing", async () => {
    const res = await orchHeartbeatPOST(
      req(url, "POST", { timestamp: T0 }, orchAuth),
    );
    await expectContract(res, fx.responses.badRequest!);
  });

  it("persists the heartbeat (fixture: success)", async () => {
    mockStorage.upsertSetting!.mockResolvedValue(undefined);
    const res = await orchHeartbeatPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.success!);

    const [key, value] = mockStorage.upsertSetting!.mock.calls[0] as [
      string,
      string,
    ];
    expect(key).toBe(`orchestrator:${ORCH_ID}:heartbeat`);
    expect(JSON.parse(value)).toMatchObject({
      orchestratorId: ORCH_ID,
      runningJobs: ["job-1"],
      capacity: { maxJobs: 10, currentJobs: 1, availableSlots: 9 },
    });
  });

  it("500s without leaking internals when persistence fails", async () => {
    mockStorage.upsertSetting!.mockRejectedValue(new Error("boom"));
    const res = await orchHeartbeatPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/orchestrator/metrics
// ---------------------------------------------------------------------------

describe("POST /api/internal/orchestrator/metrics", () => {
  const fx = loadFixture("orchestrator-metrics");
  const url = "/api/internal/orchestrator/metrics";
  const metrics = {
    jobsProcessed: 10,
    jobsSucceeded: 9,
    jobsFailed: 1,
    averageExecutionTime: 1200,
    cpuUsage: 0.4,
    memoryUsage: 0.6,
    diskUsage: 0.2,
    activeContainers: 2,
    queueDepth: 0,
  };
  const body = {
    orchestratorId: ORCH_ID,
    timestamp: T0,
    metrics,
    period: "minute",
  };

  it("401s without / with a wrong orchestrator key", async () => {
    await expectContract(
      await metricsPOST(req(url, "POST", body)),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await metricsPOST(req(url, "POST", body, { authorization: "Bearer x" })),
      fx.responses.unauthorized!,
    );
  });

  it("400s when orchestratorId or metrics are missing", async () => {
    await expectContract(
      await metricsPOST(
        req(
          url,
          "POST",
          { timestamp: T0, metrics, period: "minute" },
          orchAuth,
        ),
      ),
      fx.responses.badRequestMissingId!,
    );
    await expectContract(
      await metricsPOST(
        req(
          url,
          "POST",
          { orchestratorId: ORCH_ID, timestamp: T0, period: "minute" },
          orchAuth,
        ),
      ),
      fx.responses.badRequestMissingMetrics!,
    );
  });

  it("persists the metrics snapshot (fixture: success)", async () => {
    mockStorage.upsertSetting!.mockResolvedValue(undefined);
    const res = await metricsPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.success!);

    const [key, value] = mockStorage.upsertSetting!.mock.calls[0] as [
      string,
      string,
    ];
    expect(key).toBe(`orchestrator:${ORCH_ID}:metrics`);
    expect(JSON.parse(value)).toMatchObject({
      orchestratorId: ORCH_ID,
      period: "minute",
      metrics,
    });
  });

  it("500s without leaking internals when persistence fails", async () => {
    mockStorage.upsertSetting!.mockRejectedValue(new Error("kaput"));
    const res = await metricsPOST(req(url, "POST", body, orchAuth));
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// GET /api/internal/servers/[serverId]
// ---------------------------------------------------------------------------

describe("GET /api/internal/servers/[serverId]", () => {
  const fx = loadFixture("servers-get");
  const url = "/api/internal/servers/7";
  const serverParams = { params: Promise.resolve({ serverId: "7" }) };
  const serverRow = () => ({
    id: 7,
    name: "sandbox-1",
    address: "203.0.113.10",
    port: 22,
    username: "deploy",
    online: true,
    shared: false,
    lastChecked: new Date(T0),
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  });

  it("401s / 403s on missing and garbage tokens", async () => {
    await expectContract(
      await serverGET(req(url, "GET"), serverParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await serverGET(
        req(url, "GET", undefined, { "x-job-capability": "cap.1.bad.sig" }),
        serverParams,
      ),
      fx.responses.forbidden!,
    );
  });

  it("403s when the token targets a different server or none at all", async () => {
    const otherServer = mintJobCapability(
      { jobId: JOB_ID, userId: USER_ID, serverId: "8" },
      nowSec(),
    );
    await expectContract(
      await serverGET(
        req(url, "GET", undefined, { "x-job-capability": otherServer }),
        serverParams,
      ),
      fx.responses.forbiddenScope!,
    );
    const noServer = mintJobCapability(
      { jobId: JOB_ID, userId: USER_ID },
      nowSec(),
    );
    await expectContract(
      await serverGET(
        req(url, "GET", undefined, { "x-job-capability": noServer }),
        serverParams,
      ),
      fx.responses.forbiddenScope!,
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("404s for an unknown server", async () => {
    mockDb.select!.mockReturnValue(dbChain([]));
    const res = await serverGET(
      req(url, "GET", undefined, capHeader()),
      serverParams,
    );
    await expectContract(res, fx.responses.notFound!);
  });

  it("returns connection details WITHOUT credentials (fixture: success)", async () => {
    mockDb.select!.mockReturnValue(dbChain([serverRow()]));
    const res = await serverGET(
      req(url, "GET", undefined, capHeader()),
      serverParams,
    );
    const json = (await expectContract(res, fx.responses.success!)) as {
      server: Record<string, unknown>;
    };
    // The selected column set must never include secrets.
    expect(json.server).not.toHaveProperty("password");
    expect(json.server).not.toHaveProperty("sshKey");
    expect(json.server).not.toHaveProperty("privateKey");
  });

  it("500s without leaking internals when the db fails", async () => {
    mockDb.select!.mockImplementation(() => {
      throw new Error("SELECT password FROM servers");
    });
    const res = await serverGET(
      req(url, "GET", undefined, capHeader()),
      serverParams,
    );
    await expectContract(res, fx.responses.serverError!);
  });
});

// ---------------------------------------------------------------------------
// GET+PUT /api/internal/variables/[userId]/[key]
// ---------------------------------------------------------------------------

describe("GET+PUT /api/internal/variables/[userId]/[key]", () => {
  const fx = loadFixture("variables");
  const url = `/api/internal/variables/${USER_ID}/MY_KEY`;
  const varParams = {
    params: Promise.resolve({ userId: USER_ID, key: "MY_KEY" }),
  };

  it("GET 401s / 403s on missing and garbage tokens", async () => {
    await expectContract(
      await variableGET(req(url, "GET"), varParams),
      fx.responses.unauthorized!,
    );
    await expectContract(
      await variableGET(
        req(url, "GET", undefined, { "x-job-capability": "junk" }),
        varParams,
      ),
      fx.responses.forbidden!,
    );
  });

  it("GET 403s when user A's token targets user B's variable", async () => {
    const userAToken = mintJobCapability(
      { jobId: JOB_ID, userId: "user-A" },
      nowSec(),
    );
    const res = await variableGET(
      req("/api/internal/variables/user-B/MY_KEY", "GET", undefined, {
        "x-job-capability": userAToken,
      }),
      { params: Promise.resolve({ userId: "user-B", key: "MY_KEY" }) },
    );
    await expectContract(res, fx.responses.forbiddenUserScope!);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("GET 404s for an unknown variable", async () => {
    mockDb.select!.mockReturnValue(dbChain([]));
    const res = await variableGET(
      req(url, "GET", undefined, capHeader()),
      varParams,
    );
    await expectContract(res, fx.responses.notFound!);
  });

  it("GET returns the decrypted value (fixture: getSuccess)", async () => {
    mockDb.select!.mockReturnValue(
      dbChain([{ key: "MY_KEY", value: "enc:hello", updatedAt: new Date(T0) }]),
    );
    const res = await variableGET(
      req(url, "GET", undefined, capHeader()),
      varParams,
    );
    await expectContract(res, fx.responses.getSuccess!);
    expect(mockDecrypt).toHaveBeenCalledWith("enc:hello", USER_ID, "MY_KEY");
  });

  it("PUT 401s / 403s on missing token and cross-user writes", async () => {
    await expectContract(
      await variablePUT(req(url, "PUT", { value: "x" }), varParams),
      fx.responses.unauthorized!,
    );
    const userAToken = mintJobCapability(
      { jobId: JOB_ID, userId: "user-A" },
      nowSec(),
    );
    const res = await variablePUT(
      req(
        "/api/internal/variables/user-B/MY_KEY",
        "PUT",
        { value: "x" },
        {
          "x-job-capability": userAToken,
        },
      ),
      { params: Promise.resolve({ userId: "user-B", key: "MY_KEY" }) },
    );
    await expectContract(res, fx.responses.forbiddenUserScope!);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("PUT upserts the encrypted value (fixture: putSuccess)", async () => {
    const insertChain = dbChain(undefined);
    mockDb.insert!.mockReturnValue(insertChain);
    const res = await variablePUT(
      req(url, "PUT", { value: "hello" }, capHeader()),
      varParams,
    );
    await expectContract(res, fx.responses.putSuccess!);

    expect(mockEncrypt).toHaveBeenCalledWith("hello", USER_ID, "MY_KEY");
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        key: "MY_KEY",
        value: "enc:hello", // encrypted at rest, never plaintext
      }),
    );
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ value: "enc:hello" }),
      }),
    );
  });

  it("GET/PUT 500 without leaking internals when the db fails", async () => {
    mockDb.select!.mockImplementation(() => {
      throw new Error("pg: relation user_variables");
    });
    await expectContract(
      await variableGET(req(url, "GET", undefined, capHeader()), varParams),
      fx.responses.serverError!,
    );
    mockDb.insert!.mockImplementation(() => {
      throw new Error("pg: insert failed");
    });
    await expectContract(
      await variablePUT(
        req(url, "PUT", { value: "v" }, capHeader()),
        varParams,
      ),
      fx.responses.serverError!,
    );
  });
});
