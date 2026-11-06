/**
 * What a failed query leaves in the server log. Drizzle's message ends with every
 * bound value, the driver's error quotes the row or the JSON it refused, and
 * console.error prints all of it for an error passed as it is. So a route logging
 * either one writes what it was saving to the log: request headers, script content,
 * whatever a script printed.
 *
 * Real Postgres on purpose. A mocked route test rejects with a hand-built error,
 * which has no params in its message and none of the driver's fields, so it can't
 * see any of this.
 */
// Only tokens are used here, and a rejected one falls through to a session lookup.
// The real NextAuth stack needs a request scope this suite does not have.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import { format } from "node:util";
import { NextRequest } from "next/server";
import {
  DELETE as deleteEvent,
  GET as getEvent,
  PATCH as patchEvent,
  PUT as putEvent,
} from "@/app/api/events/[id]/route";
import { GET as listEvents, POST as createEvent } from "@/app/api/events/route";
import { POST as executeEvent } from "@/app/api/events/[id]/execute/route";
import { POST as createLog } from "@/app/api/logs/route";
import { POST as triggerWorkflowWebhook } from "@/app/api/workflows/webhook/[key]/route";
import { hashApiToken } from "@/lib/api-token-hash";
import { hashWorkflowWebhookKey } from "@/lib/workflow-webhook-key";
import { cacheService } from "@/lib/cache/cache-service";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  EventStatus,
  WorkflowTriggerType,
  events,
  users,
  workflowNodes,
  workflows,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

/** Long enough to count as a value, and not shaped like what the masking catches. */
const SECRET = "sentinel-do-not-log-8f3a";

/** V8 quotes the JSON it couldn't parse whole only if that's under 21 characters. */
const SHORT_SECRET = "sentinel-8f3a";

let logged: string[] = [];

/**
 * Everything written, as console would print it: an error's fields count too, and
 * String(error) or args.join(" ") would leave those out. It takes the streams too,
 * so nothing here depends on knowing how a line gets logged.
 */
function captureLogs() {
  logged = [];
  for (const method of ["error", "warn", "log", "info", "debug"] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(format(...args));
    });
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    jest.spyOn(stream, "write").mockImplementation(((
      chunk: unknown,
      ...rest: unknown[]
    ) => {
      logged.push(String(chunk));
      return write(chunk, ...rest);
    }) as never);
  }
}

function expectNothingOfTheQuery() {
  const text = logged.join("\n");
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("Failed query");
  // The labels a raw error's fields print under.
  expect(text).not.toContain("params:");
  expect(text).not.toContain("query:");
  expect(text).not.toContain("detail:");
  expect(text).not.toContain("where:");
}

const refusedStatement = "RAISE EXCEPTION 'refused'";

/** Makes Postgres refuse every write to a table, with a real driver error. */
async function refuseWrites(table: string, raise = refusedStatement) {
  await pool.query(`
    CREATE FUNCTION refuse_write() RETURNS trigger AS $$
    BEGIN ${raise}; END
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_write BEFORE INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION refuse_write();
  `);
}

async function withTableRenamed(table: string, run: () => Promise<void>) {
  await pool.query(`ALTER TABLE ${table} RENAME TO ${table}_gone`);
  try {
    await run();
  } finally {
    await pool.query(`ALTER TABLE ${table}_gone RENAME TO ${table}`);
  }
}

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

const request = (path: string, method: string, token: string, body?: unknown) =>
  new NextRequest(`http://localhost:5001/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body !== undefined && {
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  });

const idParam = (id: number) => ({
  params: Promise.resolve({ id: String(id) }),
});

const newEvent = {
  name: "event",
  status: "DRAFT",
  scheduleUnit: "MINUTES",
  runLocation: "LOCAL",
  timeoutValue: 30,
  timeoutUnit: "SECONDS",
  retries: 0,
};

const newHttpEvent = {
  ...newEvent,
  type: "HTTP_REQUEST",
  httpMethod: "POST",
  httpUrl: "https://example.com/hook",
};

let owner: string;
let token: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await seedUser();
  token = await seedToken(owner);
  captureLogs();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await pool.query("DROP FUNCTION IF EXISTS refuse_write() CASCADE");
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("POST /api/events", () => {
  it.each([
    [
      "an Authorization header",
      { httpHeaders: [{ key: "Authorization", value: `Bearer ${SECRET}` }] },
    ],
    ["another header", { httpHeaders: [{ key: "X-Api-Key", value: SECRET }] }],
    ["the URL", { httpUrl: `https://example.com/hook?key=${SECRET}` }],
    ["the body", { httpBody: `{"key":"${SECRET}"}` }],
  ])(
    "doesn't log %s when the database refuses the event",
    async (_, fields) => {
      await refuseWrites("events");

      const response = await createEvent(
        request("events", "POST", token, { ...newHttpEvent, ...fields }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expectNothingOfTheQuery();
      // What's left still says what went wrong.
      expect(logged).toContainEqual("Error creating script: P0001: refused");
    },
  );

  it("doesn't log a script when the database refuses the event", async () => {
    await refuseWrites("events");

    const response = await createEvent(
      request("events", "POST", token, {
        ...newEvent,
        type: "BASH",
        content: `curl -H "Authorization: ${SECRET}" example.com`,
      }),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
  });

  // No trigger needed, so this is open to anyone who can create an event. The driver
  // quotes the JSON in `where`, which reading `error.cause` wholesale would print.
  it("doesn't log a header with a NUL byte, which Postgres refuses in JSON", async () => {
    const response = await createEvent(
      request("events", "POST", token, {
        ...newHttpEvent,
        httpHeaders: [{ key: "X-Api-Key", value: `${SECRET}\u0000` }],
      }),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      "Error creating script: 22P05: unsupported Unicode escape sequence",
    );
  });

  it("doesn't log a script with a NUL byte, which Postgres refuses in text", async () => {
    const response = await createEvent(
      request("events", "POST", token, {
        ...newEvent,
        type: "BASH",
        content: `echo ${SECRET}\u0000`,
      }),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      'Error creating script: 22021: invalid byte sequence for encoding "UTF8": 0x00',
    );
  });

  it("doesn't log an env var's name or ciphertext when saving it fails", async () => {
    await refuseWrites("env_vars");

    const response = await createEvent(
      request("events", "POST", token, {
        ...newEvent,
        type: "BASH",
        content: "echo hi",
        envVars: [{ key: SECRET, value: "the value" }],
      }),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged.join("\n")).not.toContain("crn.");
    expect(logged).toContainEqual("Error creating script: P0001: refused");
  });

  it("refuses a body that isn't JSON without logging it", async () => {
    const response = await createEvent(
      request("events", "POST", token, SHORT_SECRET),
    );

    expect(response.status).toBe(400);
    expect(logged.join("\n")).not.toContain(SHORT_SECRET);
  });
});

describe.each([
  ["PATCH", patchEvent],
  ["PUT", putEvent],
])("%s /api/events/{id}", (method, handler) => {
  it.each([
    [
      "the script",
      { content: `curl -H "Authorization: ${SECRET}" example.com` },
    ],
    ["the URL", { httpUrl: `https://example.com/hook?key=${SECRET}` }],
    ["a header", { httpHeaders: [{ key: "X-Api-Key", value: SECRET }] }],
    ["the body", { httpBody: `{"key":"${SECRET}"}` }],
    ["a tool action's config", { toolActionConfig: `{"apiKey":"${SECRET}"}` }],
  ])(
    "doesn't log %s when the database refuses the update",
    async (_, fields) => {
      const id = await seedEvent(owner);
      await refuseWrites("events");

      const response = await handler(
        request(`events/${id}`, method, token, fields),
        idParam(id),
      );

      expect(response.status).toBe(500);
      expectNothingOfTheQuery();
      expect(logged).toContainEqual("Error updating script: P0001: refused");
    },
  );
});

describe("PATCH /api/events/{id}", () => {
  it("doesn't log an env var's name or ciphertext when saving it fails", async () => {
    const id = await seedEvent(owner);
    await refuseWrites("env_vars");

    const response = await patchEvent(
      request(`events/${id}`, "PATCH", token, {
        name: "renamed",
        envVars: [{ key: SECRET, value: "the value" }],
      }),
      idParam(id),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged.join("\n")).not.toContain("crn.");
  });

  it("doesn't log an httpRequest that isn't JSON, which JSON.parse's message quotes", async () => {
    const id = await seedEvent(owner);

    await patchEvent(
      request(`events/${id}`, "PATCH", token, {
        httpRequest: SHORT_SECRET,
        name: "still saved",
      }),
      idParam(id),
    );

    expect(logged.join("\n")).not.toContain(SHORT_SECRET);
    expect(logged.join("\n")).toContain(
      `Error parsing HTTP request data for event ${id}: SyntaxError`,
    );
  });

  // Nothing in this app's own triggers does this, but one on a self-hosted database
  // can, and it's the form a message takes for any value it does quote.
  it("doesn't log a value Postgres's own message quotes", async () => {
    const id = await seedEvent(owner);
    await refuseWrites("events", "RAISE EXCEPTION 'refused %', NEW.content");

    await patchEvent(
      request(`events/${id}`, "PATCH", token, { content: SECRET }),
      idParam(id),
    );

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      "Error updating script: P0001: refused [value]",
    );
  });
});

describe("the other routes", () => {
  const stackOf = (line: string | undefined) => line?.match(/\n\s+at /);

  it("DELETE /api/events/{id} keeps the stack and leaves out the query", async () => {
    const id = await seedEvent(owner);
    await refuseWrites("events");

    const response = await deleteEvent(
      request(`events/${id}`, "DELETE", token),
      idParam(id),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("Error deleting script"),
    );
    expect(line).toContain("Error deleting script: P0001: refused");
    expect(stackOf(line)).toBeTruthy();
  });

  it("GET /api/events and GET /api/events/{id} leave out the query", async () => {
    const id = await seedEvent(owner);

    await withTableRenamed("events", async () => {
      const list = await listEvents(request("events", "GET", token));
      const one = await getEvent(
        request(`events/${id}`, "GET", token),
        idParam(id),
      );

      expect(list.status).toBe(500);
      expect(one.status).toBe(500);
    });

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("Error fetching scripts"),
    );
    expect(line).toContain(
      'Error fetching scripts: 42P01: relation "events" does not exist',
    );
    expect(stackOf(line)).toBeTruthy();
    expect(logged).toContainEqual(
      'Error fetching script: 42P01: relation "events" does not exist',
    );
  });

  it("POST /api/logs doesn't log what a script printed", async () => {
    const eventId = await seedEvent(owner);
    await refuseWrites("logs");

    const response = await createLog(
      request("logs", "POST", token, {
        eventId,
        status: "SUCCESS",
        output: `printed ${SECRET}`,
      }),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged.join("\n")).toContain("Error creating log: P0001: refused");
  });

  it("POST /api/logs doesn't log a body that isn't JSON, which JSON.parse's message quotes", async () => {
    await createLog(request("logs", "POST", token, SHORT_SECRET));

    expect(logged.join("\n")).not.toContain(SHORT_SECRET);
    expect(logged.join("\n")).toContain("Error creating log: SyntaxError");
  });

  it("POST /api/events/{id}/execute doesn't log a run's input", async () => {
    const id = await seedEvent(owner);
    await refuseWrites("jobs");

    const response = await executeEvent(
      request(`events/${id}/execute`, "POST", token, {
        input: { apiKey: SECRET },
      }),
      idParam(id),
    );

    expect(response.status).toBe(500);
    expectNothingOfTheQuery();
    expect(logged).toContainEqual("Failed to execute event: P0001: refused");
  });

  it("POST /api/workflows/webhook/{key} doesn't log the payload", async () => {
    const key = "workflow-webhook-key";
    const eventId = await seedEvent(owner);
    const [workflow] = await db
      .insert(workflows)
      .values({
        userId: owner,
        name: "webhook workflow",
        status: EventStatus.ACTIVE,
        triggerType: WorkflowTriggerType.WEBHOOK,
        webhookKeyHash: hashWorkflowWebhookKey(key),
      })
      .returning({ id: workflows.id });
    await db
      .insert(workflowNodes)
      .values({ workflowId: workflow!.id, eventId });
    await refuseWrites("workflow_executions");

    // It answers before the run starts, so what's logged comes later.
    await triggerWorkflowWebhook(
      new NextRequest(`http://localhost:5001/api/workflows/webhook/${key}`, {
        method: "POST",
        body: JSON.stringify({ apiKey: SECRET }),
      }),
      { params: Promise.resolve({ key }) },
    );
    const deadline = Date.now() + 10_000;
    while (!logged.some((line) => line.includes("run started:"))) {
      if (Date.now() > deadline)
        throw new Error("Timed out waiting for the run");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[WorkflowEngine] Failed to start workflow ${workflow!.id}: P0001: refused`,
    );
  });

  it("a failed token lookup doesn't log the token's hash", async () => {
    await withTableRenamed("api_tokens", async () => {
      const response = await listEvents(request("events", "GET", token));

      expect(response.status).toBe(401);
    });

    const text = logged.join("\n");
    expect(text).not.toContain(hashApiToken(token));
    expect(text).not.toContain("Failed query");
    expect(text).toContain(
      'Error validating API token: 42P01: relation "api_tokens" does not exist',
    );
  });
});

describe("withErrorHandling, which most tRPC routers go through", () => {
  it("leaves the query out of its log and of the response", async () => {
    const id = await seedEvent(owner);
    await refuseWrites("events");

    const failure = (await withErrorHandling(
      () => storage.updateScript(id, { content: SECRET }),
      { operationName: "update" },
    ).catch((error: unknown) => error)) as { code: string; message: string };

    expectNothingOfTheQuery();
    expect(logged.join("\n")).toContain("P0001: refused");
    // Any code but this one reaches the client with its message, and this query
    // used to be TIMEOUT because its column list has timeout_value in it.
    expect(failure.code).toBe("INTERNAL_SERVER_ERROR");
    expect(failure.message).not.toContain(SECRET);
    expect(failure.message).not.toContain("Failed query");
  });
});

/**
 * Where each kind of refusal really puts a value, so that the checks above aren't
 * only true of the refusals they happen to use.
 */
describe("what the driver's error holds", () => {
  const caught = (run: () => Promise<unknown>) =>
    run().then(
      () => {
        throw new Error("Expected the query to fail");
      },
      (error: unknown) => error,
    );

  const cases: Array<
    [string, string, string, (id: number) => Promise<unknown>]
  > = [
    [
      "23505",
      "a unique violation",
      'duplicate key value violates unique constraint "users_email_unique"',
      async () => {
        const email = `${SECRET}@example.com`;
        await db.insert(users).values({ id: "first", email } as never);
        return db.insert(users).values({ id: "second", email } as never);
      },
    ],
    [
      "23502",
      "a missing value, whose detail is the whole row",
      'null value in column "id" of relation "users" violates not-null constraint',
      () => db.insert(users).values({ id: null, email: SECRET } as never),
    ],
    [
      "23503",
      "a foreign key",
      'insert or update on table "events" violates foreign key constraint "events_user_id_users_id_fk"',
      () =>
        db
          .insert(events)
          .values({ userId: SECRET, name: "x", type: "BASH" } as never),
    ],
    [
      "22P02",
      "a value of the wrong type, which the message itself quotes",
      'invalid input syntax for type integer: "[value]"',
      (id) => storage.updateScript(id, { scheduleNumber: SECRET } as never),
    ],
    [
      "22P05",
      "a NUL byte in JSON, which `where` quotes",
      "unsupported Unicode escape sequence",
      (id) =>
        storage.updateScript(id, {
          httpHeaders: [{ key: "a", value: `${SECRET}\u0000` }],
        } as never),
    ],
  ];

  it.each(cases)("%s: %s", async (code, _, message, run) => {
    const id = await seedEvent(owner);

    const error = await caught(() => run(id));

    // A value really is in there, or this proves nothing.
    expect(format(error)).toContain(SECRET);

    expect(describeFailure(error)).toBe(`${code}: ${message}`);
    const logLine = failureWithStack(error);
    expect(logLine).not.toContain(SECRET);
    expect(logLine).toContain(`${code}: ${message}`);
    expect(logLine).toMatch(/\n\s+at /);
  });
});
