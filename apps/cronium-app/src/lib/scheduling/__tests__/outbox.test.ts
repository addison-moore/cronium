/**
 * @jest-environment node
 */
/**
 * Unit tests for the transactional-outbox consumer (outbox.ts). The db module
 * is factory-mocked with a chainable stub; the transaction callback runs
 * against a fake tx that records the SELECT batch size and every
 * UPDATE ... SET processedAt in order, so at-least-once and poison-pill
 * semantics can be asserted without Postgres.
 */

jest.mock("@/server/db", () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(),
  },
}));

import { db } from "@/server/db";
import { consumeJobTransitions, outboxBacklog, POISON_AGE_MS } from "../outbox";
import type { JobTransition } from "@/shared/schema";

const mockDb = db as unknown as {
  transaction: jest.Mock;
  select: jest.Mock;
};

const NOW = new Date("2026-07-20T10:00:00.000Z");

function makeRow(id: number, ageMs = 1000): JobTransition {
  return {
    id,
    jobId: `job-${id}`,
    fromStatus: "queued",
    toStatus: "running",
    actor: "worker:w1",
    reason: null,
    data: null,
    createdAt: new Date(NOW.getTime() - ageMs),
    processedAt: null,
  } as unknown as JobTransition;
}

/** Ordered log of tx activity: "handle:<id>" then "processed" entries. */
let activity: string[];
/** The limit(n) argument the drain used. */
let limitArg: number | undefined;
/** processedAt values written, in order. */
let processedAtWrites: unknown[];

function primeTransaction(rows: JobTransition[]): void {
  mockDb.transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: (n: number) => {
                  limitArg = n;
                  return { for: () => Promise.resolve(rows) };
                },
              }),
            }),
          }),
        }),
        update: () => ({
          set: (values: { processedAt: unknown }) => ({
            where: () => {
              activity.push("processed");
              processedAtWrites.push(values.processedAt);
              return Promise.resolve();
            },
          }),
        }),
      }),
  );
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  activity = [];
  limitArg = undefined;
  processedAtWrites = [];
  mockDb.transaction.mockReset();
  mockDb.select.mockReset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("consumeJobTransitions", () => {
  it("drains a batch in id order, marking each row processed after its handler succeeds", async () => {
    primeTransaction([makeRow(1), makeRow(2), makeRow(3)]);
    const handler = jest.fn(async (row: JobTransition) => {
      activity.push(`handle:${row.id}`);
    });

    const processed = await consumeJobTransitions(handler, {
      now: () => NOW,
    });

    expect(processed).toBe(3);
    expect(handler.mock.calls.map((c) => c[0].id)).toEqual([1, 2, 3]);
    // At-least-once ordering: a row is marked processed only after handling.
    expect(activity).toEqual([
      "handle:1",
      "processed",
      "handle:2",
      "processed",
      "handle:3",
      "processed",
    ]);
    expect(processedAtWrites).toEqual([NOW, NOW, NOW]);
  });

  it("uses the default batch size of 50 and honors an explicit batchSize", async () => {
    primeTransaction([]);
    await consumeJobTransitions(jest.fn());
    expect(limitArg).toBe(50);

    await consumeJobTransitions(jest.fn(), { batchSize: 7 });
    expect(limitArg).toBe(7);
  });

  it("returns 0 and touches nothing when there are no unprocessed rows", async () => {
    primeTransaction([]);
    const handler = jest.fn();

    const processed = await consumeJobTransitions(handler);

    expect(processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(activity).toEqual([]);
  });

  it("leaves a young failing row unprocessed for retry and keeps draining the batch", async () => {
    primeTransaction([makeRow(1), makeRow(2), makeRow(3)]);
    const handler = jest.fn(async (row: JobTransition) => {
      activity.push(`handle:${row.id}`);
      if (row.id === 2) throw new Error("side effect exploded");
    });

    const processed = await consumeJobTransitions(handler, {
      now: () => NOW,
    });

    // Row 2 is skipped (no processedAt write) but 1 and 3 still complete.
    expect(processed).toBe(2);
    expect(activity).toEqual([
      "handle:1",
      "processed",
      "handle:2",
      "handle:3",
      "processed",
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("will retry"),
      "side effect exploded",
    );
  });

  it("drops a poison row older than POISON_AGE_MS by marking it processed anyway", async () => {
    primeTransaction([makeRow(1, POISON_AGE_MS + 60_000)]);
    const handler = jest.fn(async () => {
      throw new Error("permanently broken");
    });

    const processed = await consumeJobTransitions(handler, {
      now: () => NOW,
    });

    expect(processed).toBe(1);
    expect(processedAtWrites).toEqual([NOW]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropping poison transition 1"),
      "permanently broken",
    );
  });

  it("retries a failing row aged exactly at the poison boundary minus one tick", async () => {
    primeTransaction([makeRow(1, POISON_AGE_MS - 1)]);
    const handler = jest.fn(async () => {
      throw new Error("still young");
    });

    const processed = await consumeJobTransitions(handler, {
      now: () => NOW,
    });

    expect(processed).toBe(0);
    expect(processedAtWrites).toEqual([]);
  });

  it("stringifies non-Error throwables when dropping a poison row", async () => {
    primeTransaction([makeRow(1, POISON_AGE_MS + 1)]);
    const handler = jest.fn(async () => {
      throw "poison string";
    });

    const processed = await consumeJobTransitions(handler, {
      now: () => NOW,
    });

    expect(processed).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropping poison transition"),
      "poison string",
    );
  });

  it("stringifies non-Error throwables in the retry log", async () => {
    primeTransaction([makeRow(1)]);
    const handler = jest.fn(async () => {
      throw "string failure";
    });

    await consumeJobTransitions(handler, { now: () => NOW });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("will retry"),
      "string failure",
    );
  });
});

describe("outboxBacklog", () => {
  function primeCount(rows: Array<{ value: number }>): {
    whereArgs: unknown[];
  } {
    const capture: { whereArgs: unknown[] } = { whereArgs: [] };
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: (condition: unknown) => {
          capture.whereArgs.push(condition);
          return Promise.resolve(rows);
        },
      }),
    }));
    return capture;
  }

  it("returns the unprocessed count", async () => {
    primeCount([{ value: 12 }]);
    await expect(outboxBacklog()).resolves.toBe(12);
  });

  it("accepts an olderThan cutoff and still returns the count", async () => {
    const capture = primeCount([{ value: 3 }]);
    await expect(
      outboxBacklog(new Date("2026-07-20T09:00:00.000Z")),
    ).resolves.toBe(3);
    expect(capture.whereArgs).toHaveLength(1);
    expect(capture.whereArgs[0]).toBeDefined();
  });

  it("returns 0 when the count query yields no row", async () => {
    primeCount([]);
    await expect(outboxBacklog()).resolves.toBe(0);
  });
});
