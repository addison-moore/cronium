/**
 * @jest-environment node
 */
import { Readable } from "stream";

// ---- pg / pg-cursor mocks -------------------------------------------------
type CursorCb = (
  err: Error | undefined,
  rows: Record<string, unknown>[],
  result: { fields?: { name: string }[] },
) => void;

/** A fake pg-cursor that serves `rows` in batches, like a real server cursor. */
function makeFakeCursor(
  rows: Record<string, unknown>[],
  fields: { name: string }[],
) {
  let i = 0;
  return {
    reads: [] as number[],
    read(n: number, cb: CursorCb) {
      this.reads.push(n);
      const batch = rows.slice(i, i + n);
      i += batch.length;
      process.nextTick(() => cb(undefined, batch, { fields }));
    },
    close: jest.fn().mockResolvedValue(undefined),
  };
}

let fakeCursor: ReturnType<typeof makeFakeCursor>;
const mockPgQuery = jest.fn();
const mockPgEnd = jest.fn().mockResolvedValue(undefined);
jest.mock("pg", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    // Real pg submits a Cursor and returns it; anything else is a normal query.
    query: (arg: unknown) =>
      arg && typeof (arg as { read?: unknown }).read === "function"
        ? arg
        : mockPgQuery(arg),
    end: mockPgEnd,
  })),
}));
jest.mock("pg-cursor", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => fakeCursor),
}));

// ---- mysql2 mocks ---------------------------------------------------------
let mysqlRows: Record<string, unknown>[] = [];
let mysqlFields: { name: string }[] = [];
const mockCoreDestroy = jest.fn();
const mockCoreQuery = jest.fn(() => ({
  on: function (ev: string, h: (f: { name: string }[]) => void) {
    if (ev === "fields") h(mysqlFields);
    return this;
  },
  stream: () => Readable.from(mysqlRows, { objectMode: true }),
}));
jest.mock("mysql2", () => ({
  createConnection: jest.fn(() => ({
    on: jest.fn(),
    connect: (cb: (e?: Error) => void) => cb(undefined),
    query: mockCoreQuery,
    destroy: mockCoreDestroy,
  })),
}));

const mockMysqlPromiseQuery = jest.fn();
const mockMysqlEnd = jest.fn().mockResolvedValue(undefined);
jest.mock("mysql2/promise", () => ({
  createConnection: jest.fn().mockResolvedValue({
    query: mockMysqlPromiseQuery,
    end: mockMysqlEnd,
  }),
}));

import { postgresDriver } from "../drivers/postgres";
import { mysqlDriver } from "../drivers/mysql";
import type { SqlCredentials } from "../schemas";

const pgCreds: SqlCredentials = {
  dialect: "postgres",
  host: "h",
  database: "d",
  user: "u",
  password: "p",
  ssl: "require",
};
const myCreds: SqlCredentials = { ...pgCreds, dialect: "mysql" };
const read = { maxRows: 10_000, maxBytes: 5 * 1024 * 1024, timeoutMs: 30_000 };

beforeEach(() => {
  jest.clearAllMocks();
  mysqlRows = [];
  mysqlFields = [];
});

describe("postgresDriver.query (cursor streaming)", () => {
  it("binds :name as $n and returns normalized rows with columns", async () => {
    fakeCursor = makeFakeCursor([{ id: 1n }, { id: 2n }], [{ name: "id" }]);
    const res = await postgresDriver.query(
      pgCreds,
      "SELECT id FROM t WHERE id = :id",
      { id: 1 },
      read,
    );
    expect(res).toEqual({
      columns: ["id"],
      rows: [{ id: "1" }, { id: "2" }],
      rowCount: 2,
      truncated: false,
      bytesExceeded: false,
    });
    expect(fakeCursor.close).toHaveBeenCalled();
    expect(mockPgEnd).toHaveBeenCalled();
  });

  it("stops at maxRows and reports truncated without draining the cursor", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ n: i }));
    fakeCursor = makeFakeCursor(many, [{ name: "n" }]);
    const res = await postgresDriver.query(
      pgCreds,
      "SELECT n FROM t",
      {},
      {
        ...read,
        maxRows: 10,
      },
    );
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    // Only ever asked for maxRows+1 — it did not pull all 500 rows.
    expect(Math.max(...fakeCursor.reads)).toBeLessThanOrEqual(11);
  });

  it("stops on the byte budget and reports bytesExceeded", async () => {
    const fat = Array.from({ length: 50 }, () => ({ blob: "x".repeat(1000) }));
    fakeCursor = makeFakeCursor(fat, [{ name: "blob" }]);
    const res = await postgresDriver.query(
      pgCreds,
      "SELECT blob FROM t",
      {},
      {
        ...read,
        maxBytes: 5_000,
      },
    );
    expect(res.bytesExceeded).toBe(true);
    expect(res.rows.length).toBeLessThan(50);
  });

  it("returns columns for an empty result", async () => {
    fakeCursor = makeFakeCursor([], [{ name: "id" }]);
    const res = await postgresDriver.query(
      pgCreds,
      "SELECT id FROM t",
      {},
      read,
    );
    expect(res).toEqual({
      columns: ["id"],
      rows: [],
      rowCount: 0,
      truncated: false,
      bytesExceeded: false,
    });
  });
});

describe("postgresDriver.execute (buffered write)", () => {
  it("reports affected rows and closes the client", async () => {
    mockPgQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 5 });
    const res = await postgresDriver.execute(
      pgCreds,
      "UPDATE t SET a = 1 WHERE b = :b",
      { b: 2 },
      { timeoutMs: 30_000 },
    );
    expect(mockPgQuery).toHaveBeenCalledWith({
      text: "UPDATE t SET a = 1 WHERE b = $1",
      values: [2],
    });
    expect(res).toEqual({ rowCount: 5 });
    expect(mockPgEnd).toHaveBeenCalled();
  });
});

describe("mysqlDriver.query (row streaming)", () => {
  it("binds :name as ? and returns normalized rows with columns", async () => {
    mysqlRows = [{ id: 1 }, { id: 2 }];
    mysqlFields = [{ name: "id" }];
    const res = await mysqlDriver.query(
      myCreds,
      "SELECT id FROM t WHERE id = :id",
      { id: 7 },
      read,
    );
    expect(mockCoreQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT id FROM t WHERE id = ?",
        values: [7],
      }),
    );
    expect(res).toEqual({
      columns: ["id"],
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
      truncated: false,
      bytesExceeded: false,
    });
    expect(mockCoreDestroy).toHaveBeenCalled();
  });

  it("stops at maxRows and reports truncated", async () => {
    mysqlRows = Array.from({ length: 100 }, (_, i) => ({ n: i }));
    mysqlFields = [{ name: "n" }];
    const res = await mysqlDriver.query(
      myCreds,
      "SELECT n FROM t",
      {},
      {
        ...read,
        maxRows: 5,
      },
    );
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });
});

describe("mysqlDriver.execute (buffered write)", () => {
  it("reports affectedRows from the ResultSetHeader", async () => {
    mockMysqlPromiseQuery.mockResolvedValue([{ affectedRows: 3 }, undefined]);
    const res = await mysqlDriver.execute(
      myCreds,
      "DELETE FROM t WHERE a = :a",
      { a: 1 },
      { timeoutMs: 30_000 },
    );
    expect(res).toEqual({ rowCount: 3 });
    expect(mockMysqlEnd).toHaveBeenCalled();
  });
});
