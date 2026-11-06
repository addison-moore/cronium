/**
 * @jest-environment node
 */

// Drizzle's migrator applies a journal entry only if its `when` is later than the
// last one the database has applied. An entry out of order is skipped on every
// database already past it, with no error. Two branches adding a migration at once
// can produce that, so whichever lands second has to regenerate its migration.

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DRIZZLE_DIR = join(__dirname, "../../../drizzle");

const { entries } = JSON.parse(
  readFileSync(join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"),
) as { entries: { idx: number; when: number; tag: string }[] };

describe("the migration journal", () => {
  it("has a later timestamp on every entry", () => {
    const outOfOrder = entries
      .filter((entry, i) => i > 0 && entry.when <= entries[i - 1]!.when)
      .map((entry) => entry.tag);

    expect(outOfOrder).toEqual([]);
  });

  it("numbers its entries in sequence", () => {
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_entry, i) => i),
    );
  });

  it("has a SQL file for every entry", () => {
    const missing = entries
      .map((entry) => `${entry.tag}.sql`)
      .filter((name) => !existsSync(join(DRIZZLE_DIR, name)));

    expect(missing).toEqual([]);
  });
});
