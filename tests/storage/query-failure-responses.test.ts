/**
 * What a failed query sends back to whoever called. Drizzle's message is the SQL and
 * every bound value, and these paths hand on an error's message: in a 200 from a bulk
 * or test procedure, in an MCP tool result, which goes to a model, and in a redirect's
 * query string. The text of any other error has to keep getting through, because some
 * of it is written for the caller.
 *
 * Real Postgres on purpose, as in query-failure-logging.test.ts: a hand-built error
 * has no params in its message.
 */
// Only tokens and hand-built sessions are used here. The real NextAuth stack needs a
// request scope this suite does not have.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { createHash, randomUUID } from "node:crypto";
import { format } from "node:util";
import { sql } from "drizzle-orm";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { POST as postMcp } from "@/app/api/mcp/route";
import { MCP_TOOL_BY_NAME } from "@/app/api/mcp/tools";
import { GET as oauthCallback } from "@/app/api/oauth/callback/route";
import { cacheService } from "@/lib/cache/cache-service";
import { GoogleOAuthProvider } from "@/lib/oauth/providers";
import { createCaller } from "@/server/api/root";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import {
  LogStatus,
  UserRole,
  UserStatus,
  logs,
  oauthStates,
  systemSettings,
  toolCredentials,
  userVariables,
  workflows,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

/** In a user id, so it's a bound value of any query that filters on the owner. */
const SECRET = "sentinel-do-not-return-8f3a";

const QUERY_FAILED = "A database query failed";

const NONCE = "the-browser-nonce";

let logged: string[] = [];
let renamedTable: string | null = null;
let owner: string;

function captureLogs() {
  logged = [];
  for (const method of ["error", "warn", "log", "info", "debug"] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(format(...args));
    });
  }
}

/** What goes back, whichever way it's read, holds nothing of the failed query. */
function expectNothingOfTheQuery(response: unknown) {
  const text =
    typeof response === "string" ? response : JSON.stringify(response);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("Failed query");
  expect(text).not.toContain("params:");
}

/** The caller no longer sees why, so the log has to, without the values. */
function expectReasonLogged(reason: string) {
  const text = logged.join("\n");
  expect(text).toContain(reason);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("Failed query");
}

/** Makes Postgres refuse every write to a table, with a real driver error. */
async function refuseWrites(table: string) {
  await pool.query(`
    CREATE FUNCTION refuse_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'refused'; END
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_write BEFORE INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION refuse_write();
  `);
}

/** Put back in afterEach, so a test that times out can't break the ones after it. */
async function renameAway(table: string) {
  await pool.query(`ALTER TABLE ${table} RENAME TO ${table}_gone`);
  renamedTable = table;
}

async function callerFor(userId: string) {
  const user = await storage.getUser(userId);
  const session = {
    user: {
      id: userId,
      email: user!.email ?? "",
      name: "test user",
      role: user!.role,
      status: user!.status,
      sessionVersion: user!.sessionVersion,
      image: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const seedAdmin = () =>
  seedUser({ id: `admin-${randomUUID()}`, role: UserRole.ADMIN });

beforeEach(async () => {
  await resetDatabase();
  owner = await seedUser({ id: `user-${SECRET}-${randomUUID()}` });
  captureLogs();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await pool.query("DROP FUNCTION IF EXISTS refuse_write() CASCADE");
  if (renamedTable) {
    await pool.query(
      `ALTER TABLE ${renamedTable}_gone RENAME TO ${renamedTable}`,
    );
    renamedTable = null;
  }
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("tRPC results that report a failure in a 200", () => {
  it("variables.bulkOperation", async () => {
    const [variable] = await db
      .insert(userVariables)
      .values({ userId: owner, key: "KEY", value: "value" })
      .returning({ id: userVariables.id });
    await refuseWrites("user_variables");

    const caller = await callerFor(owner);
    const result = await caller.variables.bulkOperation({
      variableIds: [variable!.id],
      operation: "delete",
    });

    expectNothingOfTheQuery(result);
    expect(result.results).toEqual([
      { id: variable!.id, success: false, error: QUERY_FAILED },
    ]);
    expectReasonLogged("P0001: refused");
  });

  it("logs.bulkOperation", async () => {
    const eventId = await seedEvent(owner);
    const [log] = await db
      .insert(logs)
      .values({ eventId, status: LogStatus.SUCCESS, userId: owner })
      .returning({ id: logs.id });
    await refuseWrites("logs");

    const caller = await callerFor(owner);
    const result = await caller.logs.bulkOperation({
      logIds: [log!.id],
      operation: "delete",
    });

    expectNothingOfTheQuery(result);
    expect(result.results).toEqual([
      { id: log!.id, success: false, error: QUERY_FAILED },
    ]);
  });

  it("workflows.bulkOperation", async () => {
    const [workflow] = await db
      .insert(workflows)
      .values({ userId: owner, name: "workflow" })
      .returning({ id: workflows.id });
    await refuseWrites("workflows");

    const caller = await callerFor(owner);
    const result = await caller.workflows.bulkOperation({
      workflowIds: [workflow!.id],
      operation: "archive",
    });

    expectNothingOfTheQuery(result);
    expect(result.results).toEqual([
      { id: workflow!.id, success: false, error: QUERY_FAILED },
    ]);
  });

  it("servers.bulkOperation", async () => {
    const serverId = await seedServer(owner);
    await refuseWrites("servers");

    const caller = await callerFor(owner);
    const result = await caller.servers.bulkOperation({
      serverIds: [serverId],
      operation: "share",
    });

    expectNothingOfTheQuery(result);
    expect(result.results).toEqual([
      { id: serverId, success: false, error: QUERY_FAILED },
    ]);
  });

  it("admin.bulkUserOperation", async () => {
    const caller = await callerFor(await seedAdmin());
    const target = await seedUser({ id: `target-${SECRET}` });
    await refuseWrites("users");

    const result = await caller.admin.bulkUserOperation({
      userIds: [target],
      operation: "activate",
    });

    // The result names the target by id, so only its error can be checked here.
    expect(result.results).toEqual([
      { id: target, success: false, error: QUERY_FAILED },
    ]);
  });

  it("admin.bulkUserOperation, resending an invite with a new token's hash", async () => {
    const caller = await callerFor(await seedAdmin());
    const target = await seedUser({ status: UserStatus.INVITED });
    await refuseWrites("users");

    const result = await caller.admin.bulkUserOperation({
      userIds: [target],
      operation: "resend_invite",
    });

    expectNothingOfTheQuery(result);
    expect(result.results).toEqual([
      { id: target, success: false, error: QUERY_FAILED },
    ]);
  });

  it("admin.sendTestEmail", async () => {
    await renameAway("system_settings");

    const caller = await callerFor(await seedAdmin());
    const result = await caller.admin.sendTestEmail({
      to: "someone@example.test",
    });

    expectNothingOfTheQuery(result);
    expect(result).toEqual({ success: false, message: QUERY_FAILED });
  });

  it("monitoring.getHealthCheck", async () => {
    const caller = await callerFor(await seedAdmin());
    const checks = {
      includeExternalServices: false,
      includeSystemResources: false,
      timeout: 1,
    };
    // Leaves the principal in its cache, so the procedure gets as far as the check.
    await caller.monitoring.getHealthCheck({
      ...checks,
      includeDatabase: false,
    });
    await renameAway("users");

    const result = await caller.monitoring.getHealthCheck({
      ...checks,
      includeDatabase: true,
    });

    expectNothingOfTheQuery(result);
    expect(result.status).toBe("unhealthy");
    expect(result.services?.database).toMatchObject({
      status: "down",
      error: QUERY_FAILED,
    });
  });
});

describe("tRPC errors, which createCaller doesn't send through the formatter", () => {
  it("servers.delete keeps the query out of its message", async () => {
    const serverId = await seedServer(owner);
    await refuseWrites("servers");

    const caller = await callerFor(owner);
    const error = await caller.servers
      .delete({ id: serverId })
      .catch((caught: unknown) => caught);

    expectNothingOfTheQuery((error as Error).message);
    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to delete server: ${QUERY_FAILED}`,
    });
  });

  it("servers.restore doesn't pass a failed query's message on", async () => {
    const serverId = await seedServer(owner, { isArchived: true });
    await refuseWrites("servers");

    const caller = await callerFor(owner);
    const error = await caller.servers
      .restore({ id: serverId })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to restore server",
    });
  });
});

describe("the text of other errors in those results", () => {
  it("workflows.bulkOperation still says why it refused", async () => {
    const someoneElse = await seedUser();
    const [workflow] = await db
      .insert(workflows)
      .values({ userId: someoneElse, name: "theirs" })
      .returning({ id: workflows.id });

    const caller = await callerFor(owner);
    const result = await caller.workflows.bulkOperation({
      workflowIds: [workflow!.id, 999_999],
      operation: "archive",
    });

    expect(result.results).toEqual([
      {
        id: workflow!.id,
        success: false,
        error: "You do not have the required capability for this workflow",
      },
      { id: 999_999, success: false, error: "Workflow not found" },
    ]);
  });

  it("admin.sendTestEmail still says what the SMTP server did", async () => {
    await db.insert(systemSettings).values(
      Object.entries({
        smtpHost: "127.0.0.1",
        // Nothing listens here, so this needs no SMTP server and no network.
        smtpPort: "1",
        smtpUser: "user",
        smtpPassword: "password",
        smtpFromEmail: "from@example.test",
      }).map(([key, value]) => ({ key, value })),
    );

    const caller = await callerFor(await seedAdmin());
    const result = await caller.admin.sendTestEmail({
      to: "someone@example.test",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("MCP tool results, which reach a model", () => {
  async function seedToken(userId: string): Promise<string> {
    const token = `test-token-${randomUUID()}`;
    await storage.createApiToken({
      userId,
      name: "ci",
      token,
      scopes: ["full"],
    } as never);
    return token;
  }

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const response = await postMcp(
      new Request("http://localhost:5001/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await seedToken(owner)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    return { text: result.content[0]!.text, isError: result.isError };
  }

  it("a procedure with no catch of its own, through route.ts", async () => {
    await renameAway("tool_credentials");

    const result = await callTool("get_capabilities");

    expectNothingOfTheQuery(result.text);
    expect(result).toEqual({ text: `Error: ${QUERY_FAILED}`, isError: true });
    expectReasonLogged('42P01: relation "tool_credentials" does not exist');
  });

  it("a procedure that picked its own message for a failed query", async () => {
    const eventId = await seedEvent(owner);
    await renameAway("events");

    const result = await callTool("get_event", { id: eventId });

    expect(result).toEqual({ text: `Error: ${QUERY_FAILED}`, isError: true });
    expectReasonLogged('42P01: relation "events" does not exist');
  });

  it("a tool that catches the error itself, through tools.ts", async () => {
    // The two procedures this tool calls both catch their own errors today, so
    // what this guards is any procedure that doesn't. The query is real.
    const failedQuery = () =>
      db.execute(sql`SELECT * FROM no_such_table WHERE id = ${SECRET}`);
    const caller = { events: { create: failedQuery } };

    const result = await MCP_TOOL_BY_NAME.get(
      "create_workflow_bundle",
    )!.handler(
      caller as never,
      { events: [{ key: "a", name: "a", type: "BASH", content: "true" }] },
      "http://localhost:5001",
    );

    expectNothingOfTheQuery(result.text);
    expect(result).toEqual({ text: `Error: ${QUERY_FAILED}`, isError: true });
  });

  it("keeps a message the model can act on", async () => {
    const notFound = await callTool("get_event", { id: 999_999 });
    expect(notFound).toEqual({ text: "Error: Event not found", isError: true });

    const eventId = await seedEvent(owner);
    const badGraph = await callTool("update_workflow", {
      id: 1,
      graph: { events: [eventId, eventId] },
    });
    expect(badGraph).toEqual({
      text: "Error: graph.events contains duplicate event ids — each event may appear once.",
      isError: true,
    });

    const badInput = await callTool("create_event", { name: 5 });
    expect(badInput.isError).toBe(true);
    expect(badInput.text).toContain("name");
  });
});

describe("the OAuth callback's redirect, which puts the text in a URL", () => {
  beforeAll(() => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "client-id";
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "client-secret";
  });

  afterAll(() => {
    delete process.env.OAUTH_GOOGLE_CLIENT_ID;
    delete process.env.OAUTH_GOOGLE_CLIENT_SECRET;
  });

  const STATE = `state-${SECRET}`;

  beforeEach(async () => {
    const [tool] = await db
      .insert(toolCredentials)
      .values({
        userId: owner,
        name: "sheets",
        type: "google_sheets",
        credentials: "encrypted-blob",
      })
      .returning({ id: toolCredentials.id });
    await db.insert(oauthStates).values({
      state: STATE,
      userId: owner,
      toolId: tool!.id,
      providerId: "google",
      redirectUri: "http://localhost:5001/api/oauth/callback",
      codeVerifier: "the-verifier",
      browserNonceHash: createHash("sha256").update(NONCE).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  async function callback({ nonce = NONCE } = {}) {
    const url = new URL("http://localhost:5001/api/oauth/callback");
    url.searchParams.set("code", "the-code");
    url.searchParams.set("state", STATE);
    // The route's schema refuses the null searchParams.get gives for an absent one,
    // and sends the request to its outer catch, so these go in empty to get past it.
    url.searchParams.set("error", "");
    url.searchParams.set("error_description", "");
    const response = await oauthCallback(
      new NextRequest(url, {
        headers: { cookie: `cronium-oauth-nonce=${nonce}` },
      }),
    );
    const location = response.headers.get("location")!;
    return { location, params: new URL(location).searchParams };
  }

  it("leaves the query out when claiming the state fails", async () => {
    await refuseWrites("oauth_states");

    const { location, params } = await callback();

    expectNothingOfTheQuery(decodeURIComponent(location));
    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(QUERY_FAILED);
  });

  it("leaves the query out when storing the tokens fails", async () => {
    jest
      .spyOn(GoogleOAuthProvider.prototype, "exchangeCodeForTokens")
      .mockResolvedValue({
        accessToken: "the-access-token",
        tokenType: "Bearer",
        scope: SECRET,
      });
    await refuseWrites("oauth_tokens");

    const { location, params } = await callback();

    expectNothingOfTheQuery(decodeURIComponent(location));
    expect(params.get("details")).toBe(
      `Failed to store tokens: ${QUERY_FAILED}`,
    );
  });

  it("still says why it refused a browser", async () => {
    const { params } = await callback({ nonce: "another-browser" });

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "OAuth session could not be verified for this browser",
    );
  });
});
