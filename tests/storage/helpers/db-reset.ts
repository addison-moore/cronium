/**
 * Per-test database reset. TRUNCATE … RESTART IDENTITY CASCADE across every
 * public table so each test starts from an empty schema with serial sequences
 * rewound — deterministic ids, zero cross-test bleed.
 *
 * Table discovery is dynamic (pg_tables) so schema additions need no change
 * here. Uses the real pool exported from @/server/db.
 */
import { pool } from "@/server/db";

let cachedTableList: string | null = null;

async function allPublicTables(): Promise<string> {
  if (cachedTableList) return cachedTableList;
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) {
    throw new Error(
      "[storage-tests] No public tables found — did db:push run? " +
        "Launch via `pnpm test:storage`.",
    );
  }
  cachedTableList = rows.map((r) => `"${r.tablename}"`).join(", ");
  return cachedTableList;
}

export async function resetDatabase(): Promise<void> {
  const tables = await allPublicTables();
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
