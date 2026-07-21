/**
 * Exploit-focused regressions for HI-03 (Viewer read-only not enforced) and
 * HI-04 (disabled/demoted users retain JWT/bearer access). These run the REAL
 * protectedProcedure/adminProcedure middleware chain from trpc.ts against a
 * minimal router, with the database mocked at the driver boundary — the
 * session is attacker-controlled, the database rows are authoritative.
 */
const dbState: {
  rows: Array<Record<string, unknown>>;
  error: Error | null;
} = { rows: [], error: null };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => {
            if (dbState.error) return Promise.reject(dbState.error);
            return Promise.resolve(dbState.rows);
          }),
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

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program; the cross-cutting tests project has no
// `include` for src/types.
import type {} from "@/types/next-auth";
import {
  adminProcedure,
  createCallerFactory,
  createTRPCRouter,
  protectedProcedure,
} from "@/server/api/trpc";
import { UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";

const testRouter = createTRPCRouter({
  events: createTRPCRouter({
    getAll: protectedProcedure.query(() => "event-list"),
    create: protectedProcedure.mutation(() => "created"),
    execute: protectedProcedure.mutation(() => "executed"),
  }),
  admin: createTRPCRouter({
    updateUser: adminProcedure.mutation(() => "admin-ok"),
  }),
});

const createCaller = createCallerFactory(testRouter);

function dbRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "user-1",
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    ...overrides,
  };
}

function sessionFor(overrides: Record<string, unknown>): Session {
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

function callerWith(session: Session | null) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

beforeEach(() => {
  dbState.rows = [];
  dbState.error = null;
});

describe("Viewer read-only enforcement (HI-03)", () => {
  beforeEach(() => {
    dbState.rows = [dbRow({ role: UserRole.VIEWER, roleId: 3 })];
  });

  it("allows a Viewer to read", async () => {
    const caller = callerWith(sessionFor({ role: UserRole.VIEWER }));
    await expect(caller.events.getAll()).resolves.toBe("event-list");
  });

  it("denies a Viewer every mutation", async () => {
    const caller = callerWith(sessionFor({ role: UserRole.VIEWER }));
    await expect(caller.events.create()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.events.execute()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies mutations even when the stale JWT still claims USER", async () => {
    // The session was minted before the account was demoted to Viewer, and the
    // sessionVersion bump means the old session is rejected outright.
    const caller = callerWith(sessionFor({ role: UserRole.USER }));
    dbState.rows = [
      dbRow({ role: UserRole.VIEWER, roleId: 3, sessionVersion: 2 }),
    ];
    await expect(caller.events.create()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    // Even if the attacker somehow forged a matching version, the live role
    // from the database wins and the mutation is still denied.
    const forged = callerWith(
      sessionFor({ role: UserRole.USER, sessionVersion: 2 }),
    );
    await expect(forged.events.create()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("Live principal revocation (HI-04)", () => {
  it("rejects a disabled user on every request despite a valid JWT", async () => {
    dbState.rows = [dbRow({ status: UserStatus.DISABLED })];
    const caller = callerWith(sessionFor({}));
    await expect(caller.events.getAll()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.events.create()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a deleted user", async () => {
    dbState.rows = [];
    const caller = callerWith(sessionFor({}));
    await expect(caller.events.getAll()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a session issued before a password/role/status change", async () => {
    dbState.rows = [dbRow({ sessionVersion: 5 })];
    const caller = callerWith(sessionFor({ sessionVersion: 4 }));
    await expect(caller.events.getAll()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects sessions that predate the sessionVersion upgrade", async () => {
    dbState.rows = [dbRow()];
    const caller = callerWith(sessionFor({ sessionVersion: undefined }));
    await expect(caller.events.getAll()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails closed when account state cannot be established", async () => {
    dbState.error = new Error("database unreachable");
    const caller = callerWith(sessionFor({}));
    await expect(caller.events.create()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("denies admin procedures to a demoted admin immediately", async () => {
    // JWT still claims ADMIN with a matching version, but the database says
    // the account is now a regular USER.
    dbState.rows = [dbRow({ role: UserRole.USER })];
    const caller = callerWith(sessionFor({ role: UserRole.ADMIN }));
    await expect(caller.admin.updateUser()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("still allows a valid active user through", async () => {
    dbState.rows = [dbRow()];
    const caller = callerWith(sessionFor({}));
    await expect(caller.events.create()).resolves.toBe("created");
    await expect(caller.admin.updateUser()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    dbState.rows = [dbRow({ role: UserRole.ADMIN, roleId: 1 })];
    const admin = callerWith(sessionFor({ role: UserRole.ADMIN }));
    await expect(admin.admin.updateUser()).resolves.toBe("admin-ok");
  });

  it("rejects unauthenticated callers", async () => {
    const caller = callerWith(null);
    await expect(caller.events.getAll()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
