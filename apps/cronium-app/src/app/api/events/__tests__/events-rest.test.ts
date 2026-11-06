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

describe("env vars too long to deliver", () => {
  const tooLong = {
    envVars: [{ key: "TOKEN", value: "x".repeat(128_001) }],
  };

  it("POST answers 400 with the reason, and creates nothing", async () => {
    const res = await post({ ...baseEvent, ...tooLong });

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("at most 128 KB");
    expect(s.createScript).not.toHaveBeenCalled();
    expect(s.createEnvVar).not.toHaveBeenCalled();
  });

  it("PATCH answers 400 with the reason, and leaves the variables alone", async () => {
    const res = await patch(tooLong);

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("at most 128 KB");
    expect(s.deleteEnvVarsByEventId).not.toHaveBeenCalled();
    expect(s.createEnvVar).not.toHaveBeenCalled();
  });

  // What a body over the proxy's 10 MB cap looks like by the time it arrives.
  const cutOff = '{"name":"e","envVars":[{"key":"K","value":"xxxxxxx';

  it.each([
    [
      "POST",
      () =>
        POST(
          new NextRequest("http://localhost:5001/api/events", {
            method: "POST",
            body: cutOff,
          }),
        ),
    ],
    [
      "PATCH",
      () =>
        PATCH(
          new NextRequest("http://localhost:5001/api/events/1", {
            method: "PATCH",
            body: cutOff,
          }),
          { params: Promise.resolve({ id: "1" }) },
        ),
    ],
  ])(
    "%s answers 400, not 500, to a body cut off at the cap",
    async (_method, send) => {
      const res = await send();

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object under 10 MB",
      });
      expect(s.deleteEnvVarsByEventId).not.toHaveBeenCalled();
    },
  );

  it("both accept a value too long for the old column", async () => {
    const long = { envVars: [{ key: "TOKEN", value: "x".repeat(4_096) }] };

    expect((await post({ ...baseEvent, ...long })).status).toBe(201);
    expect((await patch(long)).status).toBe(200);
    expect(s.createEnvVar).toHaveBeenCalledTimes(2);
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
