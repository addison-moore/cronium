/**
 * What a failed query leaves in the server log. Drizzle's message ends with every
 * bound value, the driver's error quotes the row or the JSON it refused, and
 * console.error prints all of it for an error passed as it is. So a route logging
 * either one writes what it was saving to the log: request headers, script content,
 * whatever a script printed.
 *
 * The worker, the socket server and what they call log the same errors with nobody
 * watching. There the query is holding an event's script or HTTP headers, a step's
 * output or what a job printed, and some of these write the text to a row too.
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
// There's no socket server here, and each log update would retry with backoff.
jest.mock("@/lib/websocket-broadcaster", () => ({
  getWebSocketBroadcaster: () => ({
    broadcastLogUpdate: () => Promise.resolve({ success: true, attempts: 1 }),
  }),
}));

import { randomUUID } from "node:crypto";
import { format } from "node:util";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { NextRequest } from "next/server";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { z } from "zod";
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
import { TokenManager } from "@/lib/oauth/TokenManager";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";
import * as httpEvents from "@/lib/scheduler/http-event-executor";
import { runInProcessJob } from "@/lib/scheduler/in-process-executor";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import { runDispatchTick } from "@/lib/scheduling/dispatcher";
import { POISON_AGE_MS, consumeJobTransitions } from "@/lib/scheduling/outbox";
import { runRetention } from "@/lib/scheduling/retention";
import { runSweepTick } from "@/lib/scheduling/sweeper";
import { InProcessWorkerPool } from "@/lib/scheduling/worker-executor";
import {
  advanceRunsForJob,
  advanceWorkflowRun,
  reconcileWorkflowRuns,
  startWorkflowRun,
} from "@/lib/scheduling/workflow-engine";
import { auditLogger } from "@/lib/security/audit-logger";
import { encryptEnvVarValue } from "@/lib/security/field-secret";
import { jobService } from "@/lib/services/job-service";
import { serverCleanupService } from "@/lib/services/server-cleanup-service";
import { WorkflowCleanupService } from "@/lib/services/workflow-cleanup-service";
import {
  authenticateSocketTicket,
  mintSocketTicket,
} from "@/lib/socket-ticket";
import { credentialCache } from "@/lib/tools/credential-cache";
import * as serverActions from "@/lib/tools/server-action-executor";
import { db, pool } from "@/server/db";
import { LogsWebSocketHandler } from "@/server/logs-websocket";
import { storage } from "@/server/storage";
import { TerminalWebSocketHandler } from "@/server/terminal-websocket";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  EventStatus,
  EventTriggerType,
  EventType,
  JobStatus,
  JobType,
  LeaseLossPolicy,
  LogStatus,
  WorkflowStepStatus,
  WorkflowTriggerType,
  envVars,
  events,
  jobTransitions,
  jobs,
  logs,
  scheduleIncidents,
  toolActionLogs,
  toolAuditLogs,
  toolCredentials,
  users,
  workflowExecutionEvents,
  workflowExecutions,
  workflowNodes,
  workflowStepRuns,
  workflows,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

/** Long enough to count as a value, and not shaped like what the masking catches. */
const SECRET = "sentinel-do-not-log-8f3a";

/** V8 quotes the JSON it couldn't parse whole only if that's under 21 characters. */
const SHORT_SECRET = "sentinel-8f3a";

/** What gets stored or sent in place of a failed query's text. */
const QUERY_FAILED = "A database query failed";

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
async function refuseWrites(
  table: string,
  raise = refusedStatement,
  operations = "INSERT OR UPDATE OR DELETE",
) {
  await pool.query(`
    CREATE FUNCTION refuse_write() RETURNS trigger AS $$
    BEGIN ${raise}; END
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_write BEFORE ${operations} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION refuse_write();
  `);
}

async function waitForLog(text: string) {
  const deadline = Date.now() + 10_000;
  while (!logged.some((line) => line.includes(text))) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for "${text}" in: ${logged.join("\n")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withTableRenamed<T>(table: string, run: () => Promise<T>) {
  await pool.query(`ALTER TABLE ${table} RENAME TO ${table}_gone`);
  try {
    return await run();
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
  auditLogger.stopFlushInterval();
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

/** One run of a workflow with one node, for the engine's own writes to fail. */
async function seedWorkflowRun(
  stepStatus: WorkflowStepStatus,
  stepFields: Partial<typeof workflowStepRuns.$inferInsert> = {},
) {
  const eventId = await seedEvent(owner);
  const [workflow] = await db
    .insert(workflows)
    .values({
      userId: owner,
      name: "workflow",
      status: EventStatus.ACTIVE,
      triggerType: WorkflowTriggerType.MANUAL,
    })
    .returning({ id: workflows.id });
  const [node] = await db
    .insert(workflowNodes)
    .values({ workflowId: workflow!.id, eventId })
    .returning({ id: workflowNodes.id });
  const [run] = await db
    .insert(workflowExecutions)
    .values({
      workflowId: workflow!.id,
      userId: owner,
      status: LogStatus.RUNNING,
      triggerType: WorkflowTriggerType.MANUAL,
      startedAt: new Date(),
    })
    .returning({ id: workflowExecutions.id });
  const [step] = await db
    .insert(workflowStepRuns)
    .values({
      workflowExecutionId: run!.id,
      nodeId: node!.id,
      eventId,
      status: stepStatus,
      ...stepFields,
    })
    .returning({ id: workflowStepRuns.id });
  return {
    eventId,
    runId: run!.id,
    stepId: step!.id,
    workflowId: workflow!.id,
  };
}

/** A script with a secret in it, an env var encrypted at rest and one from before that. */
async function seedEventWithSecrets(
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<number> {
  const id = await seedEvent(owner, {
    content: `curl -H "Authorization: ${SECRET}" example.com`,
    ...overrides,
  });
  await db.insert(envVars).values({
    eventId: id,
    key: "API_KEY",
    value: encryptEnvVarValue(`${SECRET}-env`, id, "API_KEY"),
  });
  await db.insert(envVars).values({
    eventId: id,
    key: "LEGACY_KEY",
    value: `${SECRET}-legacy`,
  });
  return id;
}

describe("the dispatcher", () => {
  const due = {
    status: EventStatus.ACTIVE,
    triggerType: EventTriggerType.SCHEDULE,
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    nextRunAt: new Date(Date.now() - 1000),
  };
  const seedDueEvent = () => seedEventWithSecrets(due as never);

  // The job's payload has the script, and the env vars as they're stored: ciphertext,
  // or plaintext on a row that hasn't been encrypted.
  it("doesn't log or store a script or env var when the job can't be saved", async () => {
    const id = await seedDueEvent();
    await refuseWrites("jobs");

    const result = await runDispatchTick();

    expect(result.dispatched).toBe(0);
    expectNothingOfTheQuery();
    expect(logged.join("\n")).not.toContain("crn.");
    expect(logged.join("\n")).toMatch(
      new RegExp(
        `\\[Dispatcher\\] Failed to dispatch event ${id} tick \\S+: P0001: refused`,
      ),
    );

    const incidents = await db.select().from(scheduleIncidents);
    expect(incidents).toHaveLength(1);
    expect((incidents[0]!.details as { reason: string }).reason).toBe(
      `dispatch failed: ${QUERY_FAILED}`,
    );
  });

  // Nothing encrypts these, so what's logged is the header as it was typed.
  it("doesn't log or store an HTTP event's headers, URL or body", async () => {
    await seedEvent(owner, {
      ...due,
      type: EventType.HTTP_REQUEST,
      httpMethod: "POST",
      httpUrl: `https://example.com/hook?key=${SECRET}`,
      httpHeaders: [{ key: "Authorization", value: `Bearer ${SECRET}` }],
      httpBody: `{"key":"${SECRET}"}`,
    } as never);
    await refuseWrites("jobs");

    await runDispatchTick();

    expectNothingOfTheQuery();
    const [incident] = await db.select().from(scheduleIncidents);
    expect((incident!.details as { reason: string }).reason).toBe(
      `dispatch failed: ${QUERY_FAILED}`,
    );
  });

  it.each([
    ["linking the job to its log", "logs", "UPDATE", "link a job to its log"],
    [
      "recording the job's creation",
      "job_transitions",
      "INSERT",
      "record a job's creation",
    ],
  ])(
    "leaves the query out when %s fails",
    async (_, table, operation, what) => {
      const id = await seedDueEvent();
      await refuseWrites(table, refusedStatement, operation);

      const result = await runDispatchTick();

      // The job is queued whatever happens to this write.
      expect(result.dispatched).toBe(1);
      expectNothingOfTheQuery();
      expect(logged).toContainEqual(
        `[Dispatch] Failed to ${what} for event ${id}: P0001: refused`,
      );
    },
  );
});

describe("the workflow engine", () => {
  const seedFinishedStep = async () => {
    const eventId = await seedEvent(owner);
    const jobId = await seedJob(eventId, owner, {
      status: JobStatus.COMPLETED,
      result: { scriptOutput: { apiKey: SECRET } },
    });
    return seedWorkflowRun(WorkflowStepStatus.DISPATCHED, {
      jobId,
      startedAt: new Date(),
    }).then((run) => ({ ...run, jobId }));
  };

  it("doesn't log a step's output when advancing the run fails", async () => {
    const { jobId, runId } = await seedFinishedStep();
    await refuseWrites("workflow_step_runs");

    await advanceRunsForJob(jobId);

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[WorkflowEngine] advance failed for run ${runId}: P0001: refused`,
    );
  });

  it("doesn't log a step's output when the reconcile sweep's advance fails", async () => {
    const { runId } = await seedFinishedStep();
    await refuseWrites("workflow_step_runs");

    await reconcileWorkflowRuns();

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[WorkflowEngine] reconcile failed for run ${runId}: P0001: refused`,
    );
  });

  // The step's error is shown in the run's history, so the job's payload would be
  // stored a second time, in plaintext, and sent to whoever looks at the run.
  it("doesn't log or store the job's payload when dispatching a step fails", async () => {
    const eventId = await seedEventWithSecrets();
    const [workflow] = await db
      .insert(workflows)
      .values({
        userId: owner,
        name: "workflow",
        status: EventStatus.ACTIVE,
        triggerType: WorkflowTriggerType.MANUAL,
      })
      .returning({ id: workflows.id });
    await db
      .insert(workflowNodes)
      .values({ workflowId: workflow!.id, eventId });
    await refuseWrites("jobs");

    await startWorkflowRun(workflow!.id, {
      triggerType: WorkflowTriggerType.MANUAL,
      input: { apiKey: SECRET },
    });

    expectNothingOfTheQuery();
    const [step] = await db.select().from(workflowStepRuns);
    expect(step!.error).toBe(`Dispatch failed: ${QUERY_FAILED}`);
    expect(logged).toContainEqual(
      `[WorkflowEngine] Failed to dispatch step ${step!.id}: P0001: refused`,
    );
    const [telemetry] = await db.select().from(workflowExecutionEvents);
    expect(telemetry!.errorMessage).toBe(`Dispatch failed: ${QUERY_FAILED}`);
  });

  it("doesn't store the query when the authorization check before a dispatch fails", async () => {
    const { runId, stepId } = await seedWorkflowRun(WorkflowStepStatus.PENDING);

    await withTableRenamed("workflows", () => advanceWorkflowRun(runId));

    expectNothingOfTheQuery();
    const [step] = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.id, stepId));
    expect(step!.error).toBe(
      `Workflow authorization changed before dispatch: ${QUERY_FAILED}`,
    );
    expect(logged).toContainEqual(
      `[WorkflowEngine] Couldn't check authorization for run ${runId}: 42P01: relation "workflows" does not exist`,
    );
  });
});

describe("a job run in the worker", () => {
  const seedHttpJob = async (status = JobStatus.CLAIMED) => {
    const eventId = await seedEvent(owner, {
      type: EventType.HTTP_REQUEST,
      httpMethod: "GET",
      httpUrl: "https://example.com",
    } as never);
    const [log] = await db
      .insert(logs)
      .values({
        eventId,
        status: LogStatus.RUNNING,
        startTime: new Date(),
        userId: owner,
      } as never)
      .returning({ id: logs.id });
    const jobId = await seedJob(eventId, owner, {
      type: JobType.HTTP_REQUEST,
      status,
      payload: { executionLogId: log!.id },
    });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    return { event: event!, job: job!, jobId, logId: log!.id };
  };

  // Saving the result fails, and what's caught is then saved as the job's failure:
  // in the job, in its transition and in the log its owner reads.
  it("doesn't log or store what a request returned when saving it fails", async () => {
    const { event, job, jobId, logId } = await seedHttpJob();
    jest.spyOn(httpEvents, "executeHttpEvent").mockResolvedValue({
      stdout: `printed ${SECRET}`,
      stderr: "",
      exitCode: 0,
      data: { body: SECRET },
      producesOutput: true,
    } as never);
    await refuseWrites(
      "jobs",
      "IF NEW.status = 'completed' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW",
      "UPDATE",
    );

    await runInProcessJob(job, event);

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[InProcess] Job ${jobId} failed to execute: P0001: refused`,
    );
    const [stored] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(stored!.status).toBe(JobStatus.FAILED);
    expect(stored!.lastError ?? "").not.toContain("Failed query");
    const reasons = await db
      .select({ reason: jobTransitions.reason })
      .from(jobTransitions)
      .where(eq(jobTransitions.jobId, jobId));
    expect(JSON.stringify(reasons)).not.toContain(SECRET);
    expect(JSON.stringify(reasons)).not.toContain("Failed query");
    const [log] = await db.select().from(logs).where(eq(logs.id, logId));
    expect(log!.output).toBe(QUERY_FAILED);
    expect(log!.error).toBe(QUERY_FAILED);
  });

  it("leaves the query out when finalizing the failed job fails too", async () => {
    const { event, job, jobId } = await seedHttpJob();
    jest.spyOn(httpEvents, "executeHttpEvent").mockResolvedValue({
      stdout: `printed ${SECRET}`,
      stderr: "",
      exitCode: 0,
    } as never);
    await refuseWrites(
      "jobs",
      "IF NEW.status <> 'running' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW",
      "UPDATE",
    );

    await runInProcessJob(job, event);

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith(`[InProcess] Could not finalize failed job ${jobId}:`),
    );
    expect(line).toContain("P0001: refused");
  });

  it("doesn't store the query when the pool can't load the job's event", async () => {
    const { jobId } = await seedHttpJob(JobStatus.QUEUED);
    const workerPool = new InProcessWorkerPool("worker-under-test");

    await withTableRenamed("env_vars", async () => {
      expect(await workerPool.claimAndRun()).toBe(1);
      await workerPool.drain(5_000);
    });

    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[WorkerPool] Job ${jobId} crashed: 42P01: relation "env_vars" does not exist`,
    );
    const [stored] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(stored!.lastError).toBe(QUERY_FAILED);
    const [transition] = await db
      .select({ reason: jobTransitions.reason })
      .from(jobTransitions)
      .where(eq(jobTransitions.toStatus, JobStatus.FAILED));
    expect(transition!.reason).toBe(QUERY_FAILED);
  });
});

describe("a job that fails", () => {
  const printed = `the script printed ${SECRET}`;

  it("doesn't log what it printed when the retry can't be recorded", async () => {
    const eventId = await seedEvent(owner);
    const [log] = await db
      .insert(logs)
      .values({
        eventId,
        status: LogStatus.RUNNING,
        startTime: new Date(),
        userId: owner,
      } as never)
      .returning({ id: logs.id });
    const jobId = await seedJob(eventId, owner, {
      status: JobStatus.RUNNING,
      attempts: 0,
      maxAttempts: 2,
      payload: { executionLogId: log!.id },
    });
    await refuseWrites("logs");

    await jobService.updateJobStatus(jobId, JobStatus.FAILED, {
      error: printed,
    });

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("[JobService] Failed to record retry on execution log:"),
    );
    expect(line).toContain("P0001: refused");
  });

  // An orchestrator reporting late, or twice. What it reports is the script's stderr.
  it("doesn't log what it printed when its report comes too late", async () => {
    const eventId = await seedEvent(owner);
    const jobId = await seedJob(eventId, owner, {
      status: JobStatus.COMPLETED,
    });

    await jobService.updateJobStatus(jobId, JobStatus.FAILED, {
      error: printed,
    });

    expect(logged.join("\n")).not.toContain(SECRET);
    expect(logged).toContainEqual(
      `[JobTransition] Rejected completed → failed for job ${jobId} (actor: app)`,
    );
  });
});

describe("a tool action", () => {
  const seedTool = async (
    fields: Partial<typeof toolCredentials.$inferInsert> = {},
  ) => {
    const [tool] = await db
      .insert(toolCredentials)
      .values({
        userId: owner,
        name: "tool",
        type: "SLACK",
        credentials: JSON.stringify({ webhookUrl: "https://example.com/x" }),
        ...fields,
      })
      .returning({ id: toolCredentials.id });
    return tool!.id;
  };

  const run = async (toolId: number, execute = () => Promise.resolve({})) => {
    const id = await seedEvent(owner, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: {
        toolType: "SLACK",
        actionId: "fake",
        toolId,
        parameters: { text: `posted ${SECRET}` },
      },
    } as never);
    const [event] = await db.select().from(events).where(eq(events.id, id));
    jest.spyOn(serverActions, "getServerActionById").mockReturnValue({
      id: "fake",
      name: "Fake",
      actionType: "SEND",
      inputSchema: z.object({}).passthrough(),
      execute,
    } as never);
    const result = await executeToolAction(event!);
    await auditLogger.flush();
    return result;
  };

  // Each run also logs its parameters and result on purpose, after redacting them,
  // so these look at what the failure added and not at the whole log.
  it("leaves the query out when logging a run that worked fails", async () => {
    const toolId = await seedTool();
    await refuseWrites("tool_action_logs");

    const result = await run(toolId, () =>
      Promise.resolve({ ok: true, echoed: SECRET }),
    );

    expect(result.exitCode).toBe(0);
    expect(logged.join("\n")).not.toContain("Failed query");
    expect(logged).toContainEqual(
      "Failed to log tool action execution: P0001: refused",
    );
  });

  it("leaves the query out when logging a run that failed fails", async () => {
    const toolId = await seedTool();
    await refuseWrites("tool_action_logs");

    const result = await run(toolId, () =>
      Promise.reject(new Error("the provider said no")),
    );

    expect(result.exitCode).toBe(1);
    expect(logged.join("\n")).not.toContain("Failed query");
    expect(logged).toContainEqual(
      "Failed to log tool action error: P0001: refused",
    );
  });

  // The audit table and tool_action_logs keep this, and a script calling the action
  // gets it back, stack and all, in `data`.
  it("doesn't store or return the query when one fails during the run", async () => {
    const toolId = await seedTool();

    const result = await withTableRenamed("user_variables", () => run(toolId));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `An unexpected error occurred\n\nDetails: ${QUERY_FAILED}`,
    );
    expect(JSON.stringify(result)).not.toContain("Failed query");

    const [toolLog] = await db.select().from(toolActionLogs);
    expect(toolLog!.errorMessage).toBe(QUERY_FAILED);
    const audited = await db.select().from(toolAuditLogs);
    expect(JSON.stringify(audited)).not.toContain("Failed query");

    expect(logged.join("\n")).not.toContain("Failed query");
    expect(logged).toContainEqual(
      '[ToolAction] Execution failed: 42P01: relation "user_variables" does not exist',
    );
  });

  // The real action against a real database that isn't this app's business: what it
  // says is what the action's owner needs, and it's a driver's error too.
  it("still reports a SQL action's own failure", async () => {
    const { hostname, password, pathname, port, username } = new URL(
      process.env.DATABASE_URL!,
    );
    const toolId = await seedTool({
      type: "sql",
      credentials: JSON.stringify({
        dialect: "postgres",
        host: hostname,
        port: Number(port),
        database: pathname.slice(1),
        user: username,
        password,
        ssl: "disable",
      }),
    });
    const id = await seedEvent(owner, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: {
        toolType: "sql",
        actionId: "run-query",
        toolId,
        parameters: { query: "select * from no_such_table" },
      },
    } as never);
    const [event] = await db.select().from(events).where(eq(events.id, id));

    const result = await executeToolAction(event!);
    await auditLogger.flush();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('relation "no_such_table" does not exist');
    const [toolLog] = await db.select().from(toolActionLogs);
    expect(toolLog!.errorMessage).toContain(
      'relation "no_such_table" does not exist',
    );
  });

  it("doesn't log unencrypted credentials that aren't JSON, which JSON.parse's message quotes", async () => {
    const toolId = await seedTool({ credentials: SHORT_SECRET });

    const result = await run(toolId);

    expect(logged.join("\n")).not.toContain(SHORT_SECRET);
    expect(logged.join("\n")).toContain(
      "[ToolAction] Failed to parse unencrypted credentials: SyntaxError",
    );
    expect(JSON.stringify(result)).not.toContain(SHORT_SECRET);
    expect(result.stderr).toContain("Invalid credential format");
  });

  it("doesn't log or return stored credentials that don't parse", async () => {
    const toolId = await seedTool({
      credentials: SHORT_SECRET,
      encrypted: true,
    });

    const result = await run(toolId);

    expect(logged.join("\n")).not.toContain(SHORT_SECRET);
    expect(logged.join("\n")).toContain(
      "[ToolAction] Failed to decrypt credentials: SyntaxError",
    );
    expect(JSON.stringify(result)).not.toContain(SHORT_SECRET);
    expect(result.stderr).toContain("Failed to decrypt tool credentials");
    const [toolLog] = await db.select().from(toolActionLogs);
    expect(toolLog!.errorMessage).not.toContain(SHORT_SECRET);
  });

  it("leaves the query out when reading the credentials fails", async () => {
    const toolId = await seedTool();

    await withTableRenamed("tool_credentials", async () => {
      await credentialCache.get(toolId, owner);
    });

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("Error fetching credential:"),
    );
    expect(line).toContain('42P01: relation "tool_credentials" does not exist');
  });
});

describe("the background sweeps", () => {
  it.each([
    ["will retry", 0, "will retry: P0001: refused"],
    ["drops", POISON_AGE_MS + 60_000, "of failures: P0001: refused"],
  ])(
    "the outbox %s without logging what its handler was saving",
    async (_, age, ending) => {
      const eventId = await seedEvent(owner);
      const jobId = await seedJob(eventId, owner);
      const [log] = await db
        .insert(logs)
        .values({
          eventId,
          status: LogStatus.RUNNING,
          startTime: new Date(),
          userId: owner,
        } as never)
        .returning({ id: logs.id });
      await db.insert(jobTransitions).values({
        jobId,
        toStatus: JobStatus.QUEUED,
        actor: "test",
      });
      await refuseWrites("logs");

      await consumeJobTransitions(
        async () => {
          await db
            .update(logs)
            .set({ output: SECRET })
            .where(eq(logs.id, log!.id));
        },
        { now: () => new Date(Date.now() + age) },
      );

      expectNothingOfTheQuery();
      const line = logged.find((text) => text.startsWith("[Outbox]"));
      expect(line).toContain(ending);
    },
  );

  it("the sweeper leaves the query out when finalizing a log fails", async () => {
    const eventId = await seedEvent(owner);
    const [log] = await db
      .insert(logs)
      .values({
        eventId,
        status: LogStatus.RUNNING,
        startTime: new Date(),
        userId: owner,
      } as never)
      .returning({ id: logs.id });
    const jobId = await seedJob(eventId, owner, {
      status: JobStatus.RUNNING,
      leaseExpiresAt: new Date(Date.now() - 60_000),
      leaseLossPolicy: LeaseLossPolicy.FAIL,
      payload: { executionLogId: log!.id },
    });
    await refuseWrites("logs");

    const result = await runSweepTick();

    expect(result.failed).toBe(1);
    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      `[Sweeper] Failed to finalize log ${log!.id} for job ${jobId}: P0001: refused`,
    );
  });

  it("retention says why a table failed, without the query", async () => {
    const result = await withTableRenamed("logs", () =>
      runRetention({ windows: { logs: 1 } }),
    );

    expect(result.failed).toContain("logs");
    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("[Retention] Failed to purge logs:"),
    );
    expect(line).toContain('42P01: relation "logs" does not exist');
  });

  it("workflow cleanup leaves the query out when it can't write a timeout log", async () => {
    const service = new WorkflowCleanupService({ sweepJobs: false });
    const { runId } = await seedWorkflowRun(WorkflowStepStatus.PENDING);
    await refuseWrites("workflow_logs");

    await service.cleanupWorkflow(runId);

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith(
        `[WorkflowCleanup] Error writing the timeout log for workflow run ${runId}:`,
      ),
    );
    expect(line).toContain("P0001: refused");
  });

  it("server cleanup leaves the query out of its log and its result", async () => {
    let result: Awaited<
      ReturnType<typeof serverCleanupService.runCleanupCycle>
    >;
    await withTableRenamed("servers", async () => {
      result = await serverCleanupService.runCleanupCycle();
    });

    expectNothingOfTheQuery();
    expect(result!.errors).toContainEqual(
      'Failed to fetch servers for deletion: 42P01: relation "servers" does not exist',
    );
    expect(logged).toContainEqual(
      '[ServerCleanupService] Failed to fetch servers for deletion: 42P01: relation "servers" does not exist',
    );
  });
});

describe("OAuth tokens", () => {
  const manager = new TokenManager({ id: "google" } as never);

  // This text ends up in a redirect's query string, so in browser history and
  // access logs too.
  it("doesn't put the encrypted tokens in the error when saving them fails", async () => {
    await refuseWrites("oauth_tokens");

    const failure = await manager
      .storeTokens(owner, 1, { accessToken: SECRET, tokenType: "Bearer" })
      .catch((error: unknown) => error as Error);

    expect((failure as Error).message).toBe(
      `Failed to store tokens: ${QUERY_FAILED}`,
    );
    expectNothingOfTheQuery();
    expect(logged).toContainEqual(
      "[TokenManager] Failed to store tokens: P0001: refused",
    );
  });

  it("says so without the query when reading or deleting them fails", async () => {
    const reasons: string[] = [];
    await withTableRenamed("oauth_tokens", async () => {
      for (const attempt of [
        () => manager.getTokens(owner, 1),
        () => manager.deleteTokens(owner, 1),
      ]) {
        await attempt().catch((error: Error) => reasons.push(error.message));
      }
    });

    expect(reasons).toEqual([
      `Failed to retrieve tokens: ${QUERY_FAILED}`,
      // Deleting reads them first.
      `Failed to delete tokens: Failed to retrieve tokens: ${QUERY_FAILED}`,
    ]);
    expect(logged.join("\n")).not.toContain("Failed query");
  });
});

describe("the socket server", () => {
  /** Just enough of socket.io to reach a handler. */
  const fakeSocket = (userId: string) => {
    const handlers: Record<string, (data: unknown) => Promise<void>> = {};
    const emitted: Array<[string, unknown]> = [];
    const socket = {
      id: "socket-under-test",
      connected: true,
      data: { userId },
      handshake: { auth: {} },
      on: (name: string, handler: (data: unknown) => Promise<void>) => {
        handlers[name] = handler;
      },
      emit: (name: string, payload: unknown) => {
        emitted.push([name, payload]);
      },
    };
    return { emitted, handlers, socket: socket as unknown as Socket };
  };

  it("doesn't log a user's id with the query when authenticating fails", async () => {
    const { ticket } = mintSocketTicket(SECRET, "logs");

    await withTableRenamed("users", async () => {
      const principal = await authenticateSocketTicket(ticket, "logs", {
        consumeTicket: () => Promise.resolve(true),
      });

      expect(principal).toBeNull();
    });

    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("Socket authentication lookup failed:"),
    );
    expect(line).toContain('42P01: relation "users" does not exist');
  });

  it("doesn't send the query to a client that asked for a terminal", async () => {
    const { emitted, handlers, socket } = fakeSocket(owner);
    const terminal = new TerminalWebSocketHandler({
      use: () => undefined,
      on: (_: string, connect: (client: Socket) => void) => connect(socket),
    } as unknown as SocketIOServer);

    await withTableRenamed("users", async () => {
      await handlers["create-terminal"]!({
        serverId: 1,
        cols: 80,
        rows: 24,
      });
    });
    terminal.cleanup();

    expect(emitted).toEqual([
      [
        "terminal-error",
        { error: `Failed to create terminal: ${QUERY_FAILED}` },
      ],
    ]);
    expectNothingOfTheQuery();
    const line = logged.find((text) =>
      text.startsWith("Server: Failed to create terminal session:"),
    );
    expect(line).toContain('42P01: relation "users" does not exist');
  });

  it("leaves the query out when broadcasting a job's update fails", async () => {
    const namespace = { use: () => undefined, on: () => undefined };
    const handler = new LogsWebSocketHandler({
      of: () => namespace,
    } as unknown as SocketIOServer);

    await withTableRenamed("logs", async () => {
      handler.broadcastJobUpdate({ id: SECRET, status: "running" } as never);
      await waitForLog("Error broadcasting job update:");
    });

    expectNothingOfTheQuery();
  });
});

describe("the cache", () => {
  // Not a query, but the same mistake: ioredis puts the command on its error, and
  // console.error prints it, so a refused write logged the value it was caching.
  it("doesn't log the value when Valkey refuses a write", async () => {
    const admin = new Redis(process.env.VALKEY_URL!);
    await cacheService.set("reachable", true);
    await admin.config("SET", "maxmemory-policy", "noeviction");
    await admin.config("SET", "maxmemory", "1");
    try {
      await cacheService.set("the-key", { apiKey: SECRET });
    } finally {
      await admin.config("SET", "maxmemory", "0");
      admin.disconnect();
    }

    expect(logged.join("\n")).not.toContain(SECRET);
    const line = logged.find((text) =>
      text.startsWith("Cache set error for key the-key:"),
    );
    expect(line).toContain("OOM command not allowed");
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
