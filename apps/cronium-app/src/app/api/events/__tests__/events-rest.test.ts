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
    replaceEventEnvVars: jest.fn(),
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

    it("materializes the schedule only after the event, its env vars and servers exist", async () => {
      const order: string[] = [];
      s.createScript!.mockImplementation(() => {
        order.push("event");
        return Promise.resolve({ id: 1 });
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

      expect(order).toEqual(["event", "schedule"]);
      // In the same call, so a failure can't leave an event without them.
      expect(s.createScript!.mock.calls[0]![1]).toEqual({
        envVars: [{ key: "A", value: "1" }],
        serverIds: [3],
      });
    });

    it("answers 500 and schedules nothing when the event can't be created", async () => {
      const error = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      s.createScript!.mockRejectedValueOnce(new Error("insert failed"));

      const res = await post({
        ...baseEvent,
        scheduleNumber: 5,
        envVars: [{ key: "A", value: "1" }],
      });

      expect(res.status).toBe(500);
      expect(scheduler.updateScript).not.toHaveBeenCalled();
      error.mockRestore();
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

  describe("env vars", () => {
    const envVars = [{ key: "B", value: "2" }];

    it("replaces them in one call", async () => {
      const res = await patch({ name: "renamed", envVars });

      expect(res.status).toBe(200);
      expect(s.replaceEventEnvVars).toHaveBeenCalledTimes(1);
      expect(s.replaceEventEnvVars).toHaveBeenCalledWith(1, envVars);
    });

    it("clears them when given an empty list", async () => {
      await patch({ envVars: [] });
      expect(s.replaceEventEnvVars).toHaveBeenCalledWith(1, []);
    });

    it("leaves them alone when the body has none", async () => {
      await patch({ name: "renamed" });
      expect(s.replaceEventEnvVars).not.toHaveBeenCalled();
    });

    it("saves them with no other field, which an empty update would refuse", async () => {
      const res = await patch({ envVars });

      expect(res.status).toBe(200);
      expect(s.updateScript).not.toHaveBeenCalled();
      expect(s.replaceEventEnvVars).toHaveBeenCalledWith(1, envVars);
    });

    it("answers 500 and stops at a failed save, leaving servers and schedule alone", async () => {
      const error = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      s.replaceEventEnvVars!.mockRejectedValueOnce(new Error("save failed"));

      const res = await patch({
        status: "PAUSED",
        envVars,
        selectedServerIds: [3],
      });

      expect(res.status).toBe(500);
      expect(s.setEventServers).not.toHaveBeenCalled();
      expect(scheduler.updateScript).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  it("changes servers with no other field, which an empty update would refuse", async () => {
    const res = await patch({ selectedServerIds: [3] });

    expect(res.status).toBe(200);
    expect(s.updateScript).not.toHaveBeenCalled();
    expect(s.setEventServers).toHaveBeenCalledWith(1, [3], USER);
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
