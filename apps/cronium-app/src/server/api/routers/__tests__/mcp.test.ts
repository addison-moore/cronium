/** @jest-environment node */
/**
 * Behavioral tests for the REAL mcp router (src/server/api/routers/mcp.ts) —
 * getCapabilities discovery and the validatePlan dry-run — through the REAL
 * protectedProcedure middleware chain. Mocked process boundaries: the database
 * driver (users + tool_credentials tables), the storage monolith
 * (queryServers), and the tool registry.
 */

type Row = Record<string, unknown>;

const dbState: {
  users: Row[];
  toolCredentials: Row[];
} = {
  users: [],
  toolCredentials: [],
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
      case "tool_credentials":
        return dbState.toolCredentials;
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
        return Promise.resolve(rowsFor(table)).then(onFulfilled, onRejected);
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

jest.mock("@/server/storage", () => ({
  storage: {
    queryServers: jest.fn(),
  },
}));

jest.mock("@/lib/tools/tool-registry", () => ({
  getSupportedToolTypes: jest.fn(),
  getManifest: jest.fn(),
  getServerActionById: jest.fn(),
}));

import type { Session } from "next-auth";
import type {} from "@/types/next-auth";
import { z } from "zod";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { mcpRouter } from "@/server/api/routers/mcp";
import { UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  getSupportedToolTypes,
  getManifest,
  getServerActionById,
} from "@/lib/tools/tool-registry";

// Mounted under "mcp" exactly as in root.ts (capability inventory keys).
const rootRouter = createTRPCRouter({ mcp: mcpRouter });
const createCaller = createCallerFactory(rootRouter);

const storageMock = storage as unknown as { queryServers: jest.Mock };
const registryMock = {
  getSupportedToolTypes: getSupportedToolTypes as jest.Mock,
  getManifest: getManifest as jest.Mock,
  getServerActionById: getServerActionById as jest.Mock,
};

const OWNER = "user-1";

function sessionFor(): Session {
  return {
    user: {
      id: OWNER,
      email: "user@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function caller() {
  return createCaller({
    session: sessionFor(),
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const SLACK_ACTION = {
  id: "slack_send_message",
  name: "Send message",
  description: "Send a Slack message",
  category: "messaging",
  actionType: "server",
  producesOutput: true,
  parameters: [
    { name: "channel", type: "string", required: true },
    { name: "message", type: "string", required: true },
  ],
  helpText: "Sends to a channel",
  examples: [],
  inputSchema: z.object({ channel: z.string(), message: z.string() }),
};

beforeEach(() => {
  jest.clearAllMocks();
  dbState.users = [
    {
      id: OWNER,
      role: UserRole.USER,
      roleId: 2,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      mfaEnabled: false,
    },
  ];
  dbState.toolCredentials = [
    { id: 7, type: "SLACK", name: "Team Slack", isActive: true },
  ];
  storageMock.queryServers.mockResolvedValue({
    items: [{ id: 6, name: "sandbox-a" }],
    total: 1,
    hasMore: false,
  });
  registryMock.getSupportedToolTypes.mockReturnValue(["slack"]);
  registryMock.getManifest.mockReturnValue({ actions: [SLACK_ACTION] });
  registryMock.getServerActionById.mockImplementation((id: string) =>
    id === SLACK_ACTION.id ? SLACK_ACTION : undefined,
  );
});

describe("mcp.getCapabilities", () => {
  it("returns enums, defaults, guidance, tool actions, and the user's ids", async () => {
    const caps = await caller().mcp.getCapabilities();

    expect(caps.eventTypes).toContain("BASH");
    expect(caps.defaults.status).toBe("DRAFT");
    expect(caps.scheduling.specificTime).toContain("customSchedule");
    // The iterate-loop guidance the new tool surface documents.
    expect(caps.guidance.iterateLoop).toContain("run_workflow");
    expect(caps.guidance.verification).toContain("get_execution");
    expect(caps.guidance.updating).toContain("REPLACES");
    expect(caps.guidance.reading).toContain("never returned");

    expect(caps.toolTypes).toEqual([
      expect.objectContaining({
        type: "slack",
        actions: [
          expect.objectContaining({
            id: "slack_send_message",
            producesOutput: true,
          }),
        ],
      }),
    ]);
    expect(caps.servers).toEqual([{ id: 6, name: "sandbox-a" }]);
  });

  it("normalizes credential types to the lowercase manifest type and exposes no secrets", async () => {
    const caps = await caller().mcp.getCapabilities();
    expect(caps.credentials).toEqual([
      { id: 7, toolType: "slack", name: "Team Slack", isActive: true },
    ]);
    // Only these four fields — never encrypted config/secret material.
    for (const cred of caps.credentials) {
      expect(Object.keys(cred).sort()).toEqual([
        "id",
        "isActive",
        "name",
        "toolType",
      ]);
    }
  });
});

describe("mcp.validatePlan", () => {
  const bash = (key: string) => ({
    key,
    name: `Event ${key}`,
    type: "BASH",
    content: "echo hi",
  });

  const toolAction = (key: string, config: unknown) => ({
    key,
    name: `Tool ${key}`,
    type: "TOOL_ACTION",
    toolActionConfig:
      typeof config === "string" ? config : JSON.stringify(config),
  });

  it("accepts a valid multi-event plan with a workflow", async () => {
    const res = await caller().mcp.validatePlan({
      events: [
        bash("a"),
        toolAction("b", {
          toolType: "slack",
          toolId: 7,
          actionId: "slack_send_message",
          parameters: { channel: "#general", message: "hi" },
        }),
      ],
      workflow: {
        name: "Chain",
        connections: [{ from: "a", to: "b", connectionType: "ON_SUCCESS" }],
      },
    });
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.summary).toContain("2 event(s)");
    expect(res.hasWorkflow).toBe(true);
  });

  it("flags duplicate event keys", async () => {
    const res = await caller().mcp.validatePlan({
      events: [bash("a"), bash("a")],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toContain('Duplicate event key "a"');
  });

  it("flags schema-invalid events (script without content)", async () => {
    const res = await caller().mcp.validatePlan({
      events: [{ key: "a", name: "A", type: "BASH" }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toContain('event "a"');
  });

  it("flags non-JSON toolActionConfig", async () => {
    const res = await caller().mcp.validatePlan({
      events: [toolAction("t", "{not json")],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toContain("not valid JSON");
  });

  it("flags a toolId that is not one of the user's credentials", async () => {
    const res = await caller().mcp.validatePlan({
      events: [
        toolAction("t", {
          toolType: "slack",
          toolId: 999,
          actionId: "slack_send_message",
          parameters: { channel: "#g", message: "m" },
        }),
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toContain("toolId 999");
  });

  it("flags a toolType that doesn't match the credential", async () => {
    const res = await caller().mcp.validatePlan({
      events: [
        toolAction("t", {
          toolType: "discord",
          toolId: 7,
          actionId: "slack_send_message",
          parameters: { channel: "#g", message: "m" },
        }),
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toContain('toolType "discord"');
  });

  it("flags an unknown actionId and bad action parameters", async () => {
    const unknownAction = await caller().mcp.validatePlan({
      events: [
        toolAction("t", {
          toolType: "slack",
          toolId: 7,
          actionId: "nope",
          parameters: {},
        }),
      ],
    });
    expect(unknownAction.valid).toBe(false);
    expect(unknownAction.errors.join("\n")).toContain("unknown actionId");

    const badParams = await caller().mcp.validatePlan({
      events: [
        toolAction("t", {
          toolType: "slack",
          toolId: 7,
          actionId: "slack_send_message",
          parameters: { channel: "#g" }, // missing `message`
        }),
      ],
    });
    expect(badParams.valid).toBe(false);
    expect(badParams.errors.join("\n")).toContain("parameters");
  });

  it("flags workflow graph problems: unknown keys, self-loops, fan-in, cycles", async () => {
    const unknownKey = await caller().mcp.validatePlan({
      events: [bash("a")],
      workflow: { connections: [{ from: "a", to: "ghost" }] },
    });
    expect(unknownKey.errors.join("\n")).toContain('unknown event key "ghost"');

    const selfLoop = await caller().mcp.validatePlan({
      events: [bash("a")],
      workflow: { connections: [{ from: "a", to: "a" }] },
    });
    expect(selfLoop.errors.join("\n")).toContain("self-loop");

    const fanIn = await caller().mcp.validatePlan({
      events: [bash("a"), bash("b"), bash("c")],
      workflow: {
        connections: [
          { from: "a", to: "c" },
          { from: "b", to: "c" },
        ],
      },
    });
    expect(fanIn.errors.join("\n")).toContain("fan-in is not allowed");

    const cycle = await caller().mcp.validatePlan({
      events: [bash("a"), bash("b")],
      workflow: {
        connections: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      },
    });
    expect(cycle.errors.join("\n")).toContain("cycle");
  });
});
