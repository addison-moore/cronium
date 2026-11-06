/**
 * The tool audit log is the security record of who changed or used a credential.
 * It flushes in batches, and a batch insert is all or nothing, so these pin what
 * happens to an entry the database won't store, and that the others still land.
 * Entries also wait in memory, so the last sections pin the time a row says it
 * happened and what becomes of them when the process stops.
 *
 * Real Postgres on purpose: the rejections here only exist there, and the logger
 * has to recognise them through Drizzle's error wrapper.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import { MAX_AUDIT_ENTRY_CHARS } from "@/lib/security/audit-entry";
import {
  auditLog,
  auditLogger,
  MAX_PENDING_AUDIT_ENTRIES,
  type AuditLogEntry,
} from "@/lib/security/audit-logger";
import { db, pool } from "@/server/db";
import {
  events,
  EventType,
  jobs,
  JobStatus,
  JobType,
  toolAuditLogs,
  toolCredentials,
} from "@/shared/schema";
import { hangableDatabase } from "../hangable-database";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

const USER = "audit-user";

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

type Details = Record<string, unknown>;

const storedRows = () =>
  db.select().from(toolAuditLogs).orderBy(asc(toolAuditLogs.id));

/** A valid entry, labelled so the rows it becomes can be told apart. */
const logLabelled = (label: string, userId = USER) =>
  auditLogger.logSuccess("credential.read", { userId }, { label });

const labels = (rows: Awaited<ReturnType<typeof storedRows>>) =>
  rows.map((row) => (row.actionDetails as Details).label);

/** Flushes, and checks the flush left nothing behind to write later. */
async function flushCompletely() {
  await auditLogger.flush();
  const count = (await storedRows()).length;
  await auditLogger.flush();
  expect(await storedRows()).toHaveLength(count);
}

const logged = (spy: jest.SpyInstance): string[] =>
  spy.mock.calls.map((args: unknown[]) => args.join(" "));

const droppedLines = () =>
  logged(errorSpy).filter((line) => line.includes("DROPPED"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const settled = (promise: Promise<unknown>, as: string, withinMs = 1000) =>
  Promise.race([
    promise.then(() => as),
    sleep(withinMs).then(() => "still waiting"),
  ]);

const writeToStderr = process.stderr.write.bind(process.stderr) as (
  ...args: unknown[]
) => boolean;

/**
 * Decides what becomes of the empty write shutdown waits on. It can't be left to
 * the real stderr: Jest's default reporter swaps process.stderr.write for one that
 * never calls back, so every shutdown that logs something would wait out its cap,
 * and only there. Inside a coding agent Jest picks a reporter that leaves stderr
 * alone, so a run there can pass where CI fails. --reporters=default shows both.
 */
function answerStderrWait(answer: (callback: () => void) => void) {
  jest.spyOn(process.stderr, "write").mockImplementation(((
    chunk: unknown,
    ...rest: unknown[]
  ) => {
    if (chunk === "") {
      answer(rest[0] as () => void);
      return true;
    }
    return writeToStderr(chunk, ...rest);
  }) as never);
}

/** For what happens after log() has returned: it doesn't wait for a flush. */
async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

const firstFlushFailed = () =>
  until("a flush to fail", () =>
    logged(errorSpy).some((line) => line.includes("kept for retry")),
  );

/** JSON too deep for JSON.stringify, built without needing it. */
const deepJson = (depth: number) =>
  `${'{"a":'.repeat(depth)}"leaf"${"}".repeat(depth)}`;
const deepValue = (depth: number): unknown => JSON.parse(deepJson(depth));

async function seedCredential(): Promise<number> {
  const [tool] = await db
    .insert(toolCredentials)
    .values({
      userId: USER,
      name: "Team Slack",
      type: "slack",
      credentials: "ciphertext",
    })
    .returning({ id: toolCredentials.id });
  return tool!.id;
}

/**
 * A logger of its own on a pool of its own, for a database the shared one can't
 * show: the logger is one per process, so `run` gets the others out of the way.
 */
async function withOwnLogger(
  databaseUrl: string,
  run: (logger: typeof auditLogger, loggerPool: typeof pool) => Promise<void>,
) {
  const key = Symbol.for("cronium.auditLogger");
  const shared = globalThis as unknown as Record<symbol, unknown>;
  const original = { url: process.env.DATABASE_URL, logger: shared[key] };

  delete shared[key];
  process.env.DATABASE_URL = databaseUrl;
  try {
    await jest.isolateModulesAsync(async () => {
      const { auditLogger: logger } =
        await import("@/lib/security/audit-logger");
      const { pool: loggerPool } = await import("@/server/db");
      logger.stopFlushInterval();
      await run(logger, loggerPool);
      await loggerPool.end();
    });
  } finally {
    process.env.DATABASE_URL = original.url;
    shared[key] = original.logger;
  }
}

async function runToolAction(toolActionConfig: unknown) {
  const id = await seedEvent(USER, {
    type: EventType.TOOL_ACTION,
    toolActionConfig,
  });
  const [event] = await db.select().from(events).where(eq(events.id, id));
  return executeToolAction(event!);
}

/**
 * Ends either outage below. Also runs after every test, because one cut off
 * inside an outage would otherwise break every test and suite after it: the
 * database is shared, and TRUNCATE fails while this table is renamed.
 */
async function endOutage() {
  await pool.query(`
    ALTER TABLE IF EXISTS tool_audit_logs_away RENAME TO tool_audit_logs;
    DROP TRIGGER IF EXISTS audit_test_fail ON tool_audit_logs;
    DROP FUNCTION IF EXISTS audit_test_fail();
  `);
}

/** Postgres is up but every insert fails with 42P01, whatever the entry holds. */
async function whileTableIsMissing(run: () => Promise<void>) {
  await pool.query(
    `ALTER TABLE tool_audit_logs RENAME TO tool_audit_logs_away`,
  );
  await run();
  await endOutage();
}

/**
 * Fails an insert with whatever SQLSTATE the row asks for. A user id of
 * 'raise-22023' fails every attempt at that entry. An error message of
 * 'raise-22023' fails only the attempts that store the message, so the row that
 * says who did what still goes in.
 */
async function whileInsertsRaise(run: () => Promise<void>) {
  await pool.query(`
    CREATE FUNCTION audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id LIKE 'raise-%' THEN
        RAISE EXCEPTION 'raised' USING ERRCODE = substr(NEW.user_id, 7);
      END IF;
      IF NEW.error_message LIKE 'raise-%' THEN
        RAISE EXCEPTION 'raised' USING ERRCODE = substr(NEW.error_message, 7);
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER audit_test_fail BEFORE INSERT ON tool_audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_test_fail();
  `);
  await run();
  await endOutage();
}

beforeAll(() => {
  // These suites decide when a flush happens.
  auditLogger.stopFlushInterval();
});

beforeEach(async () => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  answerStderrWait((callback) => callback());

  // A test that failed midway must not leave its entries for the next one.
  // And the one logger has to take entries again after the last test's shutdown.
  Object.assign(auditLogger, { buffer: [], retrying: false, closed: false });
  await resetDatabase();
  await seedUser({ id: USER });
});

afterEach(async () => {
  await endOutage();
  // Lets a flush log() started finish, so it can't land in the next test.
  await auditLogger.shutdown();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await closePool();
});

describe("a missing tool id", () => {
  it("is stored as null", async () => {
    await auditLog.toolExecutionFailed(
      { userId: USER },
      "slack-send-message",
      "boom",
    );

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: USER,
      toolId: null,
      action: "tool.execute",
      success: false,
      errorMessage: "boom",
      actionDetails: { actionId: "slack-send-message" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["names no tool", { toolType: "slack", actionId: "slack-send-message" }],
    ["names tool 0", { toolType: "slack", toolId: 0 }],
    ["can't be read", "not-json"],
  ])(
    "is stored as null when a tool action fails because its config %s",
    async (_name, config) => {
      const result = await runToolAction(config);
      expect(result.exitCode).toBe(1);
      errorSpy.mockClear();

      await flushCompletely();

      const rows = await storedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: USER,
        toolId: null,
        action: "tool.execute",
        success: false,
        errorMessage: "Incomplete tool action configuration",
      });
      expect(rows[0]!.actionDetails).not.toHaveProperty("toolId");
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("no longer stops the log when a caller still passes 0", async () => {
    await logLabelled("before");
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, toolId: 0 },
      "boom",
    );

    await flushCompletely();

    const rows = await storedRows();
    expect(labels(rows)).toEqual(["before", undefined]);
    expect(rows[1]).toMatchObject({ toolId: null, errorMessage: "boom" });
    expect(rows[1]!.actionDetails).not.toHaveProperty("toolId");

    await logLabelled("later");
    await flushCompletely();

    expect(labels(await storedRows())).toEqual(["before", undefined, "later"]);
  });
});

describe("an entry whose credential is gone", () => {
  it("keeps the whole record when the credential is deleted before the flush", async () => {
    const deleted = await seedCredential();
    const surviving = await seedCredential();

    await auditLogger.logSuccess(
      "credential.update",
      {
        userId: USER,
        toolId: deleted,
        ipAddress: "203.0.113.7",
        userAgent: "curl/8",
      },
      { changes: { credentialsUpdated: true } },
    );
    await auditLog.toolExecuted(
      { userId: USER, toolId: surviving },
      "slack-send-message",
      12,
    );
    await db.delete(toolCredentials).where(eq(toolCredentials.id, deleted));
    await auditLog.credentialDeleted(
      { userId: USER, toolId: deleted },
      "slack",
    );

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      action: "credential.update",
      toolId: null,
      ipAddress: "203.0.113.7",
      userAgent: "curl/8",
      actionDetails: {
        toolId: deleted,
        changes: { credentialsUpdated: true },
      },
    });
    expect(rows[1]).toMatchObject({
      action: "tool.execute",
      toolId: surviving,
    });
    expect(rows[2]).toMatchObject({
      action: "credential.delete",
      toolId: null,
      actionDetails: { toolId: deleted, toolType: "slack" },
    });

    expect(logged(warnSpy)).toEqual([
      expect.stringMatching(
        new RegExp(`credential\\.update.*tool id ${deleted}.*23503`),
      ),
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("records a tool action whose event still points at a deleted credential", async () => {
    const deleted = await seedCredential();
    await db.delete(toolCredentials).where(eq(toolCredentials.id, deleted));

    const result = await runToolAction({
      toolType: "slack",
      actionId: "slack-send-message",
      toolId: deleted,
    });
    expect(result.exitCode).toBe(1);
    await logLabelled("later");

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      toolId: null,
      action: "tool.execute",
      success: false,
      errorMessage: `Tool not found: ${deleted}`,
      actionDetails: { actionId: "slack-send-message", toolId: deleted },
    });
    expect(labels(rows)[1]).toBe("later");
  });

  it.each([
    ["names no credential", 999, 999, "tool id 999 .*23503"],
    [
      "is too big for its column",
      2 ** 40,
      2 ** 40,
      `tool id ${2 ** 40} .*22003`,
    ],
    ["isn't a number", "abc", "abc", 'tool id "abc" .*22P02'],
    ["holds a NUL byte", "a\u0000b", "ab", 'tool id "ab" .*22P02'],
  ])(
    "gives up only the reference when a tool id %s",
    async (_name, toolId, kept, warning) => {
      await auditLogger.logFailure(
        "tool.execute",
        {
          userId: USER,
          toolId: toolId as number,
          ipAddress: "203.0.113.7",
          userAgent: "curl/8",
        },
        "boom",
        { actionId: "slack-send-message" },
      );

      await flushCompletely();

      const rows = await storedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        toolId: null,
        ipAddress: "203.0.113.7",
        userAgent: "curl/8",
        errorMessage: "boom",
        actionDetails: { actionId: "slack-send-message", toolId: kept },
      });
      expect(logged(warnSpy)).toEqual([
        expect.stringMatching(new RegExp(warning)),
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );
});

describe("values that can't be stored as they are", () => {
  const circular: Details = { actionId: "slack-send-message" };
  circular.self = circular;

  it.each<
    [
      string,
      Partial<AuditLogEntry>,
      Partial<AuditLogEntry["context"]>,
      Record<string, unknown>,
    ]
  >([
    [
      "a NUL byte in the error message",
      { errorMessage: "provider said \u0000 boom" },
      {},
      { errorMessage: "provider said  boom" },
    ],
    [
      "a NUL byte in a detail",
      { details: { actionId: "a\u0000b" } },
      {},
      { actionDetails: { actionId: "ab" } },
    ],
    [
      "a NUL byte in a detail's key",
      { details: { "a\u0000b": "c" } },
      {},
      { actionDetails: { ab: "c" } },
    ],
    [
      "a lone surrogate in a detail",
      { details: { actionId: "a\ud800b" } },
      {},
      { actionDetails: { actionId: "a\uFFFDb" } },
    ],
    [
      "a NUL byte in the IP address",
      {},
      { ipAddress: "203.0.\u0000113.7" },
      { ipAddress: "203.0.113.7" },
    ],
    [
      "a NUL byte in the user agent",
      {},
      { userAgent: "curl\u0000/8" },
      { userAgent: "curl/8" },
    ],
    [
      "an IP address longer than the column",
      {},
      { ipAddress: "x".repeat(46) },
      { ipAddress: `${"x".repeat(44)}…` },
    ],
    [
      "circular details",
      { details: circular },
      {},
      {
        actionDetails: {
          actionId: "slack-send-message",
          self: "[Circular]",
        },
      },
    ],
    [
      "a BigInt in the details",
      { details: { n: BigInt(5) } },
      {},
      { actionDetails: { n: "5" } },
    ],
  ])(
    "stores everything else when an entry has %s",
    async (_name, fields, context, expected) => {
      const toolId = await seedCredential();
      await logLabelled("before");
      await auditLogger.log({
        action: "tool.execute",
        context: {
          userId: USER,
          toolId,
          ipAddress: "203.0.113.7",
          userAgent: "curl/8",
          ...context,
        },
        success: false,
        errorMessage: "boom",
        details: { actionId: "slack-send-message" },
        ...fields,
      });
      await logLabelled("after");

      await flushCompletely();

      const rows = await storedRows();
      expect(rows).toHaveLength(3);
      expect(labels(rows)[0]).toBe("before");
      expect(labels(rows)[2]).toBe("after");
      expect(rows[1]).toMatchObject({
        userId: USER,
        toolId,
        action: "tool.execute",
        success: false,
        ipAddress: "203.0.113.7",
        userAgent: "curl/8",
        errorMessage: "boom",
        actionDetails: { actionId: "slack-send-message" },
        ...expected,
      });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("cuts off details too deep to store, and keeps the rest of the row", async () => {
    await logLabelled("before");
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, ipAddress: "203.0.113.7" },
      "boom",
      { actionId: deepValue(8000) },
    );

    await flushCompletely();

    const rows = await storedRows();
    expect(labels(rows)[0]).toBe("before");
    expect(rows[1]).toMatchObject({
      ipAddress: "203.0.113.7",
      errorMessage: "boom",
    });
    expect(JSON.stringify(rows[1]!.actionDetails)).toContain("[Too deep]");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("doesn't let a deep actionId in an event's config stop the log", async () => {
    // The API takes this config as a string, so nothing limits its depth.
    const result = await runToolAction(
      `{"toolType":"slack","toolId":999,"actionId":${deepJson(8000)}}`,
    );
    expect(result.exitCode).toBe(1);
    await logLabelled("later");
    errorSpy.mockClear();

    await flushCompletely();

    // The message is the executor's own: its log line gives up on this depth
    // before it gets as far as looking for the tool.
    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      toolId: null,
      success: false,
      errorMessage: expect.any(String),
      actionDetails: { toolId: 999 },
    });
    expect(JSON.stringify(rows[0]!.actionDetails)).toContain("[Too deep]");
    expect(labels(rows)[1]).toBe("later");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("doesn't let a NUL byte in an event's config cost the row its other fields", async () => {
    const result = await runToolAction(
      `{"toolType":"slack","toolId":999,"actionId":"a\\u0000b"}`,
    );
    expect(result.exitCode).toBe(1);

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      success: false,
      errorMessage: "Tool not found: 999",
      actionDetails: { actionId: "ab", toolId: 999 },
    });
  });

  it("cuts down what is too big to keep, in the buffer and in the row", async () => {
    const huge = "x".repeat(1_000_000);
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, ipAddress: huge, userAgent: huge },
      huge,
      { actionId: huge, others: [huge, huge] },
    );

    const { buffer } = auditLogger as unknown as { buffer: unknown[] };
    expect(JSON.stringify(buffer).length).toBeLessThan(MAX_AUDIT_ENTRY_CHARS);

    await flushCompletely();

    const [row] = await storedRows();
    expect(row!.ipAddress).toHaveLength(45);
    expect(row!.userAgent!.length).toBeLessThanOrEqual(1000);
    expect(row!.errorMessage!.length).toBeLessThanOrEqual(4000);
    expect(row!.actionDetails).toHaveProperty("detailsTruncated");
    expect(JSON.stringify(row!.actionDetails).length).toBeLessThan(
      MAX_AUDIT_ENTRY_CHARS,
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("an entry the database still rejects", () => {
  it.each(["22023", "23514", "54000", "54001", "P0001", "XX000"])(
    "keeps who did what when the rest is rejected with %s, and logs the rest",
    async (code) => {
      const toolId = await seedCredential();
      await logLabelled("before");
      await auditLogger.logFailure(
        "tool.execute",
        {
          userId: USER,
          toolId,
          ipAddress: "203.0.113.7",
          userAgent: "curl/8",
        },
        `raise-${code}`,
        { actionId: "slack-send-message" },
      );
      await logLabelled("after");

      await whileInsertsRaise(async () => {
        await flushCompletely();
      });

      const rows = await storedRows();
      expect(labels(rows)).toEqual(["before", undefined, "after"]);
      expect(rows[1]).toMatchObject({
        userId: USER,
        toolId: null,
        action: "tool.execute",
        success: false,
        ipAddress: null,
        userAgent: null,
        errorMessage: null,
      });
      expect(rows[1]!.actionDetails).toEqual({ detailsRejected: code, toolId });

      const lines = logged(errorSpy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("without its details");
      expect(lines[0]).toContain(code);
      expect(lines[0]).toContain(`"errorMessage":"raise-${code}"`);
      expect(lines[0]).toContain('"actionId":"slack-send-message"');
      expect(lines[0]).not.toContain("Failed query");
    },
  );

  it.each([
    ["too long for its column", "u".repeat(256), "22001"],
    ["holding a NUL byte", "user\u0000", "22021"],
    ["missing", undefined, "23502"],
    ["rejected outright", "raise-22023", "22023"],
    ["failing a check", "raise-23514", "23514"],
    ["too big for Postgres", "raise-54000", "54000"],
    [
      "something the driver can't encode",
      {
        toPostgres() {
          throw new TypeError("no");
        },
      },
      "TypeError",
    ],
  ])(
    "drops and logs an entry whose user id is %s, and writes the others",
    async (_name, userId, code) => {
      await logLabelled("before");
      await auditLogger.logFailure(
        "tool.execute",
        { userId: userId as string, toolId: 999 },
        "boom",
      );
      await logLabelled("after");

      await whileInsertsRaise(async () => {
        await flushCompletely();
      });

      expect(labels(await storedRows())).toEqual(["before", "after"]);

      const lines = logged(errorSpy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("DROPPED a tool.execute entry");
      expect(lines[0]).toContain(code);
      expect(lines[0]).toContain('"errorMessage":"boom"');
      expect(lines[0]).toContain('"toolId":999');
      expect(lines[0]).not.toContain("Failed query");
    },
  );

  it("drops one entry once when even logging it fails, and keeps going", async () => {
    await logLabelled("before");
    await auditLogger.logFailure(
      "tool.execute",
      { userId: deepValue(20000) as string },
      "boom",
    );
    await logLabelled("after");

    await flushCompletely();
    await flushCompletely();

    expect(labels(await storedRows())).toEqual(["before", "after"]);
    expect(droppedLines()).toEqual([
      expect.stringContaining("this entry could not be serialized"),
    ]);
  });

  it("keeps an entry nothing proves is at fault, instead of dropping it", async () => {
    await logLabelled("before");
    await logLabelled("not reached", "raise-P0001");

    await whileInsertsRaise(async () => {
      await auditLogger.flush();

      expect(labels(await storedRows())).toEqual(["before"]);
      expect(droppedLines()).toEqual([]);
      expect(logged(errorSpy)).toEqual([
        expect.stringMatching(/1 kept for retry: P0001/),
      ]);
    });

    await flushCompletely();

    expect(labels(await storedRows())).toEqual(["before", "not reached"]);
  });

  it("writes everything around several bad entries, once each and in order", async () => {
    const logWith = (label: string, toolId: number) =>
      auditLogger.logSuccess(
        "credential.read",
        { userId: USER, toolId },
        { label },
      );

    await logWith("no such tool", 999);
    await logLabelled("a");
    await auditLogger.logFailure(
      "credential.read",
      { userId: USER },
      "raise-22023",
    );
    await logLabelled("b");
    await logLabelled("dropped", "u".repeat(256));
    await logLabelled("c");
    await logWith("no such tool either", 998);

    await whileInsertsRaise(async () => {
      await flushCompletely();
    });

    expect(labels(await storedRows())).toEqual([
      "no such tool",
      "a",
      undefined,
      "b",
      "c",
      "no such tool either",
    ]);
  });

  it("can't be made to forge a line in the server log", async () => {
    const forged = "abc\n[AuditLog] DROPPED nothing, all is well";

    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, toolId: forged as unknown as number },
      "boom",
    );
    await auditLogger.logFailure(
      "tool.execute",
      { userId: "u".repeat(256) },
      forged,
      { actionId: forged },
    );

    await flushCompletely();

    const lines = logged(warnSpy).concat(logged(errorSpy));
    expect(lines).toHaveLength(2);
    expect(lines.join("")).not.toContain("\n");
  });

  it("masks secrets in what it writes to the server log", async () => {
    await auditLogger.logFailure(
      "tool.execute",
      { userId: "u".repeat(256) },
      "boom",
      { apiKey: "not-for-the-logs" },
    );

    await flushCompletely();

    const line = logged(errorSpy).join("\n");
    expect(line).toContain('"apiKey":"[REDACTED]"');
    expect(line).not.toContain("not-for-the-logs");
  });

  it("masks and shortens what it quotes from a rejected tool id", async () => {
    const secret = `eyJ${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;

    await auditLogger.logFailure(
      "tool.execute",
      {
        userId: USER,
        toolId: `${secret} ${"x".repeat(100_000)}` as unknown as number,
      },
      "boom",
    );

    await flushCompletely();

    const lines = logged(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("22P02");
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]!.length).toBeLessThan(1500);
  });
});

describe("a database that can't take anything", () => {
  it("keeps entries through an outage and then writes each of them once", async () => {
    await logLabelled("a");
    await logLabelled("b");

    await whileTableIsMissing(async () => {
      await auditLogger.flush();
      await logLabelled("c");
      await auditLogger.flush();
    });

    const lines = logged(errorSpy);
    expect(lines).toEqual([
      expect.stringMatching(/Failed to flush, 2 kept for retry: 42P01/),
      expect.stringMatching(/Failed to flush, 3 kept for retry: 42P01/),
    ]);
    // Drizzle's own message would repeat every value in the batch.
    expect(lines.join("\n")).not.toContain("Failed query");

    await flushCompletely();

    expect(labels(await storedRows())).toEqual(["a", "b", "c"]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(droppedLines()).toEqual([]);
  });

  it("keeps entries while Postgres refuses connections, then writes them", async () => {
    const databaseUrl = process.env.DATABASE_URL!;

    // Pointed where nothing listens.
    await withOwnLogger(
      "postgresql://postgres:x@127.0.0.1:1/nowhere",
      async (logger, loggerPool) => {
        await logger.logSuccess(
          "credential.read",
          { userId: USER },
          { label: "a" },
        );
        await logger.flush();
        await logger.flush();

        expect(logged(errorSpy)).toEqual([
          expect.stringMatching(/1 kept for retry: ECONNREFUSED/),
          expect.stringMatching(/1 kept for retry: ECONNREFUSED/),
        ]);
        expect(await storedRows()).toHaveLength(0);

        // The database comes back.
        loggerPool.options.connectionString = databaseUrl;
        await logger.flush();
      },
    );

    expect(labels(await storedRows())).toEqual(["a"]);
  });

  it.each([
    "08006",
    "25006",
    "40001",
    "40P01",
    "42501",
    "53300",
    "55P03",
    "57014",
    "57P03",
    "58030",
  ])(
    "doesn't take %s out on the entry: it keeps the whole row for later",
    async (code) => {
      const toolId = await seedCredential();
      await auditLogger.logFailure(
        "tool.execute",
        { userId: USER, toolId, ipAddress: "203.0.113.7" },
        `raise-${code}`,
      );

      await whileInsertsRaise(async () => {
        await auditLogger.flush();

        expect(await storedRows()).toHaveLength(0);
      });

      expect(logged(errorSpy)).toEqual([
        expect.stringMatching(new RegExp(`1 kept for retry: ${code}`)),
      ]);

      await flushCompletely();

      const rows = await storedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        toolId,
        ipAddress: "203.0.113.7",
        errorMessage: `raise-${code}`,
      });
    },
  );

  it("doesn't take a dropped connection out on the entry", async () => {
    const toolId = await seedCredential();
    await auditLog.toolExecuted(
      { userId: USER, toolId },
      "slack-send-message",
      12,
    );

    // As pg reports it: no code, no severity. Twice, because a step down the
    // one-at-a-time pass would need one failure for the batch and one for the row.
    const dropped = new Error("Connection terminated unexpectedly");
    const query = jest
      .spyOn(pool, "query")
      .mockRejectedValueOnce(dropped as never)
      .mockRejectedValueOnce(dropped as never);

    await auditLogger.flush();
    await auditLogger.flush();
    query.mockRestore();

    expect(logged(errorSpy)).toEqual([
      expect.stringContaining("1 kept for retry"),
      expect.stringContaining("1 kept for retry"),
    ]);

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      toolId,
      actionDetails: { actionId: "slack-send-message", duration: 12 },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("doesn't take a sequence left behind by a restore out on the entry", async () => {
    const toolId = await seedCredential();
    for (let i = 0; i < 5; i++) await logLabelled(`${i}`);
    await auditLogger.flush();
    await pool.query(`ALTER SEQUENCE tool_audit_logs_id_seq RESTART WITH 1`);

    await auditLog.toolExecuted(
      { userId: USER, toolId },
      "slack-send-message",
      12,
    );

    // Each failed attempt uses up an id, so retrying is what gets past them.
    for (let attempt = 0; attempt < 5; attempt++) {
      await auditLogger.flush();
      expect(await storedRows()).toHaveLength(5);
    }
    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(6);
    expect(rows[5]).toMatchObject({
      action: "tool.execute",
      toolId,
      actionDetails: { actionId: "slack-send-message", duration: 12 },
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(droppedLines()).toEqual([]);
    expect(logged(errorSpy)).toHaveLength(5);
    expect(logged(errorSpy)[0]).toContain("1 kept for retry: 23505");
  });

  it("keeps what it hasn't written when the outage starts during the one-at-a-time pass", async () => {
    await logLabelled("written");
    await logLabelled("dropped", "raise-22023");
    await logLabelled("also written");
    await logLabelled("caught by the outage", "raise-57P03");
    await logLabelled("not reached");

    await whileInsertsRaise(async () => {
      await auditLogger.flush();

      expect(labels(await storedRows())).toEqual(["written", "also written"]);
      expect(logged(errorSpy)).toEqual([
        expect.stringContaining("DROPPED"),
        expect.stringMatching(/2 kept for retry: 57P03/),
      ]);
    });

    await flushCompletely();

    expect(labels(await storedRows())).toEqual([
      "written",
      "also written",
      "caught by the outage",
      "not reached",
    ]);
  });
});

describe("the buffer", () => {
  it("flushes a full batch without waiting for the interval", async () => {
    for (let i = 0; i < 99; i++) await logLabelled(`${i}`);
    await sleep(50);
    expect(await storedRows()).toHaveLength(0);

    await logLabelled("99");

    await until(
      "the batch to be written",
      async () => (await storedRows()).length === 100,
    );
  });

  it("doesn't make a caller wait for the write", async () => {
    const lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE tool_audit_logs IN ACCESS EXCLUSIVE MODE");

    try {
      const logging = (async () => {
        for (let i = 0; i < 100; i++) await logLabelled(`${i}`);
      })();
      expect(await settled(logging, "returned")).toBe("returned");

      // Shutting down is the one thing that has to wait for that write.
      const stopping = auditLogger.shutdown();
      expect(await settled(stopping, "stopped")).toBe("still waiting");
      await lock.query("ROLLBACK");
      await stopping;
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }

    expect(await storedRows()).toHaveLength(100);
  });

  it("keeps its order through a burst that fails", async () => {
    const total = 350;

    await whileTableIsMissing(async () => {
      for (let i = 0; i < total; i++) await logLabelled(`${i}`);
      await firstFlushFailed();
    });

    await flushCompletely();

    expect(labels(await storedRows())).toEqual(
      Array.from({ length: total }, (_, i) => String(i)),
    );
  });

  it("holds its limit through an outage, logging the oldest entries as it drops them", async () => {
    const overflow = 5;
    const total = MAX_PENDING_AUDIT_ENTRIES + overflow;

    await whileTableIsMissing(async () => {
      for (let i = 0; i < total; i++) await logLabelled(`${i}`);
      await firstFlushFailed();

      const dropped = droppedLines();
      expect(dropped).toHaveLength(overflow);
      dropped.forEach((line, i) => {
        expect(line).toContain(`"label":"${i}"`);
      });
    });

    await flushCompletely();

    expect(labels(await storedRows())).toEqual(
      Array.from({ length: MAX_PENDING_AUDIT_ENTRIES }, (_, i) =>
        String(i + overflow),
      ),
    );
  });

  it("holds its limit when entries arrive during a flush that fails", async () => {
    await whileTableIsMissing(async () => {
      for (let i = 0; i < MAX_PENDING_AUDIT_ENTRIES; i++) {
        await logLabelled(`${i}`);
      }
      await firstFlushFailed();
      errorSpy.mockClear();

      const failing = auditLogger.flush();
      await logLabelled("during");
      await failing;

      expect(droppedLines()).toEqual([expect.stringContaining('"label":"0"')]);
    });

    await flushCompletely();

    const stored = labels(await storedRows());
    expect(stored).toHaveLength(MAX_PENDING_AUDIT_ENTRIES);
    expect(stored[0]).toBe("1");
    expect(stored[stored.length - 1]).toBe("during");
  });

  it("bounds what it logs when it drops a very large entry", async () => {
    const huge = "x".repeat(1_000_000);

    await whileTableIsMissing(async () => {
      await auditLogger.logFailure(
        "tool.execute",
        { userId: USER, userAgent: huge },
        huge,
        { actionId: huge },
      );
      for (let i = 0; i < MAX_PENDING_AUDIT_ENTRIES; i++) {
        await logLabelled(`${i}`);
      }
      await firstFlushFailed();
    });

    expect(droppedLines()).toHaveLength(1);
    expect(droppedLines()[0]!.length).toBeLessThan(MAX_AUDIT_ENTRY_CHARS + 200);
  });

  it("doesn't fail the caller when an entry it drops can't be logged", async () => {
    await whileTableIsMissing(async () => {
      // With a flush already failed, nothing tries to write what's logged next.
      await logLabelled("first");
      await auditLogger.flush();
      await auditLogger.logFailure(
        "tool.execute",
        { userId: deepValue(20000) as string },
        "boom",
      );
      for (let i = 2; i < MAX_PENDING_AUDIT_ENTRIES; i++) {
        await logLabelled(`${i}`);
      }

      await expect(
        logLabelled("pushes out the first"),
      ).resolves.toBeUndefined();
      await expect(logLabelled("pushes out the next")).resolves.toBeUndefined();

      expect(droppedLines()).toEqual([
        expect.stringContaining('"label":"first"'),
        expect.stringContaining("this entry could not be serialized"),
      ]);
    });
  });

  it("flushes full batches again after recovering through the one-at-a-time pass", async () => {
    await whileTableIsMissing(async () => {
      await logLabelled("kept");
      await auditLogger.flush();
    });
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, toolId: 999 },
      "boom",
    );
    await auditLogger.flush();
    expect(await storedRows()).toHaveLength(2);

    for (let i = 0; i < 100; i++) await logLabelled(`after ${i}`);

    await until(
      "the next batch to be written",
      async () => (await storedRows()).length === 102,
    );
  });

  it.each([
    ["it reads as an outage", "57P03"],
    ["it doesn't recognise", "P0001"],
  ])(
    "eventually pushes out an entry stuck for a reason %s",
    async (_name, code) => {
      await logLabelled("stuck", `raise-${code}`);

      await whileInsertsRaise(async () => {
        await auditLogger.flush();
        for (let i = 0; i < MAX_PENDING_AUDIT_ENTRIES; i++) {
          await logLabelled(`${i}`);
        }

        expect(droppedLines()).toEqual([
          expect.stringContaining('"label":"stuck"'),
        ]);

        await flushCompletely();
      });

      expect(await storedRows()).toHaveLength(MAX_PENDING_AUDIT_ENTRIES);
    },
  );

  it("doesn't make each new entry retry the backlog while flushes are failing", async () => {
    await whileTableIsMissing(async () => {
      for (let i = 0; i < 100; i++) await logLabelled(`${i}`);
      await firstFlushFailed();

      for (let i = 100; i < 150; i++) await logLabelled(`${i}`);
      await sleep(100);

      // Only the one that filled the first batch tried. The interval retries.
      expect(logged(errorSpy)).toEqual([
        expect.stringContaining("100 kept for retry"),
      ]);
    });

    await auditLogger.flush();
    expect(await storedRows()).toHaveLength(150);

    // Once writes work again, a full batch flushes by itself again.
    for (let i = 0; i < 100; i++) await logLabelled(`after ${i}`);
    await until(
      "the next batch to be written",
      async () => (await storedRows()).length === 250,
    );
  });
});

describe("the time on a row", () => {
  const createdAtMs = (row: { createdAt: Date }) => row.createdAt.getTime();

  it("is when the entry was logged, however long an outage held it", async () => {
    const before = Date.now();
    await logLabelled("held");
    const after = Date.now();

    await whileTableIsMissing(async () => {
      await auditLogger.flush();
      await sleep(1100);
      await auditLogger.flush();
    });
    await flushCompletely();

    const [row] = await storedRows();
    expect(createdAtMs(row!)).toBeGreaterThanOrEqual(before);
    expect(createdAtMs(row!)).toBeLessThanOrEqual(after);
  });

  it("gives entries in one batch their own times, in the order they were logged", async () => {
    await logLabelled("first");
    await sleep(20);
    await logLabelled("second");

    await flushCompletely();

    const [first, second] = await storedRows();
    expect(createdAtMs(second!) - createdAtMs(first!)).toBeGreaterThanOrEqual(
      15,
    );
  });

  it("survives losing the tool reference", async () => {
    const before = Date.now();
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, toolId: 999 },
      "boom",
    );
    const after = Date.now();
    await sleep(50);

    await flushCompletely();

    const [row] = await storedRows();
    expect(row!.toolId).toBeNull();
    expect(createdAtMs(row!)).toBeGreaterThanOrEqual(before);
    expect(createdAtMs(row!)).toBeLessThanOrEqual(after);
  });

  it("survives losing the details", async () => {
    const before = Date.now();
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER },
      "raise-22023",
    );
    const after = Date.now();
    await sleep(50);

    await whileInsertsRaise(async () => {
      await flushCompletely();
    });

    const [row] = await storedRows();
    expect(row!.actionDetails).toEqual({ detailsRejected: "22023" });
    expect(createdAtMs(row!)).toBeGreaterThanOrEqual(before);
    expect(createdAtMs(row!)).toBeLessThanOrEqual(after);
  });

  it("survives details that can't be read", async () => {
    const before = Date.now();
    await auditLogger.log({
      action: "credential.read",
      context: { userId: USER },
      success: true,
      details: {
        get unreadable(): string {
          throw new Error("no");
        },
      },
    });
    const after = Date.now();
    await sleep(50);

    await flushCompletely();

    const [row] = await storedRows();
    expect(row!.actionDetails).toMatchObject({ detailsUnreadable: true });
    expect(createdAtMs(row!)).toBeGreaterThanOrEqual(before);
    expect(createdAtMs(row!)).toBeLessThanOrEqual(after);
  });

  it("goes to the server log with an entry that is dropped", async () => {
    const before = new Date().toISOString().slice(0, 16);
    await logLabelled("dropped", "u".repeat(256));

    await flushCompletely();

    const [line] = droppedLines();
    expect(line).toMatch(
      /"occurredAt":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z"/,
    );
    expect(line).toContain(`"occurredAt":"${before}`);
  });

  it("doesn't depend on the database session's time zone", async () => {
    const before = Date.now();

    // Sessions nine hours off UTC, which CURRENT_TIMESTAMP would have shown.
    await withOwnLogger(
      `${process.env.DATABASE_URL!}?options=-c%20TimeZone%3DAsia/Tokyo`,
      async (logger) => {
        await logger.logSuccess(
          "credential.read",
          { userId: USER },
          { label: "tokyo" },
        );
        await logger.flush();
      },
    );

    const [row] = await storedRows();
    expect(labels([row!])).toEqual(["tokyo"]);
    expect(createdAtMs(row!)).toBeGreaterThanOrEqual(before);
    expect(createdAtMs(row!)).toBeLessThanOrEqual(Date.now());
  });
});

describe("the logger", () => {
  it("is shared by every copy of this module in a process", async () => {
    // Next builds it once per layer: the routes log to one copy, and instrumentation
    // shuts down another.
    let other: unknown;
    await jest.isolateModulesAsync(async () => {
      const copy = await import("@/lib/security/audit-logger");
      other = copy.auditLogger;
    });

    expect(other).toBe(auditLogger);
  });
});

describe("shutting down", () => {
  /** Every insert blocks until `run` is done, as on a database that has hung. */
  async function whileTableIsLocked(run: () => Promise<void>) {
    const lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE tool_audit_logs IN ACCESS EXCLUSIVE MODE");
    try {
      await run();
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
  }

  it("writes what is buffered, once each, and has nothing to say about it", async () => {
    await logLabelled("a");
    await logLabelled("b");

    await auditLogger.shutdown();
    await auditLogger.shutdown();

    expect(labels(await storedRows())).toEqual(["a", "b"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("waits for a flush the interval started, not only a full batch's", async () => {
    await logLabelled("in flight");

    let stopping!: Promise<void>;
    await whileTableIsLocked(async () => {
      // As the interval starts one: log() isn't involved, so it isn't earlyFlush.
      void auditLogger.flush();
      stopping = auditLogger.shutdown();

      expect(await settled(stopping, "stopped", 300)).toBe("still waiting");
    });
    await stopping;

    expect(labels(await storedRows())).toEqual(["in flight"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("puts back what a flush in flight fails on, and still writes it", async () => {
    await logLabelled("a");
    await pool.query(
      `ALTER TABLE tool_audit_logs RENAME TO tool_audit_logs_away`,
    );
    const failing = auditLogger.flush();
    const stopping = auditLogger.shutdown();
    await failing;
    await endOutage();
    await stopping;

    expect(labels(await storedRows())).toEqual(["a"]);
    expect(droppedLines()).toEqual([]);
  });

  it("writes what arrives while it is writing", async () => {
    await logLabelled("before");

    let stopping!: Promise<void>;
    await whileTableIsLocked(async () => {
      stopping = auditLogger.shutdown();
      await logLabelled("during");
    });
    await stopping;

    expect(labels(await storedRows())).toEqual(["before", "during"]);
  });

  it("keeps trying through a short outage", async () => {
    await logLabelled("a");
    await pool.query(
      `ALTER TABLE tool_audit_logs RENAME TO tool_audit_logs_away`,
    );

    const stopping = auditLogger.shutdown();
    await firstFlushFailed();
    await endOutage();
    await stopping;

    expect(labels(await storedRows())).toEqual(["a"]);
    expect(droppedLines()).toEqual([]);
  });

  it("sends what it can't write to the server log once time is up", async () => {
    await logLabelled("a");
    await auditLogger.logFailure("tool.execute", { userId: USER }, "boom", {
      apiKey: "not-for-the-logs",
    });

    await whileTableIsMissing(async () => {
      await auditLogger.shutdown(300);

      expect(droppedLines()).toEqual([
        expect.stringMatching(/DROPPED a credential\.read entry.*"label":"a"/),
        expect.stringMatching(
          /DROPPED a tool\.execute entry.*"errorMessage":"boom"/,
        ),
      ]);
      expect(droppedLines()[1]).toContain('"apiKey":"[REDACTED]"');
      expect(droppedLines()[1]).not.toContain("not-for-the-logs");
    });

    // Logged is final: nothing is left to be written a second time.
    await flushCompletely();
    expect(await storedRows()).toHaveLength(0);
    expect(droppedLines()).toHaveLength(2);
  });

  describe("the server log", () => {
    /** Holds up the empty write shutdown waits on, as a full pipe would. */
    function holdStderr() {
      const held: Array<() => void> = [];
      answerStderrWait((callback) => held.push(callback));
      return held;
    }

    it("gets to take what was sent to it before shutdown returns", async () => {
      const held = holdStderr();
      await logLabelled("a");

      await whileTableIsMissing(async () => {
        const stopping = auditLogger.shutdown(100);

        expect(await settled(stopping, "stopped", 500)).toBe("still waiting");
        expect(droppedLines()).toHaveLength(1);
        held[0]!();
        expect(await settled(stopping, "stopped")).toBe("stopped");
      });
    });

    it("can't hold up shutdown forever", async () => {
      holdStderr();
      await logLabelled("a");

      await whileTableIsMissing(async () => {
        const stopping = auditLogger.shutdown(100);

        expect(await settled(stopping, "stopped", 5000)).toBe("stopped");
      });
    });

    it("isn't waited for when nothing went to it", async () => {
      const held = holdStderr();
      await logLabelled("a");

      await auditLogger.shutdown();

      expect(held).toEqual([]);
    });

    it("gets an entry logged once everything is written, masked", async () => {
      await logLabelled("written");
      await auditLogger.shutdown();
      expect(errorSpy).not.toHaveBeenCalled();

      await auditLogger.logFailure("tool.execute", { userId: USER }, "boom", {
        apiKey: "not-for-the-logs",
      });

      expect(droppedLines()).toEqual([
        expect.stringMatching(
          /DROPPED a tool\.execute entry: logged after shutting down.*"errorMessage":"boom"/,
        ),
      ]);
      expect(droppedLines()[0]).toContain('"apiKey":"[REDACTED]"');
      expect(droppedLines()[0]).not.toContain("not-for-the-logs");
      await flushCompletely();
      expect(labels(await storedRows())).toEqual(["written"]);
    });

    it("gets an entry logged while shutdown waits on it", async () => {
      const held = holdStderr();
      await logLabelled("out of time");

      await whileTableIsMissing(async () => {
        const stopping = auditLogger.shutdown(100);
        await until("the wait to start", () => held.length === 1);

        await logLabelled("during the wait");
        held[0]!();
        await stopping;
      });

      expect(droppedLines()).toEqual([
        expect.stringContaining('"label":"out of time"'),
        expect.stringContaining('"label":"during the wait"'),
      ]);
      await flushCompletely();
      expect(await storedRows()).toHaveLength(0);
    });
  });

  it("doesn't wait for a hung database, and logs a batch caught in flight", async () => {
    await whileTableIsLocked(async () => {
      for (let i = 0; i < 100; i++) await logLabelled(`in flight ${i}`);
      await logLabelled("still buffered");

      const started = Date.now();
      await expect(
        settled(auditLogger.shutdown(300), "stopped", 3000),
      ).resolves.toBe("stopped");
      expect(Date.now() - started).toBeLessThan(2000);

      const lines = droppedLines();
      expect(lines).toHaveLength(101);
      for (let i = 0; i < 100; i++) {
        expect(
          lines.filter((line) => line.includes(`"label":"in flight ${i}"`)),
        ).toHaveLength(1);
      }
      expect(
        lines.filter((line) => line.includes('"label":"still buffered"')),
      ).toHaveLength(1);
      // Only this kind of line can be wrong about the table, so it has to say so.
      const inFlight = lines.filter((line) => line.includes('"in flight 0"'));
      expect(inFlight[0]).toContain("may still have been written");
      expect(
        lines.find((line) => line.includes("still buffered")),
      ).not.toContain("may still have been written");
    });

    // The database recovers before the process is gone. The insert it was already
    // running lands, and nothing it had hold of comes back to be written again.
    await until(
      "the batch in flight to land",
      async () => (await storedRows()).length === 100,
    );
    await flushCompletely();
    expect(await storedRows()).toHaveLength(100);
    expect(droppedLines()).toHaveLength(101);
    expect(
      logged(errorSpy).filter((l) => l.includes("kept for retry")),
    ).toEqual([]);
  });

  it("logs only what a one-at-a-time pass hasn't written when time is up", async () => {
    await pool.query(`
      CREATE FUNCTION audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id = 'raise-22023' THEN
          RAISE EXCEPTION 'raised' USING ERRCODE = '22023';
        END IF;
        IF NEW.action_details->>'label' = 'hangs' THEN
          PERFORM pg_sleep(2);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER audit_test_fail BEFORE INSERT ON tool_audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_test_fail();
    `);
    await logLabelled("written");
    await logLabelled("rejected", "raise-22023");
    await logLabelled("hangs");
    await logLabelled("not reached");

    await auditLogger.shutdown(300);

    const lines = droppedLines();
    expect(labels(await storedRows())).toEqual(["written"]);
    expect(lines.filter((l) => l.includes('"label":"rejected"'))).toHaveLength(
      1,
    );
    expect(lines.filter((l) => l.includes('"label":"hangs"'))).toEqual([
      expect.stringContaining("may still have been written"),
    ]);
    expect(lines.filter((l) => l.includes('"label":"not reached"'))).toEqual([
      expect.stringContaining("may still have been written"),
    ]);

    await until(
      "the row it was writing to land",
      async () => (await storedRows()).length === 2,
    );
    await sleep(50);
    expect(labels(await storedRows())).toEqual(["written", "hangs"]);
  });
});

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

/** With its own flags, then these, as the image's build script would run it. */
const buildBundle = (script: string, ...flags: string[]) =>
  execFileSync("pnpm", ["run", script, ...flags], {
    cwd: APP_DIR,
    stdio: "pipe",
  });

/**
 * Whether anything calls shutdown(), in the right order, is only visible from
 * outside: these run the bundle the image runs, on this database, and stop it the
 * way Docker does.
 */
describe("a real worker being stopped", () => {
  const WORKER_BUNDLE = "dist/audit-log-test-worker.cjs";
  /** The compose files' stop_grace_period for the worker. Docker kills it after. */
  const DOCKER_STOP_ALLOWANCE_MS = 40_000;

  let worker: ChildProcess | null = null;
  let healthPort = 0;
  let output = "";

  beforeAll(() => {
    buildBundle("build:worker", `--outfile=${WORKER_BUNDLE}`);
  });

  afterAll(() => {
    fs.rmSync(path.join(APP_DIR, WORKER_BUNDLE), { force: true });
  });

  afterEach(() => {
    // Before the next test truncates what it might be writing to.
    worker?.kill("SIGKILL");
    worker = null;
  });

  const freePort = () =>
    new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });

  async function startWorker(databaseUrl = process.env.DATABASE_URL!) {
    output = "";
    healthPort = await freePort();
    worker = spawn(process.execPath, [WORKER_BUNDLE], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
        WORKER_ID: "audit-log-test",
        WORKER_HEALTH_PORT: String(healthPort),
        WORKER_CLAIM_INTERVAL_MS: "100",
        // Nothing here is old enough to purge, but a worker should never be
        // left with that as the only thing protecting a database.
        CRONIUM_JOB_RETENTION_DAYS: "0",
        CRONIUM_LOG_RETENTION_DAYS: "0",
        CRONIUM_WORKFLOW_RETENTION_DAYS: "0",
        CRONIUM_INCIDENT_RETENTION_DAYS: "0",
        CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS: "0",
        CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: "0",
        CRONIUM_WEBHOOK_RETENTION_DAYS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    worker.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await until("the worker to start", () =>
      output.includes("Health endpoint on"),
    );
  }

  /** Sends SIGTERM and resolves with how it went, or fails after `withinMs`. */
  function stopWorker(withinMs: number) {
    const started = Date.now();
    return new Promise<{ code: number | null; tookMs: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `The worker hadn't exited ${withinMs}ms after SIGTERM. Its output:\n${output.slice(-4000)}`,
            ),
          );
        }, withinMs);
        worker!.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, tookMs: Date.now() - started });
        });
        worker!.kill("SIGTERM");
      },
    );
  }

  /** A job whose tool action fails at once, leaving one entry named `label`. */
  async function queueQuickJob(label: string) {
    const eventId = await seedEvent(USER, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: { toolType: "slack", actionId: label },
    });
    return seedJob(eventId, USER, { type: JobType.TOOL_ACTION, payload: {} });
  }

  const jobsWithStatus = async (status: JobStatus) =>
    (await db.select().from(jobs).where(eq(jobs.status, status))).length;

  /** A job's status changes before it is done: it still has its log to finalize. */
  const noJobsRunning = async () => {
    const response = await fetch(`http://127.0.0.1:${healthPort}/health`);
    const health = (await response.json()) as { activeInProcessJobs: number };
    return health.activeInProcessJobs === 0;
  };

  /** An event whose query takes 2 seconds, on a connection of its own. */
  async function seedSlowQueryEvent() {
    const { hostname, port, pathname, username, password } = new URL(
      process.env.DATABASE_URL!,
    );
    const [tool] = await db
      .insert(toolCredentials)
      .values({
        userId: USER,
        name: "This database",
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
      })
      .returning({ id: toolCredentials.id });
    const eventId = await seedEvent(USER, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: {
        toolType: "sql",
        toolId: tool!.id,
        actionId: "run-query",
        parameters: { query: "SELECT pg_sleep(2)" },
      },
    });
    return { eventId, toolId: tool!.id };
  }

  const actionIds = async () =>
    (await storedRows())
      .map((row) => (row.actionDetails as Details).actionId as string)
      .sort();

  const droppedFromOutput = (label: string) =>
    output
      .split("\n")
      .filter(
        (line) => line.includes("DROPPED") && line.includes(`"${label}"`),
      );

  it("writes the entries of jobs it just finished, once each", async () => {
    await startWorker();

    const expected = ["job-a", "job-b", "job-c", "job-d", "job-e"];
    for (const label of expected) await queueQuickJob(label);
    await until(
      "the jobs to finish",
      async () => (await jobsWithStatus(JobStatus.FAILED)) === expected.length,
    );
    const finished = Date.now();

    const { code } = await stopWorker(20_000);

    expect(code).toBe(0);
    expect(await actionIds()).toEqual(expected);
    for (const row of await storedRows()) {
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(finished);
    }
    expect(output).not.toContain("DROPPED");
  });

  it("writes the entry of a job that finishes while it drains", async () => {
    const { eventId, toolId } = await seedSlowQueryEvent();

    await startWorker();
    await seedJob(eventId, USER, { type: JobType.TOOL_ACTION, payload: {} });
    await until(
      "the job to start",
      async () => (await jobsWithStatus(JobStatus.RUNNING)) === 1,
    );

    const { code } = await stopWorker(20_000);

    expect(code).toBe(0);
    expect(await jobsWithStatus(JobStatus.COMPLETED)).toBe(1);
    expect(await storedRows()).toEqual([
      expect.objectContaining({
        action: "tool.execute",
        success: true,
        toolId,
      }),
    ]);
  });

  it("still exits on a database that has hung, with every entry in the table or the server log", async () => {
    const database = await hangableDatabase(process.env.DATABASE_URL!);
    try {
      await startWorker(database.url);

      const expected = ["job-a", "job-b", "job-c"];
      for (const label of expected) await queueQuickJob(label);
      await until(
        "the jobs to finish",
        async () =>
          (await jobsWithStatus(JobStatus.FAILED)) === expected.length,
      );
      await until("what they do after that", noJobsRunning);

      database.hang();
      const { code, tookMs } = await stopWorker(20_000);

      expect(code).toBe(0);
      expect(tookMs).toBeLessThan(15_000);
      // Both, for a write that was under way when the database hung.
      const written = await actionIds();
      for (const label of expected) {
        expect(
          written.filter((id) => id === label).length +
            droppedFromOutput(label).length,
        ).toBeGreaterThanOrEqual(1);
      }
    } finally {
      database.close();
    }
  });

  it("gives a job the hang caught all of its drain, and still exits before Docker's time is up", async () => {
    const database = await hangableDatabase(process.env.DATABASE_URL!);
    try {
      const { eventId } = await seedSlowQueryEvent();
      await startWorker(database.url);
      await seedJob(eventId, USER, { type: JobType.TOOL_ACTION, payload: {} });
      // Past the reads it needs first. The query isn't on the database that hangs,
      // so it finishes, logs its entry, and only then gets stuck writing the rest.
      await until("the query to be running", async () => {
        const { rows } = await pool.query(
          `SELECT 1 FROM pg_stat_activity
            WHERE query LIKE '%pg_sleep(2)%' AND pid <> pg_backend_pid()`,
        );
        return rows.length > 0;
      });

      database.hang();
      const { code } = await stopWorker(DOCKER_STOP_ALLOWANCE_MS);

      expect(code).toBe(0);
      expect(output).toContain("Draining 1 in-flight job(s)");
      expect(droppedFromOutput("run-query")).toHaveLength(1);
      expect(await storedRows()).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("the socket server", () => {
  const BUNDLE = "dist/audit-log-test-socket.cjs";
  const META = "dist/audit-log-test-socket.json";

  afterAll(() => {
    for (const file of [BUNDLE, META]) {
      fs.rmSync(path.join(APP_DIR, file), { force: true });
    }
  });

  it("has nothing to write when it stops, because it never loads the logger", () => {
    // If this fails, something the socket server runs now writes audit entries:
    // call auditLogger.shutdown() from server.ts's shutdown, as worker.ts does.
    buildBundle("build:socket", `--outfile=${BUNDLE}`, `--metafile=${META}`);
    const { inputs } = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, META), "utf8"),
    ) as { inputs: Record<string, unknown> };

    expect(Object.keys(inputs)).toContain("server.ts");
    expect(
      Object.keys(inputs).filter((file) => file.includes("audit-logger")),
    ).toEqual([]);
  });
});
