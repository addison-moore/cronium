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

const MB5 = 5 * 1024 * 1024;

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

/** A driver whose streamed read returns `over` for the given overflow flags. */
function driverReturning(result: Record<string, unknown>) {
  const query = jest.fn().mockResolvedValue({
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    bytesExceeded: false,
    ...result,
  });
  mockGetDriver.mockReturnValue({ query });
  return query;
}

beforeEach(() => jest.clearAllMocks());

describe("run-query action", () => {
  it("emits its rows into Unified I/O (producesOutput)", () => {
    expect(runQueryAction.producesOutput).toBe(true);
  });

  it("returns { columns, rows, rowCount } and passes both limits to the driver", async () => {
    const query = driverReturning({
      columns: ["id"],
      rows: [{ id: 1 }],
      rowCount: 1,
    });

    const result = await runQueryAction.execute(
      creds,
      { query: "SELECT id FROM t WHERE id = :id", params: { id: "1" } },
      ctx(),
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "postgres" }),
      "SELECT id FROM t WHERE id = :id",
      { id: "1" },
      { maxRows: 10_000, maxBytes: MB5, timeoutMs: 30_000 },
    );
    expect(result).toEqual({ columns: ["id"], rows: [{ id: 1 }], rowCount: 1 });
  });

  it("uses the event timeout (context.timeoutMs) as the statement timeout", async () => {
    const query = driverReturning({});
    const context = ctx();
    context.timeoutMs = 5_000;
    await runQueryAction.execute(
      creds,
      { query: "SELECT 1", params: {} },
      context,
    );
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      "SELECT 1",
      {},
      { maxRows: 10_000, maxBytes: MB5, timeoutMs: 5_000 },
    );
  });

  it("fails instead of silently truncating when the row cap is exceeded", async () => {
    driverReturning({ truncated: true });
    const result = (await runQueryAction.execute(
      creds,
      { query: "SELECT id FROM big", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/more than 10000 rows/);
    expect(result.error).toMatch(/LIMIT|Max Rows/);
  });

  it("fails when the streamed result hits the byte budget", async () => {
    driverReturning({ bytesExceeded: true });
    const result = (await runQueryAction.execute(
      creds,
      { query: "SELECT blob FROM big", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds the 5\.0 MB limit/);
    expect(result.error).toMatch(/INSERT \.\.\. SELECT|Script event/);
  });

  it("honors an explicit maxRows override", async () => {
    const query = driverReturning({});
    await runQueryAction.execute(
      creds,
      { query: "SELECT 1", params: {}, maxRows: 50_000 },
      ctx(),
    );
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      "SELECT 1",
      {},
      { maxRows: 50_000, maxBytes: MB5, timeoutMs: 30_000 },
    );
  });

  it("rejects a write on the read path and never touches the driver", async () => {
    driverReturning({});
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
    const query = driverReturning({});
    await runQueryAction.execute(
      creds,
      { query: "SELECT :a", params: '{"a":5}' },
      ctx(),
    );
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      "SELECT :a",
      { a: 5 },
      expect.anything(),
    );
  });

  it("returns { success:false } when the driver throws", async () => {
    mockGetDriver.mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error("connection refused")),
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
    const execute = jest.fn().mockResolvedValue({ rowCount: 4 });
    mockGetDriver.mockReturnValue({ execute });
    const result = await executeStatementAction.execute(
      creds,
      { statement: "UPDATE t SET a = 1 WHERE b = :b", params: { b: 2 } },
      ctx(),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      "UPDATE t SET a = 1 WHERE b = :b",
      { b: 2 },
      { timeoutMs: 30_000 },
    );
    expect(result).toEqual({ rowCount: 4 });
  });

  it("rejects stacked statements", async () => {
    mockGetDriver.mockReturnValue({ execute: jest.fn() });
    const result = (await executeStatementAction.execute(
      creds,
      { statement: "UPDATE t SET a=1; DROP TABLE t", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/single SQL statement/);
  });
});
