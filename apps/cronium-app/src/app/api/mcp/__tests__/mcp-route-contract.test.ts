/**
 * @jest-environment node
 *
 * Contract tests for the remote MCP endpoint (POST /api/mcp): bearer auth
 * (API token or OAuth access token), the JSON-RPC protocol surface
 * (initialize / ping / tools list+call / notifications / batch / parse
 * errors), and the tool registry exposure (schemas + annotations).
 *
 * Mocked process boundaries: token authentication, the tRPC caller factory,
 * and the database. Tool handlers run for real against the stub caller.
 */

jest.mock("@/server/db", () => ({ db: {} }));

jest.mock("@/server/api/root", () => ({
  createCaller: jest.fn(),
}));

jest.mock("@/server/api/trpc", () => ({
  sessionFromApiToken: jest.fn(),
}));

jest.mock("@/lib/mcp-oauth/resource", () => ({
  sessionFromOAuthToken: jest.fn(),
}));

// api-auth transitively imports the ESM env module; supply a faithful
// getBearerToken (the only symbol the route uses from it).
jest.mock("@/lib/api-auth", () => ({
  getBearerToken: (headers: Headers) => {
    const auth = headers.get("authorization");
    const match = auth?.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
  },
}));

jest.mock("@/lib/mcp-oauth/metadata", () => ({
  getBaseUrl: jest.fn(() => "https://cronium.test"),
  resourceMetadataUrl: jest.fn(
    () => "https://cronium.test/.well-known/oauth-protected-resource/api/mcp",
  ),
}));

import { createCaller } from "@/server/api/root";
import { sessionFromApiToken } from "@/server/api/trpc";
import { sessionFromOAuthToken } from "@/lib/mcp-oauth/resource";
import { POST, GET } from "@/app/api/mcp/route";
import { MCP_TOOLS } from "@/app/api/mcp/tools";

const createCallerMock = createCaller as unknown as jest.Mock;
const apiTokenMock = sessionFromApiToken as unknown as jest.Mock;
const oauthMock = sessionFromOAuthToken as unknown as jest.Mock;

const SESSION = {
  user: { id: "user-1", email: "u@example.com" },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

function stubCaller(overrides: Record<string, unknown> = {}) {
  return {
    mcp: {
      getCapabilities: jest.fn().mockResolvedValue({ eventTypes: ["BASH"] }),
      validatePlan: jest.fn(),
    },
    events: {
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
      execute: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      getLogs: jest.fn(),
    },
    workflows: {
      create: jest.fn(),
      update: jest.fn(),
      execute: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      getExecutions: jest.fn(),
      getExecution: jest.fn(),
    },
    ...overrides,
  };
}

function post(body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request("https://cronium.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

beforeEach(() => {
  jest.clearAllMocks();
  oauthMock.mockResolvedValue(null);
  apiTokenMock.mockResolvedValue({ session: SESSION, scopes: ["mcp"] });
  createCallerMock.mockReturnValue(stubCaller());
});

describe("auth", () => {
  it("401s with discovery challenge when no token is sent", async () => {
    apiTokenMock.mockResolvedValue(null);
    const res = await post(rpc("ping"));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      'resource_metadata="https://cronium.test/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(challenge).not.toContain("invalid_token");
  });

  it("401s flagging invalid_token when a bad token is sent", async () => {
    apiTokenMock.mockResolvedValue(null);
    const res = await post(rpc("ping"), "bogus");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  it("accepts an OAuth access token ahead of the API-token path", async () => {
    oauthMock.mockResolvedValue({ session: SESSION, scopes: ["mcp"] });
    apiTokenMock.mockResolvedValue(null);
    const res = await post(rpc("ping"), "oauth-token");
    expect(res.status).toBe(200);
  });

  it("threads the authenticated session, scopes, and mcp provenance into the caller", async () => {
    await post(rpc("ping"), "good-token");
    expect(createCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session: SESSION,
        tokenScopes: ["mcp"],
        requestSource: "mcp",
      }),
    );
  });
});

describe("JSON-RPC protocol", () => {
  it("initialize echoes the protocol version and advertises tools", async () => {
    const res = await post(
      rpc("initialize", { protocolVersion: "2025-06-18" }),
      "t",
    );
    const body = (await res.json()) as {
      result: {
        protocolVersion: string;
        serverInfo: { name: string };
        capabilities: { tools: object };
      };
    };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("cronium");
    expect(body.result.capabilities.tools).toEqual({});
  });

  it("answers ping and unknown methods per spec", async () => {
    const pong = await (await post(rpc("ping"), "t")).json();
    expect(pong).toEqual({ jsonrpc: "2.0", id: 1, result: {} });

    const unknown = (await (await post(rpc("bogus/method"), "t")).json()) as {
      error: { code: number };
    };
    expect(unknown.error.code).toBe(-32601);
  });

  it("returns 202 with no body for notification-only messages", async () => {
    const res = await post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      "t",
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("handles a batch and answers each request in it", async () => {
    const res = await post(
      [rpc("ping", undefined, 1), rpc("ping", undefined, 2)],
      "t",
    );
    const body = (await res.json()) as Array<{ id: number }>;
    expect(body.map((m) => m.id).sort()).toEqual([1, 2]);
  });

  it("400s with -32700 on a non-JSON body", async () => {
    const res = await post("{not json", "t");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("rejects GET (no server-initiated stream)", () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

describe("tools/list", () => {
  it("lists every registered tool with schema and annotations", async () => {
    const res = await post(rpc("tools/list"), "t");
    const body = (await res.json()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: unknown;
          annotations: Record<string, boolean>;
        }>;
      };
    };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(
      MCP_TOOLS.map((t) => t.name).sort(),
    );
    for (const tool of body.result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it("annotates reads, destructive writes, and runs correctly", async () => {
    const res = await post(rpc("tools/list"), "t");
    const body = (await res.json()) as {
      result: {
        tools: Array<{ name: string; annotations: Record<string, boolean> }>;
      };
    };
    const byName = new Map(
      body.result.tools.map((t) => [t.name, t.annotations]),
    );

    expect(byName.get("list_events")?.readOnlyHint).toBe(true);
    expect(byName.get("get_execution")?.readOnlyHint).toBe(true);
    expect(byName.get("create_event")?.destructiveHint).toBe(false);
    expect(byName.get("delete_event")?.destructiveHint).toBe(true);
    expect(byName.get("delete_workflow")?.destructiveHint).toBe(true);
    expect(byName.get("run_event")?.destructiveHint).toBe(true);
    expect(byName.get("run_workflow")?.idempotentHint).toBe(false);
    expect(byName.get("update_event")?.idempotentHint).toBe(true);
  });
});

describe("tools/call", () => {
  it("dispatches to the handler and returns its text content", async () => {
    const res = await post(
      rpc("tools/call", { name: "get_capabilities", arguments: {} }),
      "t",
    );
    const body = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.type).toBe("text");
    expect(JSON.parse(body.result.content[0]!.text)).toEqual({
      eventTypes: ["BASH"],
    });
  });

  it("returns -32602 for an unknown tool", async () => {
    const res = await post(
      rpc("tools/call", { name: "nope", arguments: {} }),
      "t",
    );
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32602);
  });

  it("surfaces handler failures as isError tool results, not protocol errors", async () => {
    const caller = stubCaller();
    (caller.mcp.getCapabilities as jest.Mock).mockRejectedValue(
      new Error("FORBIDDEN: token scope does not permit mcp.getCapabilities"),
    );
    createCallerMock.mockReturnValue(caller);

    const res = await post(
      rpc("tools/call", { name: "get_capabilities", arguments: {} }),
      "t",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("FORBIDDEN");
  });
});
