/**
 * @jest-environment node
 */
jest.mock("../drivers", () => ({ getDriver: jest.fn() }));

import { getDriver } from "../drivers";
import { runQueryAction } from "../actions/run-query";
import { executeStatementAction } from "../actions/execute-statement";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const mockGetDriver = getDriver as jest.Mock;

const creds = {
  dialect: "postgres",
  host: "h",
  database: "d",
  user: "u",
  password: "p",
  ssl: "require",
};

function ctx(): ExecutionContext {
  return {
    variables: { get: jest.fn(), set: jest.fn() },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("run-query action", () => {
  it("emits its rows into Unified I/O (producesOutput)", () => {
    expect(runQueryAction.producesOutput).toBe(true);
  });

  it("returns { columns, rows, rowCount, truncated } on success", async () => {
    const run = jest.fn().mockResolvedValue({
      columns: ["id"],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
    });
    mockGetDriver.mockReturnValue({ run });

    const result = await runQueryAction.execute(
      creds,
      { query: "SELECT id FROM t WHERE id = :id", params: { id: "1" } },
      ctx(),
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "postgres" }),
      "SELECT id FROM t WHERE id = :id",
      { id: "1" },
      { maxRows: 10_000, timeoutMs: 30_000 },
    );
    expect(result).toEqual({
      columns: ["id"],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
    });
  });

  it("rejects a write on the read path and never touches the driver", async () => {
    mockGetDriver.mockReturnValue({ run: jest.fn() });
    const result = (await runQueryAction.execute(
      creds,
      { query: "INSERT INTO t VALUES (1)", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read-only/);
    expect(mockGetDriver).not.toHaveBeenCalled();
  });

  it("parses a JSON-string params map", async () => {
    const run = jest.fn().mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
    mockGetDriver.mockReturnValue({ run });
    await runQueryAction.execute(
      creds,
      { query: "SELECT :a", params: '{"a":5}' },
      ctx(),
    );
    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      "SELECT :a",
      { a: 5 },
      expect.anything(),
    );
  });

  it("returns { success:false } when the driver throws", async () => {
    mockGetDriver.mockReturnValue({
      run: jest.fn().mockRejectedValue(new Error("connection refused")),
    });
    const result = (await runQueryAction.execute(
      creds,
      { query: "SELECT 1", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("connection refused");
  });
});

describe("execute-statement action", () => {
  it("does not emit output and returns the affected row count", async () => {
    expect(executeStatementAction.producesOutput).toBe(false);
    const run = jest.fn().mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 4,
      truncated: false,
    });
    mockGetDriver.mockReturnValue({ run });
    const result = await executeStatementAction.execute(
      creds,
      { statement: "UPDATE t SET a = 1 WHERE b = :b", params: { b: 2 } },
      ctx(),
    );
    expect(result).toEqual({ rowCount: 4 });
  });

  it("rejects stacked statements", async () => {
    mockGetDriver.mockReturnValue({ run: jest.fn() });
    const result = (await executeStatementAction.execute(
      creds,
      { statement: "UPDATE t SET a=1; DROP TABLE t", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/single SQL statement/);
  });
});
