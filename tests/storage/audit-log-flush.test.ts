/**
 * The tool audit log is the security record of who changed or used a credential.
 * It flushes in batches, and a batch insert is all or nothing, so these pin what
 * happens to an entry the database won't store, and that the others still land.
 *
 * Real Postgres on purpose: the rejections here only exist there, and the logger
 * has to recognise them through Drizzle's error wrapper.
 */
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
  toolAuditLogs,
  toolCredentials,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedUser } from "./helpers/seed";

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

  // A test that failed midway must not leave its entries for the next one.
  Object.assign(auditLogger, { buffer: [], retrying: false });
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

    // A second logger on its own pool, pointed where nothing listens.
    process.env.DATABASE_URL = "postgresql://postgres:x@127.0.0.1:1/nowhere";
    try {
      await jest.isolateModulesAsync(async () => {
        const { auditLogger: logger } =
          await import("@/lib/security/audit-logger");
        const { pool: loggerPool } = await import("@/server/db");
        logger.stopFlushInterval();

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
        await loggerPool.end();
      });
    } finally {
      process.env.DATABASE_URL = databaseUrl;
    }

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

    const settled = (promise: Promise<unknown>, as: string) =>
      Promise.race([
        promise.then(() => as),
        sleep(1000).then(() => "still waiting"),
      ]);

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
