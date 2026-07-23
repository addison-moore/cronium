/** @jest-environment node */
/**
 * Router-level tests for webhookSystemRouter. The REAL router and the REAL
 * protectedProcedure middleware chain run; the database is mocked at the
 * driver boundary (@/server/db) and the webhook lib layer is factory-mocked.
 *
 * Key contracts under test:
 *  - HMAC secrets are returned exactly once (create / regenerateSecret) and
 *    are masked on every read path (list / get), including custom headers.
 *  - Every ctx.db lookup and the manager delegation is tenant-scoped to the
 *    calling user.
 *  - Viewer role is denied all mutations; zod rejects malformed input.
 */
const mockDbState: {
  results: Map<unknown, unknown>;
  queries: Array<{ table: unknown; where: unknown }>;
  updates: Array<{
    table: unknown;
    values: Record<string, unknown>;
    where: unknown;
  }>;
} = { results: new Map(), queries: [], updates: [] };

jest.mock("@/server/db", () => {
  const terminal = (table: unknown) => {
    const value = mockDbState.results.get(table);
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value ?? []);
  };
  const makeChain = (table: unknown) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      where: (where: unknown) => {
        mockDbState.queries.push({ table, where });
        return chain;
      },
      innerJoin: () => chain,
      orderBy: () => chain,
      groupBy: () => terminal(table),
      limit: () => terminal(table),
    });
    return chain;
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => makeChain(table) }),
      $count: () => 0,
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: (where: unknown) => {
            mockDbState.updates.push({ table, values, where });
            return Promise.resolve();
          },
        }),
      }),
    },
  };
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

// The real @/lib/webhooks index transitively pulls in the storage monolith,
// SSRF agents, and a WebhookQueue whose constructor starts a processing
// interval — none of which belong in a router test. The factory mirrors the
// module's public surface used by the router; WebhookConfigSchema is a
// field-for-field copy of the schema in WebhookManager.ts.
jest.mock("@/lib/webhooks", () => {
  const { z } = jest.requireActual<typeof import("zod")>("zod");
  const WebhookConfigSchema = z.object({
    url: z.string().url(),
    events: z.array(z.string()),
    secret: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    active: z.boolean().default(true),
    retryConfig: z
      .object({
        maxRetries: z.number().default(3),
        retryDelay: z.number().default(1000),
        backoffMultiplier: z.number().default(2),
      })
      .optional(),
  });
  const manager = {
    registerWebhook: jest.fn(),
    listWebhooks: jest.fn(),
    updateWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
    getEventHistory: jest.fn(),
    retryDelivery: jest.fn(),
    triggerEvent: jest.fn(),
  };
  const generateSecret = jest.fn(() => "regenerated-plaintext-secret");
  class WebhookSecurity {
    generateSecret = generateSecret;
  }
  return {
    __esModule: true,
    WebhookConfigSchema,
    WebhookManager: { getInstance: () => manager },
    WebhookSecurity,
  };
});

jest.mock("@/lib/webhooks/webhook-secret", () => ({
  encryptWebhookSecret: jest.fn(
    (secret: string, key: string, userId: string) =>
      `enc:${secret}:${key}:${userId}`,
  ),
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { Column } from "drizzle-orm";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import {
  UserRole,
  UserStatus,
  users,
  webhooks,
  webhookDeliveries,
  webhookEvents,
} from "@/shared/schema";
import { db } from "@/server/db";
import { WebhookManager } from "@/lib/webhooks";
import { encryptWebhookSecret } from "@/lib/webhooks/webhook-secret";

// Mount under its production name so enforceRouteCapability sees the same
// paths ("webhookSystem.create", ...) that the route-capability inventory
// declares.
const testRouter = createTRPCRouter({ webhookSystem: webhookSystemRouter });
const createCaller = createCallerFactory(testRouter);

const managerMock = WebhookManager.getInstance() as unknown as {
  registerWebhook: jest.Mock;
  listWebhooks: jest.Mock;
  updateWebhook: jest.Mock;
  deleteWebhook: jest.Mock;
  getEventHistory: jest.Mock;
  retryDelivery: jest.Mock;
  triggerEvent: jest.Mock;
};
const encryptSecretMock = encryptWebhookSecret as unknown as jest.Mock;

const USER_ID = "user-1";

function principalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: USER_ID,
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mfaEnabled: false,
    ...overrides,
  };
}

function sessionFor(overrides: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: USER_ID,
      email: "user@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerWith(session: Session | null) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

function userCaller() {
  mockDbState.results.set(users, [principalRow()]);
  return callerWith(sessionFor());
}

function viewerCaller() {
  mockDbState.results.set(users, [
    principalRow({ role: UserRole.VIEWER, roleId: 3 }),
  ]);
  return callerWith(sessionFor({ role: UserRole.VIEWER }));
}

/** Collect the column names referenced anywhere in a drizzle SQL tree. */
function columnNamesIn(expr: unknown, acc = new Set<string>()): Set<string> {
  if (expr instanceof Column) {
    acc.add(expr.name);
    return acc;
  }
  if (expr && typeof expr === "object") {
    const chunks = (expr as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) columnNamesIn(chunk, acc);
    }
  }
  return acc;
}

function whereColumnsFor(table: unknown): Set<string> {
  const query = mockDbState.queries.find((q) => q.table === table);
  expect(query).toBeDefined();
  return columnNamesIn(query?.where);
}

function ownedWebhookRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 42,
    userId: USER_ID,
    key: "whk_abc123",
    url: "https://example.com/hook",
    secret: "encrypted-at-rest-secret",
    events: ["event.completed"],
    headers: { __enc: "ciphertext" },
    active: true,
    retryConfig: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

const VALID_CREATE_INPUT = {
  url: "https://example.com/hook",
  events: ["event.completed"],
  active: true,
};

beforeAll(() => {
  process.env.PUBLIC_APP_URL = "https://cronium.test";
  // withErrorHandling logs every failure path; keep test output readable.
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbState.results.clear();
  mockDbState.queries.length = 0;
  mockDbState.updates.length = 0;
});

describe("webhookSystem.create", () => {
  it("registers the webhook for the caller and returns the secret exactly once", async () => {
    managerMock.registerWebhook.mockResolvedValue({
      id: 42,
      key: "whk_abc123",
      secret: "plaintext-hmac-secret",
    });

    const result = await userCaller().webhookSystem.create(VALID_CREATE_INPUT);

    expect(managerMock.registerWebhook).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining(VALID_CREATE_INPUT),
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: 42,
        key: "whk_abc123",
        url: "https://cronium.test/api/webhooks/whk_abc123",
        secret: "plaintext-hmac-secret",
      },
      message: "Webhook created successfully",
    });
  });

  it("falls back to a relative endpoint when PUBLIC_APP_URL is unset", async () => {
    const saved = process.env.PUBLIC_APP_URL;
    delete process.env.PUBLIC_APP_URL;
    try {
      managerMock.registerWebhook.mockResolvedValue({
        id: 42,
        key: "whk_abc123",
        secret: "s",
      });
      const result =
        await userCaller().webhookSystem.create(VALID_CREATE_INPUT);
      expect(result.data.url).toBe("/api/webhooks/whk_abc123");
    } finally {
      process.env.PUBLIC_APP_URL = saved;
    }
  });

  it("rejects a Viewer with FORBIDDEN before touching the manager", async () => {
    await expect(
      viewerCaller().webhookSystem.create(VALID_CREATE_INPUT),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(managerMock.registerWebhook).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.create({
        url: "not-a-url",
        events: ["event.completed"],
        active: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(managerMock.registerWebhook).not.toHaveBeenCalled();
  });

  it("maps unexpected manager failures through withErrorHandling", async () => {
    managerMock.registerWebhook.mockRejectedValue(new Error("boom"));
    await expect(
      userCaller().webhookSystem.create(VALID_CREATE_INPUT),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      callerWith(null).webhookSystem.create(VALID_CREATE_INPUT),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("webhookSystem.list", () => {
  it("lists the caller's webhooks with secret and headers masked", async () => {
    managerMock.listWebhooks.mockResolvedValue([
      ownedWebhookRow(),
      ownedWebhookRow({
        id: 43,
        key: "whk_def456",
        secret: null,
        headers: null,
      }),
    ]);

    const result = await userCaller().webhookSystem.list();

    expect(managerMock.listWebhooks).toHaveBeenCalledWith(USER_ID);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);

    const [first, second] = result.items as Array<Record<string, unknown>>;
    // HI-09: no read path may echo the HMAC secret or credential headers.
    expect(first?.secret).toBe("");
    expect(first?.hasSecret).toBe(true);
    expect(first?.headers).toEqual({});
    expect(first?.hasHeaders).toBe(true);
    expect(first?.endpoint).toBe(
      "https://cronium.test/api/webhooks/whk_abc123",
    );
    expect(second?.secret).toBe("");
    expect(second?.hasSecret).toBe(false);
    expect(second?.hasHeaders).toBe(false);
    expect(JSON.stringify(result)).not.toContain("encrypted-at-rest-secret");
  });

  it("allows a Viewer to read the list", async () => {
    managerMock.listWebhooks.mockResolvedValue([]);
    await expect(viewerCaller().webhookSystem.list()).resolves.toMatchObject({
      total: 0,
    });
  });
});

describe("webhookSystem.get", () => {
  it("returns the webhook masked and scopes the lookup to the caller", async () => {
    mockDbState.results.set(webhooks, [ownedWebhookRow()]);

    const result = await userCaller().webhookSystem.get({ id: 42 });

    const data = result.data as Record<string, unknown>;
    expect(data.id).toBe(42);
    expect(data.secret).toBe("");
    expect(data.hasSecret).toBe(true);
    expect(data.headers).toEqual({});
    expect(data.hasHeaders).toBe(true);
    expect(data.endpoint).toBe("https://cronium.test/api/webhooks/whk_abc123");

    // Tenant scoping: the WHERE clause must constrain both id and user_id.
    const cols = whereColumnsFor(webhooks);
    expect(cols).toContain("id");
    expect(cols).toContain("user_id");
  });

  it("returns NOT_FOUND when the webhook does not exist (or belongs to someone else)", async () => {
    mockDbState.results.set(webhooks, []);
    await expect(
      userCaller().webhookSystem.get({ id: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a non-numeric id with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.get({
        id: "42" as unknown as number,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.update", () => {
  it("forwards only the defined fields, scoped to the caller", async () => {
    managerMock.updateWebhook.mockResolvedValue(undefined);

    const result = await userCaller().webhookSystem.update({
      id: 42,
      updates: { url: "https://example.com/new", active: false },
    });

    expect(managerMock.updateWebhook).toHaveBeenCalledWith(42, USER_ID, {
      url: "https://example.com/new",
      active: false,
    });
    expect(result).toEqual({
      success: true,
      data: { id: 42 },
      message: "Webhook updated successfully",
    });
  });

  it("does not drop falsy-but-defined fields (active: false survives)", async () => {
    managerMock.updateWebhook.mockResolvedValue(undefined);
    await userCaller().webhookSystem.update({
      id: 42,
      updates: { active: false, events: [] },
    });
    expect(managerMock.updateWebhook).toHaveBeenCalledWith(42, USER_ID, {
      active: false,
      events: [],
    });
  });

  it("forwards headers and retryConfig when provided", async () => {
    managerMock.updateWebhook.mockResolvedValue(undefined);
    await userCaller().webhookSystem.update({
      id: 42,
      updates: {
        headers: { "X-Custom": "value" },
        retryConfig: { maxRetries: 5, retryDelay: 500, backoffMultiplier: 2 },
      },
    });
    expect(managerMock.updateWebhook).toHaveBeenCalledWith(42, USER_ID, {
      headers: { "X-Custom": "value" },
      retryConfig: { maxRetries: 5, retryDelay: 500, backoffMultiplier: 2 },
    });
  });

  it("does not inject active:true into an unrelated partial update (zod v4 .partial() default regression)", async () => {
    managerMock.updateWebhook.mockResolvedValue(undefined);
    await userCaller().webhookSystem.update({
      id: 42,
      updates: { url: "https://example.com/only-url" },
    });
    // A disabled webhook must stay disabled when only the URL changes.
    expect(managerMock.updateWebhook).toHaveBeenCalledWith(42, USER_ID, {
      url: "https://example.com/only-url",
    });
    const forwarded = managerMock.updateWebhook.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(forwarded).not.toHaveProperty("active");
  });

  it("never updates the HMAC secret through update (rotation only)", async () => {
    managerMock.updateWebhook.mockResolvedValue(undefined);
    await userCaller().webhookSystem.update({
      id: 42,
      updates: { secret: "attacker-chosen-secret", active: true },
    });
    const forwarded = managerMock.updateWebhook.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(forwarded).not.toHaveProperty("secret");
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().webhookSystem.update({ id: 42, updates: {} }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(managerMock.updateWebhook).not.toHaveBeenCalled();
  });

  it("rejects an invalid updates.url with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.update({
        id: 42,
        updates: { url: "nope" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.delete", () => {
  it("deletes scoped to the caller", async () => {
    managerMock.deleteWebhook.mockResolvedValue(undefined);
    const result = await userCaller().webhookSystem.delete({ id: 42 });
    expect(managerMock.deleteWebhook).toHaveBeenCalledWith(42, USER_ID);
    expect(result).toEqual({
      success: true,
      data: { id: 42 },
      message: "Webhook deleted successfully",
    });
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().webhookSystem.delete({ id: 42 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(managerMock.deleteWebhook).not.toHaveBeenCalled();
  });

  it("rejects a missing id with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.delete({} as { id: number }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.getEventHistory", () => {
  it("verifies ownership then returns history with the default limit", async () => {
    mockDbState.results.set(webhooks, [ownedWebhookRow()]);
    managerMock.getEventHistory.mockResolvedValue([
      { id: 1, event: "event.completed" },
    ]);

    const result = await userCaller().webhookSystem.getEventHistory({
      webhookId: 42,
    });

    expect(managerMock.getEventHistory).toHaveBeenCalledWith(42, 100);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(100);

    const cols = whereColumnsFor(webhooks);
    expect(cols).toContain("id");
    expect(cols).toContain("user_id");
  });

  it("returns NOT_FOUND for a webhook the caller does not own", async () => {
    mockDbState.results.set(webhooks, []);
    await expect(
      userCaller().webhookSystem.getEventHistory({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(managerMock.getEventHistory).not.toHaveBeenCalled();
  });

  it("rejects out-of-range limits with BAD_REQUEST", async () => {
    const caller = userCaller();
    await expect(
      caller.webhookSystem.getEventHistory({ webhookId: 42, limit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.webhookSystem.getEventHistory({ webhookId: 42, limit: 1001 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.getStats", () => {
  it("aggregates delivery counts and recent events for an owned webhook", async () => {
    mockDbState.results.set(webhooks, [ownedWebhookRow()]);
    mockDbState.results.set(webhookDeliveries, [
      { status: "success", count: 5 },
      { status: "failed", count: 2 },
      { status: "pending", count: 1 },
    ]);
    mockDbState.results.set(webhookEvents, [
      {
        webhook_events: {
          event: "event.completed",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
        webhook_deliveries: {
          status: "success",
          statusCode: 200,
          duration: 12,
        },
      },
    ]);

    const result = await userCaller().webhookSystem.getStats({ webhookId: 42 });

    expect(result.metrics).toEqual({
      totalDeliveries: 8,
      successfulDeliveries: 5,
      failedDeliveries: 2,
      recentEventsCount: 1,
    });
    expect(new Date(result.period.start).getTime()).toBeLessThan(
      new Date(result.period.end).getTime(),
    );

    const cols = whereColumnsFor(webhooks);
    expect(cols).toContain("user_id");
  });

  it("returns NOT_FOUND for a webhook the caller does not own", async () => {
    mockDbState.results.set(webhooks, []);
    await expect(
      userCaller().webhookSystem.getStats({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("webhookSystem.retryDelivery", () => {
  it("retries a delivery owned by the caller", async () => {
    mockDbState.results.set(webhookDeliveries, [{ webhookUserId: USER_ID }]);
    managerMock.retryDelivery.mockResolvedValue({ queued: true });

    const result = await userCaller().webhookSystem.retryDelivery({
      deliveryId: "dl_123",
    });

    expect(managerMock.retryDelivery).toHaveBeenCalledWith("dl_123");
    expect(result).toEqual({
      success: true,
      data: { queued: true },
      message: "Webhook delivery retry initiated",
    });
  });

  it("returns NOT_FOUND when the delivery belongs to another tenant", async () => {
    mockDbState.results.set(webhookDeliveries, [
      { webhookUserId: "someone-else" },
    ]);
    await expect(
      userCaller().webhookSystem.retryDelivery({ deliveryId: "dl_123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(managerMock.retryDelivery).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the delivery does not exist", async () => {
    mockDbState.results.set(webhookDeliveries, []);
    await expect(
      userCaller().webhookSystem.retryDelivery({ deliveryId: "dl_123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(managerMock.retryDelivery).not.toHaveBeenCalled();
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().webhookSystem.retryDelivery({ deliveryId: "dl_123" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-string deliveryId with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.retryDelivery({
        deliveryId: 7 as unknown as string,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.test", () => {
  it("triggers a test event inside the owner's tenant", async () => {
    mockDbState.results.set(webhooks, [ownedWebhookRow()]);
    managerMock.triggerEvent.mockResolvedValue(undefined);

    const result = await userCaller().webhookSystem.test({
      webhookId: 42,
      testData: { hello: "world" },
    });

    expect(managerMock.triggerEvent).toHaveBeenCalledWith(
      "webhook.test",
      expect.objectContaining({ test: true, hello: "world" }),
      USER_ID,
      { webhookId: 42, triggeredBy: USER_ID },
    );
    expect(result).toEqual({
      success: true,
      data: { webhookId: 42 },
      message: "Test webhook sent",
    });

    const cols = whereColumnsFor(webhooks);
    expect(cols).toContain("user_id");
  });

  it("returns NOT_FOUND for a webhook the caller does not own", async () => {
    mockDbState.results.set(webhooks, []);
    await expect(
      userCaller().webhookSystem.test({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(managerMock.triggerEvent).not.toHaveBeenCalled();
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().webhookSystem.test({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-numeric webhookId with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.test({
        webhookId: "42" as unknown as number,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webhookSystem.regenerateSecret", () => {
  it("stores the encrypted secret scoped to the caller and returns the plaintext once", async () => {
    mockDbState.results.set(webhooks, [{ key: "whk_abc123" }]);

    const result = await userCaller().webhookSystem.regenerateSecret({
      webhookId: 42,
    });

    expect(result).toEqual({
      success: true,
      data: { secret: "regenerated-plaintext-secret" },
      message: "Webhook secret regenerated successfully",
    });

    // The new secret is encrypted bound to the webhook key + tenant before
    // it ever reaches the database.
    expect(encryptSecretMock).toHaveBeenCalledWith(
      "regenerated-plaintext-secret",
      "whk_abc123",
      USER_ID,
    );
    expect(mockDbState.updates).toHaveLength(1);
    const update = mockDbState.updates[0]!;
    expect(update.table).toBe(webhooks);
    expect(update.values.secret).toBe(
      "enc:regenerated-plaintext-secret:whk_abc123:user-1",
    );
    expect(update.values.updatedAt).toBeInstanceOf(Date);
    const updateCols = columnNamesIn(update.where);
    expect(updateCols).toContain("id");
    expect(updateCols).toContain("user_id");
  });

  it("returns NOT_FOUND for a webhook the caller does not own, without writing", async () => {
    mockDbState.results.set(webhooks, []);
    await expect(
      userCaller().webhookSystem.regenerateSecret({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().webhookSystem.regenerateSecret({ webhookId: 42 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("rejects a missing webhookId with BAD_REQUEST", async () => {
    await expect(
      userCaller().webhookSystem.regenerateSecret({} as { webhookId: number }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
