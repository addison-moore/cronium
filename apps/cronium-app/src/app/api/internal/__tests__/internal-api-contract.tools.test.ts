/**
 * @jest-environment node
 *
 * Contract tests for the script-facing tool-action route:
 *   POST /api/internal/tools/execute
 *
 * The runtime relays a script's cronium.toolAction() here with the job's
 * per-job capability token. Response shapes are pinned by
 * tests/fixtures/internal-api/tools-execute.json (shared with the Go relay
 * test). The heavy execution engine (executeToolAction) is mocked at the module
 * boundary — this suite pins the route's auth, tenant scoping, credential
 * resolution, and result mapping, not the engine's internals.
 */

jest.mock("@/lib/services/execution-service", () => ({
  executionService: { getExecution: jest.fn() },
}));
jest.mock("@/lib/services/job-service", () => ({
  jobService: { getJob: jest.fn() },
}));
jest.mock("@/server/storage", () => ({
  storage: { getEvent: jest.fn() },
}));
jest.mock("@/server/db", () => ({
  db: { select: jest.fn() },
}));
jest.mock("@/lib/scheduler/tool-action-executor", () => ({
  executeToolAction: jest.fn(),
}));

import { NextRequest } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import {
  mintJobCapability,
  __resetJobCapabilityKeyForTests,
} from "@/lib/security/job-capability";
import { POST as executePOST } from "@/app/api/internal/tools/execute/route";

const ENC_KEY =
  "6666666666666666666666666666666666666666666666666666666666666666";
const JOB_ID = "job-1";
const USER_ID = "user-1";
const EXEC_ID = "exec-job-1-123";

process.env.ENCRYPTION_KEY = ENC_KEY;

const nowSec = () => Math.floor(Date.now() / 1000);
const capToken = (over: { jobId?: string; userId?: string } = {}) =>
  mintJobCapability(
    { jobId: over.jobId ?? JOB_ID, userId: over.userId ?? USER_ID },
    nowSec(),
  );

const mockExec = executionService as unknown as Record<string, jest.Mock>;
const mockJob = jobService as unknown as Record<string, jest.Mock>;
const mockStorage = storage as unknown as Record<string, jest.Mock>;
const mockDb = db as unknown as Record<string, jest.Mock>;
const mockEngine = executeToolAction as jest.Mock;

/** Thenable Drizzle-style chain resolving to `result`. */
function dbChain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    c[m] = jest.fn().mockImplementation(() => c);
  }
  c.then = (onF?: (v: unknown) => unknown, onR?: (r: unknown) => unknown) =>
    Promise.resolve(result).then(onF, onR);
  return c as Record<string, jest.Mock> & PromiseLike<unknown>;
}

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://internal.test/api/internal/tools/execute", {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", ...headers },
  });
}

const cap = (token: string) => ({ "x-job-capability": token });
const goodBody = {
  executionId: EXEC_ID,
  userId: USER_ID,
  tool: "slack",
  action: "send_message",
  params: { channel: "#general", text: "hi" },
};

beforeAll(() => {
  __resetJobCapabilityKeyForTests();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  __resetJobCapabilityKeyForTests();
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExec.getExecution.mockResolvedValue({ id: EXEC_ID, jobId: JOB_ID });
  mockJob.getJob.mockResolvedValue({
    id: JOB_ID,
    userId: USER_ID,
    eventId: 42,
  });
  mockStorage.getEvent.mockResolvedValue({
    id: 42,
    userId: USER_ID,
    name: "runner",
    type: "BASH",
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
  });
  mockDb.select.mockReturnValue(dbChain([{ id: 7 }]));
  mockEngine.mockResolvedValue({
    stdout: "{}",
    stderr: "",
    exitCode: 0,
    data: { ts: "1700000000.000100" },
  });
});

describe("POST /api/internal/tools/execute", () => {
  it("401s without a capability token", async () => {
    const res = await executePOST(req(goodBody));
    expect(res.status).toBe(401);
    expect(mockEngine).not.toHaveBeenCalled();
  });

  it("403s when the capability is scoped to a different job", async () => {
    const res = await executePOST(
      req(goodBody, cap(capToken({ jobId: "job-other" }))),
    );
    expect(res.status).toBe(403);
    expect(mockEngine).not.toHaveBeenCalled();
  });

  it("400s on a malformed request (missing action)", async () => {
    const res = await executePOST(
      req({ executionId: EXEC_ID, tool: "slack" }, cap(capToken())),
    );
    expect(res.status).toBe(400);
    expect(mockEngine).not.toHaveBeenCalled();
  });

  it("404s when the user has no active connection of that type", async () => {
    mockDb.select.mockReturnValue(dbChain([]));
    const res = await executePOST(req(goodBody, cap(capToken())));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("slack");
    expect(mockEngine).not.toHaveBeenCalled();
  });

  it("resolves the tool by type, runs the engine, and returns the result data", async () => {
    const res = await executePOST(req(goodBody, cap(capToken())));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ts: "1700000000.000100" });

    // The engine ran against a synthesized event carrying the resolved toolId
    // and the requested action — with the OWNER from the capability.
    const [event, params] = mockEngine.mock.calls[0] as [
      { userId: string; toolActionConfig: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(event.userId).toBe(USER_ID);
    expect(event.toolActionConfig).toMatchObject({
      toolType: "slack",
      actionId: "send_message",
      toolId: 7,
    });
    expect(params).toEqual({ channel: "#general", text: "hi" });
  });

  it("derives the owner from the capability, not the body (no cross-tenant)", async () => {
    // A token for USER_ID; a body claiming someone else's id must not widen it.
    await executePOST(
      req({ ...goodBody, userId: "attacker" }, cap(capToken())),
    );
    // getJob returns userId USER_ID (matches cap); engine gets the cap owner.
    const [event] = mockEngine.mock.calls[0] as [{ userId: string }];
    expect(event.userId).toBe(USER_ID);
    // The tool lookup queried the cap owner's credentials, not "attacker".
    expect(mockStorage.getEvent).toHaveBeenCalled();
  });

  it("maps an action that ran-but-failed to success:false with the error", async () => {
    mockEngine.mockResolvedValue({
      stdout: "",
      stderr: "channel_not_found",
      exitCode: 1,
      data: null,
    });
    const res = await executePOST(req(goodBody, cap(capToken())));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("channel_not_found");
  });
});
