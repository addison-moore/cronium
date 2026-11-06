/**
 * The real boot script, run-migrations.cjs, as a child process. Each test gets a
 * database of its own on the harness's throwaway server, because the script needs
 * them in states the shared test database can't be in: from the old push flow,
 * migrated partway, and empty.
 *
 * Nothing else covers the push flow's one-time transition, and a data change skipped
 * there reports nothing: the boot succeeds and the data just stays.
 */
import { spawnSync } from "child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool as harnessPool } from "@/server/db";
import { closePool } from "./helpers/db-reset";

// Each boot from the push flow runs drizzle-kit, which takes seconds.
jest.setTimeout(240_000);

const APP_DIR = join(__dirname, "../../apps/cronium-app");
const DRIZZLE_DIR = join(APP_DIR, "drizzle");
const RUNNER = join(APP_DIR, "scripts/run-migrations.cjs");
const REPEAT_TAG_SUFFIX = "_repeat_skipped_legacy_data_changes";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

const journal = JSON.parse(
  readFileSync(join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"),
) as Journal;

const SYSTEM_HEADERS = {
  "Content-Type": "application/json",
  "X-Webhook-Id": "1",
  "X-Webhook-Event": "user.created",
  "X-Webhook-Timestamp": "2026-01-01T00:00:00.000Z",
  "X-Delivery-Id": "delivery-1",
};
const FROM_BEFORE_THE_FIX = {
  ...SYSTEM_HEADERS,
  "X-Webhook-Signature": "sha256=abc123",
  Authorization: "Bearer SECRET-SENTINEL",
  "X-Api-Key": "ALSO-SECRET-SENTINEL",
};
const WRITTEN_SINCE_THE_FIX = {
  ...SYSTEM_HEADERS,
  Authorization: "[redacted]",
};

let databaseCount = 0;
const openDatabases: { name: string; pool: Pool }[] = [];

function urlOf(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

async function createDatabase(): Promise<{ url: string; pool: Pool }> {
  databaseCount += 1;
  const name = `run_migrations_${process.pid}_${databaseCount}`;
  await harnessPool.query(`CREATE DATABASE "${name}"`);
  const url = urlOf(name);
  const pool = new Pool({ connectionString: url });
  // pool.end() can resolve with a client still closing, so the DROP ... WITH (FORCE)
  // in afterAll has Postgres terminate it. pg-pool emits that as `error` on the pool,
  // and with no listener it's an uncaught exception, which Jest pins on a random test.
  pool.on("error", () => undefined);
  openDatabases.push({ name, pool });
  return { url, pool };
}

function run(command: string, args: string[], url: string): string {
  const result = spawnSync(command, args, {
    cwd: APP_DIR,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

const boot = (url: string) => run(process.execPath, [RUNNER], url);

/** What the old flow did to a database: the schema, and no migration records. */
function pushSchema(url: string): void {
  run("npx", ["drizzle-kit", "push", "--config", "drizzle.config.ts"], url);
}

/** Applies the migrations before the repeat, as a database on them has. */
async function migrateToJustBeforeTheRepeat(pool: Pool): Promise<void> {
  const cut = journal.entries.findIndex((entry) =>
    entry.tag.endsWith(REPEAT_TAG_SUFFIX),
  );
  const folder = mkdtempSync(join(tmpdir(), "cronium-migrations-"));
  try {
    cpSync(DRIZZLE_DIR, folder, { recursive: true });
    writeFileSync(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
    );
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** One delivery per value, in order, and the user, webhook and event they need. */
async function seedDeliveries(pool: Pool, headers: unknown[]): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, username) VALUES ('u1', 'u1@example.test', 'u1')`,
  );
  await pool.query(
    `INSERT INTO webhooks (user_id, name, url, key, secret)
     VALUES ('u1', 'hook', 'https://hooks.example/in', 'hook-key', 'whsec')`,
  );
  await pool.query(
    `INSERT INTO webhook_events (event, payload) VALUES ('user.created', '{}')`,
  );
  for (const value of headers) {
    await pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, webhook_event_id, delivery_id, status, headers, attempted_at)
       VALUES (1, 1, 'delivery-1', 'success', $1::jsonb, now())`,
      [JSON.stringify(value)],
    );
  }
}

async function seedSettings(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value)
     VALUES ('logRetentionDays', '30'), ('registrationEnabled', 'true')`,
  );
}

async function headersOf(pool: Pool): Promise<unknown[]> {
  const { rows } = await pool.query<{ headers: unknown }>(
    `SELECT headers FROM webhook_deliveries ORDER BY id`,
  );
  return rows.map((row) => row.headers);
}

async function settingKeys(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ key: string }>(
    `SELECT key FROM system_settings ORDER BY key`,
  );
  return rows.map((row) => row.key);
}

async function stampedTimes(pool: Pool): Promise<number[]> {
  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );
  return rows.map((row) => Number(row.created_at));
}

/** Everything a boot could have touched, row versions included. */
async function fingerprint(pool: Pool) {
  const query = async (sql: string) => (await pool.query(sql)).rows;
  return {
    deliveries: await query(
      `SELECT id, xmin::text, headers FROM webhook_deliveries ORDER BY id`,
    ),
    settings: await query(
      `SELECT id, xmin::text, key, value FROM system_settings ORDER BY id`,
    ),
    stamps: await query(
      `SELECT id, xmin::text, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
    ),
    triggers: await query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
    ),
  };
}

const everyStamp = journal.entries.map((entry) => entry.when);

afterAll(async () => {
  for (const { name, pool } of openDatabases) {
    await pool.end();
    await harnessPool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await closePool();
});

describe("a database from the old push flow", () => {
  async function bootedLegacyDatabase() {
    const { url, pool } = await createDatabase();
    pushSchema(url);
    await seedDeliveries(pool, [FROM_BEFORE_THE_FIX, WRITTEN_SINCE_THE_FIX]);
    await seedSettings(pool);
    const output = boot(url);
    return { url, pool, output };
  }

  it("has the skipped data changes made on its first boot, and every migration stamped", async () => {
    const { pool, output } = await bootedLegacyDatabase();

    expect(output).toContain("Legacy schema detected");
    expect(output).toMatch(/Applying custom migration \d+_repeat_skipped/);
    expect(await headersOf(pool)).toEqual([
      SYSTEM_HEADERS,
      WRITTEN_SINCE_THE_FIX,
    ]);
    expect(await settingKeys(pool)).toEqual(["registrationEnabled"]);
    expect(await stampedTimes(pool)).toEqual(everyStamp);
  });

  it("changes nothing on its second boot", async () => {
    const { url, pool } = await bootedLegacyDatabase();
    const before = await fingerprint(pool);

    const output = boot(url);

    expect(output).not.toContain("Legacy schema detected");
    expect(await fingerprint(pool)).toEqual(before);
  });
});

describe("a database already stamped past 0012 without running it", () => {
  it("has the skipped data changes made through the migrator", async () => {
    const { url, pool } = await createDatabase();
    await migrateToJustBeforeTheRepeat(pool);
    // As a legacy database is after an earlier transition: the records say the data
    // changes happened, and the values and the setting are still there.
    await seedDeliveries(pool, [FROM_BEFORE_THE_FIX, WRITTEN_SINCE_THE_FIX]);
    await seedSettings(pool);

    const output = boot(url);

    expect(output).not.toContain("Legacy schema detected");
    expect(await headersOf(pool)).toEqual([
      SYSTEM_HEADERS,
      WRITTEN_SINCE_THE_FIX,
    ]);
    expect(await settingKeys(pool)).toEqual(["registrationEnabled"]);
    expect(await stampedTimes(pool)).toEqual(everyStamp);

    const before = await fingerprint(pool);
    boot(url);
    expect(await fingerprint(pool)).toEqual(before);
  });
});

describe("a database that ran 0012 and 0013", () => {
  it("has no row rewritten by the upgrade, and none on the boot after", async () => {
    const { url, pool } = await createDatabase();
    await migrateToJustBeforeTheRepeat(pool);
    await seedDeliveries(pool, [SYSTEM_HEADERS, WRITTEN_SINCE_THE_FIX, {}]);
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('registrationEnabled', 'true')`,
    );
    const before = await fingerprint(pool);

    boot(url);

    const after = await fingerprint(pool);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(after.settings).toEqual(before.settings);
    expect(after.triggers).toEqual(before.triggers);
    expect(await stampedTimes(pool)).toEqual(everyStamp);

    boot(url);
    expect(await fingerprint(pool)).toEqual(after);
  });
});

describe("an empty database", () => {
  it("installs from the migrator, and changes nothing on its second boot", async () => {
    const { url, pool } = await createDatabase();

    const output = boot(url);

    expect(output).not.toContain("Legacy schema detected");
    expect(await headersOf(pool)).toEqual([]);
    expect(await stampedTimes(pool)).toEqual(everyStamp);

    const before = await fingerprint(pool);
    boot(url);
    expect(await fingerprint(pool)).toEqual(before);
  });
});
