/**
 * @jest-environment node
 */

// Handler-level tests for /api/workflows/webhook/[key]. The key-hashing
// helper stays REAL (wrapped in a spy) so the tests prove the handler looks
// workflows up by SHA-256 hash, never by the plaintext bearer key. The db
// select and the workflow-engine trigger boundary are mocked.

jest.mock("@/server/db", () => {
  const state: {
    rows: unknown[];
    whereArgs: unknown[];
    error: Error | null;
  } = { rows: [], whereArgs: [], error: null };
  return {
    __state: state,
    db: {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn((condition: unknown) => {
            state.whereArgs.push(condition);
            return {
              limit: jest.fn(async () => {
                if (state.error) throw state.error;
                return state.rows;
              }),
            };
          }),
        })),
      })),
    },
  };
});

jest.mock("@/lib/scheduling/workflow-engine", () => ({
  startWorkflowRun: jest.fn(),
}));

jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { tryCheckLimit: jest.fn() },
}));

// The real module pulls nanoid (ESM-only) for key generation; the route only
// needs the hash, so the mock re-implements the identical SHA-256 hex hash
// (kept in lockstep with src/lib/workflow-webhook-key.ts) wrapped in a spy.
jest.mock("@/lib/workflow-webhook-key", () => {
  const { createHash } = jest.requireActual<typeof import("crypto")>("crypto");
  return {
    hashWorkflowWebhookKey: jest.fn((key: string) =>
      createHash("sha256").update(key).digest("hex"),
    ),
  };
});

import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST } from "../webhook/[key]/route";
import { hashWorkflowWebhookKey } from "@/lib/workflow-webhook-key";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { EventStatus, WorkflowTriggerType } from "@/shared/schema";

const dbMock = jest.requireMock("@/server/db") as {
  __state: { rows: unknown[]; whereArgs: unknown[]; error: Error | null };
};
const rateLimitMock = jest.requireMock("@/lib/rate-limit-service") as {
  RateLimitService: { tryCheckLimit: jest.Mock };
};
const startWorkflowRunMock = startWorkflowRun as jest.Mock;
const hashMock = hashWorkflowWebhookKey as jest.Mock;
const realHash = (key: string) =>
  crypto.createHash("sha256").update(key).digest("hex");

const KEY = "wfk_plaintext_bearer_key_123456";

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    userId: "owner-1",
    name: "My Workflow",
    status: EventStatus.ACTIVE,
    triggerType: WorkflowTriggerType.WEBHOOK,
    webhookKey: null,
    webhookKeyHash: realHash(KEY),
    ...overrides,
  };
}

function post(
  key: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new NextRequest(
    `http://localhost:5001/api/workflows/webhook/${key}`,
    { method: "POST", headers, ...(body !== undefined && { body }) },
  );
  return POST(request, { params: Promise.resolve({ key }) });
}

/** Walk an object graph (e.g. a drizzle SQL condition) looking for a value. */
function deepContains(
  value: unknown,
  needle: string,
  seen = new Set<object>(),
): boolean {
  if (typeof value === "string") return value === needle;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((v) => deepContains(v, needle, seen));
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeAll(() => {
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  dbMock.__state.rows = [];
  dbMock.__state.whereArgs.length = 0;
  dbMock.__state.error = null;
  rateLimitMock.RateLimitService.tryCheckLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    resetAt: new Date(Date.now() + 60_000),
  });
  startWorkflowRunMock.mockResolvedValue({ success: true, executionId: 900 });
});

describe("POST /api/workflows/webhook/[key] — lookup", () => {
  it("returns 404 for an unknown key and never starts a run", async () => {
    const res = await post(KEY, "{}");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      message: "No workflow found for this webhook key",
    });
    expect(startWorkflowRunMock).not.toHaveBeenCalled();
  });

  it("looks the workflow up by hash + WEBHOOK trigger type, not by the plaintext key", async () => {
    dbMock.__state.rows = [workflowRow()];
    await post(KEY, "{}");

    expect(hashMock).toHaveBeenCalledWith(KEY);
    const condition = dbMock.__state.whereArgs[0];
    // The SQL condition carries the SHA-256 hash and the trigger type...
    expect(deepContains(condition, realHash(KEY))).toBe(true);
    expect(deepContains(condition, WorkflowTriggerType.WEBHOOK)).toBe(true);
    // ...and never the plaintext bearer key.
    expect(deepContains(condition, KEY)).toBe(false);
  });

  it("returns 400 for an inactive workflow without starting a run", async () => {
    dbMock.__state.rows = [workflowRow({ status: EventStatus.PAUSED })];
    const res = await post(KEY, "{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      message: "This workflow is not active",
    });
    expect(startWorkflowRunMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the lookup throws", async () => {
    dbMock.__state.error = new Error("db down");
    const res = await post(KEY, "{}");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      message: "Failed to process webhook",
    });
  });
});

describe("POST /api/workflows/webhook/[key] — rate limiting", () => {
  it("returns 429 with Retry-After when the per-key limit is exhausted", async () => {
    const resetAt = new Date("2026-07-22T12:00:00Z");
    rateLimitMock.RateLimitService.tryCheckLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt,
    });
    const res = await post(KEY, "{}");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(resetAt.toUTCString());
    expect(rateLimitMock.RateLimitService.tryCheckLimit).toHaveBeenCalledWith(
      KEY,
      "workflow-webhook",
      {
        maxRequests: 60,
        windowMs: 60_000,
      },
    );
    expect(startWorkflowRunMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/workflows/webhook/[key] — trigger contract", () => {
  beforeEach(() => {
    dbMock.__state.rows = [workflowRow()];
  });

  it("starts the run with WEBHOOK trigger type and passes the JSON payload through", async () => {
    const payload = { orderId: 17, source: "shop" };
    const res = await post(KEY, JSON.stringify(payload), {
      "content-type": "application/json",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Webhook received and workflow execution started",
      workflowId: 42,
    });
    expect(startWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(startWorkflowRunMock).toHaveBeenCalledWith(42, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: payload,
    });
  });

  it("wraps a non-JSON body under a body key", async () => {
    await post(KEY, "plain text payload", { "content-type": "text/plain" });
    expect(startWorkflowRunMock).toHaveBeenCalledWith(42, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: { body: "plain text payload" },
    });
  });

  it("wraps a JSON array body under a body key", async () => {
    await post(KEY, JSON.stringify([1, 2, 3]), {
      "content-type": "application/json",
    });
    expect(startWorkflowRunMock).toHaveBeenCalledWith(42, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: { body: [1, 2, 3] },
    });
  });

  it("uses an empty input when the body is empty", async () => {
    await post(KEY);
    expect(startWorkflowRunMock).toHaveBeenCalledWith(42, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: {},
    });
  });

  it("treats an unreadable body as empty input", async () => {
    const request = new NextRequest(
      `http://localhost:5001/api/workflows/webhook/${KEY}`,
      { method: "POST" },
    );
    Object.defineProperty(request, "text", {
      value: () => Promise.reject(new Error("stream broke")),
    });
    const res = await POST(request, { params: Promise.resolve({ key: KEY }) });
    expect(res.status).toBe(200);
    expect(startWorkflowRunMock).toHaveBeenCalledWith(42, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: {},
    });
  });

  it("responds 200 even when the async run start later fails (fire-and-forget)", async () => {
    startWorkflowRunMock.mockRejectedValue(new Error("engine down"));
    const res = await post(KEY, "{}");
    expect(res.status).toBe(200);
    await flush(); // the rejection is caught by the handler's .catch
  });

  it("logs the non-success engine result branch without changing the response", async () => {
    startWorkflowRunMock.mockResolvedValue({
      success: false,
      output: "no nodes",
    });
    const res = await post(KEY, "{}");
    expect(res.status).toBe(200);
    await flush();
  });

  it("never logs the plaintext bearer key (regression for credential leak)", async () => {
    await post(KEY, "{}");
    await flush();
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .filter((arg): arg is string => typeof arg === "string");
    expect(logged.some((line) => line.includes(KEY))).toBe(false);
  });
});

describe("POST /api/workflows/webhook/[key] — payload size cap", () => {
  beforeEach(() => {
    dbMock.__state.rows = [workflowRow()];
  });

  it("rejects a body over 1 MB with 413", async () => {
    const res = await post(KEY, "a".repeat(1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      success: false,
      message: "Payload too large (max 1 MB)",
    });
    expect(startWorkflowRunMock).not.toHaveBeenCalled();
  });

  it("measures the cap in bytes, not characters (multi-byte regression)", async () => {
    // 600k "é" = 600k chars (< 1 Mi chars) but 1.2 MB of UTF-8.
    const res = await post(KEY, "é".repeat(600_000));
    expect(res.status).toBe(413);
    expect(startWorkflowRunMock).not.toHaveBeenCalled();
  });
});
