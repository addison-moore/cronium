/** @jest-environment node */
/**
 * Router tests for workflowsRouter. The REAL router and the REAL
 * protectedProcedure middleware chain run; the database, storage monolith,
 * resource-access asserts, webhook-key minting, and the workflow engine are
 * mocked at their module boundaries.
 */

// Mutable state read lazily by the @/server/db factory mock. The first-class
// consumer is enforceLivePrincipal (users table lookup, detected by the
// `mfaEnabled` field in the select projection); every other select consumes
// from `selectQueue` (used by getExecutions' direct-db branch).
const mockDbState: {
  principalRows: Array<Record<string, unknown>>;
  selectQueue: unknown[];
} = { principalRows: [], selectQueue: [] };

jest.mock("@/server/db", () => {
  const makeChain = (resolve: () => unknown) => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "from",
      "where",
      "limit",
      "offset",
      "leftJoin",
      "innerJoin",
      "orderBy",
      "groupBy",
    ]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      let value: unknown;
      try {
        value = resolve();
      } catch (error) {
        return Promise.reject(error).then(onFulfilled, onRejected);
      }
      if (value instanceof Error) {
        return Promise.reject(value).then(onFulfilled, onRejected);
      }
      return Promise.resolve(value).then(onFulfilled, onRejected);
    };
    return chain;
  };
  return {
    db: {
      select: jest.fn((fields?: Record<string, unknown>) =>
        makeChain(() => {
          if (fields && "mfaEnabled" in fields) {
            return mockDbState.principalRows;
          }
          return mockDbState.selectQueue.length > 0
            ? mockDbState.selectQueue.shift()
            : [];
        }),
      ),
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

jest.mock("@/server/storage", () => ({
  storage: {
    queryWorkflows: jest.fn(),
    getWorkflow: jest.fn(),
    getAllWorkflows: jest.fn(),
    getWorkflowWithRelations: jest.fn(),
    createWorkflow: jest.fn(),
    updateWorkflow: jest.fn(),
    deleteWorkflow: jest.fn(),
    getWorkflowNodes: jest.fn(),
    createWorkflowNode: jest.fn(),
    deleteWorkflowNode: jest.fn(),
    getWorkflowConnections: jest.fn(),
    createWorkflowConnection: jest.fn(),
    deleteWorkflowConnection: jest.fn(),
    getWorkflowExecutions: jest.fn(),
    getWorkflowExecution: jest.fn(),
    getWorkflowExecutionEvents: jest.fn(),
    getWorkflowLogs: jest.fn(),
  },
}));

jest.mock("@/server/security/resource-access", () => ({
  assertWorkflowCapability: jest.fn(() => Promise.resolve()),
  assertWorkflowGraphCapability: jest.fn(() => Promise.resolve()),
  assertWorkflowDefinition: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/workflow-webhook-key", () => {
  let minted = 0;
  return {
    newWorkflowWebhookKeyFields: jest.fn(() => {
      minted += 1;
      return {
        plaintext: `plaintext-key-${minted}`,
        webhookKey: null,
        webhookKeyHash: `hash-${minted}`,
      };
    }),
  };
});

jest.mock("@/lib/scheduling/workflow-engine", () => ({
  startWorkflowRun: jest.fn(),
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { workflowsRouter } from "@/server/api/routers/workflows";
import {
  ConnectionType,
  EventStatus,
  LogStatus,
  RunLocation,
  UserRole,
  UserStatus,
  WorkflowTriggerType,
} from "@/shared/schema";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  assertWorkflowCapability,
  assertWorkflowDefinition,
  assertWorkflowGraphCapability,
} from "@/server/security/resource-access";
import { newWorkflowWebhookKeyFields } from "@/lib/workflow-webhook-key";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { TRPCError } from "@trpc/server";

// Mount under "workflows" so route-capability lookups see the production
// paths ("workflows.create" → edit, "workflows.execute" → execute, ...).
const testRouter = createTRPCRouter({ workflows: workflowsRouter });
const createCaller = createCallerFactory(testRouter);

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const mockedStorage = storage as unknown as Record<string, jest.Mock>;
const mockedAssertCapability = assertWorkflowCapability as unknown as jest.Mock;
const mockedAssertGraph = assertWorkflowGraphCapability as unknown as jest.Mock;
const mockedAssertDefinition = assertWorkflowDefinition as unknown as jest.Mock;
const mockedStartRun = startWorkflowRun as unknown as jest.Mock;
const mockedNewKeyFields = newWorkflowWebhookKeyFields as unknown as jest.Mock;

function lastMintedKeyFields(): {
  plaintext: string;
  webhookKey: null;
  webhookKeyHash: string;
} {
  const result = mockedNewKeyFields.mock.results.at(-1);
  if (!result) throw new Error("newWorkflowWebhookKeyFields was not called");
  return result.value as {
    plaintext: string;
    webhookKey: null;
    webhookKeyHash: string;
  };
}

function principalRow(overrides: Record<string, unknown> = {}) {
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

function sessionFor(role: UserRole): Session {
  return {
    user: {
      id: USER_ID,
      email: "user@example.com",
      role,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerFor(
  role: UserRole = UserRole.USER,
  requestSource: string | null = null,
) {
  mockDbState.principalRows = [
    principalRow({ role, roleId: role === UserRole.VIEWER ? 3 : 2 }),
  ];
  return createCaller({
    session: sessionFor(role),
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource,
  });
}

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    userId: USER_ID,
    name: "My Workflow",
    description: null,
    tags: [],
    triggerType: WorkflowTriggerType.MANUAL,
    webhookKey: null,
    webhookKeyHash: null,
    scheduleNumber: null,
    scheduleUnit: null,
    customSchedule: null,
    useCronScheduling: false,
    runLocation: RunLocation.LOCAL,
    overrideEventServers: false,
    overrideServerIds: [],
    status: EventStatus.DRAFT,
    shared: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function workflowWithRelations(overrides: Record<string, unknown> = {}) {
  return {
    ...workflowRow(),
    nodes: [],
    connections: [],
    ...overrides,
  };
}

function nodeInput(id: string, eventId: number, x = 0, y = 0) {
  return {
    id,
    type: "eventNode" as const,
    position: { x, y },
    data: {
      eventId,
      label: `node-${id}`,
      type: "BASH",
      eventTypeIcon: "terminal",
      tags: [],
    },
  };
}

function edgeInput(
  id: string,
  source: string,
  target: string,
  connectionType: ConnectionType = ConnectionType.ON_SUCCESS,
) {
  return {
    id,
    source,
    target,
    type: "connectionEdge" as const,
    animated: true,
    data: { connectionType },
  };
}

const forbidden = () =>
  new TRPCError({ code: "FORBIDDEN", message: "not yours" });

let consoleErrorSpy: jest.SpyInstance;
let consoleLogSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbState.principalRows = [];
  mockDbState.selectQueue = [];

  mockedAssertCapability.mockResolvedValue(undefined);
  mockedAssertGraph.mockResolvedValue(undefined);
  mockedAssertDefinition.mockResolvedValue(undefined);

  let nextNodeId = 100;
  mockedStorage.createWorkflow!.mockImplementation(
    (data: Record<string, unknown>) => Promise.resolve({ id: 10, ...data }),
  );
  mockedStorage.createWorkflowNode!.mockImplementation(
    (data: Record<string, unknown>) => {
      nextNodeId += 1;
      return Promise.resolve({ id: nextNodeId, ...data });
    },
  );
  mockedStorage.createWorkflowConnection!.mockImplementation(
    (data: Record<string, unknown>) => Promise.resolve({ id: 500, ...data }),
  );
  mockedStorage.getWorkflowWithRelations!.mockImplementation((id: number) =>
    Promise.resolve(workflowWithRelations({ id })),
  );
  mockedStorage.getWorkflowNodes!.mockResolvedValue([]);
  mockedStorage.getWorkflowConnections!.mockResolvedValue([]);
  mockedStorage.updateWorkflow!.mockResolvedValue(workflowRow());
  mockedStorage.deleteWorkflow!.mockResolvedValue(undefined);
  mockedStorage.deleteWorkflowNode!.mockResolvedValue(undefined);
  mockedStorage.deleteWorkflowConnection!.mockResolvedValue(undefined);
});

describe("workflows.getAll", () => {
  it("returns DTO-projected workflows and never leaks webhook credentials", async () => {
    const caller = callerFor();
    mockedStorage.queryWorkflows!.mockResolvedValue({
      items: [
        workflowRow({
          id: 1,
          webhookKeyHash: "stored-hash",
          overrideServerIds: [7],
        }),
        workflowRow({
          id: 2,
          userId: OTHER_USER_ID,
          shared: true,
          overrideServerIds: [9],
        }),
      ],
      total: 2,
      hasMore: false,
    });

    const result = await caller.workflows.getAll({});

    expect(mockedStorage.queryWorkflows).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);

    const owned = result.workflows[0]!;
    expect(owned.webhookKey).toBeNull();
    expect(owned.webhookKeyHash).toBeNull();
    expect(owned.hasWebhookKey).toBe(true);
    expect(owned.overrideServerIds).toEqual([7]);
    expect(owned.secretFieldsRedacted).toBe(false);

    const foreign = result.workflows[1]!;
    expect(foreign.secretFieldsRedacted).toBe(true);
    expect(foreign.overrideServerIds).toEqual([]);
  });

  it("rejects invalid pagination input", async () => {
    const caller = callerFor();
    await expect(caller.workflows.getAll({ limit: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockedStorage.queryWorkflows).not.toHaveBeenCalled();
  });
});

describe("workflows.getById", () => {
  it("checks graph view capability then returns the workflow DTO", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowWithRelations!.mockResolvedValue(
      workflowWithRelations({ id: 5, webhookKeyHash: "h" }),
    );

    const result = await caller.workflows.getById({ id: 5 });

    expect(mockedAssertGraph).toHaveBeenCalledWith(5, USER_ID, "view");
    expect(result.data.id).toBe(5);
    expect(result.data.webhookKey).toBeNull();
    expect(result.data.webhookKeyHash).toBeNull();
    expect(result.data.hasWebhookKey).toBe(true);
  });

  it("returns NOT_FOUND when the workflow does not exist", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowWithRelations!.mockResolvedValue(null);
    await expect(caller.workflows.getById({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not fetch another user's workflow when the capability check denies", async () => {
    const caller = callerFor();
    mockedAssertGraph.mockRejectedValueOnce(forbidden());
    await expect(caller.workflows.getById({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.getWorkflowWithRelations).not.toHaveBeenCalled();
  });

  it("rejects a non-positive id", async () => {
    const caller = callerFor();
    await expect(caller.workflows.getById({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("workflows.create", () => {
  const graphInput = {
    name: "Graph WF",
    triggerType: WorkflowTriggerType.MANUAL,
    nodes: [nodeInput("a", 11, 10, 20), nodeInput("b", 12, 30, 40)],
    edges: [edgeInput("e1", "a", "b", ConnectionType.ON_FAILURE)],
  };

  it("creates workflow, nodes, and connections with mapped DB ids", async () => {
    const caller = callerFor();
    const result = await caller.workflows.create(graphInput);

    expect(mockedAssertDefinition).toHaveBeenCalledWith(USER_ID, [11, 12], []);
    expect(mockedStorage.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Graph WF",
        userId: USER_ID,
        webhookKey: null,
        webhookKeyHash: null,
        source: null,
      }),
    );
    expect(mockedStorage.createWorkflowNode).toHaveBeenNthCalledWith(1, {
      workflowId: 10,
      eventId: 11,
      position_x: 10,
      position_y: 20,
    });
    expect(mockedStorage.createWorkflowNode).toHaveBeenNthCalledWith(2, {
      workflowId: 10,
      eventId: 12,
      position_x: 30,
      position_y: 40,
    });
    const [nodeA, nodeB] = mockedStorage.createWorkflowNode!.mock.results.map(
      (r) => r.value as Promise<{ id: number }>,
    );
    const nodeAId = (await nodeA!).id;
    const nodeBId = (await nodeB!).id;
    expect(mockedStorage.createWorkflowConnection).toHaveBeenCalledWith({
      workflowId: 10,
      sourceNodeId: nodeAId,
      targetNodeId: nodeBId,
      connectionType: ConnectionType.ON_FAILURE,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: 10 });
  });

  it("creates connections even when a node's DB id is 0 (falsy-drop fix)", async () => {
    const caller = callerFor();
    mockedStorage
      .createWorkflowNode!.mockResolvedValueOnce({ id: 0 })
      .mockResolvedValueOnce({ id: 1 });

    await caller.workflows.create(graphInput);

    expect(mockedStorage.createWorkflowConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNodeId: 0, targetNodeId: 1 }),
    );
  });

  it("mints a server-side webhook key and surfaces the plaintext exactly once", async () => {
    const caller = callerFor();
    const result = await caller.workflows.create({
      name: "Hooked",
      triggerType: WorkflowTriggerType.WEBHOOK,
      webhookKey: "attacker-chosen-key",
      nodes: [],
      edges: [],
    });

    const keyFields = lastMintedKeyFields();
    expect(mockedStorage.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookKey: null,
        webhookKeyHash: keyFields.webhookKeyHash,
      }),
    );
    // The client-supplied key must never be persisted.
    const persisted = mockedStorage.createWorkflow!.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(persisted.webhookKey).not.toBe("attacker-chosen-key");
    expect(persisted.webhookKeyHash).not.toBe("attacker-chosen-key");
    // Plaintext surfaced once on the response.
    expect((result.data as unknown as { webhookKey: string }).webhookKey).toBe(
      keyFields.plaintext,
    );
  });

  it("stamps MCP provenance onto created workflows", async () => {
    const caller = callerFor(UserRole.USER, "mcp");
    await caller.workflows.create(graphInput);
    expect(mockedStorage.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ source: "mcp" }),
    );
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(caller.workflows.create(graphInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.createWorkflow).not.toHaveBeenCalled();
  });

  it("propagates a definition capability denial before writing anything", async () => {
    const caller = callerFor();
    mockedAssertDefinition.mockRejectedValueOnce(forbidden());
    await expect(caller.workflows.create(graphInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.createWorkflow).not.toHaveBeenCalled();
  });

  describe("zod graph invariants", () => {
    const invalid = [
      ["empty name", { ...graphInput, name: "" }],
      ["self-loop edge", { ...graphInput, edges: [edgeInput("e1", "a", "a")] }],
      [
        "edge referencing a missing node",
        { ...graphInput, edges: [edgeInput("e1", "a", "ghost")] },
      ],
      [
        "cycle",
        {
          ...graphInput,
          edges: [edgeInput("e1", "a", "b"), edgeInput("e2", "b", "a")],
        },
      ],
      [
        "fan-in (two edges into one target)",
        {
          ...graphInput,
          nodes: [nodeInput("a", 11), nodeInput("b", 12), nodeInput("c", 13)],
          edges: [edgeInput("e1", "a", "c"), edgeInput("e2", "b", "c")],
        },
      ],
      [
        "invalid connection type",
        {
          ...graphInput,
          edges: [
            {
              ...edgeInput("e1", "a", "b"),
              data: { connectionType: "SOMETIMES" },
            },
          ],
        },
      ],
      [
        "active workflow without nodes",
        {
          name: "Active empty",
          triggerType: WorkflowTriggerType.MANUAL,
          status: EventStatus.ACTIVE,
          nodes: [],
          edges: [],
        },
      ],
      [
        "active scheduled workflow without schedule config",
        {
          name: "Sched",
          triggerType: WorkflowTriggerType.SCHEDULE,
          status: EventStatus.ACTIVE,
          nodes: [nodeInput("a", 11)],
          edges: [],
        },
      ],
    ] as const;

    it.each(invalid)("rejects %s", async (_label, input) => {
      const caller = callerFor();
      await expect(
        caller.workflows.create(input as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockedStorage.createWorkflow).not.toHaveBeenCalled();
    });
  });
});

describe("workflows.update", () => {
  beforeEach(() => {
    mockedStorage.getWorkflow!.mockResolvedValue(workflowRow({ id: 5 }));
  });

  it("updates metadata, dropping explicit nulls, without touching the graph", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowNodes!.mockResolvedValue([
      { id: 201, eventId: 21 },
    ]);

    await caller.workflows.update({
      id: 5,
      name: "Renamed",
      description: null,
    });

    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "edit");
    expect(mockedAssertDefinition).toHaveBeenCalledWith(USER_ID, [21], []);
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(5, {
      name: "Renamed",
    });
    expect(mockedStorage.deleteWorkflowNode).not.toHaveBeenCalled();
    expect(mockedStorage.deleteWorkflowConnection).not.toHaveBeenCalled();
  });

  it("replaces the graph when nodes and edges are provided", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowNodes!.mockResolvedValue([
      { id: 201, eventId: 21 },
    ]);
    mockedStorage.getWorkflowConnections!.mockResolvedValue([{ id: 301 }]);

    await caller.workflows.update({
      id: 5,
      nodes: [nodeInput("x", 31), nodeInput("y", 32)],
      edges: [edgeInput("e1", "x", "y", ConnectionType.ALWAYS)],
    });

    expect(mockedAssertDefinition).toHaveBeenCalledWith(USER_ID, [31, 32], []);
    expect(mockedStorage.deleteWorkflowNode).toHaveBeenCalledWith(201);
    expect(mockedStorage.deleteWorkflowConnection).toHaveBeenCalledWith(301);
    expect(mockedStorage.createWorkflowNode).toHaveBeenCalledTimes(2);
    expect(mockedStorage.createWorkflowConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 5,
        connectionType: ConnectionType.ALWAYS,
      }),
    );
  });

  it("does NOT wipe the persisted graph on an edges-only payload (destructive-update fix)", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowNodes!.mockResolvedValue([
      { id: 201, eventId: 21 },
    ]);
    mockedStorage.getWorkflowConnections!.mockResolvedValue([{ id: 301 }]);

    await caller.workflows.update({ id: 5, edges: [] });

    expect(mockedStorage.deleteWorkflowNode).not.toHaveBeenCalled();
    expect(mockedStorage.deleteWorkflowConnection).not.toHaveBeenCalled();
    expect(mockedStorage.createWorkflowConnection).not.toHaveBeenCalled();
  });

  it("sanitizes stored overrideServerIds before revalidating the definition", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({ id: 5, overrideServerIds: [7, 0, -2, "junk", 9] }),
    );

    await caller.workflows.update({ id: 5, name: "Renamed" });

    expect(mockedAssertDefinition).toHaveBeenCalledWith(USER_ID, [], [7, 9]);
  });

  it("mints a webhook key when switching to WEBHOOK without one, surfacing plaintext once", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({ id: 5, webhookKeyHash: null }),
    );

    const result = await caller.workflows.update({
      id: 5,
      triggerType: WorkflowTriggerType.WEBHOOK,
    });

    const keyFields = lastMintedKeyFields();
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        triggerType: WorkflowTriggerType.WEBHOOK,
        webhookKey: null,
        webhookKeyHash: keyFields.webhookKeyHash,
      }),
    );
    expect((result as { webhookKey?: string }).webhookKey).toBe(
      keyFields.plaintext,
    );
  });

  it("does not rotate an existing webhook key on unrelated updates", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({
        id: 5,
        triggerType: WorkflowTriggerType.WEBHOOK,
        webhookKeyHash: "already-set",
      }),
    );

    const result = await caller.workflows.update({ id: 5, name: "Renamed" });

    expect(mockedNewKeyFields).not.toHaveBeenCalled();
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(5, {
      name: "Renamed",
    });
    // Reads never surface the stored key.
    expect((result as { webhookKey: unknown }).webhookKey).toBeNull();
  });

  it("returns NOT_FOUND for a missing workflow", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(undefined);
    await expect(
      caller.workflows.update({ id: 5, name: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates FORBIDDEN when the caller does not own the workflow", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(
      caller.workflows.update({ id: 5, name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.updateWorkflow).not.toHaveBeenCalled();
  });

  it("wraps unexpected storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.updateWorkflow!.mockRejectedValueOnce(new Error("boom"));
    await expect(
      caller.workflows.update({ id: 5, name: "x" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update workflow",
    });
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(
      caller.workflows.update({ id: 5, name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.getWorkflow).not.toHaveBeenCalled();
  });

  it("rejects fan-in edges and non-positive ids at validation", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.update({
        id: 5,
        nodes: [nodeInput("a", 1), nodeInput("b", 2), nodeInput("c", 3)],
        edges: [edgeInput("e1", "a", "c"), edgeInput("e2", "b", "c")],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.workflows.update({ id: -1, name: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("workflows.rotateWebhookKey", () => {
  it("stores only the new hash and returns the plaintext once", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({
        id: 5,
        triggerType: WorkflowTriggerType.WEBHOOK,
        webhookKeyHash: "old-hash",
      }),
    );

    const result = await caller.workflows.rotateWebhookKey({ id: 5 });

    const keyFields = lastMintedKeyFields();
    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "edit");
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(5, {
      webhookKey: null,
      webhookKeyHash: keyFields.webhookKeyHash,
    });
    expect(result).toEqual({ webhookKey: keyFields.plaintext });
  });

  it("rejects rotation on non-webhook workflows", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({ id: 5, triggerType: WorkflowTriggerType.MANUAL }),
    );
    await expect(
      caller.workflows.rotateWebhookKey({ id: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedStorage.updateWorkflow).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing workflow", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(undefined);
    await expect(
      caller.workflows.rotateWebhookKey({ id: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates FORBIDDEN for a workflow the caller cannot edit", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflow!.mockResolvedValue(
      workflowRow({
        id: 5,
        userId: OTHER_USER_ID,
        triggerType: WorkflowTriggerType.WEBHOOK,
      }),
    );
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(
      caller.workflows.rotateWebhookKey({ id: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.updateWorkflow).not.toHaveBeenCalled();
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(
      caller.workflows.rotateWebhookKey({ id: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects invalid ids", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.rotateWebhookKey({ id: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("workflows.delete", () => {
  it("checks edit capability then deletes", async () => {
    const caller = callerFor();
    await expect(caller.workflows.delete({ id: 5 })).resolves.toEqual({
      success: true,
    });
    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "edit");
    expect(mockedStorage.deleteWorkflow).toHaveBeenCalledWith(5);
  });

  it("does not delete another user's workflow", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(caller.workflows.delete({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.deleteWorkflow).not.toHaveBeenCalled();
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.deleteWorkflow!.mockRejectedValueOnce(new Error("fk"));
    await expect(caller.workflows.delete({ id: 5 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete workflow",
    });
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(caller.workflows.delete({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.deleteWorkflow).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    const caller = callerFor();
    await expect(caller.workflows.delete({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("workflows.execute", () => {
  it("dispatches a MANUAL run to the workflow engine after an execute capability check", async () => {
    const caller = callerFor();
    mockedStartRun.mockResolvedValueOnce({ runId: 42, status: "RUNNING" });

    const result = await caller.workflows.execute({
      id: 5,
      payload: { region: "eu" },
    });

    expect(mockedAssertGraph).toHaveBeenCalledWith(5, USER_ID, "execute");
    expect(mockedStartRun).toHaveBeenCalledWith(5, {
      userId: USER_ID,
      triggerType: WorkflowTriggerType.MANUAL,
      input: { region: "eu" },
    });
    expect(result).toEqual({ runId: 42, status: "RUNNING" });
  });

  it("never reaches the engine when the capability check denies", async () => {
    const caller = callerFor();
    mockedAssertGraph.mockRejectedValueOnce(forbidden());
    await expect(caller.workflows.execute({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStartRun).not.toHaveBeenCalled();
  });

  it("wraps engine failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStartRun.mockRejectedValueOnce(new Error("engine down"));
    await expect(caller.workflows.execute({ id: 5 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to execute workflow",
    });
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(caller.workflows.execute({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStartRun).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    const caller = callerFor();
    await expect(caller.workflows.execute({ id: -3 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("workflows.getExecutions", () => {
  it("requires execute capability and converts offset to a page for a single workflow", async () => {
    const caller = callerFor();
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
    mockedStorage.getWorkflowExecutions!.mockResolvedValue({
      executions: rows,
      total: 60,
    });

    const result = await caller.workflows.getExecutions({
      id: 5,
      limit: 20,
      offset: 40,
    });

    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "execute");
    expect(mockedStorage.getWorkflowExecutions).toHaveBeenCalledWith(5, 20, 3);
    expect(result.hasMore).toBe(true);
  });

  it("lists all of the caller's executions via the direct db query", async () => {
    const caller = callerFor();
    const listRows = [
      { id: 1, workflowId: 5, workflowName: "My Workflow" },
      { id: 2, workflowId: 6, workflowName: "Other" },
    ];
    mockDbState.selectQueue = [listRows, [{ count: 5 }]];

    const result = await caller.workflows.getExecutions({
      limit: 2,
      offset: 0,
    });

    expect(mockedAssertCapability).not.toHaveBeenCalled();
    expect(result.executions).toEqual({ executions: listRows, total: 5 });
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore=false when the caller has no further executions", async () => {
    const caller = callerFor();
    mockDbState.selectQueue = [[], [{ count: 0 }]];
    const result = await caller.workflows.getExecutions({});
    expect(result.hasMore).toBe(false);
  });

  it("propagates FORBIDDEN from the capability check", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(
      caller.workflows.getExecutions({ id: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.getWorkflowExecutions).not.toHaveBeenCalled();
  });

  it("wraps db failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockDbState.selectQueue = [new Error("db down")];
    await expect(caller.workflows.getExecutions({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("workflows.getLogs", () => {
  it("requires execute capability and pages logs", async () => {
    const caller = callerFor();
    const logs = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    mockedStorage.getWorkflowLogs!.mockResolvedValue({ logs, total: 30 });

    const result = await caller.workflows.getLogs({
      id: 5,
      limit: 10,
      offset: 20,
    });

    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "execute");
    expect(mockedStorage.getWorkflowLogs).toHaveBeenCalledWith(5, 10, 3);
    expect(result.logs).toEqual(logs);
    expect(result.hasMore).toBe(true);
  });

  it("propagates FORBIDDEN from the capability check", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(caller.workflows.getLogs({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowLogs!.mockRejectedValueOnce(new Error("boom"));
    await expect(caller.workflows.getLogs({ id: 5 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch workflow logs",
    });
  });
});

describe("workflows.archive", () => {
  it("archives after an edit capability check", async () => {
    const caller = callerFor();
    const result = await caller.workflows.archive({ id: 5 });

    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "edit");
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ status: EventStatus.ARCHIVED }),
    );
    expect(result.success).toBe(true);
  });

  it("propagates FORBIDDEN and denies Viewers", async () => {
    const owner = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(owner.workflows.archive({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockedStorage.updateWorkflow).not.toHaveBeenCalled();

    const viewer = callerFor(UserRole.VIEWER);
    await expect(viewer.workflows.archive({ id: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.updateWorkflow!.mockRejectedValueOnce(new Error("boom"));
    await expect(caller.workflows.archive({ id: 5 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to archive workflow",
    });
  });
});

describe("workflows.bulkOperation", () => {
  it("deletes each owned workflow and records per-id failures", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockImplementation((id: number) =>
      id === 2 ? Promise.reject(forbidden()) : Promise.resolve(),
    );

    const result = await caller.workflows.bulkOperation({
      workflowIds: [1, 2],
      operation: "delete",
    });

    expect(mockedStorage.deleteWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedStorage.deleteWorkflow).toHaveBeenCalledWith(1);
    expect(result.results).toEqual([
      { id: 1, success: true },
      { id: 2, success: false, error: "not yours" },
    ]);
  });

  it("activation additionally requires graph execute capability", async () => {
    const caller = callerFor();
    mockedAssertGraph.mockRejectedValueOnce(forbidden());

    const result = await caller.workflows.bulkOperation({
      workflowIds: [1, 2],
      operation: "activate",
    });

    expect(mockedAssertGraph).toHaveBeenNthCalledWith(1, 1, USER_ID, "execute");
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedStorage.updateWorkflow).toHaveBeenCalledWith(2, {
      status: EventStatus.ACTIVE,
    });
    expect(result.results[0]).toMatchObject({ id: 1, success: false });
    expect(result.results[1]).toEqual({ id: 2, success: true });
  });

  it("supports archive and pause status transitions", async () => {
    const caller = callerFor();
    await caller.workflows.bulkOperation({
      workflowIds: [3],
      operation: "archive",
    });
    expect(mockedStorage.updateWorkflow).toHaveBeenLastCalledWith(3, {
      status: EventStatus.ARCHIVED,
    });

    await caller.workflows.bulkOperation({
      workflowIds: [4],
      operation: "pause",
    });
    expect(mockedStorage.updateWorkflow).toHaveBeenLastCalledWith(4, {
      status: EventStatus.PAUSED,
    });
  });

  it("denies Viewers", async () => {
    const caller = callerFor(UserRole.VIEWER);
    await expect(
      caller.workflows.bulkOperation({ workflowIds: [1], operation: "delete" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects empty id lists and unknown operations", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.bulkOperation({ workflowIds: [], operation: "delete" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.workflows.bulkOperation({
        workflowIds: [1],
        operation: "explode" as never,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("workflows.getExecution", () => {
  it("returns the execution with computed event statistics", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowExecution!.mockResolvedValue({
      id: 9,
      workflowId: 5,
      status: LogStatus.SUCCESS,
    });
    mockedStorage.getWorkflowExecutionEvents!.mockResolvedValue([
      { id: 1, status: LogStatus.SUCCESS },
      { id: 2, status: LogStatus.FAILURE },
      { id: 3, status: LogStatus.TIMEOUT },
      { id: 4, status: LogStatus.RUNNING },
    ]);

    const result = await caller.workflows.getExecution({
      workflowId: 5,
      executionId: 9,
    });

    expect(mockedAssertCapability).toHaveBeenCalledWith(5, USER_ID, "execute");
    expect(result.totalEvents).toBe(4);
    expect(result.successfulEvents).toBe(1);
    expect(result.failedEvents).toBe(2);
    expect(result.events).toHaveLength(4);
  });

  it("returns NOT_FOUND when the execution belongs to a different workflow", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowExecution!.mockResolvedValue({
      id: 9,
      workflowId: 999,
    });
    await expect(
      caller.workflows.getExecution({ workflowId: 5, executionId: 9 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates FORBIDDEN from the capability check", async () => {
    const caller = callerFor();
    mockedAssertCapability.mockRejectedValueOnce(forbidden());
    await expect(
      caller.workflows.getExecution({ workflowId: 5, executionId: 9 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.getWorkflowExecution).not.toHaveBeenCalled();
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowExecution!.mockRejectedValueOnce(
      new Error("boom"),
    );
    await expect(
      caller.workflows.getExecution({ workflowId: 5, executionId: 9 }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch execution details",
    });
  });
});

describe("workflows.download", () => {
  beforeEach(() => {
    mockedStorage.getAllWorkflows!.mockResolvedValue([
      workflowRow({ id: 1, name: "First" }),
      workflowRow({ id: 2, name: "Second" }),
    ]);
  });

  it("downloads a single workflow as JSON with credentials stripped", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowWithRelations!.mockResolvedValue(
      workflowWithRelations({ id: 1, name: "First", webhookKeyHash: "h" }),
    );

    const result = await caller.workflows.download({ workflowIds: [1] });

    expect(mockedAssertGraph).toHaveBeenCalledWith(1, USER_ID, "view");
    expect(result.format).toBe("json");
    expect(result.filename).toBe("First.json");
    const parsed = JSON.parse(result.data) as Record<string, unknown>;
    expect(parsed.id).toBe(1);
    expect(parsed.webhookKey).toBeNull();
    expect(parsed.webhookKeyHash).toBeNull();
  });

  it("downloads multiple workflows into workflows.json", async () => {
    const caller = callerFor();
    const result = await caller.workflows.download({ workflowIds: [1, 2] });
    expect(result.filename).toBe("workflows.json");
    const parsed = JSON.parse(result.data) as Array<{ id: number }>;
    expect(parsed.map((w) => w.id)).toEqual([1, 2]);
  });

  it("silently drops ids the caller does not own and forbids when none remain", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.download({ workflowIds: [99] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedStorage.getWorkflowWithRelations).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the selected workflow no longer exists", async () => {
    const caller = callerFor();
    mockedStorage.getWorkflowWithRelations!.mockResolvedValue(null);
    await expect(
      caller.workflows.download({ workflowIds: [1] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.workflows.download({ workflowIds: [1, 2] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is available to Viewers (declared view capability)", async () => {
    const caller = callerFor(UserRole.VIEWER);
    mockedStorage.getWorkflowWithRelations!.mockResolvedValue(
      workflowWithRelations({ id: 1, name: "First" }),
    );
    await expect(
      caller.workflows.download({ workflowIds: [1] }),
    ).resolves.toMatchObject({ filename: "First.json" });
  });

  it("rejects an empty selection", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.download({ workflowIds: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    const caller = callerFor();
    mockedStorage.getAllWorkflows!.mockRejectedValueOnce(new Error("boom"));
    await expect(
      caller.workflows.download({ workflowIds: [1] }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to download workflows",
    });
  });
});

describe("workflows.getForFilters", () => {
  beforeEach(() => {
    mockedStorage.getAllWorkflows!.mockResolvedValue([
      workflowRow({ id: 1, name: "Alpha", status: EventStatus.ACTIVE }),
      workflowRow({ id: 2, name: "Beta", status: EventStatus.PAUSED }),
      workflowRow({ id: 3, name: "alphabet", status: EventStatus.ACTIVE }),
    ]);
  });

  it("filters by search and status, returning lightweight rows", async () => {
    const caller = callerFor();
    const result = await caller.workflows.getForFilters({
      search: "alpha",
      status: EventStatus.ACTIVE,
    });

    expect(result.workflows).toEqual([
      { id: 1, name: "Alpha" },
      { id: 3, name: "alphabet" },
    ]);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it("paginates and reports hasMore", async () => {
    const caller = callerFor();
    const result = await caller.workflows.getForFilters({
      limit: 2,
      offset: 0,
    });
    expect(result.workflows).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it("rejects invalid pagination", async () => {
    const caller = callerFor();
    await expect(
      caller.workflows.getForFilters({ limit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
