/**
 * @jest-environment node
 *
 * The legacy REST event routes: secrets stay out of the logs, what the schema
 * accepts is what gets stored, and a schedule set here actually runs.
 */
jest.mock("@/lib/api-auth", () => ({
  authenticateRestPrincipal: jest.fn(),
  restPrincipalErrorResponse: jest.fn(),
}));
jest.mock("@/server/storage", () => ({
  storage: {
    createScript: jest.fn(),
    updateScript: jest.fn(),
    createEnvVar: jest.fn(),
    deleteEnvVarsByEventId: jest.fn(),
    setEventServers: jest.fn(),
    getEvent: jest.fn(),
    getEventWithRelations: jest.fn(),
    getAllEvents: jest.fn(),
    deleteScript: jest.fn(),
  },
}));
jest.mock("@/lib/scheduler", () => ({
  scheduler: { updateScript: jest.fn() },
}));
jest.mock("@/lib/scheduling/materialize", () => ({
  touchesEventSchedule: jest.requireActual<
    typeof import("@/lib/scheduling/materialize")
  >("@/lib/scheduling/materialize").touchesEventSchedule,
}));
jest.mock("@/server/security/resource-access", () => ({
  assertProposedEventServers: jest.fn(),
  assertEventCapability: jest.fn(),
  assertEventRelations: jest.fn(),
  resourceAccessHttpStatus: jest.fn(),
}));
// The materialize mock's requireActual would otherwise reach the real database.
jest.mock("@/server/db", () => ({ db: {} }));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { PATCH, GET as GET_ONE } from "../[id]/route";
import { authenticateRestPrincipal } from "@/lib/api-auth";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import { resourceAccessHttpStatus } from "@/server/security/resource-access";
import { TRPCError } from "@trpc/server";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
} from "@/shared/request-limits";

const s = storage as unknown as Record<string, jest.Mock>;
const USER = "user-1";

const baseEvent = {
  name: "nightly",
  type: "BASH",
  content: "echo hi",
  status: "ACTIVE",
  scheduleUnit: "MINUTES",
  runLocation: "LOCAL",
  timeoutValue: 30,
  timeoutUnit: "SECONDS",
  retries: 0,
};

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:5001/api/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost:5001/api/events/1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "1" }) },
  );

const created = () =>
  s.createScript!.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRestPrincipal as jest.Mock).mockResolvedValue({
    ok: true,
    userId: USER,
    role: "USER",
    scopes: null,
  });
  s.createScript!.mockResolvedValue({ id: 1 });
  s.getEvent!.mockResolvedValue({ id: 1, userId: USER });
  s.getEventWithRelations!.mockResolvedValue({
    id: 1,
    userId: USER,
    envVars: [],
    servers: [],
  });
});

describe("POST /api/events", () => {
  it("does not write env var values or request headers to the logs", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await post({
      ...baseEvent,
      type: "HTTP_REQUEST",
      httpMethod: "GET",
      httpUrl: "https://api.example.test/",
      httpHeaders: [{ key: "Authorization", value: "Bearer HEADER-SENTINEL" }],
      envVars: [{ key: "API_KEY", value: "ENV-SENTINEL" }],
    });

    const logged = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("HEADER-SENTINEL");
    expect(logged).not.toContain("ENV-SENTINEL");
    log.mockRestore();
    error.mockRestore();
  });

  it("stores the description, sharing flag and tags it validated", async () => {
    await post({
      ...baseEvent,
      description: "does things",
      shared: true,
      tags: ["a", "b"],
    });
    expect(created()).toMatchObject({
      description: "does things",
      shared: true,
      tags: ["a", "b"],
    });
  });

  it("stores HTTP headers as an array, which is what the executor reads", async () => {
    await post({
      ...baseEvent,
      type: "HTTP_REQUEST",
      httpMethod: "GET",
      httpUrl: "https://api.example.test/",
      httpHeaders: [{ key: "X-Thing", value: "1" }],
    });
    expect(created().httpHeaders).toEqual([{ key: "X-Thing", value: "1" }]);
  });

  it("accepts the legacy httpRequest JSON form", async () => {
    const res = await post({
      ...baseEvent,
      type: "HTTP_REQUEST",
      httpRequest: JSON.stringify({
        method: "POST",
        url: "https://api.example.test/",
        headers: [{ key: "X-Thing", value: "1" }],
        body: "{}",
      }),
    });
    expect(res.status).toBe(201);
    expect(created()).toMatchObject({
      httpMethod: "POST",
      httpUrl: "https://api.example.test/",
      httpBody: "{}",
      httpHeaders: [{ key: "X-Thing", value: "1" }],
    });
  });

  describe("scheduling", () => {
    it.each([
      ["an interval", { scheduleNumber: 5 }],
      ["a cron expression", { customSchedule: "0 9 * * MON" }],
    ])("treats an event given %s as scheduled", async (_label, schedule) => {
      await post({ ...baseEvent, ...schedule });
      expect(created().triggerType).toBe("SCHEDULE");
    });

    it("leaves an event with no schedule manual", async () => {
      await post(baseEvent);
      expect(created().triggerType).toBe("MANUAL");
    });

    it("honors an explicit trigger type", async () => {
      await post({ ...baseEvent, scheduleNumber: 5, triggerType: "MANUAL" });
      expect(created().triggerType).toBe("MANUAL");
    });

    it("materializes the schedule only after env vars and servers exist", async () => {
      const order: string[] = [];
      s.createEnvVar!.mockImplementation(() => {
        order.push("env");
        return Promise.resolve({});
      });
      s.setEventServers!.mockImplementation(() => {
        order.push("servers");
        return Promise.resolve();
      });
      (scheduler.updateScript as jest.Mock).mockImplementation(() => {
        order.push("schedule");
        return Promise.resolve();
      });

      await post({
        ...baseEvent,
        scheduleNumber: 5,
        envVars: [{ key: "A", value: "1" }],
        selectedServerIds: [3],
      });

      expect(order).toEqual(["env", "servers", "schedule"]);
    });

    it.each([
      [
        "a sub-10-second interval",
        { scheduleNumber: 5, scheduleUnit: "SECONDS" },
      ],
      ["an invalid cron expression", { customSchedule: "not a cron" }],
    ])("rejects %s", async (_label, schedule) => {
      const res = await post({ ...baseEvent, ...schedule });
      expect(res.status).toBe(400);
      expect(s.createScript).not.toHaveBeenCalled();
    });
  });

  it("says access denied, not internal server error, for a forbidden server", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { assertProposedEventServers } = jest.requireMock(
      "@/server/security/resource-access",
    ) as { assertProposedEventServers: jest.Mock };
    assertProposedEventServers.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );
    (resourceAccessHttpStatus as jest.Mock).mockReturnValueOnce(403);

    const res = await post({ ...baseEvent, serverId: 9 });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Access denied" });
    consoleError.mockRestore();
  });
});

describe("PATCH /api/events/[id]", () => {
  it("re-materializes when a schedule field changes", async () => {
    await patch({ status: "PAUSED" });
    expect(scheduler.updateScript).toHaveBeenCalledWith(1);
  });

  it("does not re-anchor the schedule for an unrelated edit", async () => {
    await patch({ name: "renamed" });
    expect(scheduler.updateScript).not.toHaveBeenCalled();
  });
});

describe("env var values over REST", () => {
  const withEnv = {
    id: 1,
    userId: USER,
    servers: [],
    envVars: [{ key: "TOKEN", value: "plain-in-this-test" }],
  };
  const get = () =>
    GET_ONE(new NextRequest("http://localhost:5001/api/events/1"), {
      params: Promise.resolve({ id: "1" }),
    });

  it("returns values to a cookie session", async () => {
    s.getEventWithRelations!.mockResolvedValue(withEnv);
    const body = (await (await get()).json()) as {
      envVars: Array<{ value: string }>;
    };
    expect(body.envVars[0]!.value).toBe("plain-in-this-test");
  });

  it("returns only keys to a token below full", async () => {
    s.getEventWithRelations!.mockResolvedValue(withEnv);
    (authenticateRestPrincipal as jest.Mock).mockResolvedValue({
      ok: true,
      userId: USER,
      role: "USER",
      scopes: ["mcp"],
    });
    const body = (await (await get()).json()) as {
      envVars: Array<{ key: string; value: string }>;
    };
    expect(body.envVars).toEqual([{ key: "TOKEN", value: "" }]);
  });
});

describe("a save past what one request can carry", () => {
  /** A JSON body of exactly `bytes` bytes, with the event's script making up the room. */
  const eventOfSize = (bytes: number, fields: object) => {
    const shell = JSON.stringify({ ...fields, content: "" }).length;
    return JSON.stringify({ ...fields, content: "x".repeat(bytes - shell) });
  };
  const OVER = MAX_REQUEST_BODY_BYTES + 1;

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

  type Body = string | ReadableStream<Uint8Array>;
  const sendPost = (body: Body, headers: Record<string, string> = {}) =>
    POST(
      new NextRequest("http://localhost:5001/api/events", {
        method: "POST",
        headers,
        body,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
    );
  const sendPatch = (body: Body, headers: Record<string, string> = {}) =>
    PATCH(
      new NextRequest("http://localhost:5001/api/events/1", {
        method: "PATCH",
        headers,
        body,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
      { params: Promise.resolve({ id: "1" }) },
    );

  describe.each([
    ["POST", sendPost, baseEvent, "createScript"],
    ["PATCH", sendPatch, {}, "updateScript"],
  ] as const)("%s", (_method, send, fields, writes) => {
    it("saves a body of exactly the limit", async () => {
      const res = await send(eventOfSize(MAX_REQUEST_BODY_BYTES, fields));

      expect(res.status).toBeLessThan(300);
      expect(s[writes]).toHaveBeenCalledTimes(1);
    });

    it("refuses a body one byte over, says why, and saves nothing", async () => {
      const res = await send(eventOfSize(OVER, fields));

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: EVENT_TOO_LONG_MESSAGE });
      expect(s[writes]).not.toHaveBeenCalled();
    });

    it("refuses a declared oversize body without reading any of it", async () => {
      const { stream, seen } = streamed([new TextEncoder().encode("{}")]);

      const res = await send(stream, {
        "content-length": String(OVER),
      });

      expect(res.status).toBe(413);
      expect(seen.pulls).toBe(0);
      expect(s[writes]).not.toHaveBeenCalled();
    });

    it("stops reading an undeclared body as soon as it passes the limit", async () => {
      const chunkSize = 2 * 1024 * 1024;
      // Bounded, so a regression fails the assertion below instead of running the test
      // process out of memory.
      function* farTooMuch() {
        for (let i = 0; i < 64; i++) yield new Uint8Array(chunkSize);
      }
      const { stream, seen } = streamed(farTooMuch());

      const res = await send(stream);

      expect(res.status).toBe(413);
      // Five chunks reach the limit exactly, and the sixth passes it.
      expect(seen.pulls).toBe(6);
      expect(seen.cancelled).toBe(true);
      expect(s[writes]).not.toHaveBeenCalled();
    });

    it("counts what's sent, so a script's line breaks count twice", async () => {
      // 6 MB of script, under the limit, and 12 MB of JSON, over it.
      const content = `echo hi${"\n".repeat(6 * 1024 * 1024)}`;

      const res = await send(JSON.stringify({ ...fields, content }));

      expect(res.status).toBe(413);
      expect(s[writes]).not.toHaveBeenCalled();
    });

    it("answers 400, not 500, to a body that isn't JSON", async () => {
      const res = await send('{"name":"e","content":"xxxxxxx');

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object under 10 MB",
      });
      expect(s[writes]).not.toHaveBeenCalled();
    });
  });

  it("POST checks who's asking before the body", async () => {
    (authenticateRestPrincipal as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
    });
    const { restPrincipalErrorResponse } =
      jest.requireMock<typeof import("@/lib/api-auth")>("@/lib/api-auth");
    (restPrincipalErrorResponse as jest.Mock).mockReturnValue(
      new Response(null, { status: 401 }),
    );

    const res = await sendPost(eventOfSize(OVER, baseEvent));

    expect(res.status).toBe(401);
  });

  it("PATCH checks the event exists before the body", async () => {
    s.getEvent!.mockResolvedValue(undefined);

    const res = await sendPatch(eventOfSize(OVER, {}));

    expect(res.status).toBe(404);
  });
});
