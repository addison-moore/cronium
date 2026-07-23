/**
 * @jest-environment node
 */
/**
 * Router tests for the tools tRPC router (routers/tools.ts).
 *
 * The REAL toolsRouter and the REAL protectedProcedure middleware chain run
 * (authentication → live principal → role capability → token scopes); the
 * database, credential encryption, credential cache, audit logging, rate
 * limiting, provider registry, and OAuth boundaries are factory-mocked. The
 * session is caller-controlled; the database principal rows are authoritative.
 *
 * Credential-safety invariants exercised here:
 *  - create/update never store plaintext (fail closed when encryption is down)
 *  - no response ever echoes a plaintext secret or the stored ciphertext
 *  - credential access is scoped to the owning user's rows
 */

// Mutable state read lazily by the hoisted @/server/db factory (same pattern
// as trpc-authorization.test.ts, which declares its state above jest.mock).
const dbState = {
  // users table (live principal re-validation in protectedProcedure)
  principalRows: [] as Array<Record<string, unknown>>,
  // tool_credentials selects WITH orderBy (getUserTools)
  toolRows: [] as Array<Record<string, unknown>>,
  // FIFO for tool_credentials selects WITHOUT orderBy (update ownership check,
  // then the rename-conflict check)
  plainToolSelects: [] as Array<Array<Record<string, unknown>>>,
  // events count select (checkToolActionUsage)
  eventCountRows: [] as Array<Record<string, unknown>>,
  // tool_action_logs select without join (checkToolActionUsage recent logs)
  toolActionLogRows: [] as Array<Record<string, unknown>>,
  // tool_action_logs select WITH innerJoin (getStats)
  statsRows: [] as Array<Record<string, unknown>>,
  insertCalls: [] as Array<Record<string, unknown>>,
  insertReturning: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  updateReturning: [] as Array<Record<string, unknown>>,
  deleteCalls: 0,
};

jest.mock("@/server/db", () => {
  const schema =
    jest.requireActual<typeof import("@/shared/schema")>("@/shared/schema");

  interface Query {
    table: unknown;
    calls: string[];
  }

  const resolveSelect = (q: Query): Array<Record<string, unknown>> => {
    if (q.table === schema.users) return dbState.principalRows;
    if (q.table === schema.toolCredentials) {
      if (q.calls.includes("orderBy")) return dbState.toolRows;
      return dbState.plainToolSelects.shift() ?? [];
    }
    if (q.table === schema.events) return dbState.eventCountRows;
    if (q.table === schema.toolActionLogs) {
      if (q.calls.includes("innerJoin")) return dbState.statsRows;
      return dbState.toolActionLogRows;
    }
    return [];
  };

  const makeSelectBuilder = () => {
    const q: Query = { table: undefined, calls: [] };
    const builder: Record<string, unknown> = {};
    for (const method of [
      "from",
      "where",
      "orderBy",
      "limit",
      "innerJoin",
      "leftJoin",
      "groupBy",
    ]) {
      builder[method] = (arg: unknown) => {
        q.calls.push(method);
        if (method === "from") q.table = arg;
        return builder;
      };
    }
    builder.then = (
      onFulfilled?: (rows: unknown) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) =>
      Promise.resolve()
        .then(() => resolveSelect(q))
        .then(onFulfilled, onRejected);
    return builder;
  };

  return {
    db: {
      select: jest.fn(() => makeSelectBuilder()),
      insert: jest.fn(() => ({
        values: (values: Record<string, unknown>) => {
          dbState.insertCalls.push(values);
          return {
            returning: () => Promise.resolve(dbState.insertReturning),
          };
        },
      })),
      update: jest.fn(() => ({
        set: (values: Record<string, unknown>) => {
          dbState.updateCalls.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve(dbState.updateReturning),
            }),
          };
        },
      })),
      delete: jest.fn(() => ({
        where: () => {
          dbState.deleteCalls += 1;
          return Promise.resolve(undefined);
        },
      })),
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

jest.mock("@/lib/security/credential-encryption", () => ({
  credentialEncryption: {
    isAvailable: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  },
}));

jest.mock("@/lib/tools/credential-cache", () => ({
  credentialCache: { get: jest.fn(), invalidate: jest.fn() },
}));

jest.mock("@/lib/security/audit-logger", () => ({
  auditLog: {
    credentialCreated: jest.fn(),
    credentialUpdated: jest.fn(),
    credentialDeleted: jest.fn(),
  },
}));

jest.mock("@/lib/security/rate-limiter", () => ({
  rateLimiter: { checkRateLimit: jest.fn(), checkQuota: jest.fn() },
}));

jest.mock("@/lib/tools/tool-registry", () => ({
  testToolConnection: jest.fn(),
  validateToolCredentials: jest.fn(),
  getServerActionById: jest.fn(),
}));

jest.mock("@/lib/scheduler/tool-action-health-monitor", () => ({
  toolActionHealthMonitor: {
    getHealthMetrics: jest.fn(),
    getRecommendations: jest.fn(),
    needsAttention: jest.fn(),
    getHealthSummary: jest.fn(),
    getUnhealthyActions: jest.fn(),
  },
}));

jest.mock("@/lib/oauth/credential-bridge", () => ({
  injectOAuthToken: jest.fn(),
}));

jest.mock("@/lib/oauth/TokenManager", () => {
  const hasValidTokens = jest.fn();
  const deleteTokens = jest.fn();
  return {
    TokenManager: jest.fn(() => ({ hasValidTokens, deleteTokens })),
    __tokenManagerMocks: { hasValidTokens, deleteTokens },
  };
});

jest.mock("@/lib/oauth/providers", () => ({
  GoogleOAuthProvider: jest.fn(),
  MicrosoftOAuthProvider: jest.fn(),
  SlackOAuthProvider: jest.fn(),
}));

// The slack sub-router is out of scope; substitute an empty (but real) router
// so composing the tools router still succeeds.
jest.mock("../tools/slack-routes", () => {
  const { createTRPCRouter } =
    jest.requireActual<typeof import("@/server/api/trpc")>("@/server/api/trpc");
  return { slackRouter: createTRPCRouter({}) };
});

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { z } from "zod";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { toolsRouter } from "../tools";
import { UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { credentialEncryption } from "@/lib/security/credential-encryption";
import { credentialCache } from "@/lib/tools/credential-cache";
import { auditLog } from "@/lib/security/audit-logger";
import { rateLimiter } from "@/lib/security/rate-limiter";
import {
  testToolConnection,
  validateToolCredentials,
  getServerActionById,
} from "@/lib/tools/tool-registry";
import { injectOAuthToken } from "@/lib/oauth/credential-bridge";
import { toolActionHealthMonitor } from "@/lib/scheduler/tool-action-health-monitor";

const mockIsAvailable = credentialEncryption.isAvailable as jest.Mock;
const mockEncrypt = credentialEncryption.encrypt as jest.Mock;
const mockDecrypt = credentialEncryption.decrypt as jest.Mock;
const mockCacheInvalidate = credentialCache.invalidate as jest.Mock;
const mockAuditCreated = auditLog.credentialCreated as jest.Mock;
const mockAuditUpdated = auditLog.credentialUpdated as jest.Mock;
const mockAuditDeleted = auditLog.credentialDeleted as jest.Mock;
const mockCheckRateLimit = rateLimiter.checkRateLimit as jest.Mock;
const mockCheckQuota = rateLimiter.checkQuota as jest.Mock;
const mockTestToolConnection = testToolConnection as jest.Mock;
const mockValidateCredentials = validateToolCredentials as jest.Mock;
const mockGetServerAction = getServerActionById as jest.Mock;
const mockInjectOAuthToken = injectOAuthToken as jest.Mock;
const mockHealthMetrics = toolActionHealthMonitor.getHealthMetrics as jest.Mock;
const mockHealthRecommendations =
  toolActionHealthMonitor.getRecommendations as jest.Mock;
const mockHealthNeedsAttention =
  toolActionHealthMonitor.needsAttention as jest.Mock;
const mockHealthSummary = toolActionHealthMonitor.getHealthSummary as jest.Mock;
const mockUnhealthyActions =
  toolActionHealthMonitor.getUnhealthyActions as jest.Mock;
const { __tokenManagerMocks } = jest.requireMock(
  "@/lib/oauth/TokenManager",
) as {
  __tokenManagerMocks: { hasValidTokens: jest.Mock; deleteTokens: jest.Mock };
};

const SECRET = "stored-secret-token-xyz";
const PLAINTEXT_SECRET = "hunter2-plaintext-secret";

// What the mocked encryption service "produces"; the router must store exactly
// this (stringified), never the plaintext.
const ENC = {
  data: "ciphertext-0123456789abcdef",
  iv: "aXYtdmFsdWU=",
  authTag: "dGFnLXZhbHVl",
  algorithm: "aes-256-gcm",
  keyDerivation: "scrypt-v1",
};

const router = createTRPCRouter({ tools: toolsRouter });
const createCaller = createCallerFactory(router);

function principalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "user-1",
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
      id: "user-1",
      email: "user@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerFor(session: Session | null) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

function userCaller() {
  return callerFor(sessionFor({}));
}

function viewerCaller() {
  dbState.principalRows = [principalRow({ role: UserRole.VIEWER, roleId: 3 })];
  return callerFor(sessionFor({ role: UserRole.VIEWER }));
}

function toolRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 5,
    userId: "user-1",
    name: "Team Slack",
    type: "SLACK",
    // object credentials exercise the "already an object" parse branch
    credentials: { token: SECRET, email: "ops@example.com" },
    isActive: true,
    encrypted: false,
    encryptionMetadata: null,
    description: "Primary workspace",
    tags: ["prod"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "debug").mockImplementation(() => undefined);

  dbState.principalRows = [principalRow()];
  dbState.toolRows = [];
  dbState.plainToolSelects = [];
  dbState.eventCountRows = [{ count: 0 }];
  dbState.toolActionLogRows = [];
  dbState.statsRows = [{ count: 0, successCount: 0, avgTime: 0 }];
  dbState.insertCalls = [];
  dbState.insertReturning = [];
  dbState.updateCalls = [];
  dbState.updateReturning = [];
  dbState.deleteCalls = 0;

  mockIsAvailable.mockReturnValue(true);
  mockEncrypt.mockReturnValue(ENC);
  mockDecrypt.mockReturnValue({});
  mockValidateCredentials.mockReturnValue({ valid: true, errors: [] });
  mockTestToolConnection.mockResolvedValue({
    success: true,
    message: "Connection successful",
    details: {},
  });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockCheckQuota.mockResolvedValue({ allowed: true });
  mockInjectOAuthToken.mockImplementation((credentials: unknown) =>
    Promise.resolve(credentials),
  );
  mockAuditCreated.mockResolvedValue(undefined);
  mockAuditUpdated.mockResolvedValue(undefined);
  mockAuditDeleted.mockResolvedValue(undefined);
});

describe("authentication and authorization", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(callerFor(null).tools.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows a Viewer to read but denies every mutation", async () => {
    dbState.toolRows = [toolRow()];
    const caller = viewerCaller();
    const forbidden = { code: "FORBIDDEN" };

    await expect(caller.tools.list()).resolves.toHaveLength(1);

    await expect(
      caller.tools.create({
        name: "New",
        type: "slack",
        credentials: { token: "x" },
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      caller.tools.update({ id: 5, name: "Renamed" }),
    ).rejects.toMatchObject(forbidden);
    await expect(caller.tools.delete({ id: 5 })).rejects.toMatchObject(
      forbidden,
    );
    await expect(caller.tools.testConnection({ id: 5 })).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      caller.tools.testCredentials({ type: "slack", credentials: {} }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      caller.tools.executeAction({
        toolId: 5,
        actionId: "slack-send-message",
        parameters: {},
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      caller.tools.revokeOAuthTokens({ toolId: 5, providerId: "google" }),
    ).rejects.toMatchObject(forbidden);

    // No Viewer mutation attempt may reach a write or a provider call.
    expect(dbState.insertCalls).toHaveLength(0);
    expect(dbState.updateCalls).toHaveLength(0);
    expect(dbState.deleteCalls).toBe(0);
    expect(mockTestToolConnection).not.toHaveBeenCalled();
  });

  it("rejects malformed input on every mutation with BAD_REQUEST", async () => {
    const caller = userCaller();
    const bad = { code: "BAD_REQUEST" };

    await expect(
      caller.tools.create({ name: "", type: "slack", credentials: {} }),
    ).rejects.toMatchObject(bad);
    await expect(
      caller.tools.update({ id: -1 } as never),
    ).rejects.toMatchObject(bad);
    await expect(caller.tools.delete({ id: 0 } as never)).rejects.toMatchObject(
      bad,
    );
    await expect(
      caller.tools.testConnection({} as never),
    ).rejects.toMatchObject(bad);
    await expect(
      caller.tools.testCredentials({ type: "", credentials: {} }),
    ).rejects.toMatchObject(bad);
    await expect(
      caller.tools.executeAction({
        actionId: "a",
        parameters: {},
      } as never),
    ).rejects.toMatchObject(bad);
    await expect(
      caller.tools.revokeOAuthTokens({
        toolId: 5,
        providerId: "github",
      } as never),
    ).rejects.toMatchObject(bad);
  });
});

describe("list", () => {
  it("returns the user's tools with secret fields blanked", async () => {
    dbState.toolRows = [toolRow(), toolRow({ id: 6, name: "Other" })];
    const result = await userCaller().tools.list();

    expect(result).toHaveLength(2);
    expect(result[0]!.credentials).toEqual({
      token: "",
      email: "ops@example.com",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("filters by id when provided", async () => {
    dbState.toolRows = [toolRow(), toolRow({ id: 6, name: "Other" })];
    const result = await userCaller().tools.list({ id: 6 });
    expect(result.map((t) => t.id)).toEqual([6]);
  });

  it("decrypts encrypted credentials server-side and still redacts secrets", async () => {
    dbState.toolRows = [
      toolRow({
        credentials: JSON.stringify(ENC),
        encrypted: true,
        encryptionMetadata: {
          algorithm: "aes-256-gcm",
          keyDerivation:
            '{"method":"scrypt","salt":"c2FsdA==","iterations":16384}',
        },
      }),
    ];
    mockDecrypt.mockReturnValue({ token: SECRET, channel: "#alerts" });

    const result = await userCaller().tools.list();

    expect(mockDecrypt).toHaveBeenCalledWith(ENC);
    expect(result[0]!.credentials).toEqual({ token: "", channel: "#alerts" });
    expect(result[0]!.encryptionMetadata?.keyDerivation).toMatchObject({
      method: "scrypt",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("returns empty credentials for a legacy non-JSON encrypted blob", async () => {
    dbState.toolRows = [
      toolRow({ credentials: "AAAA-legacy-opaque-blob", encrypted: true }),
    ];
    const result = await userCaller().tools.list();
    expect(result[0]!.credentials).toEqual({});
  });

  it("returns empty credentials when decryption fails", async () => {
    dbState.toolRows = [
      toolRow({ credentials: JSON.stringify(ENC), encrypted: true }),
    ];
    mockDecrypt.mockImplementation(() => {
      throw new Error("bad key");
    });
    const result = await userCaller().tools.list();
    expect(result[0]!.credentials).toEqual({});
  });

  it("never falls back to raw ciphertext when encryption is unavailable", async () => {
    mockIsAvailable.mockReturnValue(false);
    dbState.toolRows = [
      toolRow({ credentials: JSON.stringify(ENC), encrypted: true }),
    ];
    const result = await userCaller().tools.list();
    expect(result[0]!.credentials).toEqual({});
  });

  it("recovers credentials that are encrypted but not flagged as such", async () => {
    // Stored string is not JSON-object-shaped and encrypted=false: the router
    // attempts decryption anyway and must still redact the recovered secret.
    dbState.toolRows = [toolRow({ credentials: "12345", encrypted: false })];
    mockDecrypt.mockReturnValue({ token: SECRET, host: "smtp.example.com" });

    const result = await userCaller().tools.list();

    expect(result[0]!.credentials).toEqual({
      token: "",
      host: "smtp.example.com",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("returns empty credentials for an unflagged opaque blob that cannot be decrypted", async () => {
    dbState.toolRows = [
      toolRow({ credentials: "opaque-not-json-blob", encrypted: false }),
    ];
    const result = await userCaller().tools.list();
    expect(result[0]!.credentials).toEqual({});
  });

  it("parses plain JSON string credentials and redacts them", async () => {
    dbState.toolRows = [
      toolRow({
        credentials: JSON.stringify({ token: "plain-secret", host: "smtp" }),
        encrypted: false,
      }),
    ];
    const result = await userCaller().tools.list();
    expect(result[0]!.credentials).toEqual({ token: "", host: "smtp" });
  });
});

describe("getAll", () => {
  const threeTools = () => [
    toolRow({
      id: 1,
      name: "Alpha",
      type: "SLACK",
      description: "First workspace",
      tags: ["prod"],
    }),
    toolRow({
      id: 2,
      name: "Beta",
      type: "DISCORD",
      description: "Second workspace",
      tags: ["dev"],
    }),
    toolRow({
      id: 3,
      name: "Gamma",
      type: "SLACK",
      description: "Third workspace",
      tags: ["staging"],
    }),
  ];

  it("returns redacted tools with pagination metadata", async () => {
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({ limit: 2, offset: 0 });

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]!.credentials).toEqual({
      token: "",
      email: "ops@example.com",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const lastPage = await userCaller().tools.getAll({ limit: 2, offset: 2 });
    expect(lastPage.tools).toHaveLength(1);
    expect(lastPage.hasMore).toBe(false);
  });

  it("filters by type", async () => {
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({ type: "DISCORD" });
    expect(result.tools.map((t) => t.id)).toEqual([2]);
  });

  it("matches search against the name", async () => {
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({ search: "gam" });
    expect(result.tools.map((t) => t.id)).toEqual([3]);
  });

  it("matches search against the description", async () => {
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({ search: "second" });
    expect(result.tools.map((t) => t.id)).toEqual([2]);
  });

  it("matches search against tags even when a description is present (regression)", async () => {
    // Bug fixed in tools.ts: `description?.includes(...) ?? tags.some(...)`
    // only consulted tags when description was null/undefined, so tag search
    // silently failed for any tool that had a description.
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({ search: "prod" });
    expect(result.tools.map((t) => t.id)).toEqual([1]);
  });

  it("sorts by name descending", async () => {
    dbState.toolRows = threeTools();
    const result = await userCaller().tools.getAll({
      sortBy: "name",
      sortOrder: "desc",
    });
    expect(result.tools.map((t) => t.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("sorts by type and by timestamps", async () => {
    dbState.toolRows = [
      toolRow({ id: 1, name: "A", type: "SLACK", createdAt: new Date(3000) }),
      toolRow({ id: 2, name: "B", type: "DISCORD", createdAt: new Date(1000) }),
      toolRow({ id: 3, name: "C", type: "EMAIL", createdAt: new Date(2000) }),
    ];
    const byType = await userCaller().tools.getAll({ sortBy: "type" });
    expect(byType.tools.map((t) => t.type)).toEqual([
      "DISCORD",
      "EMAIL",
      "SLACK",
    ]);

    const byCreated = await userCaller().tools.getAll({
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(byCreated.tools.map((t) => t.id)).toEqual([1, 3, 2]);

    const byUpdated = await userCaller().tools.getAll({ sortBy: "updatedAt" });
    expect(byUpdated.tools).toHaveLength(3);
  });
});

describe("create", () => {
  const input = {
    name: "New Slack",
    type: "slack",
    credentials: { token: PLAINTEXT_SECRET, email: "a@b.c" },
    description: "team tool",
    tags: ["team"],
  };

  it("encrypts credentials before storage and never echoes plaintext or ciphertext", async () => {
    dbState.insertReturning = [
      toolRow({
        id: 10,
        name: "New Slack",
        credentials: JSON.stringify(ENC),
        encrypted: true,
      }),
    ];

    const result = await userCaller().tools.create(input);

    // Validation used the lowercase plugin key.
    expect(mockValidateCredentials).toHaveBeenCalledWith(
      "slack",
      input.credentials,
    );
    // The encryption boundary was crossed with the submitted plaintext...
    expect(mockEncrypt).toHaveBeenCalledWith(input.credentials);
    // ...and the STORED value is the ciphertext envelope, not plaintext.
    expect(dbState.insertCalls).toHaveLength(1);
    const stored = dbState.insertCalls[0]!;
    expect(stored.credentials).toBe(JSON.stringify(ENC));
    expect(String(stored.credentials)).not.toContain(PLAINTEXT_SECRET);
    expect(stored.encrypted).toBe(true);
    expect(stored.type).toBe("SLACK");
    expect(stored.userId).toBe("user-1");

    // The response masks secret values and does not leak the ciphertext.
    expect(result.id).toBe(10);
    expect(result.credentials).toEqual({ token: "", email: "a@b.c" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PLAINTEXT_SECRET);
    expect(serialized).not.toContain(ENC.data);

    expect(mockAuditCreated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", toolId: 10 }),
      "slack",
    );
  });

  it("fails closed (no write) when the encryption service is unavailable", async () => {
    mockIsAvailable.mockReturnValue(false);
    await expect(userCaller().tools.create(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("rejects credentials the plugin validator refuses", async () => {
    mockValidateCredentials.mockReturnValue({
      valid: false,
      errors: ["token is required"],
    });
    await expect(userCaller().tools.create(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("token is required"),
    });
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("rejects a duplicate tool name", async () => {
    dbState.toolRows = [toolRow({ name: "New Slack" })];
    await expect(userCaller().tools.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dbState.insertCalls).toHaveLength(0);
  });
});

describe("update", () => {
  it("merges blank secrets with stored values, re-encrypts, and invalidates the credential cache", async () => {
    // Ownership check (plain select), then getUserTools for the merge.
    dbState.plainToolSelects = [[toolRow()]];
    dbState.toolRows = [
      toolRow({ credentials: { token: SECRET, email: "ops@example.com" } }),
    ];
    dbState.updateReturning = [
      toolRow({ credentials: JSON.stringify(ENC), encrypted: true }),
    ];

    const result = await userCaller().tools.update({
      id: 5,
      credentials: { token: "", email: "new@b.c" },
    });

    // Blank secret means "keep current": the merged plaintext reached the
    // encryption boundary; validation ran on the merged object with the
    // existing tool's type (lowercased).
    expect(mockEncrypt).toHaveBeenCalledWith({
      token: SECRET,
      email: "new@b.c",
    });
    expect(mockValidateCredentials).toHaveBeenCalledWith("slack", {
      token: SECRET,
      email: "new@b.c",
    });

    expect(dbState.updateCalls).toHaveLength(1);
    const stored = dbState.updateCalls[0]!;
    expect(stored.credentials).toBe(JSON.stringify(ENC));
    expect(String(stored.credentials)).not.toContain(SECRET);
    expect(stored.encrypted).toBe(true);

    expect(mockCacheInvalidate).toHaveBeenCalledWith(5, "user-1");
    expect(mockAuditUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", toolId: 5 }),
      expect.objectContaining({ credentialsUpdated: true }),
    );

    // Response is masked and leaks neither plaintext nor ciphertext.
    expect(result.credentials).toEqual({ token: "", email: "new@b.c" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(ENC.data);
  });

  it("updates metadata without touching stored credentials", async () => {
    dbState.plainToolSelects = [[toolRow()], []]; // ownership, rename-conflict
    dbState.updateReturning = [toolRow({ name: "Renamed" })];

    const result = await userCaller().tools.update({ id: 5, name: "Renamed" });

    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(dbState.updateCalls[0]).not.toHaveProperty("credentials");
    expect(dbState.updateCalls[0]!.name).toBe("Renamed");
    expect(result.credentials).toEqual({});
  });

  it("returns NOT_FOUND for a tool the caller does not own", async () => {
    dbState.plainToolSelects = [[]];
    await expect(
      userCaller().tools.update({ id: 999, name: "Hijack" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("rejects a rename onto another tool's name", async () => {
    dbState.plainToolSelects = [
      [toolRow()],
      [toolRow({ id: 6, name: "Taken" })],
    ];
    await expect(
      userCaller().tools.update({ id: 5, name: "Taken" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("fails closed on credential updates when encryption is unavailable", async () => {
    dbState.plainToolSelects = [[toolRow()]];
    dbState.toolRows = [toolRow()];
    mockIsAvailable.mockReturnValue(false);

    await expect(
      userCaller().tools.update({ id: 5, credentials: { token: "new" } }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(dbState.updateCalls).toHaveLength(0);
  });
});

describe("delete", () => {
  it("deletes an owned tool, drops its cached credential, and audits", async () => {
    dbState.toolRows = [toolRow()];
    const result = await userCaller().tools.delete({ id: 5 });

    expect(result).toEqual({ success: true });
    expect(dbState.deleteCalls).toBe(1);
    expect(mockCacheInvalidate).toHaveBeenCalledWith(5, "user-1");
    expect(mockAuditDeleted).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", toolId: 5 }),
      "SLACK",
    );
  });

  it("returns NOT_FOUND for a tool outside the caller's scope", async () => {
    dbState.toolRows = [];
    await expect(userCaller().tools.delete({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(dbState.deleteCalls).toBe(0);
  });
});

describe("testConnection", () => {
  it("runs the provider check with the decrypted credentials and reports usage", async () => {
    dbState.toolRows = [toolRow()];
    dbState.eventCountRows = [{ count: 3 }];
    dbState.toolActionLogRows = [
      { createdAt: new Date("2026-07-01T00:00:00Z") },
    ];

    const result = await userCaller().tools.testConnection({ id: 5 });

    expect(mockTestToolConnection).toHaveBeenCalledWith("SLACK", {
      token: SECRET,
      email: "ops@example.com",
    });
    expect(result.success).toBe(true);
    expect(result.details.authenticated).toBe(true);
    expect(result.details.toolActionUsage).toMatchObject({
      eventCount: 3,
      recentExecutions: 1,
    });
    expect(typeof result.duration).toBe("number");
  });

  it("returns an unsuccessful result when the provider rejects", async () => {
    dbState.toolRows = [toolRow()];
    mockTestToolConnection.mockResolvedValue({
      success: false,
      message: "invalid_auth",
    });
    const result = await userCaller().tools.testConnection({ id: 5 });
    expect(result.success).toBe(false);
    expect(result.message).toBe("invalid_auth");
  });

  it("returns NOT_FOUND for another user's tool id", async () => {
    dbState.toolRows = [];
    await expect(
      userCaller().tools.testConnection({ id: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockTestToolConnection).not.toHaveBeenCalled();
  });
});

describe("testCredentials", () => {
  it("tests submitted credentials after shape validation", async () => {
    const result = await userCaller().tools.testCredentials({
      type: "slack",
      credentials: { token: "candidate" },
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith("user-1", "slack");
    expect(mockTestToolConnection).toHaveBeenCalledWith("slack", {
      token: "candidate",
    });
    expect(result.success).toBe(true);
  });

  it("is rate limited before any provider call", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    await expect(
      userCaller().tools.testCredentials({
        type: "slack",
        credentials: { token: "x" },
      }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("30"),
    });
    expect(mockTestToolConnection).not.toHaveBeenCalled();
  });

  it("returns an inline failure for invalid credential shapes", async () => {
    mockValidateCredentials.mockReturnValue({
      valid: false,
      errors: ["token is required"],
    });
    const result = await userCaller().tools.testCredentials({
      type: "slack",
      credentials: {},
    });
    expect(result).toMatchObject({
      success: false,
      message: "token is required",
    });
    expect(mockTestToolConnection).not.toHaveBeenCalled();
  });

  it("falls back to the stored secret when editing with a blank secret field", async () => {
    dbState.toolRows = [toolRow()];
    await userCaller().tools.testCredentials({
      type: "slack",
      credentials: { token: "", channel: "#x" },
      toolId: 5,
    });
    expect(mockTestToolConnection).toHaveBeenCalledWith(
      "slack",
      expect.objectContaining({ token: SECRET, channel: "#x" }),
    );
  });
});

describe("getStats", () => {
  it("aggregates the caller's tools and today's executions", async () => {
    dbState.toolRows = [
      toolRow({ id: 1, type: "SLACK" }),
      toolRow({ id: 2, type: "SLACK" }),
      toolRow({ id: 3, type: "DISCORD", isActive: false }),
    ];
    dbState.statsRows = [{ count: 4, successCount: 2, avgTime: 120 }];

    const stats = await userCaller().tools.getStats({ period: "day" });

    expect(stats.totalTools).toBe(3);
    expect(stats.activeTools).toBe(2);
    expect(stats.inactiveTools).toBe(1);
    expect(stats.executionsToday).toBe(4);
    expect(stats.successRate).toBe(50);
    expect(stats.avgResponseTime).toBe(120);
    expect(stats.byType).toEqual({ slack: 2, discord: 1 });
  });

  it("returns NOT_FOUND for an unknown toolId", async () => {
    dbState.toolRows = [toolRow({ id: 1 })];
    await expect(
      userCaller().tools.getStats({ period: "week", toolId: 999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["week", "month", "year"] as const)(
    "computes the %s window without error",
    async (period) => {
      dbState.toolRows = [toolRow()];
      const stats = await userCaller().tools.getStats({ period });
      expect(stats.period).toBe(period);
    },
  );
});

describe("getToolActionHealth", () => {
  it("returns metrics and recommendations for a specific tool action", async () => {
    const metrics = { healthScore: 92, status: "healthy" };
    mockHealthMetrics.mockReturnValue(metrics);
    mockHealthRecommendations.mockReturnValue(["all good"]);
    mockHealthNeedsAttention.mockReturnValue(false);

    const result = await userCaller().tools.getToolActionHealth({
      toolId: 5,
      actionId: "slack-send-message",
    });

    expect(result).toMatchObject({
      success: true,
      metrics,
      recommendations: ["all good"],
      needsAttention: false,
    });
  });

  it("reports unknown when no health data exists", async () => {
    mockHealthMetrics.mockReturnValue(null);
    const result = await userCaller().tools.getToolActionHealth({
      toolId: 5,
      actionId: "slack-send-message",
    });
    expect(result).toMatchObject({ success: true, status: "unknown" });
  });

  it("returns the overall summary with formatted unhealthy actions", async () => {
    mockHealthSummary.mockReturnValue({ total: 2, unhealthy: 1 });
    mockUnhealthyActions.mockReturnValue([
      {
        toolId: 5,
        actionId: "slack-send-message",
        status: "unhealthy",
        healthScore: 40,
        failureCount: 5,
        totalExecutions: 10,
        averageLatency: 123.6,
        lastExecutionTime: new Date("2026-07-01T00:00:00Z"),
      },
    ]);

    const result = await userCaller().tools.getToolActionHealth();

    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ total: 2, unhealthy: 1 });
    expect(result.unhealthyActions![0]).toMatchObject({
      toolId: 5,
      failureRate: "50.0%",
      averageLatency: 124,
    });
  });
});

describe("executeAction", () => {
  function slackAction(overrides: Record<string, unknown> = {}) {
    return {
      id: "slack-send-message",
      name: "Send Message",
      inputSchema: z.object({ channel: z.string() }),
      execute: jest.fn().mockResolvedValue({ delivered: true }),
      ...overrides,
    };
  }

  it("validates, rate limits, injects OAuth, and executes the action", async () => {
    dbState.toolRows = [toolRow()];
    const action = slackAction();
    mockGetServerAction.mockReturnValue(action);
    mockInjectOAuthToken.mockImplementation((credentials: object) =>
      Promise.resolve({ ...credentials, accessToken: "fresh-token" }),
    );

    const result = await userCaller().tools.executeAction({
      toolId: 5,
      actionId: "slack-send-message",
      parameters: { channel: "#general" },
    });

    expect(mockCheckRateLimit).toHaveBeenCalledWith("user-1", "SLACK");
    expect(mockCheckQuota).toHaveBeenCalledWith("user-1", "SLACK");
    expect(mockInjectOAuthToken).toHaveBeenCalledWith(
      { token: SECRET, email: "ops@example.com" },
      { userId: "user-1", toolId: 5, toolType: "SLACK" },
    );
    expect(action.execute).toHaveBeenCalledWith(
      expect.objectContaining({ token: SECRET, accessToken: "fresh-token" }),
      { channel: "#general" },
      expect.objectContaining({ isTest: false }),
    );
    expect(result).toMatchObject({
      success: true,
      result: { delivered: true },
      actionId: "slack-send-message",
      isTest: false,
    });
  });

  it("returns NOT_FOUND for a tool the caller does not own (regression: was 500)", async () => {
    dbState.toolRows = [];
    mockGetServerAction.mockReturnValue(slackAction());
    await expect(
      userCaller().tools.executeAction({
        toolId: 999,
        actionId: "slack-send-message",
        parameters: { channel: "#general" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for an unknown action id", async () => {
    dbState.toolRows = [toolRow()];
    mockGetServerAction.mockReturnValue(undefined);
    await expect(
      userCaller().tools.executeAction({
        toolId: 5,
        actionId: "nope",
        parameters: {},
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns BAD_REQUEST when parameters fail the action schema (regression: was 500)", async () => {
    dbState.toolRows = [toolRow()];
    const action = slackAction();
    mockGetServerAction.mockReturnValue(action);
    await expect(
      userCaller().tools.executeAction({
        toolId: 5,
        actionId: "slack-send-message",
        parameters: {},
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Invalid parameters"),
    });
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("returns TOO_MANY_REQUESTS when rate limited (regression: was 500)", async () => {
    dbState.toolRows = [toolRow()];
    const action = slackAction();
    mockGetServerAction.mockReturnValue(action);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 45 });

    await expect(
      userCaller().tools.executeAction({
        toolId: 5,
        actionId: "slack-send-message",
        parameters: { channel: "#general" },
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("returns TOO_MANY_REQUESTS when the quota is exhausted", async () => {
    dbState.toolRows = [toolRow()];
    const action = slackAction();
    mockGetServerAction.mockReturnValue(action);
    mockCheckQuota.mockResolvedValue({ allowed: false });

    await expect(
      userCaller().tools.executeAction({
        toolId: 5,
        actionId: "slack-send-message",
        parameters: { channel: "#general" },
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("wraps provider execution failures as INTERNAL_SERVER_ERROR", async () => {
    dbState.toolRows = [toolRow()];
    const action = slackAction({
      execute: jest.fn().mockRejectedValue(new Error("slack down")),
    });
    mockGetServerAction.mockReturnValue(action);

    await expect(
      userCaller().tools.executeAction({
        toolId: 5,
        actionId: "slack-send-message",
        parameters: { channel: "#general" },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("checkOAuthStatus", () => {
  afterEach(() => {
    delete process.env.OAUTH_GOOGLE_CLIENT_ID;
    delete process.env.OAUTH_GOOGLE_CLIENT_SECRET;
  });

  it("reports an unconfigured provider without failing", async () => {
    const result = await userCaller().tools.checkOAuthStatus({
      toolId: 5,
      providerId: "google",
    });
    expect(result).toMatchObject({ configured: false, hasTokens: false });
  });

  it("reports token status when the provider is configured", async () => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "client-id";
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "client-secret";
    __tokenManagerMocks.hasValidTokens.mockResolvedValue(true);

    const result = await userCaller().tools.checkOAuthStatus({
      toolId: 5,
      providerId: "google",
    });

    expect(result).toEqual({
      configured: true,
      hasTokens: true,
      providerId: "google",
    });
    expect(__tokenManagerMocks.hasValidTokens).toHaveBeenCalledWith(
      "user-1",
      5,
    );
  });
});

describe("revokeOAuthTokens", () => {
  afterEach(() => {
    delete process.env.OAUTH_SLACK_CLIENT_ID;
    delete process.env.OAUTH_SLACK_CLIENT_SECRET;
  });

  it("deletes the caller's tokens for the tool", async () => {
    process.env.OAUTH_SLACK_CLIENT_ID = "client-id";
    process.env.OAUTH_SLACK_CLIENT_SECRET = "client-secret";
    __tokenManagerMocks.deleteTokens.mockResolvedValue(undefined);

    const result = await userCaller().tools.revokeOAuthTokens({
      toolId: 5,
      providerId: "slack",
    });

    expect(result).toEqual({ success: true });
    expect(__tokenManagerMocks.deleteTokens).toHaveBeenCalledWith("user-1", 5);
  });

  it("returns BAD_REQUEST when the provider is not configured (regression: was 500)", async () => {
    await expect(
      userCaller().tools.revokeOAuthTokens({
        toolId: 5,
        providerId: "slack",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(__tokenManagerMocks.deleteTokens).not.toHaveBeenCalled();
  });
});
