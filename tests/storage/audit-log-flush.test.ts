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
 * Fails an insert according to its user id: 'rejected' with a data exception,
 * 'unavailable' with 57P03, as a database that is shutting down would.
 */
async function withInsertsFailingByUser(run: () => Promise<void>) {
  await pool.query(`
    CREATE FUNCTION audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id = 'rejected' THEN
        RAISE EXCEPTION 'rejected' USING ERRCODE = '22023';
      END IF;
      IF NEW.user_id = 'unavailable' THEN
        RAISE EXCEPTION 'unavailable' USING ERRCODE = '57P03';
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
  await auditLogger.flush();
  await resetDatabase();
  await seedUser({ id: USER });
  errorSpy.mockClear();
  warnSpy.mockClear();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await endOutage();
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
    ["names no credential", 999, "tool id 999 .*23503"],
    ["is too big for its column", 2 ** 40, `tool id ${2 ** 40} .*22003`],
    ["isn't a number", "abc", 'tool id "abc" .*22P02'],
  ])(
    "gives up only the reference when a tool id %s",
    async (_name, toolId, warning) => {
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
        actionDetails: { actionId: "slack-send-message", toolId },
      });
      expect(logged(warnSpy)).toEqual([
        expect.stringMatching(new RegExp(warning)),
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );
});

describe("an entry the database won't store", () => {
  const circular: Details = {};
  circular.self = circular;

  it.each<
    [string, Partial<AuditLogEntry>, Partial<AuditLogEntry["context"]>, string]
  >([
    [
      "a NUL byte in its error message",
      { errorMessage: "provider said \u0000 boom" },
      {},
      "22021",
    ],
    [
      "a NUL byte in its details",
      { details: { actionId: "a\u0000b" } },
      {},
      "22P05",
    ],
    [
      "an IP address longer than the column",
      {},
      { ipAddress: "x".repeat(46) },
      "22001",
    ],
    ["circular details", { details: circular }, {}, "TypeError"],
    ["a BigInt in its details", { details: { n: BigInt(5) } }, {}, "TypeError"],
  ])(
    "keeps who did what when it has %s, and logs the rest",
    async (_name, fields, context, code) => {
      const toolId = await seedCredential();
      await logLabelled("before");
      await auditLogger.log({
        action: "tool.execute",
        context: { userId: USER, toolId, ...context },
        success: false,
        ...fields,
      });
      await logLabelled("after");

      await flushCompletely();

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
        actionDetails: { detailsRejected: code, toolId },
      });

      const lines = logged(errorSpy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("without its details");
      expect(lines[0]).toContain(code);
      expect(lines[0]).toContain('"action":"tool.execute"');
      expect(lines[0]).toContain(`"userId":"${USER}"`);
      expect(lines[0]).not.toContain("Failed query");
    },
  );

  it("doesn't copy a tool id that can't be stored anywhere", async () => {
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER, toolId: "a\u0000b" as unknown as number },
      "boom",
    );

    await flushCompletely();

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toolId: null, errorMessage: null });
    expect(rows[0]!.actionDetails).toEqual({ detailsRejected: "22P05" });
  });

  it.each([
    ["too long for its column", "u".repeat(256), "22001"],
    ["holding a NUL byte", "user\u0000", "22021"],
    ["missing", undefined, "23502"],
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

      await flushCompletely();

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

  it("writes everything around several bad entries, once each and in order", async () => {
    const logWith = (
      label: string,
      context: { toolId?: number; ipAddress?: string },
    ) =>
      auditLogger.logSuccess(
        "credential.read",
        { userId: USER, ...context },
        { label },
      );

    await logWith("no such tool", { toolId: 999 });
    await logLabelled("a");
    await logWith("details rejected", { ipAddress: "x".repeat(46) });
    await logLabelled("b");
    await logLabelled("dropped", "u".repeat(256));
    await logLabelled("c");
    await logWith("no such tool either", { toolId: 998 });

    await flushCompletely();

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
      { userId: USER },
      `${forged}\u0000`,
      { actionId: forged },
    );

    await flushCompletely();

    expect(logged(warnSpy).concat(logged(errorSpy)).join("")).not.toContain(
      "\n",
    );
  });

  it("masks secrets in what it writes to the server log", async () => {
    await auditLogger.logFailure(
      "tool.execute",
      { userId: USER },
      "provider said \u0000 boom",
      { apiKey: "not-for-the-logs" },
    );

    await flushCompletely();

    const line = logged(errorSpy).join("\n");
    expect(line).toContain('"apiKey":"[REDACTED]"');
    expect(line).not.toContain("not-for-the-logs");
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
    expect(logged(errorSpy).join("\n")).not.toContain("DROPPED");
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

  it("keeps what it hasn't written when the outage starts during the one-at-a-time pass", async () => {
    await logLabelled("written");
    await logLabelled("dropped", "rejected");
    await logLabelled("also written");
    await logLabelled("caught by the outage", "unavailable");
    await logLabelled("not reached");

    await withInsertsFailingByUser(async () => {
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
    expect(await storedRows()).toHaveLength(0);

    await logLabelled("99");

    expect(await storedRows()).toHaveLength(100);
  });

  it("holds its limit through an outage, logging the oldest entries as it drops them", async () => {
    const overflow = 5;
    const total = MAX_PENDING_AUDIT_ENTRIES + overflow;

    await whileTableIsMissing(async () => {
      for (let i = 0; i < total; i++) await logLabelled(`${i}`);

      const dropped = logged(errorSpy).filter((line) =>
        line.includes("DROPPED"),
      );
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
      errorSpy.mockClear();

      const failing = auditLogger.flush();
      await logLabelled("during");
      await failing;

      expect(
        logged(errorSpy).filter((line) => line.includes("DROPPED")),
      ).toEqual([expect.stringContaining('"label":"0"')]);
    });

    await flushCompletely();

    const stored = labels(await storedRows());
    expect(stored).toHaveLength(MAX_PENDING_AUDIT_ENTRIES);
    expect(stored[0]).toBe("1");
    expect(stored[stored.length - 1]).toBe("during");
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

    expect(await storedRows()).toHaveLength(102);
  });

  it("eventually pushes out an entry stuck for a reason it doesn't recognise", async () => {
    await logLabelled("stuck", "unavailable");

    await withInsertsFailingByUser(async () => {
      for (let i = 0; i < MAX_PENDING_AUDIT_ENTRIES; i++) {
        await logLabelled(`${i}`);
      }

      expect(
        logged(errorSpy).filter((line) => line.includes("DROPPED")),
      ).toEqual([expect.stringContaining('"label":"stuck"')]);

      await flushCompletely();
    });

    expect(await storedRows()).toHaveLength(MAX_PENDING_AUDIT_ENTRIES);
  });

  it("doesn't make each new entry retry the backlog while flushes are failing", async () => {
    await whileTableIsMissing(async () => {
      for (let i = 0; i < 150; i++) await logLabelled(`${i}`);

      // Only the one that filled the first batch tried. The interval retries.
      expect(logged(errorSpy)).toEqual([
        expect.stringContaining("100 kept for retry"),
      ]);
    });

    await auditLogger.flush();
    expect(await storedRows()).toHaveLength(150);

    // Once writes work again, a full batch flushes by itself again.
    for (let i = 0; i < 100; i++) await logLabelled(`after ${i}`);
    expect(await storedRows()).toHaveLength(250);
  });
});
