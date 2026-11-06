/**
 * @jest-environment node
 *
 * POST /api/events/{id}/execute and POST /api/workflows/{id}/execute. The token
 * check and scope policy run for real over a fake token table; the access checks
 * and the enqueue are mocks. tests/storage/rest-execute.test.ts runs ownership and
 * the enqueue against real rows.
 */
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/server/storage", () => ({
  storage: {
    getApiTokenByToken: jest.fn(),
    updateApiToken: jest.fn(),
    getEventWithRelations: jest.fn(),
  },
}));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/server/security/authorization", () => ({
  ...jest.requireActual<typeof import("@/server/security/authorization")>(
    "@/server/security/authorization",
  ),
  getAuthorizedPrincipal: jest.fn(),
}));
jest.mock("@/server/security/resource-access", () => ({
  ...jest.requireActual<typeof import("@/server/security/resource-access")>(
    "@/server/security/resource-access",
  ),
  assertEventRelations: jest.fn(),
  assertWorkflowGraphCapability: jest.fn(),
}));
jest.mock("@/lib/scheduling/dispatch", () => ({
  dispatchEventJob: jest.fn(),
}));
jest.mock("@/lib/scheduling/workflow-engine", () => ({
  startWorkflowRun: jest.fn(),
}));
jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { tryCheckLimit: jest.fn() },
}));

import { NextRequest } from "next/server";
import { TRPCError } from "@trpc/server";
import { getServerSession } from "next-auth";
import { POST as executeEvent } from "../events/[id]/execute/route";
import { POST as executeWorkflow } from "../workflows/[id]/execute/route";
import { RateLimitService } from "@/lib/rate-limit-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { getAuthorizedPrincipal } from "@/server/security/authorization";
import {
  assertEventRelations,
  assertWorkflowGraphCapability,
} from "@/server/security/resource-access";
import { storage } from "@/server/storage";
import { TokenStatus, UserRole, UserStatus } from "@/shared/schema";

const USER = "user-1";
const s = storage as unknown as Record<string, jest.Mock>;
const mockDispatch = dispatchEventJob as jest.Mock;
const mockStartRun = startWorkflowRun as jest.Mock;
const mockSession = getServerSession as jest.Mock;
const mockPrincipal = getAuthorizedPrincipal as jest.Mock;
const mockLimit = RateLimitService.tryCheckLimit as jest.Mock;

const routes = [
  {
    resource: "Event",
    path: "events",
    POST: executeEvent,
    scopePath: "events.execute",
    assertAccess: assertEventRelations as jest.Mock,
    enqueue: mockDispatch,
  },
  {
    resource: "Workflow",
    path: "workflows",
    POST: executeWorkflow,
    scopePath: "workflows.execute",
    assertAccess: assertWorkflowGraphCapability as jest.Mock,
    enqueue: mockStartRun,
  },
];
type Route = (typeof routes)[number];

function call(
  route: Route,
  {
    id = "7",
    token = "a-token",
    body,
  }: { id?: string; token?: string | null; body?: string } = {},
) {
  return route.POST(
    new NextRequest(`http://localhost:5001/api/${route.path}/${id}/execute`, {
      method: "POST",
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      ...(body !== undefined && { body }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function tokenWithScopes(scopes: string[] | null) {
  s.getApiTokenByToken!.mockResolvedValue({
    id: 1,
    userId: USER,
    status: TokenStatus.ACTIVE,
    expiresAt: null,
    scopes,
  });
}

function silenceErrors() {
  return jest.spyOn(console, "error").mockImplementation(() => undefined);
}

beforeEach(() => {
  jest.resetAllMocks();
  tokenWithScopes(["full"]);
  mockSession.mockResolvedValue(null);
  mockPrincipal.mockResolvedValue({
    id: USER,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
  });
  mockLimit.mockResolvedValue({
    allowed: true,
    remaining: 49,
    resetAt: new Date(),
  });
  s.getEventWithRelations!.mockResolvedValue({ id: 7, userId: USER });
  mockDispatch.mockResolvedValue({ job: { id: "job_abc" }, logId: 101 });
  mockStartRun.mockResolvedValue({
    success: true,
    executionId: 55,
    status: "RUNNING",
  });
});

describe.each(routes)("POST /api/$path/{id}/execute", (route) => {
  describe("authentication and scope", () => {
    it("rejects a request with no credentials", async () => {
      const res = await call(route, { token: null });
      expect(res.status).toBe(401);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it("rejects an unknown token", async () => {
      s.getApiTokenByToken!.mockResolvedValue(undefined);
      const res = await call(route);
      expect(res.status).toBe(401);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    // A cross-site page can make a browser send the session cookie. It cannot
    // make it send a bearer token, so only tokens can start a run.
    it.each([
      ["with no token", null],
      ["alongside a token that does not check out", "bad-token"],
    ])("rejects a valid session cookie %s", async (_label, token) => {
      s.getApiTokenByToken!.mockResolvedValue(undefined);
      mockSession.mockResolvedValue({
        user: { id: USER, sessionVersion: 1 },
      });
      const res = await call(route, { token });
      expect(res.status).toBe(401);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ["full", ["full"], 202],
      ["mcp", ["mcp"], 202],
      ["no scopes", [], 403],
      ["a legacy token with no scope list", null, 403],
      ["a scope that does not exist", ["execute"], 403],
    ])(
      "given a token with %s, answers as the policy says",
      async (_l, scopes, status) => {
        tokenWithScopes(scopes);
        const res = await call(route);
        expect(res.status).toBe(status);
        expect(route.enqueue).toHaveBeenCalledTimes(status === 202 ? 1 : 0);
      },
    );

    it("refuses a read-only account even with a full token", async () => {
      mockPrincipal.mockResolvedValue({ id: USER, role: UserRole.VIEWER });
      const res = await call(route);
      expect(res.status).toBe(403);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it("refuses a disabled account", async () => {
      mockPrincipal.mockRejectedValue(new Error("Account is not active"));
      const res = await call(route);
      expect(res.status).toBe(401);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it("says nothing about the request before authenticating it", async () => {
      s.getApiTokenByToken!.mockResolvedValue(undefined);
      const res = await call(route, { id: "not-a-number", body: "{bad" });
      expect(res.status).toBe(401);
    });
  });

  describe("ownership", () => {
    it("checks execute access for the token's owner", async () => {
      await call(route);
      expect(route.assertAccess).toHaveBeenCalledWith(7, USER, "execute");
    });

    it("answers 403 and enqueues nothing when access is denied", async () => {
      route.assertAccess.mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN" }),
      );
      const res = await call(route);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Access denied" });
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it("answers 404 when it does not exist", async () => {
      route.assertAccess.mockRejectedValue(
        new TRPCError({ code: "NOT_FOUND" }),
      );
      const res = await call(route);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: `${route.resource} not found`,
      });
      expect(route.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("request parsing", () => {
    it.each(["abc", "0", "-1", "12abc", "1.5", "1e3", "2147483648"])(
      "rejects the id %s",
      async (id) => {
        const res = await call(route, { id });
        expect(res.status).toBe(400);
        expect(route.assertAccess).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["no body", undefined],
      ["an empty body", ""],
      ["whitespace", "  \n"],
      ["an empty object", "{}"],
    ])("runs with no input given %s", async (_label, body) => {
      const res = await call(route, { body });
      expect(res.status).toBe(202);
    });

    // The docs once advertised these, and a strict schema has to say so rather
    // than run the event without them.
    it.each([
      ["script", { script: "echo hi" }],
      ["schedule", { schedule: "0 9 * * MON" }],
      ["envVars", { envVars: { A: "1" } }],
      ["payload", { payload: {} }],
    ])("rejects the unsupported field %s", async (_label, body) => {
      const res = await call(route, { body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    it.each(['{"input":"x"}', '{"input":[1]}', '{"input":null}', "[]", "1"])(
      "rejects the body %s",
      async (body) => {
        const res = await call(route, { body });
        expect(res.status).toBe(400);
        expect(route.enqueue).not.toHaveBeenCalled();
      },
    );

    it("rejects a body that is not JSON", async () => {
      const res = await call(route, { body: "{not json" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Request body must be JSON" });
    });

    it("measures the size limit in bytes", async () => {
      // Under the limit in characters, over it in bytes.
      const body = JSON.stringify({ input: { a: "é".repeat(600_000) } });
      const res = await call(route, { body });
      expect(res.status).toBe(413);
      expect(route.enqueue).not.toHaveBeenCalled();
    });

    describe("reading the body", () => {
      const MAX_BODY_BYTES = 1024 * 1024;
      const encoder = new TextEncoder();

      /** A JSON body of exactly `bytes` bytes. */
      const jsonOfSize = (bytes: number) => {
        const shell = JSON.stringify({ input: { a: "" } });
        return JSON.stringify({
          input: { a: "x".repeat(bytes - shell.length) },
        });
      };

      /** A body sent in pieces, with no declared length, counting what's read. */
      function streamed(chunks: Iterable<Uint8Array>) {
        const source = chunks[Symbol.iterator]();
        const seen = { pulls: 0, cancelled: false };
        const stream = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              seen.pulls++;
              const next = source.next();
              if (next.done) controller.close();
              else controller.enqueue(next.value);
            },
            cancel() {
              seen.cancelled = true;
            },
          },
          { highWaterMark: 0 },
        );
        return { stream, seen };
      }

      const callStreamed = (
        target: Route,
        stream: ReadableStream<Uint8Array>,
        headers: Record<string, string> = {},
      ) =>
        target.POST(
          new NextRequest(
            `http://localhost:5001/api/${target.path}/7/execute`,
            {
              method: "POST",
              headers: { authorization: "Bearer a-token", ...headers },
              body: stream,
              duplex: "half",
            } as ConstructorParameters<typeof NextRequest>[1],
          ),
          { params: Promise.resolve({ id: "7" }) },
        );

      it("accepts a body of exactly the limit", async () => {
        const res = await call(route, { body: jsonOfSize(MAX_BODY_BYTES) });
        expect(res.status).toBe(202);
      });

      it("refuses a body one byte over the limit", async () => {
        const res = await call(route, { body: jsonOfSize(MAX_BODY_BYTES + 1) });
        expect(res.status).toBe(413);
        expect(route.enqueue).not.toHaveBeenCalled();
      });

      it("refuses a declared oversize body without reading any of it", async () => {
        const { stream, seen } = streamed([encoder.encode("{}")]);

        const res = await callStreamed(route, stream, {
          "content-length": String(MAX_BODY_BYTES + 1),
        });

        expect(res.status).toBe(413);
        expect(seen.pulls).toBe(0);
        expect(route.enqueue).not.toHaveBeenCalled();
      });

      it("stops reading an undeclared body as soon as it passes the limit", async () => {
        const chunkSize = 256 * 1024;
        // Bounded, so a regression fails the assertion below instead of running
        // the test process out of memory.
        function* farTooMuch() {
          for (let i = 0; i < 64; i++) yield new Uint8Array(chunkSize);
        }
        const { stream, seen } = streamed(farTooMuch());

        const res = await callStreamed(route, stream);

        expect(res.status).toBe(413);
        // Four chunks reach the limit exactly, and the fifth passes it.
        expect(seen.pulls).toBe(5);
        expect(seen.cancelled).toBe(true);
        expect(route.enqueue).not.toHaveBeenCalled();
      });

      it("does not trust a declared length that understates the body", async () => {
        function* tooMuch() {
          for (let i = 0; i < 5; i++) yield new Uint8Array(256 * 1024);
        }
        const { stream } = streamed(tooMuch());

        const res = await callStreamed(route, stream, {
          "content-length": "2",
        });

        expect(res.status).toBe(413);
      });

      it("rebuilds a character split across two chunks", async () => {
        const bytes = encoder.encode('{"input":{"a":"é"}}');
        const split = bytes.indexOf(0xc3) + 1; // inside the two bytes of é
        const { stream } = streamed([
          bytes.slice(0, split),
          bytes.slice(split),
        ]);

        const res = await callStreamed(route, stream);

        expect(res.status).toBe(202);
        expect(route.enqueue).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ input: { a: "é" } }),
        );
      });

      it("ignores a byte order mark, as request.text() does", async () => {
        const res = await call(route, {
          body: '\uFEFF{"input":{"a":"1"}}',
        });

        expect(res.status).toBe(202);
      });

      it("answers 500 if the connection fails partway through", async () => {
        const errors = silenceErrors();
        const stream = new ReadableStream<Uint8Array>(
          {
            pull() {
              throw new Error("connection reset");
            },
          },
          { highWaterMark: 0 },
        );

        const res = await callStreamed(route, stream);

        expect(res.status).toBe(500);
        expect(route.enqueue).not.toHaveBeenCalled();
        errors.mockRestore();
      });
    });
  });

  describe("rate limit", () => {
    it("checks the budget of the matching tRPC procedure", async () => {
      await call(route);
      expect(mockLimit).toHaveBeenCalledWith(USER, route.scopePath, {
        maxRequests: 50,
        windowMs: 60_000,
      });
    });

    it("answers 429 with Retry-After and enqueues nothing", async () => {
      mockLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: new Date("2030-01-01T00:00:00Z"),
      });
      const res = await call(route);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe(
        "Tue, 01 Jan 2030 00:00:00 GMT",
      );
      expect(route.assertAccess).not.toHaveBeenCalled();
      expect(route.enqueue).not.toHaveBeenCalled();
    });
  });

  it("hides the text of an unexpected error", async () => {
    const consoleError = silenceErrors();
    route.assertAccess.mockRejectedValue(new Error("connect ECONNREFUSED db"));
    const res = await call(route);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("ECONNREFUSED");
    consoleError.mockRestore();
  });
});

describe("POST /api/events/{id}/execute", () => {
  const [route] = routes as [Route, Route];

  it("queues through the single enqueue path and returns the ids to follow", async () => {
    const event = { id: 7, userId: USER };
    s.getEventWithRelations!.mockResolvedValue(event);

    const res = await call(route, {
      body: JSON.stringify({ input: { commit: "abc" } }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      success: true,
      logId: 101,
      jobId: "job_abc",
    });
    expect(mockDispatch).toHaveBeenCalledWith(event, {
      triggeredBy: "manual",
      input: { commit: "abc" },
      authorizedUserId: USER,
      actor: `user:${USER}`,
    });
  });

  it("answers 409 when the overlap policy skips the run", async () => {
    mockDispatch.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "overlap",
    });
    const res = await call(route);
    expect(res.status).toBe(409);
  });

  it("answers 409 with the reason when the event has no servers", async () => {
    mockDispatch.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "no_servers",
    });
    const res = await call(route);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error:
        "This event runs only on servers and has none. Choose a server, or set it to run locally.",
    });
  });

  it("answers 404 if the event vanished after the access check", async () => {
    s.getEventWithRelations!.mockResolvedValue(undefined);
    const res = await call(route);
    expect(res.status).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("answers 403 when the dispatch boundary refuses", async () => {
    mockDispatch.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    const res = await call(route);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/workflows/{id}/execute", () => {
  const [, route] = routes as [Route, Route];

  it("starts a manual run and returns its execution id", async () => {
    const res = await call(route, {
      body: JSON.stringify({ input: { commit: "abc" } }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      success: true,
      executionId: 55,
      status: "RUNNING",
    });
    expect(mockStartRun).toHaveBeenCalledWith(7, {
      userId: USER,
      triggerType: "MANUAL",
      input: { commit: "abc" },
    });
  });

  // tRPC reports these as a 200. CI needs a failing status, or `curl --fail`
  // passes on a run that never began.
  it("answers 409 with the reason when the graph cannot run", async () => {
    mockStartRun.mockResolvedValue({
      success: false,
      output: "Workflow has no nodes",
      notRunnable: true,
    });
    const res = await call(route);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Workflow has no nodes" });
  });

  it("answers 500 without the text when the engine fails unexpectedly", async () => {
    mockStartRun.mockResolvedValue({
      success: false,
      output: 'relation "workflow_step_runs" does not exist',
    });
    const res = await call(route);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to execute workflow" });
  });
});
