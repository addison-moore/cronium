/**
 * @jest-environment node
 */

// On a database from the old `drizzle-kit push` flow, run-migrations.cjs pushes the
// schema, executes only the migrations carrying the marker, and stamps the rest as
// applied. So a data change or a trigger without the marker never happens on those
// databases, and nothing reports it. 0012 and 0013 shipped that way.
//
// The opposite fails too. Push has already made whatever a generated statement makes,
// so a marked file holding `CREATE INDEX` stops the transition with "already exists".
// A migration that needs both is two files: one generated, one with
// `db:generate --custom` and the marker.

import { readFileSync } from "fs";
import { join } from "path";

const APP_DIR = join(__dirname, "../../..");
const DRIZZLE_DIR = join(APP_DIR, "drizzle");
const MARKER = "-- cronium:custom-migration";

// Shipped without the marker, and past fixing in place: an edit wouldn't reach a
// database already stamped past them. Each names the marked migration that repeats its
// data change. A new migration has no reason to be here. It can carry the marker.
const REPEATED_BY_LATER_MIGRATION: Record<string, string> = {
  "0012_scrub_webhook_delivery_headers":
    "0015_repeat_skipped_legacy_data_changes",
  "0013_retention_indexes": "0015_repeat_skipped_legacy_data_changes",
};

// What `drizzle-kit generate` writes, and so what push works out from schema.ts by
// itself. Listing these rather than the data-changing statements means a statement
// nobody thought of asks for the marker instead of slipping through.
const PUSH_APPLIES =
  /^(CREATE|ALTER|DROP) ((UNIQUE )?INDEX|TABLE|TYPE|SCHEMA|SEQUENCE|POLICY|ROLE|(MATERIALIZED )?VIEW)\b/;

const { entries } = JSON.parse(
  readFileSync(join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };

const tags = entries.map((entry) => entry.tag);

function sqlOf(tag: string): string {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), "utf8");
}

/** Where the quoted text starting at `start` ends, just past its closing quote. */
function endOfQuoted(sql: string, start: number): number {
  const quote = sql[start];
  const allowsBackslash = quote === "'" && /^e$/i.test(sql[start - 1] ?? "");
  let i = start + 1;
  while (i < sql.length) {
    if (allowsBackslash && sql[i] === "\\") {
      i += 2;
    } else if (sql[i] === quote) {
      // A doubled quote is an escaped one, not the end.
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

/** Where the block comment starting at `start` ends. Postgres lets them nest. */
function endOfBlockComment(sql: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < sql.length) {
    if (sql.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (sql.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

/**
 * The statements in a file, upper-cased, with comments removed and the contents of
 * strings and dollar-quoted bodies blanked. So only real SQL can decide what a
 * statement is, not a comment that says `UPDATE`, a default of `'a;b'`, or a function
 * body. `ON DELETE cascade` and `BEFORE UPDATE` don't matter, because a statement is
 * judged by how it starts.
 */
function statementsOf(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const char = sql[i]!;
    if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline;
    } else if (sql.startsWith("/*", i)) {
      i = endOfBlockComment(sql, i);
    } else if (char === "'") {
      i = endOfQuoted(sql, i);
      current += "''";
    } else if (char === '"') {
      const end = endOfQuoted(sql, i);
      current += sql.slice(i, end);
      i = end;
    } else if (char === ";") {
      statements.push(current);
      current = "";
      i += 1;
    } else {
      // A `$` inside an identifier, like a$b$c, doesn't open a dollar quote.
      const tag =
        char === "$" && !/[\w$]/.test(sql[i - 1] ?? "")
          ? /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))?.[0]
          : undefined;
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        current += "$$";
      } else {
        current += char;
        i += 1;
      }
    }
  }
  statements.push(current);

  return statements
    .map((statement) => statement.replace(/\s+/g, " ").trim().toUpperCase())
    .filter((statement) => statement !== "");
}

const pushCantApply = (sql: string) =>
  statementsOf(sql).filter((statement) => !PUSH_APPLIES.test(statement));

/** A statement with IF [NOT] EXISTS can follow push, because it won't fail. */
const pushAlreadyApplied = (sql: string) =>
  statementsOf(sql).filter(
    (statement) =>
      PUSH_APPLIES.test(statement) && !/\bIF (NOT )?EXISTS\b/.test(statement),
  );

describe("which migrations reach a database from the old push flow", () => {
  it("marks every migration holding something push can't apply", () => {
    const unmarked = tags
      .filter((tag) => !(tag in REPEATED_BY_LATER_MIGRATION))
      .filter((tag) => !sqlOf(tag).includes(MARKER))
      .flatMap((tag) =>
        pushCantApply(sqlOf(tag)).map(
          (statement) => `${tag}: ${statement.slice(0, 60)}`,
        ),
      );

    expect(unmarked).toEqual([]);
  });

  it("marks no migration holding something push has already applied", () => {
    const wouldFail = tags
      .filter((tag) => sqlOf(tag).includes(MARKER))
      .flatMap((tag) =>
        pushAlreadyApplied(sqlOf(tag)).map(
          (statement) => `${tag}: ${statement.slice(0, 60)}`,
        ),
      );

    expect(wouldFail).toEqual([]);
  });

  it.each(Object.entries(REPEATED_BY_LATER_MIGRATION))(
    "excuses %s only because %s, later and marked, repeats it",
    (tag, repeatedBy) => {
      expect(sqlOf(tag)).not.toContain(MARKER);
      expect(pushCantApply(sqlOf(tag))).not.toEqual([]);
      expect(tags.indexOf(tag)).toBeGreaterThanOrEqual(0);
      expect(tags.indexOf(repeatedBy)).toBeGreaterThan(tags.indexOf(tag));
      expect(sqlOf(repeatedBy)).toContain(MARKER);
    },
  );

  it("looks for the same marker the runner looks for", () => {
    const runner = readFileSync(
      join(APP_DIR, "scripts/run-migrations.cjs"),
      "utf8",
    );

    expect(runner).toContain(`"${MARKER}"`);
  });
});

describe("telling a statement push can't apply from one it can", () => {
  it.each([
    ['UPDATE "t" SET "a" = 1'],
    ["update t set a = 1"],
    ['DELETE FROM "t"'],
    ['INSERT INTO "t" VALUES (1)'],
    ['TRUNCATE "t"'],
    ["MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE"],
    ["WITH gone AS (DELETE FROM t RETURNING id) SELECT count(*) FROM gone"],
    ["DO $$ BEGIN UPDATE t SET a = 1; END; $$"],
    ["CREATE TRIGGER x BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f()"],
    ["CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $x$ SELECT 1 $x$"],
    ['CREATE EXTENSION "pgcrypto"'],
    ["-- a comment first\nUPDATE t SET a = 1"],
    ["/* a /* nested */ comment */ UPDATE t SET a = 1"],
    ["ALTER TABLE t ADD COLUMN a int;UPDATE t SET a = 1"],
    ["ALTER TABLE t ADD COLUMN a text DEFAULT 'x;y';\nDELETE FROM t"],
    ["ALTER TABLE t ADD COLUMN a text DEFAULT E'it\\'s;';\nDELETE FROM t"],
    ['ALTER TABLE t ADD COLUMN "a;b" int;\nDELETE FROM t'],
    ["ALTER TABLE t ADD COLUMN a$$b int;\nDELETE FROM t WHERE a$$b = 1"],
    ['CREATE INDEX "i" ON "t" ("a");--> statement-breakpoint\nDELETE FROM "t"'],
  ])("flags %j", (sql) => {
    expect(pushCantApply(sql)).not.toEqual([]);
  });

  it.each([
    ['CREATE TABLE "t" ("id" serial PRIMARY KEY)'],
    [
      'ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("b") REFERENCES "c"("id") ON DELETE cascade ON UPDATE no action',
    ],
    ['CREATE INDEX "i" ON "t" USING btree ("a") WHERE "s" IN (\'q\')'],
    ['CREATE UNIQUE INDEX "u" ON "t" USING btree ("a")'],
    ['DROP INDEX "i"'],
    ["ALTER TABLE t ALTER COLUMN a SET DEFAULT 'x; UPDATE t SET a = 1'"],
    ["ALTER TABLE t ALTER COLUMN a SET DEFAULT 'it''s; UPDATE t SET a = 1'"],
    ["ALTER TABLE t ALTER COLUMN a SET DEFAULT $v$; UPDATE t SET a = 1$v$"],
    ['ALTER TABLE t ADD COLUMN "x; UPDATE t SET a = 1" int'],
    ["-- UPDATE t SET a = 1\nALTER TABLE t ADD COLUMN a int"],
    ["/* DELETE FROM t; */ ALTER TABLE t ADD COLUMN a int"],
    ['ALTER TABLE "t" ADD "a" int;--> statement-breakpoint\nDROP TABLE "u"'],
    ["-- only a comment"],
  ])("doesn't flag %j", (sql) => {
    expect(pushCantApply(sql)).toEqual([]);
  });

  it("sees what push has already applied, unless it is safe to repeat", () => {
    expect(pushAlreadyApplied('CREATE INDEX "i" ON "t" ("a")')).toHaveLength(1);
    expect(
      pushAlreadyApplied('CREATE INDEX IF NOT EXISTS "i" ON "t" ("a")'),
    ).toEqual([]);
    expect(pushAlreadyApplied('ALTER TABLE "t" ADD "a" int')).toHaveLength(1);
    expect(
      pushAlreadyApplied('ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "a" int'),
    ).toEqual([]);
    expect(pushAlreadyApplied('UPDATE "t" SET "a" = 1')).toEqual([]);
  });
});
