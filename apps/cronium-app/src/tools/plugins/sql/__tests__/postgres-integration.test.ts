/**
 * @jest-environment node
 *
 * Integration test for the real Postgres adapter (unmocked `pg`). It only runs
 * when CRONIUM_SQL_TEST_PG_URL points at a reachable Postgres; otherwise the
 * suite is skipped, so CI without a database still passes. All queries are
 * read-only against Postgres built-ins (generate_series, casts, now()) — no
 * tables are created and nothing is written.
 *
 * Run locally, e.g.:
 *   CRONIUM_SQL_TEST_PG_URL="$DATABASE_URL" pnpm exec jest postgres-integration
 */
import { postgresDriver } from "../drivers/postgres";
import { runQueryAction } from "../actions/run-query";
import type { SqlCredentials } from "../schemas";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const url = process.env.CRONIUM_SQL_TEST_PG_URL;
const describeIf = url ? describe : describe.skip;

// Keep the file valid (>=1 test) when the integration suite is skipped.
if (!url) {
  it("skips Postgres integration (set CRONIUM_SQL_TEST_PG_URL to run)", () => {
    expect(true).toBe(true);
  });
}

function credsFromUrl(raw: string): SqlCredentials {
  const u = new URL(raw);
  return {
    dialect: "postgres",
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: u.searchParams.get("sslmode") === "require" ? "require" : "disable",
  };
}

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

describeIf("postgres adapter (integration)", () => {
  // describe.skip still executes this body to register (skipped) tests, so this
  // must not throw when the URL is absent.
  const creds = url ? credsFromUrl(url) : ({} as SqlCredentials);
  const opts = {
    maxRows: 10_000,
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15_000,
  };

  it("binds :named params and returns them", async () => {
    const res = await postgresDriver.query(
      creds,
      "SELECT :a::int AS a, :b AS b, :a::int + 1 AS a_plus",
      { a: "5", b: "hi" },
      opts,
    );
    expect(res.columns).toEqual(["a", "b", "a_plus"]);
    expect(res.rows).toEqual([{ a: 5, b: "hi", a_plus: 6 }]);
    expect(res.rowCount).toBe(1);
  });

  it("coerces bigint and timestamp to JSON-safe values", async () => {
    const res = await postgresDriver.query(
      creds,
      "SELECT 9007199254740993::bigint AS big, '2020-01-02T03:04:05Z'::timestamptz AS ts, '2021-05-06'::date AS d",
      {},
      opts,
    );
    const row = res.rows[0]!;
    expect(row.big).toBe("9007199254740993"); // string, not a lossy number
    expect(typeof row.ts).toBe("string");
    expect(row.ts).toContain("2020-01-02");
    expect(typeof row.d).toBe("string");
    expect(row.d).toContain("2021-05-06");
  });

  it("returns columns for an empty result", async () => {
    const res = await postgresDriver.query(
      creds,
      "SELECT g FROM generate_series(1, 0) AS g",
      {},
      opts,
    );
    expect(res.columns).toEqual(["g"]);
    expect(res.rows).toEqual([]);
  });

  it("stops at the row cap and reports truncated", async () => {
    const res = await postgresDriver.query(
      creds,
      "SELECT g FROM generate_series(1, 50) AS g",
      {},
      { ...opts, maxRows: 10 },
    );
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(res.bytesExceeded).toBe(false);
  });

  it("bounds a huge result set by the byte budget instead of buffering it", async () => {
    // 5 million rows would be gigabytes if buffered. The cursor must stop at the
    // byte budget almost immediately and return promptly.
    const started = Date.now();
    const res = await postgresDriver.query(
      creds,
      "SELECT g, repeat('x', 500) AS pad FROM generate_series(1, 5000000) AS g",
      {},
      { maxRows: 1_000_000, maxBytes: 200_000, timeoutMs: 15_000 },
    );
    expect(res.bytesExceeded).toBe(true);
    expect(res.rows.length).toBeLessThan(1000); // stopped early, not 5M rows
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("streams EXPLAIN through the cursor", async () => {
    const res = await postgresDriver.query(creds, "EXPLAIN SELECT 1", {}, opts);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("runs end-to-end through the run-query action", async () => {
    const result = (await runQueryAction.execute(
      creds,
      { query: "SELECT :n::int AS n", params: { n: "42" } },
      ctx(),
    )) as { rows: Record<string, unknown>[]; rowCount: number };
    expect(result.rows).toEqual([{ n: 42 }]);
    expect(result.rowCount).toBe(1);
  });

  it("rejects a write on the read path before connecting", async () => {
    const result = (await runQueryAction.execute(
      creds,
      { query: "CREATE TABLE cronium_should_not_exist (id int)", params: {} },
      ctx(),
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read-only/);
  });
});
