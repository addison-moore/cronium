/**
 * The repeat_skipped_legacy_data_changes migration, against rows in each shape the
 * webhook code has written. The harness pushes the schema instead of running
 * migrations, so these tests run the migration's own file.
 * run-migrations.test.ts covers it through the real boot script.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { QueryResult } from "pg";
import { db, pool } from "@/server/db";
import { serializePayload } from "@/lib/webhooks/delivery-body";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { systemSettings, webhookEvents, webhooks } from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

jest.mock("axios", () => ({
  request: jest.fn(async () => ({
    status: 200,
    data: jest
      .requireActual<typeof import("node:stream")>("node:stream")
      .Readable.from([Buffer.from("ok")]),
  })),
}));
// The harness's stub has only customAlphabet.
jest.mock("nanoid", () => ({ nanoid: () => "delivery-1" }));

const DRIZZLE_DIR = join(__dirname, "../../apps/cronium-app/drizzle");

// By suffix, because a number changes if another migration lands first.
function migrationEndingWith(suffix: string): string {
  const name = readdirSync(DRIZZLE_DIR).find((file) => file.endsWith(suffix));
  return readFileSync(join(DRIZZLE_DIR, name!), "utf8");
}

const migration = migrationEndingWith(
  "_repeat_skipped_legacy_data_changes.sql",
);
const original = migrationEndingWith("_scrub_webhook_delivery_headers.sql");

const SYSTEM_HEADERS = {
  "Content-Type": "application/json",
  "X-Webhook-Id": "1",
  "X-Webhook-Event": "user.created",
  "X-Webhook-Timestamp": "2026-01-01T00:00:00.000Z",
  "X-Delivery-Id": "delivery-1",
};

/** What the old code recorded: the whole request, secrets included. */
const FROM_BEFORE_THE_FIX = {
  ...SYSTEM_HEADERS,
  "X-Webhook-Signature": "sha256=abc123",
  Authorization: "Bearer SECRET-SENTINEL",
  "X-Api-Key": "ALSO-SECRET-SENTINEL",
};

let webhookId: number;
let webhookEventId: number;

async function applyMigration() {
  const [scrub, settings] = (await pool.query(
    migration,
  )) as unknown as QueryResult[];
  return { scrubbed: scrub!.rowCount, settingsRemoved: settings!.rowCount };
}

/** Takes JSON text, so a test can store shapes the app never would. */
async function seedDelivery(
  headers: string | null,
  id = "delivery-1",
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO webhook_deliveries
       (webhook_id, webhook_event_id, delivery_id, status, status_code, response, error, headers, duration, attempted_at)
     VALUES ($1, $2, $3, 'success', 200, 'ok', 'none', $4::jsonb, 12, now())
     RETURNING id`,
    [webhookId, webhookEventId, id, headers],
  );
  return rows[0]!.id;
}

async function rowOf(id: number) {
  const { rows } = await pool.query<{ headers: unknown; xmin: string }>(
    `SELECT *, xmin::text FROM webhook_deliveries WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

/** What a statement would leave in a row, without keeping it. */
async function headersAfterRunning(sql: string, id: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    const { rows } = await client.query<{ headers: unknown }>(
      `SELECT headers FROM webhook_deliveries WHERE id = $1`,
      [id],
    );
    return rows[0]!.headers;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

beforeEach(async () => {
  await resetDatabase();
  const userId = await seedUser();
  const [webhook] = await db
    .insert(webhooks)
    .values({
      userId,
      name: "hook",
      url: "https://hooks.example/in",
      key: "hook-key",
      secret: "whsec",
    })
    .returning({ id: webhooks.id });
  webhookId = webhook!.id;
  const [event] = await db
    .insert(webhookEvents)
    .values({ event: "user.created", payload: {}, userId })
    .returning({ id: webhookEvents.id });
  webhookEventId = event!.id;
});

afterAll(async () => {
  await closePool();
});

describe("a row from before the fix", () => {
  it("loses its custom header values and signature, and keeps its system headers", async () => {
    const id = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));

    expect(await applyMigration()).toMatchObject({ scrubbed: 1 });

    expect((await rowOf(id)).headers).toEqual(SYSTEM_HEADERS);
  });

  it("ends up as 0012 leaves one", async () => {
    const id = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));
    const leftBy0012 = await headersAfterRunning(original, id);

    await applyMigration();

    expect((await rowOf(id)).headers).toEqual(leftBy0012);
  });

  it("changes nothing else on the row", async () => {
    const id = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));
    const { xmin: _before, ...before } = await rowOf(id);

    await applyMigration();

    const { xmin: _after, ...after } = await rowOf(id);
    expect(after).toEqual({ ...before, headers: SYSTEM_HEADERS });
  });

  it("is judged one entry at a time", async () => {
    const id = await seedDelivery(
      JSON.stringify({
        ...SYSTEM_HEADERS,
        "X-Named-Since-The-Fix": "[redacted]",
        Authorization: "Bearer SECRET-SENTINEL",
      }),
    );

    expect(await applyMigration()).toMatchObject({ scrubbed: 1 });

    expect((await rowOf(id)).headers).toEqual({
      ...SYSTEM_HEADERS,
      "X-Named-Since-The-Fix": "[redacted]",
    });
  });

  it("can't tell a custom header given a system header's name from the real one", async () => {
    const headers = { ...SYSTEM_HEADERS, "x-delivery-id": "custom-value" };
    const id = await seedDelivery(JSON.stringify(headers));

    expect(await applyMigration()).toMatchObject({ scrubbed: 0 });

    expect((await rowOf(id)).headers).toEqual(headers);
  });

  it("does nothing the second time", async () => {
    const id = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));
    await applyMigration();
    const after = await rowOf(id);

    expect(await applyMigration()).toEqual({ scrubbed: 0, settingsRemoved: 0 });

    expect(await rowOf(id)).toEqual(after);
  });
});

describe("a row with nothing left to remove", () => {
  it("keeps the custom header names the fixed code records", async () => {
    await WebhookManager.getInstance().processDelivery(
      webhookId,
      webhookEventId,
      "https://hooks.example/in",
      "hmac-secret",
      { Authorization: "Bearer SECRET-SENTINEL", "X-Api-Key": "SECRET" },
      serializePayload({
        id: "1",
        event: "user.created",
        timestamp: new Date("2026-11-05T00:00:00Z"),
        data: {},
      }),
    );
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM webhook_deliveries`,
    );
    const id = rows[0]!.id;
    const before = await rowOf(id);
    expect(before.headers).toMatchObject({
      Authorization: "[redacted]",
      "X-Api-Key": "[redacted]",
    });

    expect(await applyMigration()).toMatchObject({ scrubbed: 0 });

    expect(await rowOf(id)).toEqual(before);
  });

  it("would lose those names to 0012's statement, which is why this isn't a copy of it", async () => {
    const id = await seedDelivery(
      JSON.stringify({ ...SYSTEM_HEADERS, Authorization: "[redacted]" }),
    );

    expect(await headersAfterRunning(original, id)).toEqual(SYSTEM_HEADERS);
  });

  it("isn't rewritten after 0012 scrubbed it", async () => {
    const id = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));
    await pool.query(original);
    const before = await rowOf(id);

    expect(await applyMigration()).toMatchObject({ scrubbed: 0 });

    expect(await rowOf(id)).toEqual(before);
  });

  it.each<[string, string | null]>([
    ["SQL null", null],
    ["JSON null", "null"],
    ["an empty object", "{}"],
  ])("stays as %s", async (_label, headers) => {
    const id = await seedDelivery(headers);
    const before = await rowOf(id);

    expect(await applyMigration()).toMatchObject({ scrubbed: 0 });

    expect(await rowOf(id)).toEqual(before);
  });
});

describe("a value that isn't an object", () => {
  it.each<[string, string]>([
    [
      "a string holding encoded headers",
      JSON.stringify(JSON.stringify(FROM_BEFORE_THE_FIX)),
    ],
    ["an array", JSON.stringify(["Authorization: Bearer SECRET-SENTINEL"])],
    ["a number", "12345"],
    ["a boolean", "true"],
  ])("is emptied, for %s", async (_label, headers) => {
    const id = await seedDelivery(headers);

    expect(await applyMigration()).toMatchObject({ scrubbed: 1 });

    expect((await rowOf(id)).headers).toEqual({});
  });

  it("doesn't stop the rows around it from being scrubbed", async () => {
    const before = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));
    await seedDelivery(JSON.stringify("not an object"));
    await seedDelivery("[1, 2]");
    await seedDelivery(null);
    const after = await seedDelivery(JSON.stringify(FROM_BEFORE_THE_FIX));

    expect(await applyMigration()).toMatchObject({ scrubbed: 4 });

    expect((await rowOf(before)).headers).toEqual(SYSTEM_HEADERS);
    expect((await rowOf(after)).headers).toEqual(SYSTEM_HEADERS);
  });
});

describe("the removed logRetentionDays setting", () => {
  it("goes, and no other setting does", async () => {
    await db.insert(systemSettings).values([
      { key: "logRetentionDays", value: "30" },
      { key: "registrationEnabled", value: "true" },
    ]);

    expect(await applyMigration()).toMatchObject({ settingsRemoved: 1 });

    const rows = await db.select().from(systemSettings);
    expect(rows.map((row) => row.key)).toEqual(["registrationEnabled"]);
  });
});

it("is marked to run on legacy databases too", () => {
  // run-migrations.cjs stamps every migration on a database created by the old
  // push flow, and executes only the ones carrying this marker.
  expect(migration).toContain("-- cronium:custom-migration");
});
