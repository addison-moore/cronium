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

const cacheState: { store: Map<string, unknown>; failing: boolean } = {
  store: new Map(),
  failing: false,
};

jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: {
    get: jest.fn((key: string) => {
      if (cacheState.failing) return Promise.reject(new Error("cache down"));
      return Promise.resolve(cacheState.store.get(key) ?? null);
    }),
    set: jest.fn((key: string, value: unknown) => {
      if (cacheState.failing) return Promise.reject(new Error("cache down"));
      cacheState.store.set(key, value);
      return Promise.resolve(true);
    }),
    delete: jest.fn((key: string) => {
      cacheState.store.delete(key);
      return Promise.resolve(true);
    }),
  },
}));

import {
  assertRoleCapability,
  getAuthorizedPrincipal,
  invalidatePrincipal,
  roleAllowsCapability,
  type Capability,
} from "@/server/security/authorization";
import { capabilityForRoute } from "@/server/security/route-capabilities";
import { UserRole, UserStatus } from "@/shared/schema";

const CAPABILITIES: Capability[] = [
  "view",
  "fork",
  "edit",
  "execute",
  "use-secret",
  "admin",
];

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 3,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.rows = [];
  dbState.error = null;
  cacheState.store.clear();
  cacheState.failing = false;
});

describe("role capability matrix (deny by default)", () => {
  it("gives Viewer only view", () => {
    expect(roleAllowsCapability(UserRole.VIEWER, "view")).toBe(true);
    for (const capability of CAPABILITIES.filter((c) => c !== "view")) {
      expect(roleAllowsCapability(UserRole.VIEWER, capability)).toBe(false);
    }
  });

  it("gives User everything except admin", () => {
    for (const capability of CAPABILITIES) {
      expect(roleAllowsCapability(UserRole.USER, capability)).toBe(
        capability !== "admin",
      );
    }
  });

  it("gives Admin all capabilities", () => {
    for (const capability of CAPABILITIES) {
      expect(roleAllowsCapability(UserRole.ADMIN, capability)).toBe(true);
    }
  });

  it("denies unknown roles everything", () => {
    for (const capability of CAPABILITIES) {
      expect(roleAllowsCapability("SUPERUSER", capability)).toBe(false);
      expect(roleAllowsCapability("", capability)).toBe(false);
    }
  });

  it("assertRoleCapability throws FORBIDDEN on denial", () => {
    expect(() => assertRoleCapability(UserRole.VIEWER, "execute")).toThrow(
      /role does not permit/,
    );
    expect(() => assertRoleCapability(UserRole.USER, "edit")).not.toThrow();
  });
});

describe("capabilityForRoute", () => {
  it("declared mutations use their declared capability", () => {
    expect(capabilityForRoute("events.execute", "mutation")).toBe("execute");
    expect(capabilityForRoute("admin.updateUser", "mutation")).toBe("admin");
    expect(capabilityForRoute("servers.testConnection", "mutation")).toBe(
      "use-secret",
    );
  });

  it("queries default to view", () => {
    expect(capabilityForRoute("events.getAll", "query")).toBe("view");
  });

  it("an UNDECLARED mutation falls back to edit (denied to Viewer)", () => {
    expect(capabilityForRoute("events.someNewMutation", "mutation")).toBe(
      "edit",
    );
  });

  it("public account-lifecycle flows resolve to view for role purposes", () => {
    expect(capabilityForRoute("userAuth.login", "mutation")).toBe("view");
  });
});

describe("getAuthorizedPrincipal (fail closed)", () => {
  it("returns the live principal for an active user", async () => {
    dbState.rows = [activeRow()];
    const principal = await getAuthorizedPrincipal("user-1", {
      expectedSessionVersion: 3,
    });
    expect(principal.role).toBe(UserRole.USER);
    expect(principal.sessionVersion).toBe(3);
  });

  it("rejects a missing user", async () => {
    dbState.rows = [];
    await expect(getAuthorizedPrincipal("gone")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a disabled user even with a matching session version", async () => {
    dbState.rows = [activeRow({ status: UserStatus.DISABLED })];
    await expect(
      getAuthorizedPrincipal("user-1", { expectedSessionVersion: 3 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a stale session version (password/role/status changed)", async () => {
    dbState.rows = [activeRow({ sessionVersion: 4 })];
    await expect(
      getAuthorizedPrincipal("user-1", { expectedSessionVersion: 3 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed when the database is unreachable", async () => {
    dbState.error = new Error("connection refused");
    await expect(getAuthorizedPrincipal("user-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("survives a failing cache by reading the database", async () => {
    cacheState.failing = true;
    dbState.rows = [activeRow()];
    const principal = await getAuthorizedPrincipal("user-1");
    expect(principal.id).toBe("user-1");
  });

  it("rejects an empty user id", async () => {
    await expect(getAuthorizedPrincipal("")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("invalidatePrincipal forces the next read to see fresh state", async () => {
    dbState.rows = [activeRow()];
    await getAuthorizedPrincipal("user-1");

    // Simulate a role/status change that the cache has not yet expired for.
    dbState.rows = [activeRow({ status: UserStatus.DISABLED })];
    // Without invalidation the cached ACTIVE principal would still pass.
    await expect(getAuthorizedPrincipal("user-1")).resolves.toBeDefined();

    await invalidatePrincipal("user-1");
    await expect(getAuthorizedPrincipal("user-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
