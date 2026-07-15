/**
 * @jest-environment node
 */
import {
  rewriteNamedPlaceholders,
  toJsonSafe,
  normalizeRows,
  leadingKeyword,
  countStatements,
  assertReadOnlyStatement,
  assertSingleStatement,
  coerceBindParams,
} from "../drivers/sql-helpers";

describe("rewriteNamedPlaceholders", () => {
  it("rewrites :name to $n (postgres) binding in order", () => {
    const { text, values } = rewriteNamedPlaceholders(
      "SELECT * FROM t WHERE a = :a AND b = :b",
      { a: 1, b: "x" },
      "dollar",
    );
    expect(text).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
    expect(values).toEqual([1, "x"]);
  });

  it("reuses $n for a repeated name (postgres)", () => {
    const { text, values } = rewriteNamedPlaceholders(
      "SELECT :x, :y, :x",
      { x: 1, y: 2 },
      "dollar",
    );
    expect(text).toBe("SELECT $1, $2, $1");
    expect(values).toEqual([1, 2]);
  });

  it("rewrites :name to ? (mysql) repeating the value per occurrence", () => {
    const { text, values } = rewriteNamedPlaceholders(
      "SELECT :x, :y, :x",
      { x: 1, y: 2 },
      "question",
    );
    expect(text).toBe("SELECT ?, ?, ?");
    expect(values).toEqual([1, 2, 1]);
  });

  it("does not treat a Postgres :: cast as a placeholder", () => {
    const { text, values } = rewriteNamedPlaceholders(
      "SELECT id::text FROM t WHERE id = :id",
      { id: 5 },
      "dollar",
    );
    expect(text).toBe("SELECT id::text FROM t WHERE id = $1");
    expect(values).toEqual([5]);
  });

  it("ignores :name inside string literals and comments", () => {
    const sql =
      "SELECT ':notparam' AS a, /* :nope */ b -- :also\nFROM t WHERE c = :real";
    const { text, values } = rewriteNamedPlaceholders(
      sql,
      { real: 9 },
      "dollar",
    );
    expect(text).toContain("':notparam'");
    expect(text).toContain("/* :nope */");
    expect(text).toContain("c = $1");
    expect(values).toEqual([9]);
  });

  it("throws when a placeholder has no matching value", () => {
    expect(() =>
      rewriteNamedPlaceholders("SELECT :missing", {}, "dollar"),
    ).toThrow(/Missing value for query parameter ":missing"/);
  });
});

describe("toJsonSafe / normalizeRows", () => {
  it("coerces Date, bigint, and Buffer to JSON-safe values", () => {
    const d = new Date("2020-01-02T03:04:05.000Z");
    expect(toJsonSafe(d)).toBe("2020-01-02T03:04:05.000Z");
    expect(toJsonSafe(10n)).toBe("10");
    expect(toJsonSafe(Buffer.from("hi"))).toBe(
      Buffer.from("hi").toString("base64"),
    );
  });

  it("recurses into nested objects and arrays", () => {
    const row = {
      id: 1n,
      at: new Date("2021-06-01T00:00:00.000Z"),
      tags: [1n],
    };
    expect(normalizeRows([row])).toEqual([
      { id: "1", at: "2021-06-01T00:00:00.000Z", tags: ["1"] },
    ]);
  });

  it("passes primitives through and maps null/undefined to null", () => {
    expect(toJsonSafe("x")).toBe("x");
    expect(toJsonSafe(3)).toBe(3);
    expect(toJsonSafe(true)).toBe(true);
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(undefined)).toBeNull();
  });
});

describe("statement guards", () => {
  it("extracts the leading keyword, ignoring comments", () => {
    expect(leadingKeyword("  -- c\n  SELECT 1")).toBe("select");
    expect(leadingKeyword("/* x */ WITH t AS (…) SELECT")).toBe("with");
    expect(leadingKeyword("DELETE FROM t")).toBe("delete");
  });

  it("counts statements, ignoring semicolons in strings/comments", () => {
    expect(countStatements("SELECT 1")).toBe(1);
    expect(countStatements("SELECT 1;")).toBe(1);
    expect(countStatements("SELECT 1; SELECT 2")).toBe(2);
    expect(countStatements("SELECT ';'")).toBe(1);
    expect(countStatements("SELECT 1 -- ; comment")).toBe(1);
  });

  it("allows read-only statements", () => {
    expect(() => assertReadOnlyStatement("SELECT * FROM t")).not.toThrow();
    expect(() =>
      assertReadOnlyStatement("WITH x AS (SELECT 1) SELECT * FROM x"),
    ).not.toThrow();
    expect(() => assertReadOnlyStatement("EXPLAIN SELECT 1")).not.toThrow();
  });

  it("rejects writes on the read path", () => {
    expect(() => assertReadOnlyStatement("INSERT INTO t VALUES (1)")).toThrow(
      /read-only/,
    );
    expect(() => assertReadOnlyStatement("UPDATE t SET a = 1")).toThrow(
      /read-only/,
    );
    expect(() => assertReadOnlyStatement("DROP TABLE t")).toThrow(/read-only/);
  });

  it("rejects stacked statements on both paths", () => {
    expect(() => assertReadOnlyStatement("SELECT 1; DROP TABLE t")).toThrow(
      /single SQL statement/,
    );
    expect(() =>
      assertSingleStatement("INSERT INTO t VALUES (1); DELETE FROM t"),
    ).toThrow(/single SQL statement/);
  });

  it("rejects an empty statement", () => {
    expect(() => assertSingleStatement("   ")).toThrow(/empty/);
  });
});

describe("coerceBindParams", () => {
  it("returns an object as-is", () => {
    expect(coerceBindParams({ a: 1 })).toEqual({ a: 1 });
  });

  it("parses a JSON-object string", () => {
    expect(coerceBindParams('{"a":1}')).toEqual({ a: 1 });
  });

  it("treats null/undefined/blank as an empty map", () => {
    expect(coerceBindParams(undefined)).toEqual({});
    expect(coerceBindParams(null)).toEqual({});
    expect(coerceBindParams("   ")).toEqual({});
  });

  it("rejects arrays, non-object JSON, and malformed JSON", () => {
    expect(() => coerceBindParams("[1,2]")).toThrow(/JSON object/);
    expect(() => coerceBindParams("5")).toThrow(/JSON object/);
    expect(() => coerceBindParams("{bad")).toThrow(/JSON object/);
    expect(() => coerceBindParams([1, 2])).toThrow(/JSON object/);
  });
});
