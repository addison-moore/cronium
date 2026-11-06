/**
 * Webhook secrets, webhook headers and user variables saved before encryption at
 * rest stay plaintext until something encrypts them. These pin the pass that does
 * (`rotate:secrets --encrypt-legacy`): rows end up under the binding the read paths
 * use, the read paths give back what they gave before, and a run can be repeated,
 * interrupted or raced by the live app without losing anything.
 *
 * Real Postgres on purpose: the pass depends on row versions, jsonb round trips and
 * per-row commits, and the CLI tests kill a real process in the middle of a run.
 * Rows go in through raw SQL because every write path in the app encrypts now.
 */
import { spawn } from "node:child_process";
import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { credentialEncryption } from "@/lib/security/credential-encryption";
import {
  countLegacyRows,
  encryptLegacySecrets,
  legacySecretsBootWarning,
  LegacySecretsRefusedError,
  type LegacySurfaceResult,
} from "@/lib/security/legacy-secrets";
import { rotateAllSecrets } from "@/lib/security/secret-rotation";
import {
  __resetSecretVaultForTests,
  getSecretVault,
  isSecretEnvelope,
  type SecretBinding,
} from "@/lib/security/secret-vault";
import {
  decryptWebhookHeaders,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  encryptWebhookSecret,
  isLegacyWebhookHeaders,
} from "@/lib/webhooks/webhook-secret";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookRouter } from "@/lib/webhooks/WebhookRouter";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import { webhookDeliveries, webhooks } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// Deliveries go to a real HTTP server on loopback, which the SSRF guard would
// otherwise refuse. Everything after the guard is the real delivery path.
jest.mock("@/lib/ssrf-guard", () => ({
  ...jest.requireActual<object>("@/lib/ssrf-guard"),
  assertRequestUrlIsPublic: () => undefined,
  ssrfHttpAgent: undefined,
  ssrfHttpsAgent: undefined,
}));

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const OWNER = "legacy-owner";
const OTHER_USER = "other-user";
const SECRET = "legacy-hmac-secret-canary";
const TOKEN = "legacy-header-token-canary";
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "X-Tenant": "acme" };
const VARIABLE_VALUE = "legacy-variable-canary";

const KEY_A = "aa".repeat(32);
const KEY_B = "bb".repeat(32);
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

function useKeys(active: string | undefined, retired?: string[]) {
  if (active === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
  // This one only reads the key when it's imported, or when told to.
  if (active && active.length >= 32) {
    const quiet = [
      jest.spyOn(console, "log").mockImplementation(() => undefined),
      jest.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    credentialEncryption.initialize(active);
    quiet.forEach((spy) => spy.mockRestore());
  }
}

let keyCounter = 0;

async function seedWebhook(
  overrides: {
    key?: string;
    secret?: string;
    /** Stored as this JSON text, or SQL NULL for null. */
    headersJson?: string | null;
    url?: string;
    events?: string[];
  } = {},
): Promise<{ id: number; key: string }> {
  keyCounter += 1;
  const key = overrides.key ?? `legacy-webhook-key-${keyCounter}`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO webhooks (user_id, name, url, key, secret, events, headers, updated_at)
     VALUES ($1, 'legacy', $2, $3, $4, $5::jsonb, $6::jsonb, '2026-01-02T03:04:05Z')
     RETURNING id`,
    [
      OWNER,
      overrides.url ?? "https://receiver.example/hook",
      key,
      overrides.secret ?? SECRET,
      JSON.stringify(overrides.events ?? []),
      overrides.headersJson === undefined
        ? JSON.stringify(HEADERS)
        : overrides.headersJson,
    ],
  );
  return { id: rows[0]!.id, key };
}

async function seedVariable(
  overrides: { key?: string; value?: string } = {},
): Promise<{ id: number; key: string }> {
  keyCounter += 1;
  const key = overrides.key ?? `LEGACY_VAR_${keyCounter}`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO user_variables (user_id, key, value, updated_at)
     VALUES ($1, $2, $3, '2026-01-02T03:04:05Z') RETURNING id`,
    [OWNER, key, overrides.value ?? VARIABLE_VALUE],
  );
  return { id: rows[0]!.id, key };
}

/** A webhook as the app saves it today: one envelope the keyring can read. */
const seedAppWebhook = () =>
  WebhookManager.getInstance().registerWebhook(OWNER, {
    url: "https://receiver.example/new",
    events: [],
    headers: HEADERS,
    active: true,
  });

const OLD_VALUE = "old-secret-value-canary";

/**
 * AES-256-GCM the way `encryptionService` wrote it before the vault. Spelled out here
 * because nothing in the app writes this any more, and the format can't change.
 */
function oldCiphertext(keyHex: string, plaintext = OLD_VALUE): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  cipher.setAAD(Buffer.from("cronium-server-encryption"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64",
  );
}

/** A tool credential or OAuth token, encrypted under this key. */
function credentialCiphertext(keyHex: string): string {
  useKeys(keyHex);
  return JSON.stringify(credentialEncryption.encrypt(OLD_VALUE));
}

async function seedToolCredential(
  credentials: string,
  { encrypted = true, updatedAt = "2026-01-02T03:04:05Z" } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO tool_credentials (user_id, name, type, credentials, encrypted, updated_at)
     VALUES ($1, 'old tool', 'slack', $2, $3, $4) RETURNING id`,
    [OWNER, credentials, encrypted, updatedAt],
  );
  return rows[0]!.id;
}

async function seedOauthTokens(
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  const toolId = await seedToolCredential("{}", { encrypted: false });
  await pool.query(
    `INSERT INTO oauth_tokens (user_id, tool_id, provider_id, access_token, refresh_token)
     VALUES ($1, $2, 'slack', $3, $4)`,
    [OWNER, toolId, accessToken, refreshToken],
  );
}

async function seedEnvVar(value: string): Promise<void> {
  const eventId = await seedEvent(OWNER);
  await pool.query(
    `INSERT INTO env_vars (event_id, key, value) VALUES ($1, 'OLD_ENV', $2)`,
    [eventId, value],
  );
}

const seedSetting = (key: string, value: string) =>
  pool.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2)`, [
    key,
    value,
  ]);

const seedApiToken = (token: string) =>
  pool.query(
    `INSERT INTO api_tokens (user_id, name, token) VALUES ($1, 'old', $2)`,
    [OWNER, token],
  );

/** Everywhere an old database can hold something to check the key against. */
const OLD_CIPHERTEXT: [string, (keyHex: string) => Promise<unknown>][] = [
  [
    "tool_credentials.credentials",
    (key) => seedToolCredential(credentialCiphertext(key)),
  ],
  [
    "oauth_tokens.access_token",
    (key) => seedOauthTokens(credentialCiphertext(key), null),
  ],
  [
    "oauth_tokens.refresh_token",
    (key) => seedOauthTokens("plaintext-token", credentialCiphertext(key)),
  ],
  [
    "servers.ssh_key",
    (key) => seedServer(OWNER, { sshKey: oldCiphertext(key) }),
  ],
  [
    "servers.password",
    (key) => seedServer(OWNER, { password: oldCiphertext(key) }),
  ],
  ["env_vars.value", (key) => seedEnvVar(oldCiphertext(key))],
  [
    "users.mfa_secret",
    (key) =>
      pool.query(`UPDATE users SET mfa_secret = $1 WHERE id = $2`, [
        oldCiphertext(key),
        OWNER,
      ]),
  ],
  [
    "system_settings.value",
    (key) => seedSetting("smtpPassword", oldCiphertext(key)),
  ],
  ["api_tokens.token", (key) => seedApiToken(oldCiphertext(key))],
];

/** The vault's id for a key, which an envelope carries as its third part. */
const keyIdOf = (keyHex: string) => {
  useKeys(keyHex);
  return getSecretVault().keyIds()[0]!.keyId;
};

interface StoredWebhook {
  id: number;
  key: string;
  secret: string;
  headers: unknown;
  version: string;
  updated_at: Date;
}

async function storedWebhook(id: number): Promise<StoredWebhook> {
  const { rows } = await pool.query<StoredWebhook>(
    `SELECT id, key, secret, headers, xmin::text AS version, updated_at
     FROM webhooks WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

interface StoredVariable {
  id: number;
  key: string;
  value: string;
  version: string;
  updated_at: Date;
}

async function storedVariable(id: number): Promise<StoredVariable> {
  const { rows } = await pool.query<StoredVariable>(
    `SELECT id, key, value, xmin::text AS version, updated_at
     FROM user_variables WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

/** Row versions of both tables: equal only if no row was rewritten at all. */
async function allVersions(): Promise<string> {
  const { rows } = await pool.query<{ versions: string }>(
    `SELECT (SELECT string_agg(id || ':' || xmin::text, ',' ORDER BY id) FROM webhooks)
         || '/' ||
         (SELECT string_agg(id || ':' || xmin::text, ',' ORDER BY id) FROM user_variables)
       AS versions`,
  );
  return rows[0]!.versions;
}

const surface = (
  surfaces: LegacySurfaceResult[],
  name: LegacySurfaceResult["surface"],
) => surfaces.find((s) => s.surface === name)!;

/** A trigger standing in for something else touching the table during a run. */
async function addTrigger(
  table: "webhooks" | "user_variables",
  timing: "BEFORE" | "AFTER",
  body: string,
): Promise<void> {
  await pool.query(
    `CREATE FUNCTION legacy_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN ${body}; RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER legacy_test_trigger ${timing} UPDATE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION legacy_test_fn()`,
  );
}

async function dropTrigger(): Promise<void> {
  await pool.query(
    `DROP TRIGGER IF EXISTS legacy_test_trigger ON webhooks;
     DROP TRIGGER IF EXISTS legacy_test_trigger ON user_variables;
     DROP FUNCTION IF EXISTS legacy_test_fn;`,
  );
}

/** A sender signing the way the docs tell it to, with no help from app code. */
async function postInbound(
  key: string,
  secret: string,
  body = JSON.stringify({ event: "ping" }),
): Promise<number> {
  const timestamp = new Date().toISOString();
  const deliveryId = randomUUID();
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest("hex")}`;
  const response = await WebhookRouter.getInstance().handleRequest(
    key,
    new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-webhook-timestamp": timestamp,
        "x-webhook-delivery-id": deliveryId,
      },
      body,
    }),
  );
  return response.status;
}

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function startReceiver() {
  const received: ReceivedRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
    async next(count: number): Promise<ReceivedRequest> {
      const deadline = Date.now() + 15_000;
      while (received.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`Receiver got ${received.length} of ${count}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return received[count - 1]!;
    },
  };
}

function expectSignedWithLegacySecret(request: ReceivedRequest): void {
  expect(request.headers["x-webhook-signature"]).toBe(
    `sha256=${createHmac("sha256", SECRET).update(request.body).digest("hex")}`,
  );
}

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

/** The CLI in its own process. `node --import tsx` so a kill reaches the script
 * itself: the `tsx` binary is a wrapper that would leave it running. */
function spawnCli(args: string[]) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/scripts/rotate-secrets.ts", ...args],
    { cwd: APP_DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const finished = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    output: string;
  }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, finished };
}

const runCli = (...args: string[]) => spawnCli(args).finished;

beforeEach(async () => {
  await resetDatabase();
  await seedUser({ id: OWNER });
  await seedUser({ id: OTHER_USER });
});

afterEach(async () => {
  await dropTrigger();
  useKeys(ORIGINAL_KEY);
});

afterAll(async () => {
  await closePool();
});

describe("what ends up at rest", () => {
  it("encrypts a webhook's secret and headers under that webhook's binding", async () => {
    const { id, key } = await seedWebhook();

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "webhooks")).toEqual({
      surface: "webhooks",
      scanned: 1,
      encrypted: 1,
      upToDate: 0,
      changedDuringRun: 0,
      failed: 0,
    });
    expect(report.failures).toEqual([]);
    expect(report.remaining).toBe(0);

    const row = await storedWebhook(id);
    expect(row.secret.startsWith("crn.1.")).toBe(true);
    const headers = row.headers as { __enc: string };
    expect(Object.keys(headers)).toEqual(["__enc"]);
    expect(headers.__enc.startsWith("crn.1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    // Header names are encrypted too: they say what the credential is for.
    expect(JSON.stringify(row)).not.toContain("Authorization");

    // The bindings are spelled out here rather than taken from the helpers, because
    // they are the contract: a row written under anything else can't be read later.
    const secretBinding: SecretBinding = {
      purpose: "webhook-secret",
      table: "webhooks",
      column: "secret",
      recordId: key,
      tenantId: OWNER,
    };
    const headersBinding: SecretBinding = {
      purpose: "webhook-headers",
      table: "webhooks",
      column: "headers",
      recordId: key,
      tenantId: OWNER,
    };
    const vault = getSecretVault();
    expect(vault.decrypt(row.secret, secretBinding)).toBe(SECRET);
    expect(JSON.parse(vault.decrypt(headers.__enc, headersBinding))).toEqual(
      HEADERS,
    );

    for (const wrong of [
      { ...secretBinding, recordId: "another-webhook-key" },
      { ...secretBinding, tenantId: OTHER_USER },
      headersBinding,
    ]) {
      expect(() => vault.decrypt(row.secret, wrong)).toThrow();
    }
    expect(() => vault.decrypt(headers.__enc, secretBinding)).toThrow();
  });

  it("encrypts a user variable under its owner and key", async () => {
    const { id, key } = await seedVariable();

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "user_variables").encrypted).toBe(1);
    expect(report.remaining).toBe(0);

    const row = await storedVariable(id);
    expect(row.value.startsWith("crn.1.")).toBe(true);
    expect(row.value).not.toContain(VARIABLE_VALUE);

    const binding: SecretBinding = {
      purpose: "user-variable",
      table: "user_variables",
      column: "value",
      recordId: key,
      tenantId: OWNER,
    };
    const vault = getSecretVault();
    expect(vault.decrypt(row.value, binding)).toBe(VARIABLE_VALUE);
    expect(() =>
      vault.decrypt(row.value, { ...binding, recordId: "OTHER" }),
    ).toThrow();
    expect(() =>
      vault.decrypt(row.value, { ...binding, tenantId: OTHER_USER }),
    ).toThrow();
  });

  it("doesn't touch updated_at, which owners see, or anything else in the row", async () => {
    const webhook = await seedWebhook();
    const variable = await seedVariable();
    const webhookBefore = await storedWebhook(webhook.id);
    const variableBefore = await storedVariable(variable.id);

    await encryptLegacySecrets();

    expect((await storedWebhook(webhook.id)).updated_at).toEqual(
      webhookBefore.updated_at,
    );
    expect((await storedVariable(variable.id)).updated_at).toEqual(
      variableBefore.updated_at,
    );
    const { rows } = await pool.query(
      `SELECT name, url, key, events, active FROM webhooks WHERE id = $1`,
      [webhook.id],
    );
    expect(rows[0]).toEqual({
      name: "legacy",
      url: "https://receiver.example/hook",
      key: webhook.key,
      events: [],
      active: true,
    });
  });

  it.each([
    ["a header literally named __enc", { __enc: "not an envelope" }],
    ["a header value that isn't a string", { "X-Count": 5, "X-Flag": true }],
    ["non-ASCII headers", { "X-Note": "héllo 🔐", "X-Empty": "" }],
    [
      "a long value",
      { Authorization: `Bearer ${"x".repeat(200_000)}`, "X-Tenant": "acme" },
    ],
  ])("keeps %s reading the same", async (_name, headers) => {
    const { id, key } = await seedWebhook({
      headersJson: JSON.stringify(headers),
    });
    const readBefore = decryptWebhookHeaders(
      (await storedWebhook(id)).headers,
      key,
      OWNER,
    );
    expect(readBefore).toEqual(headers);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    const stored = (await storedWebhook(id)).headers as { __enc: string };
    expect(stored.__enc.startsWith("crn.1.")).toBe(true);
    expect(decryptWebhookHeaders(stored, key, OWNER)).toEqual(readBefore);
  });

  it("encrypts headers double-encoded as a JSON string, which reads as an object", async () => {
    const { id, key } = await seedWebhook({
      headersJson: JSON.stringify(JSON.stringify(HEADERS)),
    });
    // What every reader gets: Drizzle parses a jsonb string that holds JSON.
    const [read] = await WebhookManager.getInstance().listWebhooks(OWNER);
    expect(read!.headers).toEqual(HEADERS);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
    const row = await storedWebhook(id);
    expect(JSON.stringify(row.headers)).not.toContain(TOKEN);
    expect(decryptWebhookHeaders(row.headers, key, OWNER)).toEqual(HEADERS);
  });

  it("leaves a row with nothing to protect alone", async () => {
    const emptyHeaders = await seedWebhook({
      secret: "",
      headersJson: "{}",
    });
    const nullHeaders = await seedWebhook({ secret: "", headersJson: null });
    const jsonNull = await seedWebhook({ secret: "", headersJson: "null" });
    const emptyArray = await seedWebhook({ secret: "", headersJson: "[]" });
    const variable = await seedVariable({ value: "" });
    const before = await allVersions();

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "webhooks").upToDate).toBe(4);
    expect(surface(report.surfaces, "user_variables").upToDate).toBe(1);
    expect(report.totalEncrypted).toBe(0);
    expect(report.remaining).toBe(0);
    expect(await allVersions()).toBe(before);
    expect((await storedWebhook(emptyHeaders.id)).headers).toEqual({});
    expect((await storedWebhook(nullHeaders.id)).headers).toBeNull();
    expect((await storedWebhook(jsonNull.id)).headers).toBeNull();
    expect((await storedWebhook(emptyArray.id)).headers).toEqual([]);
    expect((await storedVariable(variable.id)).value).toBe("");
  });

  it("encrypts only the plaintext half of a row", async () => {
    const plaintextHeaders = await seedWebhook();
    await pool.query(`UPDATE webhooks SET secret = $1 WHERE id = $2`, [
      encryptWebhookSecret(SECRET, plaintextHeaders.key, OWNER),
      plaintextHeaders.id,
    ]);
    const secretBefore = (await storedWebhook(plaintextHeaders.id)).secret;

    const plaintextSecret = await seedWebhook();
    const encryptedHeaders = encryptWebhookHeaders(
      HEADERS,
      plaintextSecret.key,
      OWNER,
    );
    await pool.query(`UPDATE webhooks SET headers = $1::jsonb WHERE id = $2`, [
      JSON.stringify(encryptedHeaders),
      plaintextSecret.id,
    ]);

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "webhooks").encrypted).toBe(2);
    const first = await storedWebhook(plaintextHeaders.id);
    expect(first.secret).toBe(secretBefore);
    expect(JSON.stringify(first.headers)).not.toContain(TOKEN);
    const second = await storedWebhook(plaintextSecret.id);
    expect(second.headers).toEqual(encryptedHeaders);
    expect(second.secret.startsWith("crn.1.")).toBe(true);
    expect(
      decryptWebhookSecret(second.secret, plaintextSecret.key, OWNER),
    ).toBe(SECRET);
  });

  it("uses the active key when a rotation is under way", async () => {
    useKeys(KEY_B, [KEY_A]);
    const { id, key } = await seedWebhook();

    await encryptLegacySecrets();

    const row = await storedWebhook(id);
    expect(getSecretVault().needsReencryption(row.secret)).toBe(false);
    useKeys(KEY_B);
    expect(decryptWebhookSecret(row.secret, key, OWNER)).toBe(SECRET);
  });
});

describe("the read paths afterwards", () => {
  it("still verifies inbound signatures made with the same secret", async () => {
    const { key } = await seedWebhook();
    expect(await postInbound(key, SECRET)).toBe(200);
    expect(await postInbound(key, "the-wrong-secret")).toBe(401);

    await encryptLegacySecrets();

    expect(await postInbound(key, SECRET)).toBe(200);
    expect(await postInbound(key, "the-wrong-secret")).toBe(401);
  });

  it("still signs deliveries and sends custom headers, and records only their names", async () => {
    const receiver = await startReceiver();
    try {
      const { id } = await seedWebhook({
        url: receiver.url,
        events: ["order.created"],
      });
      const manager = WebhookManager.getInstance();
      const trigger = () =>
        manager.triggerEvent("order.created", { order: 1 }, OWNER);

      await trigger();
      const before = await receiver.next(1);
      expectSignedWithLegacySecret(before);
      expect(before.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(before.headers["x-tenant"]).toBe("acme");

      const report = await encryptLegacySecrets();
      expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);

      await trigger();
      const after = await receiver.next(2);
      expectSignedWithLegacySecret(after);
      expect(after.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(after.headers["x-tenant"]).toBe("acme");

      const deadline = Date.now() + 15_000;
      let recorded = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, id))
        .orderBy(desc(webhookDeliveries.id));
      while (recorded.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        recorded = await db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.webhookId, id))
          .orderBy(desc(webhookDeliveries.id));
      }
      expect(recorded.length).toBe(2);
      for (const delivery of recorded) {
        expect(delivery.headers).toMatchObject({
          Authorization: "[redacted]",
          "X-Tenant": "[redacted]",
        });
        expect(JSON.stringify(delivery)).not.toContain(TOKEN);
      }
    } finally {
      await receiver.close();
    }
  });

  it("still hands the same secret and headers to a retried delivery", async () => {
    const { id } = await seedWebhook({ events: ["order.created"] });
    const manager = WebhookManager.getInstance();
    const deliver = jest.spyOn(manager, "processDelivery").mockResolvedValue({
      id: "delivery",
      webhookId: id,
      success: true,
      duration: 0,
      retryCount: 0,
    });
    try {
      await manager.triggerEvent("order.created", { order: 1 }, OWNER);
      const deadline = Date.now() + 15_000;
      while (deliver.mock.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const webhookEventId = deliver.mock.calls[0]![1];
      await db.insert(webhookDeliveries).values({
        webhookId: id,
        webhookEventId,
        deliveryId: "made-before-the-upgrade",
        status: "failed",
        headers: {},
        duration: 0,
        attemptedAt: new Date(),
      });

      await encryptLegacySecrets();

      await manager.retryDelivery("made-before-the-upgrade");
      while (deliver.mock.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const [, , , secret, headers] = deliver.mock.calls[1]!;
      expect(secret).toBe(SECRET);
      expect(headers).toEqual(HEADERS);
    } finally {
      deliver.mockRestore();
    }
  });

  it("still returns variables, and they can still be edited and renamed", async () => {
    const { id, key } = await seedVariable();
    expect((await storage.getUserVariable(OWNER, key))?.value).toBe(
      VARIABLE_VALUE,
    );

    await encryptLegacySecrets();

    expect((await storage.getUserVariable(OWNER, key))?.value).toBe(
      VARIABLE_VALUE,
    );
    expect(
      (await storage.getUserVariables(OWNER)).map((row) => row.value),
    ).toEqual([VARIABLE_VALUE]);

    await storage.updateUserVariable(id, OWNER, { description: "edited" });
    expect((await storage.getUserVariable(OWNER, key))?.value).toBe(
      VARIABLE_VALUE,
    );

    await storage.updateUserVariable(id, OWNER, { key: "RENAMED" });
    expect((await storage.getUserVariable(OWNER, "RENAMED"))?.value).toBe(
      VARIABLE_VALUE,
    );
  });

  it("lets an upgraded webhook be edited, with or without its headers", async () => {
    const receiver = await startReceiver();
    try {
      const { id } = await seedWebhook({ events: ["order.created"] });
      await encryptLegacySecrets();

      const manager = WebhookManager.getInstance();
      await manager.updateWebhook(id, OWNER, { url: receiver.url });
      await manager.triggerEvent("order.created", {}, OWNER);
      const kept = await receiver.next(1);
      expect(kept.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expectSignedWithLegacySecret(kept);

      await manager.updateWebhook(id, OWNER, {
        headers: { Authorization: "Bearer replaced" },
      });
      await manager.triggerEvent("order.created", {}, OWNER);
      const replaced = await receiver.next(2);
      expect(replaced.headers.authorization).toBe("Bearer replaced");
      expect(replaced.headers["x-tenant"]).toBeUndefined();
    } finally {
      await receiver.close();
    }
  });
});

describe("running it again", () => {
  it("rewrites nothing on a second run", async () => {
    await seedWebhook();
    await seedVariable();
    await encryptLegacySecrets();
    const before = await allVersions();

    const report = await encryptLegacySecrets();

    expect(report.totalEncrypted).toBe(0);
    expect(report.remaining).toBe(0);
    expect(surface(report.surfaces, "webhooks").upToDate).toBe(1);
    expect(surface(report.surfaces, "user_variables").upToDate).toBe(1);
    expect(await allVersions()).toBe(before);
  });

  it("rewrites nothing the app encrypted itself", async () => {
    await seedAppWebhook();
    await storage.setUserVariable(OWNER, "NEW", "new-value");
    const before = await allVersions();

    const report = await encryptLegacySecrets();

    expect(report.totalEncrypted).toBe(0);
    expect(report.failures).toEqual([]);
    expect(await allVersions()).toBe(before);
  });

  it("writes each row once when two runs overlap", async () => {
    const webhooksSeeded = await Promise.all(
      Array.from({ length: 20 }, () => seedWebhook()),
    );

    const [first, second] = await Promise.all([
      encryptLegacySecrets(),
      encryptLegacySecrets(),
    ]);

    const written =
      surface(first.surfaces, "webhooks").encrypted +
      surface(second.surfaces, "webhooks").encrypted;
    expect(written).toBe(20);
    expect(first.remaining).toBe(0);
    expect(second.remaining).toBe(0);
    for (const { id, key } of webhooksSeeded) {
      const row = await storedWebhook(id);
      expect(decryptWebhookSecret(row.secret, key, OWNER)).toBe(SECRET);
      expect(decryptWebhookHeaders(row.headers, key, OWNER)).toEqual(HEADERS);
    }
  });

  it("writes nothing in a dry run, and says what a real run would do", async () => {
    await seedWebhook();
    await seedVariable();
    const before = await allVersions();

    const report = await encryptLegacySecrets({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.totalEncrypted).toBe(2);
    expect(report.remaining).toBe(2);
    expect(await allVersions()).toBe(before);
  });
});

describe("a row that fails", () => {
  // Something the keyring can read, so these reach the rows. See "the key" below
  // for a database where nothing is readable.
  beforeEach(async () => {
    await seedAppWebhook();
  });

  it.each([
    [
      "a plaintext secret that merely starts with crn.",
      { secret: "crn.looks-like-an-envelope" },
      "secret",
    ],
    [
      "an envelope that can't be decrypted",
      { secret: "crn.1.deadbeef.AAAA.BBBB.CCCC" },
      "secret",
    ],
    [
      "encrypted headers that can't be decrypted",
      {
        headersJson: JSON.stringify({ __enc: "crn.1.deadbeef.AAAA.BBBB.CCCC" }),
      },
      "headers",
    ],
    [
      "headers that are a JSON string",
      { headersJson: JSON.stringify(`Bearer ${TOKEN}`) },
      "headers",
    ],
    [
      "headers that are a JSON array",
      { headersJson: JSON.stringify([`Bearer ${TOKEN}`]) },
      "headers",
    ],
  ])(
    "leaves a webhook with %s exactly as it was",
    async (_name, row, column) => {
      const failing = await seedWebhook(row);
      const healthy = await seedWebhook();
      const before = await storedWebhook(failing.id);

      const report = await encryptLegacySecrets();

      expect(await storedWebhook(failing.id)).toEqual(before);
      expect(report.failures).toEqual([
        expect.objectContaining({
          surface: "webhooks",
          id: failing.id,
          column,
        }),
      ]);
      expect(surface(report.surfaces, "webhooks").failed).toBe(1);
      // The rest of the table still gets done.
      expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
      expect(
        decryptWebhookSecret(
          (await storedWebhook(healthy.id)).secret,
          healthy.key,
          OWNER,
        ),
      ).toBe(SECRET);
      expect(report.remaining).toBe(1);
    },
  );

  it("doesn't encrypt the readable half of a failing row", async () => {
    const { id } = await seedWebhook({
      headersJson: JSON.stringify({ __enc: "crn.1.deadbeef.AAAA.BBBB.CCCC" }),
    });

    await encryptLegacySecrets();

    expect((await storedWebhook(id)).secret).toBe(SECRET);
  });

  it("reports both columns when both fail", async () => {
    const { id } = await seedWebhook({
      secret: "crn.nope",
      headersJson: JSON.stringify({ __enc: "crn.nope" }),
    });

    const report = await encryptLegacySecrets();

    expect(report.failures.map((f) => [f.id, f.column])).toEqual([
      [id, "secret"],
      [id, "headers"],
    ]);
    expect(surface(report.surfaces, "webhooks").failed).toBe(1);
    expect(report.remaining).toBe(1);
  });

  it("fails an envelope copied from another webhook instead of re-encrypting it", async () => {
    const source = await seedWebhook();
    const copy = encryptWebhookSecret(SECRET, source.key, OWNER);
    const target = await seedWebhook({ secret: copy });

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      expect.objectContaining({ id: target.id, column: "secret" }),
    ]);
    expect((await storedWebhook(target.id)).secret).toBe(copy);
  });

  it("reports a variable whose plaintext starts with crn., and leaves it", async () => {
    const failing = await seedVariable({ value: "crn.config.yaml" });
    const healthy = await seedVariable();

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      expect.objectContaining({
        surface: "user_variables",
        id: failing.id,
        column: "value",
      }),
    ]);
    expect((await storedVariable(failing.id)).value).toBe("crn.config.yaml");
    expect((await storedVariable(healthy.id)).value.startsWith("crn.1.")).toBe(
      true,
    );
    expect(report.remaining).toBe(1);
  });

  it("reports a failed write, leaves the row, and finishes it on the next run", async () => {
    const failing = await seedWebhook();
    const healthy = await seedWebhook();
    const before = await storedWebhook(failing.id);
    await addTrigger(
      "webhooks",
      "BEFORE",
      `IF OLD.id = ${failing.id} THEN RAISE EXCEPTION 'refused %', OLD.secret; END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(await storedWebhook(failing.id)).toEqual(before);
    expect((await storedWebhook(healthy.id)).secret.startsWith("crn.1.")).toBe(
      true,
    );
    expect(report.failures).toEqual([
      {
        surface: "webhooks",
        id: failing.id,
        column: "secret+headers",
        reason: "database error P0001",
      },
    ]);
    expect(report.remaining).toBe(1);

    await dropTrigger();
    const retry = await encryptLegacySecrets();

    expect(surface(retry.surfaces, "webhooks").encrypted).toBe(1);
    expect(retry.remaining).toBe(0);
    expect(
      decryptWebhookSecret(
        (await storedWebhook(failing.id)).secret,
        failing.key,
        OWNER,
      ),
    ).toBe(SECRET);
  });

  it("never puts a stored value in a failure reason", async () => {
    // Shaped like an envelope, so the vault's own message would quote this part.
    await seedWebhook({
      secret: `crn.1.${SECRET}.AAAA.BBBB.CCCC`,
      headersJson: JSON.stringify({ __enc: `crn.2.${TOKEN}.A.B.C` }),
    });
    await seedVariable({ value: `crn.9.${VARIABLE_VALUE}.A.B.C` });

    const report = await encryptLegacySecrets();

    expect(report.failures).toHaveLength(3);
    const text = JSON.stringify(report);
    for (const canary of [SECRET, TOKEN, VARIABLE_VALUE]) {
      expect(text).not.toContain(canary);
    }
  });
});

describe("while the app keeps running", () => {
  it("doesn't overwrite a secret regenerated after the run read it", async () => {
    const first = await seedWebhook();
    const second = await seedWebhook();
    // Rows go in id order, so this lands between the read and the second row's write.
    const regenerated = encryptWebhookSecret("regenerated", second.key, OWNER);
    await addTrigger(
      "webhooks",
      "AFTER",
      `IF OLD.id = ${first.id} THEN
         UPDATE webhooks SET secret = '${regenerated}' WHERE id = ${second.id};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    const row = await storedWebhook(second.id);
    expect(row.secret).toBe(regenerated);
    // Its headers were plaintext and stay that way, so the run says one is left.
    expect(row.headers).toEqual(HEADERS);
    expect(surface(report.surfaces, "webhooks").changedDuringRun).toBe(1);
    expect(report.remaining).toBe(1);

    await dropTrigger();
    const retry = await encryptLegacySecrets();

    expect(retry.remaining).toBe(0);
    const finished = await storedWebhook(second.id);
    expect(finished.secret).toBe(regenerated);
    expect(decryptWebhookHeaders(finished.headers, second.key, OWNER)).toEqual(
      HEADERS,
    );
  });

  it("doesn't encrypt a variable under its old key if it was renamed mid-run", async () => {
    const first = await seedVariable();
    const second = await seedVariable({ key: "BEFORE_RENAME" });
    await addTrigger(
      "user_variables",
      "AFTER",
      `IF OLD.id = ${first.id} THEN
         UPDATE user_variables SET key = 'AFTER_RENAME' WHERE id = ${second.id};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "user_variables").changedDuringRun).toBe(1);
    expect((await storedVariable(second.id)).value).toBe(VARIABLE_VALUE);
    expect(report.remaining).toBe(1);

    await dropTrigger();
    await encryptLegacySecrets();

    expect((await storage.getUserVariable(OWNER, "AFTER_RENAME"))?.value).toBe(
      VARIABLE_VALUE,
    );
  });
});

describe("the key", () => {
  it("refuses to run with no key, before touching a row", async () => {
    const { id } = await seedWebhook();
    const before = await storedWebhook(id);
    useKeys(undefined);

    await expect(encryptLegacySecrets()).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );

    expect(await storedWebhook(id)).toEqual(before);
  });

  it("refuses to run with a malformed key, before touching a row", async () => {
    const { id } = await seedWebhook();
    const before = await storedWebhook(id);
    useKeys("not-hex");

    await expect(encryptLegacySecrets()).rejects.toThrow(/64 hex characters/);

    expect(await storedWebhook(id)).toEqual(before);
  });

  it("refuses a key that can read nothing already encrypted, and writes nothing", async () => {
    useKeys(KEY_A);
    await seedAppWebhook();
    await seedWebhook();
    const before = await allVersions();

    useKeys(KEY_B);

    await expect(encryptLegacySecrets()).rejects.toThrow(
      LegacySecretsRefusedError,
    );
    await expect(encryptLegacySecrets({ dryRun: true })).rejects.toThrow(
      LegacySecretsRefusedError,
    );
    expect(await allVersions()).toBe(before);

    // With the right key in place, the same run goes ahead.
    useKeys(KEY_A);
    const report = await encryptLegacySecrets();
    expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it("refuses when the only envelope in the database is unreadable, rather than guess", async () => {
    const { id } = await seedWebhook({
      secret: "crn.1.deadbeef.AAAA.BBBB.CCCC",
    });
    const plaintext = await seedWebhook();

    await expect(encryptLegacySecrets()).rejects.toThrow(
      LegacySecretsRefusedError,
    );

    expect((await storedWebhook(plaintext.id)).secret).toBe(SECRET);
    expect((await storedWebhook(id)).headers).toEqual(HEADERS);
  });

  it("doesn't quote what it found when it refuses", async () => {
    await seedWebhook({ secret: `crn.1.${SECRET}.AAAA.BBBB.CCCC` });

    const refused = await encryptLegacySecrets().catch((e: Error) => e.message);

    expect(refused).toContain("Nothing was changed");
    expect(refused).not.toContain(SECRET);
  });

  it("also looks at envelopes outside these two tables", async () => {
    useKeys(KEY_A);
    const { encryptMfaSecret } = await import("@/lib/security/field-secret");
    await pool.query(`UPDATE users SET mfa_secret = $1 WHERE id = $2`, [
      encryptMfaSecret("JBSWY3DP", OWNER),
      OWNER,
    ]);
    const { id } = await seedWebhook();
    useKeys(KEY_B);

    await expect(encryptLegacySecrets()).rejects.toThrow(
      LegacySecretsRefusedError,
    );
    expect((await storedWebhook(id)).secret).toBe(SECRET);
  });

  it("doesn't let one row under a lost key hold up the rest", async () => {
    useKeys(KEY_B);
    const lost = await seedWebhook({ key: "lost-key-row" });
    await pool.query(`UPDATE webhooks SET secret = $1 WHERE id = $2`, [
      encryptWebhookSecret(SECRET, lost.key, OWNER),
      lost.id,
    ]);
    useKeys(KEY_A);
    await seedAppWebhook();
    const plaintext = await seedWebhook();

    const report = await encryptLegacySecrets();

    expect(report.failures.map((f) => f.id)).toEqual([lost.id]);
    expect(
      (await storedWebhook(plaintext.id)).secret.startsWith("crn.1."),
    ).toBe(true);
  });
});

describe("the key, on a database with no envelopes", () => {
  describe.each(OLD_CIPHERTEXT)("holding only %s", (source, seed) => {
    it("refuses a key that can't read it, and writes nothing", async () => {
      await seed(KEY_A);
      await seedWebhook();
      await seedVariable();
      const before = await allVersions();
      useKeys(KEY_B);

      const refused = await encryptLegacySecrets().catch((e: Error) => e);

      expect(refused).toBeInstanceOf(LegacySecretsRefusedError);
      expect((refused as Error).message).toContain(`${source} (1)`);
      await expect(encryptLegacySecrets({ dryRun: true })).rejects.toThrow(
        LegacySecretsRefusedError,
      );
      expect(await allVersions()).toBe(before);
    });

    it("goes ahead with the key that wrote it", async () => {
      await seed(KEY_A);
      const { id } = await seedWebhook();
      await seedVariable();
      useKeys(KEY_A);

      const report = await encryptLegacySecrets();

      expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
      expect(surface(report.surfaces, "user_variables").encrypted).toBe(1);
      expect(report.remaining).toBe(0);
      const { secret } = await storedWebhook(id);
      expect(secret.split(".")[2]).toBe(keyIdOf(KEY_A));
    });

    it("goes ahead when that key is retired, encrypting under the active one", async () => {
      await seed(KEY_A);
      const { id } = await seedWebhook();
      useKeys(KEY_B, [KEY_A]);

      const report = await encryptLegacySecrets();

      expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
      expect(report.remaining).toBe(0);
      const { secret } = await storedWebhook(id);
      expect(secret.split(".")[2]).toBe(keyIdOf(KEY_B));
    });
  });

  it("doesn't take a value that merely comes back from a read as proof", async () => {
    // A read returns all of these under any key at all, so none says the key fits.
    await seedServer(OWNER);
    await seedEnvVar("short-plaintext");
    await seedToolCredential(JSON.stringify({ token: "plain" }), {
      encrypted: false,
    });
    await seedOauthTokens("plaintext-token", "plaintext-refresh");
    await seedApiToken("plaintext-api-token");
    await seedSetting("smtpPassword", "short-plaintext");
    // This one is the only real evidence, and it's against.
    await seedServer(OWNER, { password: oldCiphertext(KEY_A) });
    const { id } = await seedWebhook();
    useKeys(KEY_B);

    await expect(encryptLegacySecrets()).rejects.toThrow(
      LegacySecretsRefusedError,
    );
    expect((await storedWebhook(id)).secret).toBe(SECRET);
  });

  it("goes ahead when nothing is encrypted, because there's nothing to check", async () => {
    await seedServer(OWNER);
    await seedEnvVar("short-plaintext");
    await seedToolCredential(JSON.stringify({ token: "plain" }), {
      encrypted: false,
    });
    await seedOauthTokens("plaintext-token", "plaintext-refresh");
    const { id } = await seedWebhook();
    useKeys(KEY_B);

    const report = await encryptLegacySecrets();

    expect(surface(report.surfaces, "webhooks").encrypted).toBe(1);
    expect(report.remaining).toBe(0);
    expect((await storedWebhook(id)).secret.split(".")[2]).toBe(keyIdOf(KEY_B));
  });

  it("doesn't mistake what only resembles ciphertext for it", async () => {
    // A hashed API token and a setting the app stores in the clear have the shape,
    // and a credential row that says it isn't encrypted is read as plain JSON.
    await seedApiToken("ab".repeat(32));
    await seedSetting("someOtherSetting", "A".repeat(64));
    await seedToolCredential(credentialCiphertext(KEY_A), {
      encrypted: false,
    });
    const { id } = await seedWebhook();
    useKeys(KEY_B);

    await encryptLegacySecrets();

    expect((await storedWebhook(id)).secret.startsWith("crn.1.")).toBe(true);
  });

  it("refuses a long plaintext that looks like ciphertext, until the app saves something", async () => {
    await seedEnvVar("A".repeat(64));
    const { id } = await seedWebhook();
    useKeys(KEY_A);

    await expect(encryptLegacySecrets()).rejects.toThrow(
      /env_vars\.value \(1\)/,
    );
    expect((await storedWebhook(id)).secret).toBe(SECRET);

    // What the docs say to do. The app's key is now on record, so the next run can
    // check against it.
    await seedAppWebhook();
    const report = await encryptLegacySecrets();

    // The value itself stays, reported, because nothing can say which it is.
    expect(report.failures.map((f) => f.surface)).toEqual(["env_vars"]);
    expect((await storedWebhook(id)).secret.startsWith("crn.1.")).toBe(true);
  });

  it.each([
    [
      "a readable credential, with older ciphertext it can't read",
      () => seedToolCredential(credentialCiphertext(KEY_A)),
      () => seedServer(OWNER, { password: oldCiphertext(KEY_B) }),
    ],
    [
      "readable older ciphertext, with a credential it can't read",
      () => seedServer(OWNER, { password: oldCiphertext(KEY_A) }),
      () => seedToolCredential(credentialCiphertext(KEY_B)),
    ],
    [
      "readable older ciphertext, with an envelope it can't read",
      () => seedServer(OWNER, { password: oldCiphertext(KEY_A) }),
      () => seedWebhook({ secret: "crn.1.deadbeef.AAAA.BBBB.CCCC" }),
    ],
  ])("goes ahead on one value that fits: %s", async (_name, fits, doesNot) => {
    await doesNot();
    await fits();
    const { id } = await seedWebhook();
    useKeys(KEY_A);

    await encryptLegacySecrets();

    expect((await storedWebhook(id)).secret.startsWith("crn.1.")).toBe(true);
  });

  it("checks the newest credentials, so a run of old ones under a lost key doesn't refuse", async () => {
    const lost = credentialCiphertext(KEY_B);
    for (let i = 0; i < 12; i++) await seedToolCredential(lost);
    await seedToolCredential(credentialCiphertext(KEY_A), {
      updatedAt: "2026-06-01T00:00:00Z",
    });
    const { id } = await seedWebhook();
    useKeys(KEY_A);

    await encryptLegacySecrets();

    expect((await storedWebhook(id)).secret.startsWith("crn.1.")).toBe(true);
  });

  it("counts by column when it refuses, and quotes nothing", async () => {
    const credential = credentialCiphertext(KEY_A);
    const ciphertext = oldCiphertext(KEY_A);
    await seedToolCredential(credential);
    await seedServer(OWNER, {
      sshKey: ciphertext,
      password: oldCiphertext(KEY_A),
    });
    await seedEnvVar(oldCiphertext(KEY_A));
    await seedWebhook({ secret: `crn.1.${SECRET}.AAAA.BBBB.CCCC` });
    useKeys(KEY_B);

    const refused = await encryptLegacySecrets().catch((e: Error) => e.message);

    expect(refused).toContain("webhooks.secret (1)");
    expect(refused).toContain("tool_credentials.credentials (1)");
    expect(refused).toContain("servers.ssh_key (1)");
    expect(refused).toContain("servers.password (1)");
    expect(refused).toContain("env_vars.value (1)");
    expect(refused).toContain("Nothing was changed");
    for (const value of [
      SECRET,
      OLD_VALUE,
      ciphertext,
      (JSON.parse(credential) as { encrypted: string }).encrypted,
      KEY_A,
      KEY_B,
    ]) {
      expect(refused).not.toContain(value);
    }
  });
});

describe("alongside key rotation", () => {
  it("counts plaintext headers as legacy and leaves them, instead of skipping them unseen", async () => {
    const { id } = await seedWebhook();
    await seedVariable();

    const report = await rotateAllSecrets();

    const webhooks = report.surfaces.find(
      (s) => s.surface === "webhooks.secret/headers",
    )!;
    expect(webhooks.scanned).toBe(2);
    expect(webhooks.legacy).toBe(2);
    expect(report.plaintextLegacy).toBe(3);
    expect((await storedWebhook(id)).secret).toBe(SECRET);
    expect((await storedWebhook(id)).headers).toEqual(HEADERS);
  });

  it("counts nothing as legacy once they're encrypted, and rotates them to a new key", async () => {
    useKeys(KEY_A);
    const webhook = await seedWebhook();
    const variable = await seedVariable();
    await encryptLegacySecrets();

    const check = await rotateAllSecrets({ dryRun: true });
    expect(check.plaintextLegacy).toBe(0);
    expect(check.totalReencrypted).toBe(0);

    useKeys(KEY_B, [KEY_A]);
    const rotated = await rotateAllSecrets();
    expect(rotated.totalErrors).toBe(0);
    // The webhook's secret and headers, and the variable.
    expect(rotated.totalReencrypted).toBe(3);

    // The old key is gone now, so a read proves all three moved.
    useKeys(KEY_B);
    const row = await storedWebhook(webhook.id);
    expect(decryptWebhookSecret(row.secret, webhook.key, OWNER)).toBe(SECRET);
    expect(decryptWebhookHeaders(row.headers, webhook.key, OWNER)).toEqual(
      HEADERS,
    );
    expect((await storage.getUserVariable(OWNER, variable.key))?.value).toBe(
      VARIABLE_VALUE,
    );
  });
});

describe("the worker's boot warning", () => {
  it("says how many rows are left, and writes nothing", async () => {
    await seedWebhook();
    await seedVariable();
    const before = await allVersions();

    const warning = await legacySecretsBootWarning();

    expect(warning).toContain("2 row(s)");
    expect(warning).toContain("--encrypt-legacy");
    expect(await allVersions()).toBe(before);
  });

  it("says nothing once there's nothing to do", async () => {
    await seedWebhook();
    await encryptLegacySecrets();

    expect(await legacySecretsBootWarning()).toBeNull();
  });

  it("needs no usable key, and decrypts nothing", async () => {
    useKeys(KEY_A);
    await seedAppWebhook();
    await seedWebhook();
    const decrypt = jest.spyOn(credentialEncryption, "decrypt");

    useKeys(KEY_B); // a run would refuse this one
    expect(await legacySecretsBootWarning()).toContain("1 row(s)");
    useKeys(undefined); // and any decryption would throw on this
    expect(await legacySecretsBootWarning()).toContain("1 row(s)");

    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRestore();
  });

  it("doesn't call a row plaintext if encrypting it wouldn't help, though a run still reports it", async () => {
    await seedAppWebhook();
    const envelope = await seedWebhook({
      secret: "crn.1.deadbeef.AAAA.BBBB.CCCC",
      headersJson: null,
    });
    const array = await seedWebhook({ secret: "", headersJson: '["x"]' });
    const variable = await seedVariable({ value: "crn.nope" });

    expect(await legacySecretsBootWarning()).toBeNull();

    const { failures, remaining } = await encryptLegacySecrets({
      dryRun: true,
    });
    expect(remaining).toBe(3);
    expect(failures.map((f) => [f.surface, f.id])).toEqual([
      ["webhooks", envelope.id],
      ["webhooks", array.id],
      ["user_variables", variable.id],
    ]);
  });

  it("counts plaintext sitting next to a value that fails, and a run names that row", async () => {
    await seedAppWebhook();
    const { id } = await seedWebhook({ headersJson: '["x"]' });

    expect(await countLegacyRows()).toBe(1);

    const { failures } = await encryptLegacySecrets();
    expect(failures.map((f) => f.id)).toEqual([id]);
    expect((await storedWebhook(id)).secret).toBe(SECRET);
    expect(await countLegacyRows()).toBe(1);
  });

  it("counts a row once, whichever of its columns hold plaintext", async () => {
    await seedWebhook();
    await seedWebhook({ headersJson: JSON.stringify(JSON.stringify(HEADERS)) });
    await seedWebhook({ headersJson: null });
    await seedWebhook({ secret: "" });
    await seedWebhook({
      secret: "",
      headersJson: JSON.stringify(JSON.stringify(HEADERS)),
    });

    expect(await countLegacyRows()).toBe(5);
  });

  it("agrees with what a dry run would encrypt, and with a real run", async () => {
    await seedAppWebhook();
    await seedWebhook();
    await seedWebhook({ headersJson: null });
    await seedWebhook({ secret: "" });
    await seedWebhook({ headersJson: JSON.stringify(JSON.stringify(HEADERS)) });
    await seedWebhook({ secret: "", headersJson: "{}" });
    await seedVariable();
    await seedVariable({ value: "" });

    const dryRun = await encryptLegacySecrets({ dryRun: true });
    expect(dryRun.failures).toEqual([]);
    expect(dryRun.totalEncrypted).toBe(5);
    expect(await countLegacyRows()).toBe(5);

    const realRun = await encryptLegacySecrets();
    expect(realRun.totalEncrypted).toBe(5);
    expect(await countLegacyRows()).toBe(0);
  });

  // Each row says what a run would read for that stored JSON, and so whether the
  // count has to include it. Rows go through the same Drizzle mapping a run uses,
  // which is what turns a JSON string holding an object into an object.
  it.each<[string, string | null, boolean]>([
    ["a plain object", '{"Authorization":"Bearer x"}', true],
    ["SQL NULL", null, false],
    ["JSON null", "null", false],
    ["an empty object", "{}", false],
    ["an encrypted wrapper", '{"__enc":"crn.1.a.b.c.d"}', false],
    ["an encrypted wrapper with more keys", '{"__enc":"crn.x","Y":"z"}', false],
    ["a wrapper that isn't encrypted", '{"__enc":"plain"}', true],
    ["a wrapper holding a number", '{"__enc":5}', true],
    ["a wrapper holding null", '{"__enc":null}', true],
    ["an empty array", "[]", false],
    ["an array", '["Authorization: Bearer x"]', false],
    ["a string", '"Bearer x"', false],
    ["a number", "5", false],
    ["zero", "0", false],
    ["true", "true", false],
    ["false", "false", false],
    ["an object in a string", JSON.stringify('{"A":"b"}'), true],
    ["a wrapper in a string", JSON.stringify('{"__enc":"crn.1.a"}'), false],
    ["a plain wrapper in a string", JSON.stringify('{"__enc":"x"}'), true],
    ["an empty object in a string", JSON.stringify("{}"), false],
    ["an array in a string", JSON.stringify('["x"]'), false],
    ["null in a string", JSON.stringify("null"), false],
    ["a number in a string", JSON.stringify("5"), false],
    ["a string in a string", JSON.stringify('"x"'), false],
    ["broken JSON in a string", JSON.stringify('{"A":'), false],
  ])(
    "counts headers stored as %s the way a run reads them",
    async (_name, json, plaintext) => {
      await seedWebhook({ secret: "", headersJson: json });

      const [row] = await db
        .select({ headers: webhooks.headers })
        .from(webhooks);

      expect(isLegacyWebhookHeaders(row!.headers)).toBe(plaintext);
      expect(await countLegacyRows()).toBe(plaintext ? 1 : 0);
    },
  );

  describe.each<[string, boolean]>([
    ["plaintext", true],
    ["", false],
    ["crn.", false],
    ["crn.1.a.b.c.d", false],
    ["crn.nope", false],
    ["crn", true],
    ["crnx1", true],
    ["CRN.1.a.b.c.d", true],
    [" crn.1.a.b.c.d", true],
    ["xcrn.1.a", true],
    ["%", true],
    ["_", true],
    ["line one\ncrn.1.a", true],
  ])("given the value %j", (value, plaintext) => {
    beforeEach(() => {
      expect(!!value && !isSecretEnvelope(value)).toBe(plaintext);
    });

    it("counts a webhook secret the way a run reads it", async () => {
      await seedWebhook({ secret: value, headersJson: null });

      expect(await countLegacyRows()).toBe(plaintext ? 1 : 0);
    });

    it("counts a variable the way a run reads it", async () => {
      await seedVariable({ value });

      expect(await countLegacyRows()).toBe(plaintext ? 1 : 0);
    });
  });
});

describe("the CLI", () => {
  const CANARIES = [SECRET, TOKEN, VARIABLE_VALUE];

  it("reports without writing in a dry run", async () => {
    await seedWebhook();
    await seedVariable();
    const before = await allVersions();

    const { code, output } = await runCli("--encrypt-legacy", "--dry-run");

    expect(code).toBe(0);
    expect(output).toContain("webhooks: scanned=1 to-encrypt=1");
    expect(output).toContain("user_variables: scanned=1 to-encrypt=1");
    expect(output).toContain("Legacy rows remaining: 2");
    expect(await allVersions()).toBe(before);
    for (const canary of CANARIES) expect(output).not.toContain(canary);
  });

  it("encrypts, says none remain, and exits 0", async () => {
    const webhook = await seedWebhook();
    const variable = await seedVariable();

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(0);
    expect(output).toContain("webhooks: scanned=1 encrypted=1");
    expect(output).toContain("user_variables: scanned=1 encrypted=1");
    expect(output).toContain("Legacy rows remaining: 0");
    expect(output).toContain("VACUUM FULL");
    for (const canary of CANARIES) expect(output).not.toContain(canary);

    const row = await storedWebhook(webhook.id);
    expect(decryptWebhookSecret(row.secret, webhook.key, OWNER)).toBe(SECRET);
    expect((await storage.getUserVariable(OWNER, variable.key))?.value).toBe(
      VARIABLE_VALUE,
    );

    const again = await runCli("--encrypt-legacy");
    expect(again.code).toBe(0);
    expect(again.output).toContain("encrypted=0");
    expect(again.output).toContain("Legacy rows remaining: 0");
    expect(again.output).not.toContain("VACUUM FULL");
  });

  it("names a failed row, without its value, and exits 1", async () => {
    await seedAppWebhook();
    const failing = await seedWebhook({
      secret: `crn.1.${SECRET}.AAAA.BBBB.CCCC`,
    });
    await seedVariable();

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(1);
    expect(output).toContain(
      `FAILED, left unchanged: webhooks id=${failing.id} column=secret`,
    );
    expect(output).toContain("Legacy rows remaining: 1");
    for (const canary of CANARIES) expect(output).not.toContain(canary);
  });

  it("exits 1 on a failed row in a dry run too", async () => {
    await seedWebhook({ secret: "crn.nope" });

    const { code } = await runCli("--encrypt-legacy", "--dry-run");

    expect(code).toBe(1);
  });

  it("says why it refused a key, and exits 1", async () => {
    useKeys(KEY_A);
    await seedAppWebhook();
    const plaintext = await seedWebhook();
    useKeys(KEY_B);

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(1);
    expect(output).toContain("Nothing was changed");
    expect((await storedWebhook(plaintext.id)).secret).toBe(SECRET);
  });

  it("stops on an old database under the wrong key, then runs under the right one", async () => {
    const ciphertext = oldCiphertext(KEY_A);
    const credential = credentialCiphertext(KEY_A);
    await seedServer(OWNER, { password: ciphertext });
    await seedToolCredential(credential);
    const webhook = await seedWebhook();
    await seedVariable();
    const before = await allVersions();
    useKeys(KEY_B);

    const wrong = await runCli("--encrypt-legacy");

    expect(wrong.code).toBe(1);
    expect(wrong.output).toContain("Nothing was changed");
    expect(wrong.output).toContain("servers.password (1)");
    expect(wrong.output).toContain("tool_credentials.credentials (1)");
    expect(wrong.output).not.toContain("Legacy rows remaining");
    for (const value of [
      ...CANARIES,
      ciphertext,
      (JSON.parse(credential) as { encrypted: string }).encrypted,
      KEY_A,
      KEY_B,
    ]) {
      expect(wrong.output).not.toContain(value);
    }
    expect(await allVersions()).toBe(before);

    useKeys(KEY_A);
    const right = await runCli("--encrypt-legacy");

    expect(right.code).toBe(0);
    expect(right.output).toContain("Legacy rows remaining: 0");
    const row = await storedWebhook(webhook.id);
    expect(decryptWebhookSecret(row.secret, webhook.key, OWNER)).toBe(SECRET);
  });

  it("refuses an unknown argument rather than running without it", async () => {
    const { id } = await seedWebhook();
    const before = await storedWebhook(id);

    const typo = await runCli("--encrypt-legacy", "--dry-rn");

    expect(typo.code).toBe(2);
    expect(typo.output).toContain("Unknown argument: --dry-rn");
    expect(await storedWebhook(id)).toEqual(before);
  });

  it("still rotates with no flag, and points at --encrypt-legacy", async () => {
    const { id } = await seedWebhook();

    const { code, output } = await runCli();

    expect(code).toBe(0);
    expect(output).toContain("webhooks.secret/headers: scanned=2");
    expect(output).toContain("--encrypt-legacy");
    expect(output).not.toContain("ORPHAN");
    expect((await storedWebhook(id)).secret).toBe(SECRET);
  });

  it("picks up where a killed run stopped", async () => {
    const seeded = await Promise.all(
      Array.from({ length: 40 }, () => seedWebhook()),
    );
    const variable = await seedVariable();
    await addTrigger("webhooks", "BEFORE", "PERFORM pg_sleep(0.05)");

    const countEncrypted = async () => {
      const { rows } = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM webhooks WHERE secret LIKE 'crn.%'`,
      );
      return rows[0]!.count;
    };

    const { child, finished } = spawnCli(["--encrypt-legacy"]);
    const deadline = Date.now() + 60_000;
    while ((await countEncrypted()) < 5) {
      if (Date.now() > deadline) throw new Error("The run never got going");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    child.kill("SIGKILL");
    const { signal } = await finished;
    expect(signal).toBe("SIGKILL");

    // The killed client's last UPDATE may still be finishing on the server.
    for (;;) {
      const { rows } = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE query LIKE 'update "webhooks"%' AND state = 'active'`,
      );
      if (rows[0]!.count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await dropTrigger();

    const encryptedSoFar = await pool.query<{ id: number; secret: string }>(
      `SELECT id, secret FROM webhooks WHERE secret LIKE 'crn.%'`,
    );
    const stopped = encryptedSoFar.rows.length;
    expect(stopped).toBeGreaterThanOrEqual(5);
    expect(stopped).toBeLessThan(seeded.length);

    // Every row is either fully done or untouched, and the app can read all of them.
    for (const { id, key } of seeded) {
      const row = await storedWebhook(id);
      expect(decryptWebhookSecret(row.secret, key, OWNER)).toBe(SECRET);
      expect(decryptWebhookHeaders(row.headers, key, OWNER)).toEqual(HEADERS);
      expect(row.secret.startsWith("crn.")).toBe(
        "__enc" in (row.headers as object),
      );
    }

    const resumed = await runCli("--encrypt-legacy");

    expect(resumed.code).toBe(0);
    expect(resumed.output).toContain(
      `webhooks: scanned=40 encrypted=${40 - stopped} up-to-date=${stopped}`,
    );
    expect(resumed.output).toContain("Legacy rows remaining: 0");
    // What the first run finished was not written again.
    for (const { id, secret } of encryptedSoFar.rows) {
      expect((await storedWebhook(id)).secret).toBe(secret);
    }
    for (const { id, key } of seeded) {
      const row = await storedWebhook(id);
      expect(row.secret.startsWith("crn.1.")).toBe(true);
      expect(decryptWebhookSecret(row.secret, key, OWNER)).toBe(SECRET);
      expect(decryptWebhookHeaders(row.headers, key, OWNER)).toEqual(HEADERS);
    }
    expect((await storage.getUserVariable(OWNER, variable.key))?.value).toBe(
      VARIABLE_VALUE,
    );
  });
});
