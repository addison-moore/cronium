/** @jest-environment node */
/**
 * Router-level tests for quotaManagementRouter. The REAL router and the REAL
 * protectedProcedure/adminProcedure middleware chain run; the database is
 * mocked at the driver boundary (@/server/db) and the rate-limiting lib layer
 * is factory-mocked.
 *
 * Key contracts under test:
 *  - Every self-service endpoint operates on the calling user's id only.
 *  - updateUserQuota / resetUserQuotas / getRateLimitStats are admin-gated
 *    (both plain USER and VIEWER are rejected).
 *  - getRateLimitStatus refuses user-type keys for other users.
 *  - zod rejects malformed input; undefined fields are filtered before the
 *    lib layer sees them (exactOptionalPropertyTypes contract).
 */
const mockDbState: { rows: Array<Record<string, unknown>> } = { rows: [] };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(mockDbState.rows)),
        })),
      })),
    })),
  },
}));

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

// The real @/lib/rate-limiting modules import @/server/db at module scope and
// their singletons start cache-cleanup timers. The factory mirrors the public
// surface the router uses; QuotaConfigSchema is a field-for-field copy of the
// schema in QuotaManager.ts.
jest.mock("@/lib/rate-limiting", () => {
  const { z } = jest.requireActual<typeof import("zod")>("zod");
  const QuotaConfigSchema = z.object({
    toolActionsPerMonth: z.number().default(10000),
    toolActionsPerDay: z.number().default(1000),
    webhooksPerUser: z.number().default(10),
    webhookEventsPerMonth: z.number().default(50000),
    eventsPerUser: z.number().default(100),
    eventExecutionsPerMonth: z.number().default(10000),
    workflowsPerUser: z.number().default(50),
    workflowExecutionsPerMonth: z.number().default(5000),
    totalStorageMB: z.number().default(1000),
    logRetentionDays: z.number().default(30),
    apiRequestsPerMonth: z.number().default(100000),
    apiRequestsPerMinute: z.number().default(100),
  });
  const quotaManager = {
    getQuotaStatus: jest.fn(),
    checkQuota: jest.fn(),
    updateUserQuota: jest.fn(),
    resetQuotas: jest.fn(),
    getEnforcementRules: jest.fn(),
  };
  const rateLimiter = {
    getStatistics: jest.fn(),
    getStatus: jest.fn(),
  };
  const usageReporter = {
    getUserMetrics: jest.fn(),
    getUserTrends: jest.fn(),
    getQuotaSummary: jest.fn(),
    exportUsageReport: jest.fn(),
  };
  return {
    __esModule: true,
    QuotaConfigSchema,
    QuotaManager: { getInstance: () => quotaManager },
    RateLimiter: { getInstance: () => rateLimiter },
    UsageReporter: { getInstance: () => usageReporter },
  };
});

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { quotaManagementRouter } from "@/server/api/routers/quota-management";
import { UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { QuotaManager, RateLimiter, UsageReporter } from "@/lib/rate-limiting";

// Mount under its production name so enforceRouteCapability sees the same
// paths ("quotaManagement.updateUserQuota", ...) that the route-capability
// inventory declares (admin/view capabilities).
const testRouter = createTRPCRouter({ quotaManagement: quotaManagementRouter });
const createCaller = createCallerFactory(testRouter);

const quotaManagerMock = QuotaManager.getInstance() as unknown as {
  getQuotaStatus: jest.Mock;
  checkQuota: jest.Mock;
  updateUserQuota: jest.Mock;
  resetQuotas: jest.Mock;
  getEnforcementRules: jest.Mock;
};
const rateLimiterMock = RateLimiter.getInstance() as unknown as {
  getStatistics: jest.Mock;
  getStatus: jest.Mock;
};
const usageReporterMock = UsageReporter.getInstance() as unknown as {
  getUserMetrics: jest.Mock;
  getUserTrends: jest.Mock;
  getQuotaSummary: jest.Mock;
  exportUsageReport: jest.Mock;
};

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
  mockDbState.rows = [principalRow()];
  return callerWith(sessionFor());
}

function viewerCaller() {
  mockDbState.rows = [principalRow({ role: UserRole.VIEWER, roleId: 3 })];
  return callerWith(sessionFor({ role: UserRole.VIEWER }));
}

function adminCaller() {
  mockDbState.rows = [principalRow({ role: UserRole.ADMIN, roleId: 1 })];
  return callerWith(sessionFor({ role: UserRole.ADMIN }));
}

function quotaCheck(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    limit: 100,
    used: 10,
    remaining: 90,
    percentage: 10,
    ...overrides,
  };
}

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbState.rows = [];
});

describe("quotaManagement self-service reads", () => {
  it("getStatus returns the caller's own quota status", async () => {
    const status = { toolActions: quotaCheck() };
    quotaManagerMock.getQuotaStatus.mockResolvedValue(status);

    await expect(userCaller().quotaManagement.getStatus()).resolves.toBe(
      status,
    );
    expect(quotaManagerMock.getQuotaStatus).toHaveBeenCalledWith(USER_ID);
  });

  it("getStatus is readable by a Viewer", async () => {
    quotaManagerMock.getQuotaStatus.mockResolvedValue({});
    await expect(viewerCaller().quotaManagement.getStatus()).resolves.toEqual(
      {},
    );
  });

  it("getMetrics passes the caller's id and the requested period", async () => {
    const metrics = { period: "week" };
    usageReporterMock.getUserMetrics.mockResolvedValue(metrics);

    await expect(
      userCaller().quotaManagement.getMetrics({ period: "week" }),
    ).resolves.toBe(metrics);
    expect(usageReporterMock.getUserMetrics).toHaveBeenCalledWith(
      USER_ID,
      "week",
    );
  });

  it("getMetrics defaults the period to month", async () => {
    usageReporterMock.getUserMetrics.mockResolvedValue({});
    await userCaller().quotaManagement.getMetrics({});
    expect(usageReporterMock.getUserMetrics).toHaveBeenCalledWith(
      USER_ID,
      "month",
    );
  });

  it("getMetrics rejects an unknown period with BAD_REQUEST", async () => {
    await expect(
      userCaller().quotaManagement.getMetrics({
        period: "year" as unknown as "month",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(usageReporterMock.getUserMetrics).not.toHaveBeenCalled();
  });

  it("getTrends and getSummary are scoped to the caller", async () => {
    usageReporterMock.getUserTrends.mockResolvedValue({ daily: [] });
    usageReporterMock.getQuotaSummary.mockResolvedValue({ warnings: [] });

    const caller = userCaller();
    await expect(caller.quotaManagement.getTrends()).resolves.toEqual({
      daily: [],
    });
    await expect(caller.quotaManagement.getSummary()).resolves.toEqual({
      warnings: [],
    });
    expect(usageReporterMock.getUserTrends).toHaveBeenCalledWith(USER_ID);
    expect(usageReporterMock.getQuotaSummary).toHaveBeenCalledWith(USER_ID);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      callerWith(null).quotaManagement.getStatus(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("quotaManagement.checkQuota", () => {
  it("checks the caller's own quota with the default amount of 1", async () => {
    const check = quotaCheck();
    quotaManagerMock.checkQuota.mockResolvedValue(check);

    await expect(
      userCaller().quotaManagement.checkQuota({
        resource: "toolActionsPerMonth",
      }),
    ).resolves.toBe(check);
    expect(quotaManagerMock.checkQuota).toHaveBeenCalledWith(
      USER_ID,
      "toolActionsPerMonth",
      1,
    );
  });

  it("passes an explicit amount through", async () => {
    quotaManagerMock.checkQuota.mockResolvedValue(quotaCheck());
    await userCaller().quotaManagement.checkQuota({
      resource: "webhooksPerUser",
      amount: 5,
    });
    expect(quotaManagerMock.checkQuota).toHaveBeenCalledWith(
      USER_ID,
      "webhooksPerUser",
      5,
    );
  });

  it("rejects a missing resource with BAD_REQUEST", async () => {
    await expect(
      userCaller().quotaManagement.checkQuota(
        {} as { resource: "toolActionsPerMonth" },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a resource outside QuotaConfig with BAD_REQUEST (FINDINGS #17: no unvalidated cast)", async () => {
    for (const resource of ["not-a-quota", "__proto__", "constructor"]) {
      await expect(
        userCaller().quotaManagement.checkQuota({
          resource: resource as "toolActionsPerMonth",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(quotaManagerMock.checkQuota).not.toHaveBeenCalled();
  });
});

describe("quotaManagement.exportReport", () => {
  it("exports the caller's own report with a matching filename extension", async () => {
    usageReporterMock.exportUsageReport.mockResolvedValue("csv,data");

    const result = await userCaller().quotaManagement.exportReport({
      format: "csv",
    });

    expect(usageReporterMock.exportUsageReport).toHaveBeenCalledWith(
      USER_ID,
      "csv",
    );
    expect(result.data).toBe("csv,data");
    expect(result.filename).toMatch(/^usage-report-.*\.csv$/);
  });

  it("defaults to json", async () => {
    usageReporterMock.exportUsageReport.mockResolvedValue("{}");
    const result = await userCaller().quotaManagement.exportReport({});
    expect(usageReporterMock.exportUsageReport).toHaveBeenCalledWith(
      USER_ID,
      "json",
    );
    expect(result.filename).toMatch(/\.json$/);
  });

  it("is allowed for a Viewer (declared as a view-capability export of their own data)", async () => {
    usageReporterMock.exportUsageReport.mockResolvedValue("{}");
    await expect(
      viewerCaller().quotaManagement.exportReport({ format: "json" }),
    ).resolves.toMatchObject({ data: "{}" });
    expect(usageReporterMock.exportUsageReport).toHaveBeenCalledWith(
      USER_ID,
      "json",
    );
  });

  it("rejects an unknown format with BAD_REQUEST", async () => {
    await expect(
      userCaller().quotaManagement.exportReport({
        format: "xml" as unknown as "json",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("quotaManagement.updateUserQuota (admin)", () => {
  it("lets an admin update another user's quotas, dropping undefined fields", async () => {
    quotaManagerMock.updateUserQuota.mockResolvedValue(undefined);

    const result = await adminCaller().quotaManagement.updateUserQuota({
      userId: "target-user",
      quotas: { toolActionsPerMonth: 5000, webhooksPerUser: 3 },
    });

    expect(result).toEqual({ success: true });
    expect(quotaManagerMock.updateUserQuota).toHaveBeenCalledWith(
      "target-user",
      { toolActionsPerMonth: 5000, webhooksPerUser: 3 },
    );
    // Only the provided keys reach the lib layer — no undefined padding and,
    // critically, no schema defaults for unspecified quotas (zod v4
    // .partial() default regression: a single-field update used to reset
    // every other quota to its default).
    const forwarded = quotaManagerMock.updateUserQuota.mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(forwarded).sort()).toEqual([
      "toolActionsPerMonth",
      "webhooksPerUser",
    ]);
  });

  it("filters explicitly-undefined quota values before the lib layer", async () => {
    quotaManagerMock.updateUserQuota.mockResolvedValue(undefined);
    await adminCaller().quotaManagement.updateUserQuota({
      userId: "target-user",
      quotas: { toolActionsPerMonth: 5000, webhooksPerUser: undefined },
    });
    const forwarded = quotaManagerMock.updateUserQuota.mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(forwarded).toEqual({ toolActionsPerMonth: 5000 });
    expect(Object.keys(forwarded)).not.toContain("webhooksPerUser");
  });

  it("rejects a plain USER with FORBIDDEN", async () => {
    await expect(
      userCaller().quotaManagement.updateUserQuota({
        userId: "target-user",
        quotas: { toolActionsPerMonth: 5000 },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(quotaManagerMock.updateUserQuota).not.toHaveBeenCalled();
  });

  it("rejects a Viewer with FORBIDDEN", async () => {
    await expect(
      viewerCaller().quotaManagement.updateUserQuota({
        userId: "target-user",
        quotas: {},
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(quotaManagerMock.updateUserQuota).not.toHaveBeenCalled();
  });

  it("rejects an admin whose live database role is no longer admin", async () => {
    // Stale-JWT admin: session claims ADMIN but the row says USER.
    mockDbState.rows = [principalRow({ role: UserRole.USER })];
    const caller = callerWith(sessionFor({ role: UserRole.ADMIN }));
    await expect(
      caller.quotaManagement.updateUserQuota({
        userId: "target-user",
        quotas: {},
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-numeric quota values with BAD_REQUEST", async () => {
    await expect(
      adminCaller().quotaManagement.updateUserQuota({
        userId: "target-user",
        quotas: { toolActionsPerMonth: "lots" as unknown as number },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("quotaManagement.resetUserQuotas (admin)", () => {
  it("lets an admin reset specific resources", async () => {
    quotaManagerMock.resetQuotas.mockResolvedValue(undefined);

    const result = await adminCaller().quotaManagement.resetUserQuotas({
      userId: "target-user",
      resources: ["toolActionsPerMonth", "webhooksPerUser"],
    });

    expect(result).toEqual({ success: true });
    expect(quotaManagerMock.resetQuotas).toHaveBeenCalledWith("target-user", [
      "toolActionsPerMonth",
      "webhooksPerUser",
    ]);
  });

  it("resets all quotas when resources are omitted", async () => {
    quotaManagerMock.resetQuotas.mockResolvedValue(undefined);
    await adminCaller().quotaManagement.resetUserQuotas({
      userId: "target-user",
    });
    expect(quotaManagerMock.resetQuotas).toHaveBeenCalledWith(
      "target-user",
      undefined,
    );
  });

  it("rejects a plain USER and a Viewer with FORBIDDEN", async () => {
    await expect(
      userCaller().quotaManagement.resetUserQuotas({ userId: "target-user" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewerCaller().quotaManagement.resetUserQuotas({
        userId: "target-user",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(quotaManagerMock.resetQuotas).not.toHaveBeenCalled();
  });

  it("rejects a missing userId with BAD_REQUEST", async () => {
    await expect(
      adminCaller().quotaManagement.resetUserQuotas({} as { userId: string }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("quotaManagement.getRateLimitStats (admin)", () => {
  it("returns statistics for an admin", async () => {
    const stats = { activeBuckets: 3 };
    rateLimiterMock.getStatistics.mockResolvedValue(stats);
    await expect(
      adminCaller().quotaManagement.getRateLimitStats(),
    ).resolves.toBe(stats);
  });

  it("rejects a plain USER and a Viewer with FORBIDDEN", async () => {
    await expect(
      userCaller().quotaManagement.getRateLimitStats(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewerCaller().quotaManagement.getRateLimitStats(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rateLimiterMock.getStatistics).not.toHaveBeenCalled();
  });
});

describe("quotaManagement.getRateLimitStatus", () => {
  it("returns the caller's own user-key status with cleaned key and config", async () => {
    const status = { remaining: 42 };
    rateLimiterMock.getStatus.mockResolvedValue(status);

    await expect(
      userCaller().quotaManagement.getRateLimitStatus({
        key: { type: "user", identifier: USER_ID },
        config: { windowMs: 60000 },
      }),
    ).resolves.toBe(status);

    const [key, config] = rateLimiterMock.getStatus.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // exactOptionalPropertyTypes contract: absent subIdentifier/maxRequests
    // must not appear as explicit undefined keys.
    expect(key).toEqual({ type: "user", identifier: USER_ID });
    expect(Object.keys(key)).not.toContain("subIdentifier");
    expect(config).toEqual({ windowMs: 60000 });
    expect(Object.keys(config)).not.toContain("maxRequests");
  });

  it("keeps a provided subIdentifier and omits config entirely when absent", async () => {
    rateLimiterMock.getStatus.mockResolvedValue({});
    await userCaller().quotaManagement.getRateLimitStatus({
      key: { type: "user", identifier: USER_ID, subIdentifier: "tool:slack" },
    });
    expect(rateLimiterMock.getStatus).toHaveBeenCalledWith(
      { type: "user", identifier: USER_ID, subIdentifier: "tool:slack" },
      undefined,
    );
  });

  it("filters explicitly-undefined config values before the lib layer", async () => {
    rateLimiterMock.getStatus.mockResolvedValue({});
    await userCaller().quotaManagement.getRateLimitStatus({
      key: { type: "user", identifier: USER_ID },
      config: { windowMs: 1000, maxRequests: undefined },
    });
    const config = rateLimiterMock.getStatus.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(config).toEqual({ windowMs: 1000 });
    expect(Object.keys(config)).not.toContain("maxRequests");
  });

  it("FORBIDs checking another user's rate limits", async () => {
    await expect(
      userCaller().quotaManagement.getRateLimitStatus({
        key: { type: "user", identifier: "someone-else" },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Cannot check rate limits for other users",
    });
    expect(rateLimiterMock.getStatus).not.toHaveBeenCalled();
  });

  it("rejects an unknown key type with BAD_REQUEST", async () => {
    await expect(
      userCaller().quotaManagement.getRateLimitStatus({
        key: { type: "tenant" as unknown as "user", identifier: "x" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["ip", "api_key", "tool", "webhook", "custom"] as const)(
    "FORBIDs a plain user from reading %s-type counters (FINDINGS #16: cross-tenant state)",
    async (type) => {
      await expect(
        userCaller().quotaManagement.getRateLimitStatus({
          key: { type, identifier: "some-identifier" },
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Administrator role required to inspect non-user rate limits",
      });
      expect(rateLimiterMock.getStatus).not.toHaveBeenCalled();
    },
  );

  it("lets an admin read non-user counters and other users' user counters", async () => {
    const status = { remaining: 3 };
    rateLimiterMock.getStatus.mockResolvedValue(status);

    await expect(
      adminCaller().quotaManagement.getRateLimitStatus({
        key: { type: "tool", identifier: "slack" },
      }),
    ).resolves.toBe(status);
    expect(rateLimiterMock.getStatus).toHaveBeenCalledWith(
      { type: "tool", identifier: "slack" },
      undefined,
    );

    await expect(
      adminCaller().quotaManagement.getRateLimitStatus({
        key: { type: "user", identifier: "someone-else" },
      }),
    ).resolves.toBe(status);
    expect(rateLimiterMock.getStatus).toHaveBeenLastCalledWith(
      { type: "user", identifier: "someone-else" },
      undefined,
    );
  });

  it("still FORBIDs a stale-JWT admin (live role is USER) from non-user counters", async () => {
    // Session claims ADMIN but the principal row says USER —
    // protectedProcedure refreshes the role, so the gate uses the live one.
    mockDbState.rows = [principalRow({ role: UserRole.USER })];
    const caller = callerWith(sessionFor({ role: UserRole.ADMIN }));
    await expect(
      caller.quotaManagement.getRateLimitStatus({
        key: { type: "webhook", identifier: "wh-1" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rateLimiterMock.getStatus).not.toHaveBeenCalled();
  });
});

describe("quotaManagement.getConfiguration", () => {
  it("assembles quotas, rules, and per-feature checks for the caller", async () => {
    const userQuota = {
      toolActions: quotaCheck({ limit: 10000 }),
      webhooks: quotaCheck({ limit: 10 }),
      events: quotaCheck({ limit: 100 }),
      workflows: quotaCheck({ limit: 50 }),
      storage: quotaCheck({ limit: 1000 }),
      apiRequests: quotaCheck({ limit: 100000 }),
    };
    const rules = { toolActionsPerMonth: { action: "block" } };
    quotaManagerMock.getQuotaStatus.mockResolvedValue(userQuota);
    quotaManagerMock.getEnforcementRules.mockReturnValue(rules);
    quotaManagerMock.checkQuota.mockImplementation(
      (_userId: string, resource: string) =>
        Promise.resolve(quotaCheck({ resource })),
    );

    const result = await userCaller().quotaManagement.getConfiguration();

    expect(quotaManagerMock.getQuotaStatus).toHaveBeenCalledWith(USER_ID);
    expect(result.quotas).toBe(userQuota);
    expect(result.rules).toBe(rules);

    // Every per-feature drill-down is checked for the caller, not anyone else.
    const checkedResources = quotaManagerMock.checkQuota.mock.calls.map(
      (call: unknown[]) => {
        expect(call[0]).toBe(USER_ID);
        return call[1];
      },
    );
    expect(checkedResources.sort()).toEqual([
      "apiRequestsPerMinute",
      "eventExecutionsPerMonth",
      "toolActionsPerDay",
      "webhookEventsPerMonth",
      "workflowExecutionsPerMonth",
    ]);

    expect(result.features.toolActions.quotas.monthly).toBe(
      userQuota.toolActions,
    );
    expect(result.features.toolActions.quotas.daily).toMatchObject({
      resource: "toolActionsPerDay",
    });
    expect(result.features.webhooks.quotas.total).toBe(userQuota.webhooks);
    expect(result.features.events.quotas.total).toBe(userQuota.events);
    expect(result.features.workflows.quotas.total).toBe(userQuota.workflows);
    expect(result.features.storage.quotas.totalMB).toBe(userQuota.storage);
    expect(result.features.api.quotas.monthly).toBe(userQuota.apiRequests);
  });
});
