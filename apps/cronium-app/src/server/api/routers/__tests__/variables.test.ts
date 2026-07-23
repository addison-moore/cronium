/**
 * Router tests for variablesRouter (src/server/api/routers/variables.ts).
 *
 * The REAL router runs through the REAL protectedProcedure middleware chain
 * (live-principal re-validation, deny-by-default route capabilities); the
 * database is mocked at the driver boundary and the storage layer is mocked
 * so the tests assert the router contract: CRUD semantics, ownership scoping
 * (every storage call is keyed by the session user), key-uniqueness conflict
 * handling, and value hiding on exports with includeValues: false.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Module mocks — physically first, before any imports: the factories must be
// registered before the import chain pulls in @/server/db, whose t3-env
// validation crashes under jest.
// ---------------------------------------------------------------------------

const dbState: {
  rows: Array<Record<string, unknown>>;
} = { rows: [] };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(dbState.rows)),
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

jest.mock("@/server/storage", () => ({
  storage: {
    queryUserVariables: jest.fn(),
    getUserVariables: jest.fn(),
    getUserVariable: jest.fn(),
    createUserVariable: jest.fn(),
    updateUserVariable: jest.fn(),
    deleteUserVariable: jest.fn(),
    deleteUserVariableByKey: jest.fn(),
    getAllEvents: jest.fn(),
    getAllWorkflows: jest.fn(),
  },
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { variablesRouter } from "../variables";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";

// Route paths must match the app router ("variables.create" etc.) so the
// deny-by-default capability inventory applies exactly as in production.
const testRouter = createTRPCRouter({ variables: variablesRouter });
const createCaller = createCallerFactory(testRouter);

const mockStorage = storage as unknown as Record<string, jest.Mock>;

const USER_ID = "user-1";

function dbRow(
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
  dbState.rows = [dbRow()];
  return callerWith(sessionFor());
}

function viewerCaller() {
  dbState.rows = [dbRow({ role: UserRole.VIEWER, roleId: 3 })];
  return callerWith(sessionFor({ role: UserRole.VIEWER }));
}

interface TestVariable {
  id: number;
  userId: string;
  key: string;
  value: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeVariable(overrides: Partial<TestVariable> = {}): TestVariable {
  return {
    id: 1,
    userId: USER_ID,
    key: "API_URL",
    value: "https://example.com",
    description: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    ...overrides,
  };
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  dbState.rows = [dbRow()];
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// variables.getAll
// ---------------------------------------------------------------------------

describe("variables.getAll", () => {
  it("returns the user's variables with paging metadata", async () => {
    const items = [makeVariable(), makeVariable({ id: 2, key: "TOKEN_URL" })];
    mockStorage.queryUserVariables!.mockResolvedValueOnce({
      items,
      total: 2,
      hasMore: false,
    });

    const result = await userCaller().variables.getAll({});

    // Ownership scoping: query is keyed by the session user with parsed
    // defaults applied.
    expect(mockStorage.queryUserVariables).toHaveBeenCalledWith(USER_ID, {
      limit: 20,
      offset: 0,
      sortBy: "key",
      sortOrder: "asc",
    });
    expect(result).toEqual({ variables: items, total: 2, hasMore: false });
  });

  it("passes search and sort options through", async () => {
    mockStorage.queryUserVariables!.mockResolvedValueOnce({
      items: [],
      total: 0,
      hasMore: false,
    });

    await userCaller().variables.getAll({
      search: "API",
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 5,
      offset: 10,
    });

    expect(mockStorage.queryUserVariables).toHaveBeenCalledWith(USER_ID, {
      search: "API",
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 5,
      offset: 10,
    });
  });

  it("rejects out-of-range pagination (zod)", async () => {
    await expect(
      userCaller().variables.getAll({ limit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userCaller().variables.getAll({ limit: 101 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockStorage.queryUserVariables).not.toHaveBeenCalled();
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    mockStorage.queryUserVariables!.mockRejectedValueOnce(new Error("db down"));
    await expect(userCaller().variables.getAll({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

// ---------------------------------------------------------------------------
// variables.getById / variables.getByKey
// ---------------------------------------------------------------------------

describe("variables.getById", () => {
  it("returns the variable when it belongs to the user", async () => {
    const variable = makeVariable({ id: 3 });
    mockStorage.getUserVariables!.mockResolvedValueOnce([
      makeVariable(),
      variable,
    ]);

    await expect(userCaller().variables.getById({ id: 3 })).resolves.toBe(
      variable,
    );
    expect(mockStorage.getUserVariables).toHaveBeenCalledWith(USER_ID);
  });

  it("throws NOT_FOUND when the id belongs to someone else (ownership scoping)", async () => {
    // Another user's variable never appears in the caller's list, so the id
    // simply does not resolve.
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    await expect(
      userCaller().variables.getById({ id: 999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a non-positive id (zod)", async () => {
    await expect(
      userCaller().variables.getById({ id: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockStorage.getUserVariables).not.toHaveBeenCalled();
  });
});

describe("variables.getByKey", () => {
  it("returns the variable for the caller's key", async () => {
    const variable = makeVariable();
    mockStorage.getUserVariable!.mockResolvedValueOnce(variable);

    await expect(
      userCaller().variables.getByKey({ key: "API_URL" }),
    ).resolves.toBe(variable);
    expect(mockStorage.getUserVariable).toHaveBeenCalledWith(
      USER_ID,
      "API_URL",
    );
  });

  it("throws NOT_FOUND for an unknown key", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    await expect(
      userCaller().variables.getByKey({ key: "NOPE" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an empty key (zod)", async () => {
    await expect(
      userCaller().variables.getByKey({ key: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// variables.create
// ---------------------------------------------------------------------------

describe("variables.create", () => {
  it("creates a variable for the session user, defaulting description to null", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    const created = makeVariable({ key: "NEW_KEY", value: "v" });
    mockStorage.createUserVariable!.mockResolvedValueOnce(created);

    const result = await userCaller().variables.create({
      key: "NEW_KEY",
      value: "v",
    });

    expect(mockStorage.getUserVariable).toHaveBeenCalledWith(
      USER_ID,
      "NEW_KEY",
    );
    expect(mockStorage.createUserVariable).toHaveBeenCalledWith({
      userId: USER_ID,
      key: "NEW_KEY",
      value: "v",
      description: null,
    });
    expect(result).toBe(created);
  });

  it("throws CONFLICT when the key already exists (uniqueness)", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(makeVariable());
    await expect(
      userCaller().variables.create({ key: "API_URL", value: "v" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A variable with this key already exists",
    });
    expect(mockStorage.createUserVariable).not.toHaveBeenCalled();
  });

  it("denies a Viewer before storage is touched (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().variables.create({ key: "NEW_KEY", value: "v" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockStorage.getUserVariable).not.toHaveBeenCalled();
    expect(mockStorage.createUserVariable).not.toHaveBeenCalled();
  });

  const invalidCreates: Array<{
    label: string;
    input: { key: string; value: string; description?: string };
  }> = [
    { label: "lowercase key", input: { key: "lower_case", value: "v" } },
    { label: "key starting with a digit", input: { key: "1KEY", value: "v" } },
    {
      label: "reserved prefix CRONIUM_",
      input: { key: "CRONIUM_SECRET", value: "v" },
    },
    { label: "reserved prefix PATH", input: { key: "PATH_EXTRA", value: "v" } },
    { label: "empty key", input: { key: "", value: "v" } },
    {
      label: "oversized value",
      input: { key: "OK_KEY", value: "x".repeat(10_001) },
    },
    {
      label: "oversized description",
      input: { key: "OK_KEY", value: "v", description: "d".repeat(501) },
    },
  ];

  it.each(invalidCreates)("rejects $label (zod)", async ({ input }) => {
    await expect(userCaller().variables.create(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockStorage.createUserVariable).not.toHaveBeenCalled();
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    mockStorage.createUserVariable!.mockRejectedValueOnce(
      new Error("insert failed"),
    );
    await expect(
      userCaller().variables.create({ key: "NEW_KEY", value: "v" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

// ---------------------------------------------------------------------------
// variables.update
// ---------------------------------------------------------------------------

describe("variables.update", () => {
  it("updates an owned variable, dropping undefined fields", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    const updated = makeVariable({ value: "new-value" });
    mockStorage.updateUserVariable!.mockResolvedValueOnce(updated);

    const result = await userCaller().variables.update({
      id: 1,
      value: "new-value",
    });

    // key/description were not provided, so they must not appear in the
    // update payload (exactOptionalPropertyTypes contract).
    expect(mockStorage.updateUserVariable).toHaveBeenCalledWith(1, USER_ID, {
      value: "new-value",
    });
    expect(result).toBe(updated);
  });

  it("checks key uniqueness when renaming and throws CONFLICT on collision", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    mockStorage.getUserVariable!.mockResolvedValueOnce(
      makeVariable({ id: 2, key: "TAKEN_KEY" }),
    );

    await expect(
      userCaller().variables.update({ id: 1, key: "TAKEN_KEY" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockStorage.getUserVariable).toHaveBeenCalledWith(
      USER_ID,
      "TAKEN_KEY",
    );
    expect(mockStorage.updateUserVariable).not.toHaveBeenCalled();
  });

  it("allows renaming to a free key", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    const renamed = makeVariable({ key: "FREE_KEY" });
    mockStorage.updateUserVariable!.mockResolvedValueOnce(renamed);

    await expect(
      userCaller().variables.update({ id: 1, key: "FREE_KEY" }),
    ).resolves.toBe(renamed);
  });

  it("skips the conflict check when the key is unchanged", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    mockStorage.updateUserVariable!.mockResolvedValueOnce(makeVariable());

    await userCaller().variables.update({ id: 1, key: "API_URL" });

    expect(mockStorage.getUserVariable).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a variable the user does not own", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    await expect(
      userCaller().variables.update({ id: 999, value: "v" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockStorage.updateUserVariable).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the scoped update matches no row", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    mockStorage.updateUserVariable!.mockResolvedValueOnce(undefined);
    await expect(
      userCaller().variables.update({ id: 1, value: "v" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("denies a Viewer (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().variables.update({ id: 1, value: "v" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockStorage.updateUserVariable).not.toHaveBeenCalled();
  });

  const invalidUpdates: Array<{
    label: string;
    input: { id: number; key?: string; value?: string };
  }> = [
    { label: "non-positive id", input: { id: 0, value: "v" } },
    { label: "reserved-prefix key", input: { id: 1, key: "SYSTEM_X" } },
    { label: "lowercase key", input: { id: 1, key: "bad_key" } },
  ];

  it.each(invalidUpdates)("rejects $label (zod)", async ({ input }) => {
    await expect(userCaller().variables.update(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

// ---------------------------------------------------------------------------
// variables.delete / variables.deleteByKey
// ---------------------------------------------------------------------------

describe("variables.delete", () => {
  it("deletes scoped to the session user", async () => {
    mockStorage.deleteUserVariable!.mockResolvedValueOnce(true);
    await expect(userCaller().variables.delete({ id: 4 })).resolves.toEqual({
      success: true,
    });
    expect(mockStorage.deleteUserVariable).toHaveBeenCalledWith(4, USER_ID);
  });

  it("throws NOT_FOUND when nothing was deleted (missing or not owned)", async () => {
    mockStorage.deleteUserVariable!.mockResolvedValueOnce(false);
    await expect(
      userCaller().variables.delete({ id: 4 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("denies a Viewer (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().variables.delete({ id: 4 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockStorage.deleteUserVariable).not.toHaveBeenCalled();
  });

  it("rejects a non-integer id (zod)", async () => {
    await expect(
      userCaller().variables.delete({ id: 1.5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("variables.deleteByKey", () => {
  it("deletes by key scoped to the session user", async () => {
    mockStorage.deleteUserVariableByKey!.mockResolvedValueOnce(true);
    await expect(
      userCaller().variables.deleteByKey({ key: "API_URL" }),
    ).resolves.toEqual({ success: true });
    expect(mockStorage.deleteUserVariableByKey).toHaveBeenCalledWith(
      USER_ID,
      "API_URL",
    );
  });

  it("throws NOT_FOUND for an unknown key", async () => {
    mockStorage.deleteUserVariableByKey!.mockResolvedValueOnce(false);
    await expect(
      userCaller().variables.deleteByKey({ key: "NOPE" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("denies a Viewer (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().variables.deleteByKey({ key: "API_URL" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockStorage.deleteUserVariableByKey).not.toHaveBeenCalled();
  });

  it("rejects an empty key (zod)", async () => {
    await expect(
      userCaller().variables.deleteByKey({ key: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// variables.bulkOperation
// ---------------------------------------------------------------------------

describe("variables.bulkOperation", () => {
  it("deletes owned ids and reports per-id outcomes, skipping foreign ids", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([
      makeVariable({ id: 1 }),
      makeVariable({ id: 2, key: "SECOND" }),
    ]);
    mockStorage
      .deleteUserVariable!.mockResolvedValueOnce(true) // id 1
      .mockResolvedValueOnce(false); // id 2 vanished mid-flight

    const result = await userCaller().variables.bulkOperation({
      variableIds: [1, 2, 999],
      operation: "delete",
    });

    expect(result.results).toEqual([
      { id: 1, success: true },
      { id: 2, success: false, error: "Failed to delete" },
      { id: 999, success: false, error: "Variable not found" },
    ]);
    // Ownership scoping: the foreign id is never passed to storage.
    expect(mockStorage.deleteUserVariable).toHaveBeenCalledTimes(2);
    expect(mockStorage.deleteUserVariable).toHaveBeenNthCalledWith(
      1,
      1,
      USER_ID,
    );
    expect(mockStorage.deleteUserVariable).toHaveBeenNthCalledWith(
      2,
      2,
      USER_ID,
    );
  });

  it("captures a thrown per-item error without aborting the batch", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([
      makeVariable({ id: 1 }),
      makeVariable({ id: 2, key: "SECOND" }),
    ]);
    mockStorage
      .deleteUserVariable!.mockRejectedValueOnce(new Error("fk violation"))
      .mockResolvedValueOnce(true);

    const result = await userCaller().variables.bulkOperation({
      variableIds: [1, 2],
      operation: "delete",
    });

    expect(result.results).toEqual([
      { id: 1, success: false, error: "fk violation" },
      { id: 2, success: true },
    ]);
  });

  it("marks owned ids successful for the export operation without deleting", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([
      makeVariable({ id: 1 }),
    ]);

    const result = await userCaller().variables.bulkOperation({
      variableIds: [1],
      operation: "export",
    });

    expect(result.results).toEqual([{ id: 1, success: true }]);
    expect(mockStorage.deleteUserVariable).not.toHaveBeenCalled();
  });

  it("denies a Viewer (FORBIDDEN)", async () => {
    await expect(
      viewerCaller().variables.bulkOperation({
        variableIds: [1],
        operation: "delete",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockStorage.getUserVariables).not.toHaveBeenCalled();
  });

  it("rejects an empty id list and unknown operations (zod)", async () => {
    await expect(
      userCaller().variables.bulkOperation({
        variableIds: [],
        operation: "delete",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userCaller().variables.bulkOperation({
        variableIds: [1],
        operation: "rename" as unknown as "delete",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// variables.export
// ---------------------------------------------------------------------------

describe("variables.export", () => {
  const owned = [
    makeVariable({
      id: 1,
      key: "API_URL",
      value: "https://example.com",
      description: "endpoint",
    }),
    makeVariable({
      id: 2,
      key: "DB_PASS",
      value: 'p@ss"word',
      description: null,
    }),
  ];

  it("exports selected variables as JSON with values", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);

    const result = await userCaller().variables.export({
      variableIds: [1, 2],
      format: "json",
    });

    expect(result.format).toBe("json");
    expect(result.count).toBe(2);
    expect(result.filename).toMatch(/^variables_\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(result.data) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      key: "API_URL",
      value: "https://example.com",
      description: "endpoint",
    });
  });

  it("hides values when includeValues is false — plaintext never leaves", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);

    const result = await userCaller().variables.export({
      variableIds: [1, 2],
      format: "env",
      includeValues: false,
    });

    expect(result.data).toContain("API_URL=[HIDDEN]");
    expect(result.data).toContain("DB_PASS=[HIDDEN]");
    expect(result.data).not.toContain("https://example.com");
    expect(result.data).not.toContain('p@ss"word');
  });

  it("renders env format with description comments", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);

    const result = await userCaller().variables.export({
      variableIds: [1],
      format: "env",
    });

    expect(result.data).toBe("# endpoint\nAPI_URL=https://example.com");
    expect(result.filename).toMatch(/\.env$/);
  });

  it("renders CSV with quote escaping and honors column toggles", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);

    const result = await userCaller().variables.export({
      variableIds: [2],
      format: "csv",
      includeDescriptions: false,
    });

    const [header, row] = result.data.split("\n");
    expect(header).toBe("Key,Value,Created At,Updated At");
    expect(row).toContain('"p@ss""word"');
    expect(row).not.toContain("Description");
  });

  it("throws NOT_FOUND when none of the requested ids are owned (ownership scoping)", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);
    await expect(
      userCaller().variables.export({ variableIds: [998, 999] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is declared view-capability: a Viewer may export", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce(owned);
    const result = await viewerCaller().variables.export({
      variableIds: [1],
      format: "json",
    });
    expect(result.count).toBe(1);
  });

  it("rejects an empty id list and unknown formats (zod)", async () => {
    await expect(
      userCaller().variables.export({ variableIds: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      userCaller().variables.export({
        variableIds: [1],
        format: "xml" as unknown as "json",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// variables.validate
// ---------------------------------------------------------------------------

describe("variables.validate", () => {
  it("returns valid for a fresh key", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    await expect(
      userCaller().variables.validate({ key: "FRESH_KEY", value: "v" }),
    ).resolves.toEqual({ valid: true, issues: [] });
    expect(mockStorage.getUserVariable).toHaveBeenCalledWith(
      USER_ID,
      "FRESH_KEY",
    );
  });

  it("flags duplicates, reserved prefixes and oversized values", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(makeVariable());

    const result = await userCaller().variables.validate({
      key: "CRONIUM_TOKEN",
      value: "x".repeat(10_001),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.type)).toEqual([
      "duplicate_key",
      "reserved_prefix",
      "value_too_long",
    ]);
  });

  it("skips the duplicate check when checkDuplicates is false", async () => {
    const result = await userCaller().variables.validate({
      key: "ANY_KEY",
      value: "v",
      checkDuplicates: false,
    });
    expect(result).toEqual({ valid: true, issues: [] });
    expect(mockStorage.getUserVariable).not.toHaveBeenCalled();
  });

  it("is declared view-capability: a Viewer may validate", async () => {
    mockStorage.getUserVariable!.mockResolvedValueOnce(undefined);
    await expect(
      viewerCaller().variables.validate({ key: "SOME_KEY", value: "v" }),
    ).resolves.toEqual({ valid: true, issues: [] });
  });

  it("rejects an empty key (zod)", async () => {
    await expect(
      userCaller().variables.validate({ key: "", value: "v" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// variables.getUsage
// ---------------------------------------------------------------------------

describe("variables.getUsage", () => {
  const events = [
    {
      id: 10,
      name: "uses getVariable double quotes",
      type: "BASH",
      status: "ACTIVE",
      content: 'cronium.getVariable("API_URL")',
    },
    {
      id: 11,
      name: "uses shell interpolation",
      type: "BASH",
      status: "ACTIVE",
      content: "curl $API_URL/health",
    },
    {
      id: 12,
      name: "uses process.env",
      type: "NODE",
      status: "PAUSED",
      content: "fetch(process.env.API_URL)",
    },
    {
      id: 13,
      name: "unrelated",
      type: "NODE",
      status: "ACTIVE",
      content: "console.log('nothing here')",
    },
    {
      id: 14,
      name: "no content",
      type: "HTTP",
      status: "ACTIVE",
      content: null,
    },
  ];

  it("resolves the key from variableId and reports matching events and workflows", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([
      makeVariable({ id: 5, key: "API_URL" }),
    ]);
    mockStorage.getAllEvents!.mockResolvedValueOnce(events);
    mockStorage.getAllWorkflows!.mockResolvedValueOnce([
      { id: 20, name: "wf", status: "active", extra: "ignored" },
    ]);

    const result = await userCaller().variables.getUsage({ variableId: 5 });

    expect(mockStorage.getAllEvents).toHaveBeenCalledWith(USER_ID);
    expect(mockStorage.getAllWorkflows).toHaveBeenCalledWith(USER_ID);
    expect(result.events.map((e) => e.id)).toEqual([10, 11, 12]);
    expect(result.workflows).toEqual([
      { id: 20, name: "wf", status: "active" },
    ]);
    expect(result.totalUsages).toBe(4);
  });

  it("accepts a key directly and can exclude workflows", async () => {
    mockStorage.getAllEvents!.mockResolvedValueOnce(events);

    const result = await userCaller().variables.getUsage({
      key: "API_URL",
      includeWorkflows: false,
    });

    expect(mockStorage.getUserVariables).not.toHaveBeenCalled();
    expect(mockStorage.getAllWorkflows).not.toHaveBeenCalled();
    expect(result.workflows).toEqual([]);
    expect(result.totalUsages).toBe(3);
  });

  it("can exclude events", async () => {
    mockStorage.getAllWorkflows!.mockResolvedValueOnce([]);
    const result = await userCaller().variables.getUsage({
      key: "API_URL",
      includeEvents: false,
    });
    expect(mockStorage.getAllEvents).not.toHaveBeenCalled();
    expect(result).toEqual({ events: [], workflows: [], totalUsages: 0 });
  });

  it("throws NOT_FOUND for a variableId the user does not own", async () => {
    mockStorage.getUserVariables!.mockResolvedValueOnce([makeVariable()]);
    await expect(
      userCaller().variables.getUsage({ variableId: 999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a request with neither variableId nor key (zod refine)", async () => {
    await expect(userCaller().variables.getUsage({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockStorage.getAllEvents).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Authentication baseline
// ---------------------------------------------------------------------------

describe("authentication", () => {
  it("rejects unauthenticated callers on reads and writes", async () => {
    const anon = callerWith(null);
    await expect(anon.variables.getAll({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anon.variables.create({ key: "NEW_KEY", value: "v" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
