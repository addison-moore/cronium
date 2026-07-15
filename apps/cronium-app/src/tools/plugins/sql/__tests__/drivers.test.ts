/**
 * @jest-environment node
 */
const mockPgQuery = jest.fn();
const mockPgConnect = jest.fn().mockResolvedValue(undefined);
const mockPgEnd = jest.fn().mockResolvedValue(undefined);
jest.mock("pg", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockPgConnect,
    query: mockPgQuery,
    end: mockPgEnd,
  })),
}));

const mockMysqlQuery = jest.fn();
const mockMysqlEnd = jest.fn().mockResolvedValue(undefined);
jest.mock("mysql2/promise", () => ({
  createConnection: jest.fn().mockResolvedValue({
    query: mockMysqlQuery,
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
const opts = { maxRows: 10_000, timeoutMs: 30_000 };

beforeEach(() => jest.clearAllMocks());

describe("postgresDriver.run", () => {
  it("binds :name as $n and normalizes a SELECT result", async () => {
    mockPgQuery.mockResolvedValue({
      rows: [{ id: 1n }, { id: 2n }],
      fields: [{ name: "id" }],
      rowCount: 2,
    });
    const res = await postgresDriver.run(
      pgCreds,
      "SELECT id FROM t WHERE id = :id",
      { id: 1 },
      opts,
    );
    expect(mockPgQuery).toHaveBeenCalledWith({
      text: "SELECT id FROM t WHERE id = $1",
      values: [1],
    });
    expect(res).toEqual({
      columns: ["id"],
      rows: [{ id: "1" }, { id: "2" }],
      rowCount: 2,
      truncated: false,
    });
    expect(mockPgEnd).toHaveBeenCalled();
  });

  it("caps rows and sets truncated", async () => {
    mockPgQuery.mockResolvedValue({
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      fields: [{ name: "n" }],
      rowCount: 3,
    });
    const res = await postgresDriver.run(
      pgCreds,
      "SELECT n FROM t",
      {},
      {
        maxRows: 2,
        timeoutMs: 1000,
      },
    );
    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect(res.rowCount).toBe(2);
  });

  it("reports affected rows for a write (no returned rows)", async () => {
    mockPgQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 5 });
    const res = await postgresDriver.run(
      pgCreds,
      "UPDATE t SET a = 1",
      {},
      opts,
    );
    expect(res).toEqual({
      columns: [],
      rows: [],
      rowCount: 5,
      truncated: false,
    });
  });

  it("closes the connection even when the query throws", async () => {
    mockPgQuery.mockRejectedValue(new Error("boom"));
    await expect(
      postgresDriver.run(pgCreds, "SELECT 1", {}, opts),
    ).rejects.toThrow("boom");
    expect(mockPgEnd).toHaveBeenCalled();
  });
});

describe("mysqlDriver.run", () => {
  it("binds :name as ? and normalizes a SELECT result", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ id: 1 }, { id: 2 }],
      [{ name: "id" }],
    ]);
    const res = await mysqlDriver.run(
      myCreds,
      "SELECT id FROM t WHERE id = :id",
      { id: 7 },
      opts,
    );
    expect(mockMysqlQuery).toHaveBeenCalledWith({
      sql: "SELECT id FROM t WHERE id = ?",
      values: [7],
      timeout: 30_000,
    });
    expect(res).toEqual({
      columns: ["id"],
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
      truncated: false,
    });
  });

  it("reports affectedRows for a write (ResultSetHeader)", async () => {
    mockMysqlQuery.mockResolvedValue([{ affectedRows: 3 }, undefined]);
    const res = await mysqlDriver.run(
      myCreds,
      "DELETE FROM t WHERE a = :a",
      { a: 1 },
      opts,
    );
    expect(res).toEqual({
      columns: [],
      rows: [],
      rowCount: 3,
      truncated: false,
    });
  });
});
