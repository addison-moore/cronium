/** @jest-environment node */
/**
 * Behavioral tests for the REAL events router (src/server/api/routers/events.ts)
 * running through the REAL protectedProcedure middleware chain and the REAL
 * resource-access/api-dto security layers. Only the process boundaries are
 * mocked: the database driver, the storage monolith, the scheduler facade,
 * the payload service, and the dispatch enqueue path.
 */

type Row = Record<string, unknown>;

const dbState: {
  users: Row[];
  events: Row[];
  servers: Row[];
  eventServers: Row[];
  incidents: Row[];
  error: Error | null;
} = {
  users: [],
  events: [],
  servers: [],
  eventServers: [],
  incidents: [],
  error: null,
};

jest.mock("@/server/db", () => {
  const tableNameOf = (table: unknown): string | null => {
    if (table && typeof table === "object") {
      const name = (table as Record<symbol, unknown>)[
        Symbol.for("drizzle:Name")
      ];
      if (typeof name === "string") return name;
    }
    return null;
  };

  const rowsFor = (table: unknown): Row[] => {
    switch (tableNameOf(table)) {
      case "users":
        return dbState.users;
      case "events":
        return dbState.events;
      case "servers":
        return dbState.servers;
      case "event_servers":
        return dbState.eventServers;
      case "schedule_incidents":
        return dbState.incidents;
      default:
        return [];
    }
  };

  interface QueryBuilder extends PromiseLike<Row[]> {
    from: (table: unknown) => QueryBuilder;
    where: (...args: unknown[]) => QueryBuilder;
    orderBy: (...args: unknown[]) => QueryBuilder;
    limit: (...args: unknown[]) => QueryBuilder;
  }

  const makeQuery = (): QueryBuilder => {
    let table: unknown = null;
    const builder: QueryBuilder = {
      from(t: unknown) {
        table = t;
        return builder;
      },
      where() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled, onRejected) {
        const promise = dbState.error
          ? Promise.reject(dbState.error)
          : Promise.resolve(rowsFor(table));
        return promise.then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const db = {
    select: jest.fn(() => makeQuery()),
    transaction: jest.fn(async (fn: (trx: unknown) => Promise<unknown>) =>
      fn(db),
    ),
  };
  return { db };
});

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

jest.mock("@/server/storage", () => ({
  storage: {
    queryEvents: jest.fn(),
    getEventWithRelations: jest.fn(),
    createScript: jest.fn(),
    updateScript: jest.fn(),
    deleteScript: jest.fn(),
    createEnvVar: jest.fn(),
    deleteEnvVarsByEventId: jest.fn(),
    setEventServers: jest.fn(),
    getLogsByEventId: jest.fn(),
    getWorkflowsUsingEvent: jest.fn(),
    getAllEvents: jest.fn(),
  },
}));

jest.mock("@/lib/scheduler", () => ({
  scheduler: {
    updateScript: jest.fn(),
    deleteScript: jest.fn(),
    scheduleScript: jest.fn(),
  },
}));

jest.mock("@/lib/services/payload-service", () => ({
  payloadService: {
    removeOldPayloads: jest.fn(),
    cleanupEventPayloads: jest.fn(),
  },
}));

jest.mock("@/lib/scheduling/dispatch", () => ({
  dispatchEventJob: jest.fn(),
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { eventsRouter } from "@/server/api/routers/events";
import {
  EventStatus,
  EventTriggerType,
  EventType,
  RunLocation,
  TimeUnit,
  UserRole,
  UserStatus,
} from "@/shared/schema";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import { payloadService } from "@/lib/services/payload-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";

// The route-capability inventory is keyed by "events.<procedure>", so the
// router must be mounted under "events" exactly as in root.ts.
const rootRouter = createTRPCRouter({ events: eventsRouter });
const createCaller = createCallerFactory(rootRouter);

const storageMock = storage as unknown as {
  queryEvents: jest.Mock;
  getEventWithRelations: jest.Mock;
  createScript: jest.Mock;
  updateScript: jest.Mock;
  deleteScript: jest.Mock;
  createEnvVar: jest.Mock;
  deleteEnvVarsByEventId: jest.Mock;
  setEventServers: jest.Mock;
  getLogsByEventId: jest.Mock;
  getWorkflowsUsingEvent: jest.Mock;
  getAllEvents: jest.Mock;
};
const schedulerMock = scheduler as unknown as {
  updateScript: jest.Mock;
  deleteScript: jest.Mock;
  scheduleScript: jest.Mock;
};
const payloadMock = payloadService as unknown as {
  removeOldPayloads: jest.Mock;
  cleanupEventPayloads: jest.Mock;
};
const dispatchMock = dispatchEventJob as unknown as jest.Mock;

const OWNER = "user-1";
const OTHER = "user-2";

function activeUserRow(overrides: Row = {}): Row {
  return {
    id: OWNER,
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mfaEnabled: false,
    ...overrides,
  };
}

function sessionFor(overrides: Row = {}): Session {
  return {
    user: {
      id: OWNER,
      email: "user@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerWith(
  session: Session | null,
  requestSource: string | null = null,
) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource,
  });
}

/** Minimal projection read by assertEventCapability/assertEventRelations. */
function eventAccessRow(overrides: Row = {}): Row {
  return { id: 1, userId: OWNER, shared: false, serverId: null, ...overrides };
}

/** Full relations shape consumed by toEventApiDto and the fork flow. */
function eventWithRelations(overrides: Row = {}): Row {
  return {
    id: 1,
    name: "Test Event",
    description: null,
    type: EventType.BASH,
    content: "echo hi",
    status: EventStatus.DRAFT,
    shared: false,
    tags: [],
    httpMethod: null,
    httpUrl: null,
    httpHeaders: [],
    httpBody: null,
    toolActionConfig: null,
    triggerType: EventTriggerType.MANUAL,
    scheduleNumber: null,
    scheduleUnit: null,
    customSchedule: null,
    startTime: null,
    runLocation: RunLocation.LOCAL,
    serverId: null,
    timeoutValue: 30,
    timeoutUnit: TimeUnit.MINUTES,
    retries: 0,
    userId: OWNER,
    executionCount: 0,
    envVars: [],
    servers: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dbState.error = null;
  dbState.users = [activeUserRow()];
  dbState.events = [eventAccessRow()];
  dbState.servers = [];
  dbState.eventServers = [];
  dbState.incidents = [];

  storageMock.queryEvents.mockResolvedValue({
    items: [],
    total: 0,
    hasMore: false,
  });
  storageMock.getEventWithRelations.mockResolvedValue(eventWithRelations());
  storageMock.createScript.mockResolvedValue({
    id: 5,
    name: "New Event",
    type: EventType.BASH,
  });
  storageMock.updateScript.mockResolvedValue(undefined);
  storageMock.deleteScript.mockResolvedValue(undefined);
  storageMock.createEnvVar.mockResolvedValue({ id: 1 });
  storageMock.deleteEnvVarsByEventId.mockResolvedValue(undefined);
  storageMock.setEventServers.mockResolvedValue(undefined);
  storageMock.getLogsByEventId.mockResolvedValue({ logs: [], total: 0 });
  storageMock.getWorkflowsUsingEvent.mockResolvedValue([]);
  storageMock.getAllEvents.mockResolvedValue([]);

  schedulerMock.updateScript.mockResolvedValue(undefined);
  schedulerMock.deleteScript.mockResolvedValue(undefined);
  schedulerMock.scheduleScript.mockResolvedValue(undefined);
  payloadMock.removeOldPayloads.mockResolvedValue(undefined);
  payloadMock.cleanupEventPayloads.mockResolvedValue(undefined);
  dispatchMock.mockResolvedValue({ job: { id: 42 }, logId: 7 });
});

describe("authentication and role gates", () => {
  it("rejects unauthenticated callers on queries and mutations", async () => {
    const caller = callerWith(null);
    await expect(caller.events.getAll({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.events.delete({ id: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows a Viewer to run queries", async () => {
    dbState.users = [activeUserRow({ role: UserRole.VIEWER, roleId: 3 })];
    const caller = callerWith(sessionFor({ role: UserRole.VIEWER }));
    await expect(caller.events.getAll({})).resolves.toEqual({
      events: [],
      total: 0,
      hasMore: false,
    });
  });

  it("denies a Viewer every state-changing mutation", async () => {
    dbState.users = [activeUserRow({ role: UserRole.VIEWER, roleId: 3 })];
    const caller = callerWith(sessionFor({ role: UserRole.VIEWER }));

    const mutations: Array<[string, () => Promise<unknown>]> = [
      [
        "create",
        () =>
          caller.events.create({
            name: "E",
            type: EventType.BASH,
            content: "echo hi",
          }),
      ],
      ["update", () => caller.events.update({ id: 1, name: "renamed" })],
      ["delete", () => caller.events.delete({ id: 1 })],
      ["activate", () => caller.events.activate({ id: 1 })],
      ["deactivate", () => caller.events.deactivate({ id: 1 })],
      ["execute", () => caller.events.execute({ id: 1 })],
      ["resetCounter", () => caller.events.resetCounter({ id: 1 })],
      ["fork", () => caller.events.fork({ id: 1 })],
    ];

    for (const [name, run] of mutations) {
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      void name;
    }
    expect(storageMock.createScript).not.toHaveBeenCalled();
    expect(storageMock.updateScript).not.toHaveBeenCalled();
    expect(storageMock.deleteScript).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("allows a Viewer to download (declared 'view' capability)", async () => {
    dbState.users = [activeUserRow({ role: UserRole.VIEWER, roleId: 3 })];
    storageMock.getAllEvents.mockResolvedValue([{ id: 1 }]);
    const caller = callerWith(sessionFor({ role: UserRole.VIEWER }));
    await expect(
      caller.events.download({ eventIds: [1] }),
    ).resolves.toMatchObject({ format: "json" });
  });
});

describe("getAll", () => {
  it("returns events with per-viewer redaction applied", async () => {
    storageMock.queryEvents.mockResolvedValue({
      items: [
        eventWithRelations({ id: 1, httpUrl: "https://mine.example" }),
        eventWithRelations({
          id: 2,
          userId: OTHER,
          shared: true,
          httpUrl: "https://theirs.example/secret",
          serverId: 9,
        }),
      ],
      total: 2,
      hasMore: false,
    });
    const caller = callerWith(sessionFor());
    const result = await caller.events.getAll({ limit: 20, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.events[0]).toMatchObject({
      id: 1,
      httpUrl: "https://mine.example",
      secretFieldsRedacted: false,
    });
    // The shared event from another owner is a sanitized template.
    expect(result.events[1]).toMatchObject({
      id: 2,
      httpUrl: null,
      serverId: null,
      secretFieldsRedacted: true,
    });
  });

  it("forwards pagination and falsy filter values (shared: false) to storage", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.getAll({ limit: 5, offset: 10, shared: false });
    expect(storageMock.queryEvents).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ limit: 5, offset: 10, shared: false }),
    );
  });

  it("rejects invalid pagination input", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.getAll({ limit: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.queryEvents.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.getAll({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("getById", () => {
  it("returns the full DTO for the owner", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(
      eventWithRelations({
        envVars: [{ key: "TOKEN", value: "s3cret" }],
        httpUrl: "https://mine.example",
      }),
    );
    const caller = callerWith(sessionFor());
    const result = await caller.events.getById({ id: 1 });
    expect(result).toMatchObject({
      id: 1,
      httpUrl: "https://mine.example",
      secretFieldsRedacted: false,
    });
    expect(result.envVars).toEqual([{ key: "TOKEN", value: "s3cret" }]);
  });

  it("returns a redacted template for a shared event owned by someone else", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    storageMock.getEventWithRelations.mockResolvedValue(
      eventWithRelations({
        userId: OTHER,
        shared: true,
        httpUrl: "https://theirs.example/hook?key=abc",
        httpBody: "secret-body",
        envVars: [{ key: "TOKEN", value: "s3cret" }],
        serverId: 9,
      }),
    );
    const caller = callerWith(sessionFor());
    const result = await caller.events.getById({ id: 1 });
    expect(result).toMatchObject({
      httpUrl: null,
      httpBody: null,
      serverId: null,
      secretFieldsRedacted: true,
    });
    expect(result.envVars).toEqual([]);
  });

  it("denies reading another user's unshared event", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: false })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.getById({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(storageMock.getEventWithRelations).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the event does not exist", async () => {
    dbState.events = [];
    const caller = callerWith(sessionFor());
    await expect(caller.events.getById({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns NOT_FOUND when relations vanish between check and load", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(undefined);
    const caller = callerWith(sessionFor());
    await expect(caller.events.getById({ id: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a non-positive id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.getById({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      storageMock.getEventWithRelations.mockRejectedValue(new Error("db down"));
      const caller = callerWith(sessionFor());
      await expect(caller.events.getById({ id: 1 })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("create", () => {
  it("creates a local event, materializes its schedule, and stores env vars", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(
      eventWithRelations({ id: 5, name: "New Event" }),
    );
    const caller = callerWith(sessionFor());
    const result = await caller.events.create({
      name: "New Event",
      type: EventType.BASH,
      content: "echo hi",
      envVars: [{ key: "A", value: "1" }],
    });

    expect(storageMock.createScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Event",
        userId: OWNER,
        source: null,
        startTime: null,
      }),
    );
    // Schedule materialization boundary: always invoked with the new id so an
    // event created directly as ACTIVE+SCHEDULE starts firing.
    expect(schedulerMock.updateScript).toHaveBeenCalledWith(5);
    expect(storageMock.createEnvVar).toHaveBeenCalledWith({
      eventId: 5,
      key: "A",
      value: "1",
    });
    expect(storageMock.setEventServers).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 5, secretFieldsRedacted: false });
  });

  it("associates selected servers for remote execution", async () => {
    dbState.servers = [
      { id: 7, userId: OWNER, shared: false, isArchived: false },
    ];
    const caller = callerWith(sessionFor());
    await caller.events.create({
      name: "Remote Event",
      type: EventType.BASH,
      content: "echo hi",
      runLocation: RunLocation.REMOTE,
      selectedServerIds: [7],
    });
    expect(storageMock.setEventServers).toHaveBeenCalledWith(5, [7], OWNER);
  });

  it("refuses to bind another user's server (shared grants no secret use)", async () => {
    dbState.servers = [
      { id: 7, userId: OTHER, shared: true, isArchived: false },
    ];
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.create({
        name: "Remote Event",
        type: EventType.BASH,
        content: "echo hi",
        runLocation: RunLocation.REMOTE,
        selectedServerIds: [7],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageMock.createScript).not.toHaveBeenCalled();
  });

  it("stamps MCP provenance onto created events", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const caller = callerWith(sessionFor(), "mcp");
      await caller.events.create({
        name: "Agent Event",
        type: EventType.BASH,
        content: "echo hi",
      });
      expect(storageMock.createScript).toHaveBeenCalledWith(
        expect.objectContaining({ source: "mcp" }),
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects a script event without content", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.create({ name: "Bad", type: EventType.BASH }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an HTTP event without a URL and method", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.create({ name: "Bad", type: EventType.HTTP_REQUEST }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.createScript.mockRejectedValue(new Error("insert failed"));
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.create({
        name: "New Event",
        type: EventType.BASH,
        content: "echo hi",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("update", () => {
  it("updates plain fields without touching the schedule", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.update({ id: 1, name: "Renamed" });
    expect(storageMock.updateScript).toHaveBeenCalledWith(1, {
      name: "Renamed",
    });
    expect(schedulerMock.updateScript).not.toHaveBeenCalled();
    expect(storageMock.deleteEnvVarsByEventId).not.toHaveBeenCalled();
    expect(storageMock.setEventServers).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 1 });
  });

  it("skips the storage write when only the id is provided", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1 });
    expect(storageMock.updateScript).not.toHaveBeenCalled();
  });

  it.each([
    ["status", { status: EventStatus.ACTIVE }],
    ["scheduleNumber", { scheduleNumber: 5 }],
    ["triggerType", { triggerType: EventTriggerType.SCHEDULE }],
    ["customSchedule", { customSchedule: "*/5 * * * *" }],
  ] as const)(
    "re-materializes the durable schedule when %s changes",
    async (_field, patch) => {
      const caller = callerWith(sessionFor());
      await caller.events.update({ id: 1, ...patch });
      expect(schedulerMock.updateScript).toHaveBeenCalledWith(1);
    },
  );

  it("converts a startTime string to a Date for storage", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({
      id: 1,
      startTime: "2026-08-01T12:00:00.000Z",
    });
    const patch = storageMock.updateScript.mock.calls[0]?.[1] as {
      startTime: Date;
    };
    expect(patch.startTime).toBeInstanceOf(Date);
    expect(patch.startTime.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(schedulerMock.updateScript).toHaveBeenCalledWith(1);
  });

  it("clears startTime with an explicit null and still re-materializes", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1, startTime: null });
    expect(storageMock.updateScript).toHaveBeenCalledWith(1, {
      startTime: null,
    });
    expect(schedulerMock.updateScript).toHaveBeenCalledWith(1);
  });

  it("replaces env vars by deleting the old set before inserting the new", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({
      id: 1,
      envVars: [{ key: "B", value: "2" }],
    });
    expect(storageMock.deleteEnvVarsByEventId).toHaveBeenCalledWith(1);
    expect(storageMock.createEnvVar).toHaveBeenCalledWith({
      eventId: 1,
      key: "B",
      value: "2",
    });
    const deleteOrder =
      storageMock.deleteEnvVarsByEventId.mock.invocationCallOrder[0]!;
    const createOrder = storageMock.createEnvVar.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("clears env vars when an empty array is sent", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1, envVars: [] });
    expect(storageMock.deleteEnvVarsByEventId).toHaveBeenCalledWith(1);
    expect(storageMock.createEnvVar).not.toHaveBeenCalled();
  });

  it("clears server associations when an empty list is sent (falsy-length input)", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1, selectedServerIds: [] });
    expect(storageMock.setEventServers).toHaveBeenCalledWith(1, [], OWNER);
  });

  it("cleans up stale payloads when a remote event's content changes", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(
      eventWithRelations({ runLocation: RunLocation.REMOTE }),
    );
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1, content: "echo updated" });
    expect(payloadMock.removeOldPayloads).toHaveBeenCalledWith(1, 0);
  });

  it("ignores payload cleanup failures", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(
      eventWithRelations({ runLocation: RunLocation.REMOTE }),
    );
    payloadMock.removeOldPayloads.mockRejectedValue(new Error("fs error"));
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.update({ id: 1, content: "echo updated" }),
    ).resolves.toMatchObject({ id: 1 });
  });

  it("does not touch payloads for local events", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.update({ id: 1, content: "echo updated" });
    expect(payloadMock.removeOldPayloads).not.toHaveBeenCalled();
  });

  it("denies editing another user's event even when shared", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.update({ id: 1, name: "hijack" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageMock.updateScript).not.toHaveBeenCalled();
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.update({ id: -1, name: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.updateScript.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.update({ id: 1, name: "x" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("delete", () => {
  it("cleans up payloads, cancels the schedule, then deletes", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.delete({ id: 1 })).resolves.toEqual({
      success: true,
    });
    expect(payloadMock.cleanupEventPayloads).toHaveBeenCalledWith(1);
    expect(schedulerMock.deleteScript).toHaveBeenCalledWith(1);
    expect(storageMock.deleteScript).toHaveBeenCalledWith(1);

    const payloadOrder =
      payloadMock.cleanupEventPayloads.mock.invocationCallOrder[0]!;
    const scheduleOrder =
      schedulerMock.deleteScript.mock.invocationCallOrder[0]!;
    const deleteOrder = storageMock.deleteScript.mock.invocationCallOrder[0]!;
    expect(payloadOrder).toBeLessThan(scheduleOrder);
    expect(scheduleOrder).toBeLessThan(deleteOrder);
  });

  it("denies deleting another user's event", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.delete({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(storageMock.deleteScript).not.toHaveBeenCalled();
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.deleteScript.mockRejectedValue(new Error("fk violation"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.delete({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.delete({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("activate", () => {
  it("marks the event ACTIVE and schedules it", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.activate({ id: 1 })).resolves.toEqual({
      success: true,
    });
    expect(storageMock.updateScript).toHaveBeenCalledTimes(1);
    expect(storageMock.updateScript).toHaveBeenCalledWith(1, {
      status: EventStatus.ACTIVE,
    });
    expect(schedulerMock.scheduleScript).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it("resets the execution counter when requested", async () => {
    const caller = callerWith(sessionFor());
    await caller.events.activate({ id: 1, resetCounter: true });
    expect(storageMock.updateScript).toHaveBeenNthCalledWith(1, 1, {
      status: EventStatus.ACTIVE,
    });
    expect(storageMock.updateScript).toHaveBeenNthCalledWith(2, 1, {
      executionCount: 0,
    });
  });

  it("skips scheduling when the event vanished after the update", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(undefined);
    const caller = callerWith(sessionFor());
    await expect(caller.events.activate({ id: 1 })).resolves.toEqual({
      success: true,
    });
    expect(schedulerMock.scheduleScript).not.toHaveBeenCalled();
  });

  it("denies activating another user's event (execute is owner-only)", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.activate({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(storageMock.updateScript).not.toHaveBeenCalled();
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.activate({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.updateScript.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.activate({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("deactivate", () => {
  it("marks the event PAUSED and cancels the in-memory schedule", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.deactivate({ id: 1 })).resolves.toEqual({
      success: true,
    });
    expect(storageMock.updateScript).toHaveBeenCalledWith(1, {
      status: EventStatus.PAUSED,
    });
    expect(schedulerMock.deleteScript).toHaveBeenCalledWith(1);
  });

  it("denies pausing another user's event", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.deactivate({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.deactivate({ id: -3 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.updateScript.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.deactivate({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("execute", () => {
  it("dispatches a manual run and returns the job/log handles", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.execute({ id: 1 });
    expect(result).toEqual({ success: true, logId: 7, jobId: 42 });
    // Contract with the single enqueue path.
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        triggeredBy: "manual",
        input: undefined,
        authorizedUserId: OWNER,
        actor: `user:${OWNER}`,
      },
    );
  });

  it("maps an overlap skip to CONFLICT", async () => {
    dispatchMock.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "overlap",
    });
    const caller = callerWith(sessionFor());
    await expect(caller.events.execute({ id: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("returns NOT_FOUND when the event no longer exists", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(undefined);
    const caller = callerWith(sessionFor());
    await expect(caller.events.execute({ id: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("denies executing another user's event even when shared", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.execute({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("normalizes dispatch failures to INTERNAL_SERVER_ERROR", async () => {
    dispatchMock.mockRejectedValue(new Error("queue unavailable"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.execute({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.execute({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("getLogs", () => {
  it("returns logs with pagination metadata", async () => {
    const logs = Array.from({ length: 2 }, (_, i) => ({ id: i + 1 }));
    storageMock.getLogsByEventId.mockResolvedValue({ logs, total: 12 });
    const caller = callerWith(sessionFor());
    const result = await caller.events.getLogs({ id: 1, limit: 2, offset: 0 });
    expect(result).toEqual({ logs, total: 12, hasMore: true });
    expect(storageMock.getLogsByEventId).toHaveBeenCalledWith(1, {
      limit: 2,
      offset: 0,
    });
  });

  it("reports hasMore=false when fewer logs than the limit are returned", async () => {
    storageMock.getLogsByEventId.mockResolvedValue({
      logs: [{ id: 1 }],
      total: 1,
    });
    const caller = callerWith(sessionFor());
    const result = await caller.events.getLogs({ id: 1, limit: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(1);
  });

  it("handles an empty log set", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.getLogs({ id: 1 });
    expect(result).toEqual({ logs: [], total: 0, hasMore: false });
  });

  it("denies log access to non-owners even for shared events", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.getLogs({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(storageMock.getLogsByEventId).not.toHaveBeenCalled();
  });

  it("rejects an invalid limit", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.getLogs({ id: 1, limit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.getLogsByEventId.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.getLogs({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("resetCounter", () => {
  it("zeroes the execution counter", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.resetCounter({ id: 1 })).resolves.toEqual({
      success: true,
    });
    expect(storageMock.updateScript).toHaveBeenCalledWith(1, {
      executionCount: 0,
    });
  });

  it("denies resetting another user's counter", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.resetCounter({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.resetCounter({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.updateScript.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.resetCounter({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("getWorkflows", () => {
  it("returns the workflows using this event, scoped to the caller", async () => {
    const workflows = [{ id: 3, name: "wf" }];
    storageMock.getWorkflowsUsingEvent.mockResolvedValue(workflows);
    const caller = callerWith(sessionFor());
    await expect(caller.events.getWorkflows({ id: 1 })).resolves.toEqual(
      workflows,
    );
    expect(storageMock.getWorkflowsUsingEvent).toHaveBeenCalledWith(1, OWNER);
  });

  it("denies viewing workflows of another user's unshared event", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: false })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.getWorkflows({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.getWorkflowsUsingEvent.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.getWorkflows({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("download", () => {
  it("downloads a single owned event as JSON named after the event", async () => {
    storageMock.getAllEvents.mockResolvedValue([{ id: 1 }]);
    const caller = callerWith(sessionFor());
    const result = await caller.events.download({ eventIds: [1] });
    expect(result.format).toBe("json");
    expect(result.filename).toBe("Test Event.json");
    expect(JSON.parse(result.data) as Row).toMatchObject({
      id: 1,
      secretFieldsRedacted: false,
    });
  });

  it("silently filters out event ids the caller does not own", async () => {
    storageMock.getAllEvents.mockResolvedValue([{ id: 1 }]);
    const caller = callerWith(sessionFor());
    const result = await caller.events.download({ eventIds: [1, 999] });
    // Only the accessible event is exported (single-event path).
    expect(result.filename).toBe("Test Event.json");
    expect(storageMock.getEventWithRelations).toHaveBeenCalledTimes(1);
    expect(storageMock.getEventWithRelations).toHaveBeenCalledWith(1);
  });

  it("bundles multiple events into events.json", async () => {
    storageMock.getAllEvents.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    storageMock.getEventWithRelations.mockImplementation((id: number) =>
      Promise.resolve(eventWithRelations({ id })),
    );
    const caller = callerWith(sessionFor());
    const result = await caller.events.download({ eventIds: [1, 2] });
    expect(result.filename).toBe("events.json");
    const parsed = JSON.parse(result.data) as Row[];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.id)).toEqual([1, 2]);
  });

  it("returns FORBIDDEN when no requested event is accessible", async () => {
    storageMock.getAllEvents.mockResolvedValue([]);
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.download({ eventIds: [999] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND when the event vanished before export", async () => {
    storageMock.getAllEvents.mockResolvedValue([{ id: 1 }]);
    storageMock.getEventWithRelations.mockResolvedValue(undefined);
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.download({ eventIds: [1] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an empty selection", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.download({ eventIds: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.getAllEvents.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.download({ eventIds: [1] }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("fork", () => {
  it("copies an owned event with env vars and server bindings as a DRAFT", async () => {
    storageMock.getEventWithRelations
      .mockResolvedValueOnce(
        eventWithRelations({
          name: "Original",
          shared: true,
          httpUrl: "https://mine.example",
          envVars: [{ key: "A", value: "1" }],
          servers: [{ id: 7 }],
        }),
      )
      .mockResolvedValueOnce(eventWithRelations({ id: 5 }));
    dbState.servers = [
      { id: 7, userId: OWNER, shared: false, isArchived: false },
    ];
    const caller = callerWith(sessionFor());
    const result = await caller.events.fork({ id: 1 });

    expect(storageMock.createScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Original (fork)",
        status: EventStatus.DRAFT,
        shared: false,
        httpUrl: "https://mine.example",
        userId: OWNER,
      }),
    );
    expect(storageMock.createEnvVar).toHaveBeenCalledWith({
      eventId: 5,
      key: "A",
      value: "1",
    });
    expect(storageMock.setEventServers).toHaveBeenCalledWith(5, [7], OWNER);
    expect(result).toMatchObject({ id: 5 });
  });

  it("strips secrets when forking another user's shared template", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    storageMock.getEventWithRelations
      .mockResolvedValueOnce(
        eventWithRelations({
          userId: OTHER,
          shared: true,
          name: "Shared Template",
          httpUrl: "https://theirs.example/hook?key=abc",
          httpBody: "secret-body",
          runLocation: RunLocation.REMOTE,
          serverId: 9,
          envVars: [{ key: "TOKEN", value: "s3cret" }],
          servers: [{ id: 9 }],
        }),
      )
      .mockResolvedValueOnce(eventWithRelations({ id: 5 }));
    const caller = callerWith(sessionFor());
    await caller.events.fork({ id: 1 });

    expect(storageMock.createScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Shared Template (fork)",
        httpUrl: null,
        httpBody: null,
        runLocation: RunLocation.LOCAL,
        serverId: null,
        shared: false,
        userId: OWNER,
      }),
    );
    // The owner's environment and server bindings never transfer.
    expect(storageMock.createEnvVar).not.toHaveBeenCalled();
    expect(storageMock.setEventServers).not.toHaveBeenCalled();
  });

  it("denies forking another user's unshared event", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: false })];
    const caller = callerWith(sessionFor());
    await expect(caller.events.fork({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(storageMock.createScript).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the original vanished", async () => {
    storageMock.getEventWithRelations.mockResolvedValue(undefined);
    const caller = callerWith(sessionFor());
    await expect(caller.events.fork({ id: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an invalid id", async () => {
    const caller = callerWith(sessionFor());
    await expect(caller.events.fork({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.createScript.mockRejectedValue(new Error("insert failed"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.fork({ id: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("getForFilters", () => {
  const allEvents = [
    { id: 1, name: "Alpha", status: EventStatus.ACTIVE },
    { id: 2, name: "beta", status: EventStatus.PAUSED },
    { id: 3, name: "Alphabet", status: EventStatus.ACTIVE },
  ];

  beforeEach(() => {
    storageMock.getAllEvents.mockResolvedValue(allEvents);
  });

  it("returns lightweight id/name pairs", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.getForFilters({});
    expect(result.events).toEqual([
      { id: 1, name: "Alpha" },
      { id: 2, name: "beta" },
      { id: 3, name: "Alphabet" },
    ]);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(storageMock.getAllEvents).toHaveBeenCalledWith(OWNER);
  });

  it("filters by case-insensitive name search", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.getForFilters({ search: "alpha" });
    expect(result.events.map((e) => e.id)).toEqual([1, 3]);
    expect(result.total).toBe(2);
  });

  it("treats an empty search string as no filter", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.getForFilters({ search: "" });
    expect(result.total).toBe(3);
  });

  it("filters by status", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.getForFilters({
      status: EventStatus.PAUSED,
    });
    expect(result.events).toEqual([{ id: 2, name: "beta" }]);
  });

  it("paginates and reports hasMore", async () => {
    const caller = callerWith(sessionFor());
    const page1 = await caller.events.getForFilters({ limit: 2, offset: 0 });
    expect(page1.events.map((e) => e.id)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);

    const page2 = await caller.events.getForFilters({ limit: 2, offset: 2 });
    expect(page2.events.map((e) => e.id)).toEqual([3]);
    expect(page2.hasMore).toBe(false);
  });

  it("normalizes storage failures to INTERNAL_SERVER_ERROR", async () => {
    storageMock.getAllEvents.mockRejectedValue(new Error("db down"));
    const caller = callerWith(sessionFor());
    await expect(caller.events.getForFilters({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("validateCron", () => {
  it("accepts a valid expression and previews upcoming fire times", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.validateCron({
      expression: "*/5 * * * *",
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.next.length).toBeGreaterThan(0);
    for (const iso of result.next) {
      expect(new Date(iso).toISOString()).toBe(iso);
    }
  });

  it("reports an invalid expression without throwing", async () => {
    const caller = callerWith(sessionFor());
    const result = await caller.events.validateCron({
      expression: "not a cron",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toEqual(expect.any(String));
  });

  it("rejects an empty expression", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.validateCron({ expression: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("getScheduleIncidents", () => {
  it("returns recent incidents for an owned event", async () => {
    dbState.incidents = [
      { id: 11, eventId: 1, kind: "MISSED" },
      { id: 12, eventId: 1, kind: "AUTO_PAUSED" },
    ];
    const caller = callerWith(sessionFor());
    const result = await caller.events.getScheduleIncidents({ eventId: 1 });
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents[0]).toMatchObject({ eventId: 1, kind: "MISSED" });
  });

  it("denies incident history for another user's event even when shared", async () => {
    dbState.events = [eventAccessRow({ userId: OTHER, shared: true })];
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.getScheduleIncidents({ eventId: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an invalid event id", async () => {
    const caller = callerWith(sessionFor());
    await expect(
      caller.events.getScheduleIncidents({ eventId: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
