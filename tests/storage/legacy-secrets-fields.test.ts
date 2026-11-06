/**
 * `rotate:secrets --encrypt-legacy` on the columns that can hold more than plaintext:
 * server credentials, env vars, MFA secrets and sensitive settings can hold static-AAD
 * ciphertext from before the vault, and tool credentials and OAuth tokens have their own
 * format. tests/storage/legacy-secrets.test.ts covers webhooks and user variables, and
 * the guarantees they share.
 *
 * What's different here is that a read guesses by a value's shape. So these pin that
 * the pass goes by what authenticates: a value ends up holding what's really in it,
 * bound to its row, and one it can't be sure of is reported and left alone.
 *
 * Real Postgres on purpose, as there. Rows go in through raw SQL because every write
 * path in the app encrypts now.
 */
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { getSmtpSettings } from "@/lib/email";
import { encryptionService } from "@/lib/encryption-service";
import { TokenManager } from "@/lib/oauth/TokenManager";
import {
  credentialEncryption,
  parseEncryptedData,
} from "@/lib/security/credential-encryption";
import {
  decryptEnvVarValue,
  encryptEnvVarValue,
  encryptServerSecret,
} from "@/lib/security/field-secret";
import {
  countLegacyRows,
  encryptLegacySecrets,
  legacySecretsBootWarning,
  type LegacySurfaceResult,
} from "@/lib/security/legacy-secrets";
import { rotateAllSecrets } from "@/lib/security/secret-rotation";
import {
  __resetSecretVaultForTests,
  getSecretVault,
  isSecretEnvelope,
  type SecretBinding,
} from "@/lib/security/secret-vault";
import { generateTotp, verifyTotp } from "@/lib/security/totp";
import { pool } from "@/server/db";
import { toEventApiDto } from "@/server/security/api-dto";
import { storage } from "@/server/storage";
import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const OWNER = "fields-owner";
const OLD_KEY = randomBytes(32).toString("hex");
const NEW_KEY = randomBytes(32).toString("hex");
const LOST_KEY = randomBytes(32).toString("hex");
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

const SSH_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nssh-key-canary\n-----END";
const PASSWORD = "server-password-canary";
const ENV_VALUE = "env-value-canary";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SMTP_PASSWORD = "smtp-password-canary";
const ACCESS_TOKEN = "access-token-canary";
const REFRESH_TOKEN = "refresh-token-canary";
const CREDENTIALS = { apiKey: "tool-api-key-canary", region: "eu" };
const CANARIES = [
  SSH_KEY,
  "ssh-key-canary",
  PASSWORD,
  ENV_VALUE,
  TOTP_SECRET,
  SMTP_PASSWORD,
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  CREDENTIALS.apiKey,
];

/** What a restart does to a service: only the keys it was given, nothing cached. */
function useKeys(active: string, retired?: string[]) {
  process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
  const quiet = [
    jest.spyOn(console, "log").mockImplementation(() => undefined),
    jest.spyOn(console, "warn").mockImplementation(() => undefined),
  ];
  credentialEncryption.initialize(active);
  quiet.forEach((spy) => spy.mockRestore());
}

/**
 * AES-256-GCM the way `encryptionService` wrote it before the vault. Spelled out here
 * because nothing in the app writes this any more, and the format can't change.
 */
function oldCiphertext(keyHex: string, plaintext: string): string {
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

const old = (plaintext: string) => oldCiphertext(OLD_KEY, plaintext);

const encryptedCredential = (value: unknown) =>
  JSON.stringify(credentialEncryption.encrypt(value));

async function one<T extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const { rows } = await pool.query<T>(sql, params);
  return rows[0]!;
}

const insertId = async (sql: string, params: unknown[]) =>
  (await one<{ id: number }>(sql, params)).id;

/** A row as an old instance left it, with a timestamp a write would change. */
const seedOldServer = (sshKey: string | null, password: string | null) =>
  seedServer(OWNER, {
    sshKey,
    password,
    updatedAt: new Date("2026-01-02T03:04:05Z"),
  });

async function seedEnvVar(
  value: string,
  key = "OLD_ENV",
  eventId?: number,
): Promise<{ id: number; eventId: number; key: string }> {
  const event = eventId ?? (await seedEvent(OWNER));
  const id = await insertId(
    `INSERT INTO env_vars (event_id, key, value, updated_at)
     VALUES ($1, $2, $3, '2026-01-02T03:04:05Z') RETURNING id`,
    [event, key, value],
  );
  return { id, eventId: event, key };
}

const storedEnvVar = (id: number) =>
  one<{ value: string; version: string; updated_at: Date }>(
    `SELECT value, xmin::text AS version, updated_at FROM env_vars WHERE id = $1`,
    [id],
  );

const storedServer = (id: number) =>
  one<{
    ssh_key: string | null;
    password: string | null;
    name: string;
    version: string;
    updated_at: Date;
  }>(
    `SELECT ssh_key, password, name, xmin::text AS version, updated_at FROM servers WHERE id = $1`,
    [id],
  );

async function setMfa(userId: string, stored: string | null): Promise<void> {
  await pool.query(
    `UPDATE users SET mfa_secret = $1, mfa_enabled = true, updated_at = '2026-01-02T03:04:05Z' WHERE id = $2`,
    [stored, userId],
  );
}

const storedMfa = (userId: string) =>
  one<{ mfa_secret: string | null; version: string; updated_at: Date }>(
    `SELECT mfa_secret, xmin::text AS version, updated_at FROM users WHERE id = $1`,
    [userId],
  );

const seedSetting = (key: string, value: string) =>
  insertId(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, '2026-01-02T03:04:05Z') RETURNING id`,
    [key, value],
  );

const storedSetting = (id: number) =>
  one<{ value: string; version: string; updated_at: Date }>(
    `SELECT value, xmin::text AS version, updated_at FROM system_settings WHERE id = $1`,
    [id],
  );

let toolCounter = 0;
function seedTool(credentials: string, encrypted: boolean): Promise<number> {
  toolCounter += 1;
  return insertId(
    `INSERT INTO tool_credentials (user_id, name, type, credentials, encrypted, updated_at)
     VALUES ($1, $2, 'SLACK', $3, $4, '2026-01-02T03:04:05Z') RETURNING id`,
    [OWNER, `tool-${toolCounter}`, credentials, encrypted],
  );
}

const storedTool = (id: number) =>
  one<{
    credentials: string;
    encrypted: boolean;
    encryption_metadata: { algorithm: string } | null;
    version: string;
    updated_at: Date;
  }>(
    `SELECT credentials, encrypted, encryption_metadata, xmin::text AS version, updated_at
     FROM tool_credentials WHERE id = $1`,
    [id],
  );

async function seedTokens(
  accessToken: string,
  refreshToken: string | null,
): Promise<{ id: number; toolId: number }> {
  const toolId = await seedTool("{}", false);
  const id = await insertId(
    `INSERT INTO oauth_tokens (user_id, tool_id, provider_id, access_token, refresh_token, updated_at)
     VALUES ($1, $2, 'slack', $3, $4, '2026-01-02T03:04:05Z') RETURNING id`,
    [OWNER, toolId, accessToken, refreshToken],
  );
  return { id, toolId };
}

const storedTokens = (id: number) =>
  one<{
    access_token: string;
    refresh_token: string | null;
    version: string;
    updated_at: Date;
  }>(
    `SELECT access_token, refresh_token, xmin::text AS version, updated_at
     FROM oauth_tokens WHERE id = $1`,
    [id],
  );

const readTokens = (toolId: number) =>
  new TokenManager({ id: "slack" } as never).getTokens(OWNER, toolId);

/**
 * What the read paths do with a tool row: they go by its flag. `tools.ts`,
 * `slack-routes.ts` and `tool-action-executor.ts` each have their own copy of this.
 */
function readTool(row: { credentials: string; encrypted: boolean }): unknown {
  return row.encrypted
    ? credentialEncryption.decrypt(JSON.parse(row.credentials) as never)
    : JSON.parse(row.credentials);
}

const surface = (
  report: { surfaces: LegacySurfaceResult[] },
  name: LegacySurfaceResult["surface"],
) => report.surfaces.find((s) => s.surface === name)!;

/** The vault's own view of a value, with the binding written out in full. */
function decryptedWith(stored: string, binding: SecretBinding): string {
  expect(stored.startsWith("crn.1.")).toBe(true);
  return getSecretVault().decrypt(stored, binding);
}

const serverBinding = (
  column: "sshKey" | "password",
  userId = OWNER,
): SecretBinding => ({
  purpose: "server-secret",
  table: "servers",
  column,
  recordId: userId,
  tenantId: userId,
});

const envBinding = (eventId: number, key: string): SecretBinding => ({
  purpose: "env-var",
  table: "env_vars",
  column: "value",
  recordId: key,
  tenantId: String(eventId),
});

const mfaBinding = (userId: string): SecretBinding => ({
  purpose: "mfa-secret",
  table: "users",
  column: "mfaSecret",
  recordId: userId,
  tenantId: userId,
});

const settingBinding = (key: string): SecretBinding => ({
  purpose: "system-setting",
  table: "system_settings",
  column: "value",
  recordId: key,
  tenantId: "system",
});

const TABLES = [
  "servers",
  "env_vars",
  "users",
  "system_settings",
  "tool_credentials",
  "oauth_tokens",
];

/** Row versions of every table here: equal only if no row was rewritten at all. */
async function allVersions(): Promise<string> {
  const parts: string[] = [];
  for (const table of TABLES) {
    const { versions } = await one<{ versions: string | null }>(
      `SELECT string_agg(id::text || ':' || xmin::text, ',' ORDER BY id) AS versions FROM ${table}`,
    );
    parts.push(`${table}=${versions}`);
  }
  return parts.join(" ");
}

/** A trigger standing in for something else touching the table during a run. */
async function addTrigger(
  table: string,
  timing: "BEFORE" | "AFTER",
  body: string,
): Promise<void> {
  await pool.query(
    `CREATE FUNCTION fields_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN ${body}; RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER fields_test_trigger ${timing} UPDATE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION fields_test_fn()`,
  );
}

async function dropTrigger(): Promise<void> {
  for (const table of TABLES) {
    await pool.query(`DROP TRIGGER IF EXISTS fields_test_trigger ON ${table}`);
  }
  await pool.query(`DROP FUNCTION IF EXISTS fields_test_fn`);
}

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

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

/** A value of the shape that makes a read try to decrypt it. */
const LOOKS_LIKE_CIPHERTEXT = "QWxhZGRpbjpvcGVuIHNlc2FtZQ".repeat(3);

const CANT_TELL =
  "has the shape of old ciphertext, but no key in this keyring opens it, so it can't be told from plaintext";

beforeEach(async () => {
  await dropTrigger();
  await resetDatabase();
  await seedUser({ id: OWNER });
  useKeys(OLD_KEY);
});

afterEach(async () => {
  await dropTrigger();
  useKeys(ORIGINAL_KEY!);
});

afterAll(async () => {
  await closePool();
});

describe("servers", () => {
  it.each([
    ["old ciphertext", () => old(SSH_KEY), () => old(PASSWORD)],
    ["plaintext", () => SSH_KEY, () => PASSWORD],
  ])("moves %s into the vault under the server's binding", async (_n, k, p) => {
    const id = await seedOldServer(k(), p());
    const before = await storedServer(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(report.remaining).toBe(0);
    expect(surface(report, "servers").encrypted).toBe(1);
    const row = await storedServer(id);
    expect(decryptedWith(row.ssh_key!, serverBinding("sshKey"))).toBe(SSH_KEY);
    expect(decryptedWith(row.password!, serverBinding("password"))).toBe(
      PASSWORD,
    );
    expect(row.updated_at).toEqual(before.updated_at);
    expect(row.name).toBe(before.name);

    // The real read path, which SSH logins go through.
    const server = await storage.getServerForExecution(id, OWNER);
    expect(server?.sshKey).toBe(SSH_KEY);
    expect(server?.password).toBe(PASSWORD);
  });

  it("binds each column to itself and the owner, so neither can be moved", async () => {
    const id = await seedOldServer(old(SSH_KEY), old(PASSWORD));

    await encryptLegacySecrets();

    const row = await storedServer(id);
    expect(() =>
      decryptedWith(row.ssh_key!, serverBinding("password")),
    ).toThrow();
    expect(() =>
      decryptedWith(row.ssh_key!, serverBinding("sshKey", "someone-else")),
    ).toThrow();
  });

  it("leaves a null or empty column alone", async () => {
    const id = await seedOldServer(null, "");
    const before = await storedServer(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "servers").upToDate).toBe(1);
    expect((await storedServer(id)).version).toBe(before.version);
  });

  it("encrypts only the column that needs it", async () => {
    const envelope = encryptServerSecret(PASSWORD, "password", OWNER);
    const id = await seedOldServer(old(SSH_KEY), envelope);

    await encryptLegacySecrets();

    const row = await storedServer(id);
    expect(row.password).toBe(envelope);
    expect(isSecretEnvelope(row.ssh_key)).toBe(true);
  });

  it("is all or nothing: a column it can't be sure of keeps the other as it was", async () => {
    const stored = old(SSH_KEY);
    const id = await seedOldServer(stored, LOOKS_LIKE_CIPHERTEXT);
    const before = await storedServer(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      { surface: "servers", id, column: "password", reason: CANT_TELL },
    ]);
    const row = await storedServer(id);
    expect(row.ssh_key).toBe(stored);
    expect(row.version).toBe(before.version);
  });
});

describe("env vars", () => {
  it.each([
    ["old ciphertext", () => old(ENV_VALUE)],
    ["plaintext", () => ENV_VALUE],
  ])("moves %s into the vault under its event and key", async (_n, value) => {
    const { id, eventId, key } = await seedEnvVar(value());
    const before = await storedEnvVar(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "env_vars").encrypted).toBe(1);
    const row = await storedEnvVar(id);
    expect(decryptedWith(row.value, envBinding(eventId, key))).toBe(ENV_VALUE);
    expect(row.updated_at).toEqual(before.updated_at);
  });

  it("hands the same value to the edit form and to a job", async () => {
    const { eventId, key } = await seedEnvVar(old(ENV_VALUE));
    const readEvent = async () => storage.getEventWithRelations(eventId);
    const viaForm = async () =>
      toEventApiDto((await readEvent())!, OWNER, {
        revealEnvVarValues: true,
      }).envVars.find((v) => v.key === key)?.value;
    const viaJob = async () => {
      const event = (await readEvent())!;
      const job = transformJobForOrchestrator({
        id: "job-1",
        eventId,
        userId: OWNER,
        type: "SCRIPT",
        priority: 5,
        attempts: 0,
        payload: {
          script: { type: "BASH", content: "echo hi" },
          environment: Object.fromEntries(
            event.envVars.map((v) => [v.key, v.value]),
          ),
          target: {},
        },
        metadata: {},
      } as never);
      return (job.execution.environment as Record<string, string>)[key];
    };
    expect(await viaForm()).toBe(ENV_VALUE);
    expect(await viaJob()).toBe(ENV_VALUE);

    await encryptLegacySecrets();

    expect(await viaForm()).toBe(ENV_VALUE);
    expect(await viaJob()).toBe(ENV_VALUE);
  });

  it("can't be swapped to another event or key afterwards", async () => {
    const { id, eventId, key } = await seedEnvVar(old(ENV_VALUE));

    await encryptLegacySecrets();

    const { value } = await storedEnvVar(id);
    expect(() => decryptEnvVarValue(value, eventId + 1, key)).toThrow();
    expect(() => decryptEnvVarValue(value, eventId, "OTHER")).toThrow();
  });

  it("leaves an empty value alone", async () => {
    const { id } = await seedEnvVar("");
    const before = await storedEnvVar(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "env_vars").upToDate).toBe(1);
    expect((await storedEnvVar(id)).version).toBe(before.version);
  });

  it("leaves a value encrypted several times over alone, which a read already unwraps", async () => {
    const eventId = await seedEvent(OWNER);
    const key = "NESTED";
    const once = encryptEnvVarValue(ENV_VALUE, eventId, key);
    const twice = encryptEnvVarValue(once, eventId, key);
    const { id } = await seedEnvVar(twice, key, eventId);
    const before = await storedEnvVar(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "env_vars").upToDate).toBe(1);
    expect((await storedEnvVar(id)).version).toBe(before.version);
    expect(report.readsAsCiphertext).toEqual([]);
  });

  it("fits a value whose envelope wouldn't have fit the old varchar(255)", async () => {
    // 157 bytes is the most the old scheme could store in that column, and its envelope
    // is over 255 characters. This is why the run needs migration 0016.
    const value = "z".repeat(157);
    const stored = old(value);
    expect(stored.length).toBeLessThanOrEqual(255);
    const { id, eventId, key } = await seedEnvVar(stored);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    const { value: next } = await storedEnvVar(id);
    expect(next.length).toBeGreaterThan(255);
    expect(decryptEnvVarValue(next, eventId, key)).toBe(value);
  });
});

describe("MFA secrets", () => {
  it.each([
    ["old ciphertext", () => old(TOTP_SECRET)],
    ["plaintext", () => TOTP_SECRET],
  ])("moves %s into the vault under the user", async (_n, value) => {
    await setMfa(OWNER, value());
    const before = await storedMfa(OWNER);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "users").encrypted).toBe(1);
    const row = await storedMfa(OWNER);
    expect(decryptedWith(row.mfa_secret!, mfaBinding(OWNER))).toBe(TOTP_SECRET);
    expect(row.updated_at).toEqual(before.updated_at);

    // The sign-in check still passes with the authenticator the user already has.
    const secret = await storage.getMfaSecret(OWNER);
    const now = Math.floor(Date.now() / 1000);
    expect(verifyTotp(secret!, generateTotp(TOTP_SECRET, now))).toBe(true);
  });

  it("doesn't touch a user with no secret", async () => {
    const before = await storedMfa(OWNER);

    const report = await encryptLegacySecrets();

    expect(surface(report, "users").upToDate).toBe(1);
    expect((await storedMfa(OWNER)).version).toBe(before.version);
  });

  it("reports a secret it can't open, rather than locking the user out differently", async () => {
    const stored = oldCiphertext(LOST_KEY, TOTP_SECRET);
    await setMfa(OWNER, stored);
    await seedEnvVar(old(ENV_VALUE)); // So the key check has something to go on.

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      { surface: "users", id: OWNER, column: "mfaSecret", reason: CANT_TELL },
    ]);
    expect((await storedMfa(OWNER)).mfa_secret).toBe(stored);
  });
});

describe("sensitive settings", () => {
  it.each([
    ["old ciphertext", () => old(SMTP_PASSWORD)],
    ["plaintext", () => SMTP_PASSWORD],
  ])("moves %s into the vault under the setting's key", async (_n, value) => {
    const id = await seedSetting("smtpPassword", value());
    await seedSetting("smtpHost", "mail.example");
    const before = await storedSetting(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "system_settings").encrypted).toBe(1);
    const row = await storedSetting(id);
    expect(decryptedWith(row.value, settingBinding("smtpPassword"))).toBe(
      SMTP_PASSWORD,
    );
    expect(row.updated_at).toEqual(before.updated_at);

    // Both ways the app reads it.
    expect((await storage.getSetting("smtpPassword"))?.value).toBe(
      SMTP_PASSWORD,
    );
    expect((await getSmtpSettings()).password).toBe(SMTP_PASSWORD);
  });

  it("leaves settings that aren't secret as they are, whatever they look like", async () => {
    const plain = await seedSetting("smtpHost", "mail.example");
    const longPlain = await seedSetting("someSetting", LOOKS_LIKE_CIPHERTEXT);
    await seedEnvVar(old(ENV_VALUE));
    const versions = async () => [
      (await storedSetting(plain)).version,
      (await storedSetting(longPlain)).version,
    ];
    const before = await versions();

    const report = await encryptLegacySecrets();

    expect(await versions()).toEqual(before);
    expect(surface(report, "system_settings").scanned).toBe(0);
    expect(report.failures).toEqual([]);
    expect(await countLegacyRows()).toBe(0);
  });

  it("names a setting it can't move by its key, which an operator will recognize", async () => {
    await seedOldServer(old("readable-by-this-key"), null);
    await seedSetting("customAiApiKey", LOOKS_LIKE_CIPHERTEXT);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "system_settings",
        id: "customAiApiKey",
        column: "value",
        reason: CANT_TELL,
      },
    ]);
  });

  it("covers every setting the app treats as sensitive", async () => {
    const { SENSITIVE_SYSTEM_SETTINGS } =
      await import("@/lib/encryption-service");
    for (const key of SENSITIVE_SYSTEM_SETTINGS) {
      await seedSetting(key, `value-of-${key}`);
    }

    const report = await encryptLegacySecrets();

    expect(surface(report, "system_settings").encrypted).toBe(
      SENSITIVE_SYSTEM_SETTINGS.length,
    );
    for (const key of SENSITIVE_SYSTEM_SETTINGS) {
      expect((await storage.getSetting(key))?.value).toBe(`value-of-${key}`);
    }
  });
});

describe("a value that starts like an envelope and isn't one", () => {
  it("is reported, and left, for the same reason a read fails on it", async () => {
    await seedOldServer(old("readable-by-this-key"), null);
    const { id } = await seedEnvVar("crn.not-really");
    const before = await storedEnvVar(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "env_vars",
        id,
        column: "value",
        reason:
          "looks encrypted, but this keyring can't decrypt it for this row",
      },
    ]);
    expect((await storedEnvVar(id)).version).toBe(before.version);
  });

  it("is what's inside old ciphertext sometimes, and stays what it was", async () => {
    const { id, eventId, key } = await seedEnvVar(
      old("crn.1.not.really.an.env"),
    );

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    const { value } = await storedEnvVar(id);
    expect(decryptedWith(value, envBinding(eventId, key))).toBe(
      "crn.1.not.really.an.env",
    );
    expect(decryptEnvVarValue(value, eventId, key)).toBe(
      "crn.1.not.really.an.env",
    );
  });
});

describe("a plaintext value that looks like ciphertext", () => {
  it.each<[string, () => Promise<() => Promise<unknown>>]>([
    [
      "servers",
      async () => {
        const id = await seedOldServer(null, LOOKS_LIKE_CIPHERTEXT);
        return () => storedServer(id);
      },
    ],
    [
      "env_vars",
      async () => {
        const { id } = await seedEnvVar(LOOKS_LIKE_CIPHERTEXT);
        return () => storedEnvVar(id);
      },
    ],
    [
      "users",
      async () => {
        await setMfa(OWNER, LOOKS_LIKE_CIPHERTEXT);
        return () => storedMfa(OWNER);
      },
    ],
    [
      "system_settings",
      async () => {
        const id = await seedSetting("customAiApiKey", LOOKS_LIKE_CIPHERTEXT);
        return () => storedSetting(id);
      },
    ],
  ])("%s: is reported and left, not encrypted", async (name, seed) => {
    const stored = await seed();
    // The key check has to have something that fits, or it stops the whole run.
    await seedOldServer(old("readable-by-this-key"), null);
    const before = await stored();

    const report = await encryptLegacySecrets();

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      surface: name,
      reason: CANT_TELL,
    });
    expect(report.remaining).toBe(1);
    expect(await stored()).toEqual(before);
    expect(JSON.stringify(report)).not.toContain(LOOKS_LIKE_CIPHERTEXT);
  });

  it("is fixed by saving it, and the next run has nothing left to report", async () => {
    await seedOldServer(old("readable-by-this-key"), null);
    const { id } = await seedEnvVar(LOOKS_LIKE_CIPHERTEXT);
    expect((await encryptLegacySecrets()).remaining).toBe(1);

    const { eventId, key } = await one<{ eventId: number; key: string }>(
      `SELECT event_id AS "eventId", key FROM env_vars WHERE id = $1`,
      [id],
    );
    await storage.deleteEnvVarsByEventId(eventId);
    await storage.createEnvVar({
      eventId,
      key,
      value: LOOKS_LIKE_CIPHERTEXT,
    } as never);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(report.remaining).toBe(0);
  });

  it("isn't quoted anywhere the CLI writes", async () => {
    await seedOldServer(old("readable-by-this-key"), LOOKS_LIKE_CIPHERTEXT);

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(1);
    expect(output).toContain("column=password");
    expect(output).toContain("can't be told from plaintext");
    expect(output).not.toContain(LOOKS_LIKE_CIPHERTEXT);
    expect(output).toContain("Legacy rows remaining: 1");
  });
});

describe("a value under a retired key", () => {
  it.each<[string, (v: string) => Promise<() => Promise<string | null>>]>([
    [
      "servers",
      async (stored) => {
        const id = await seedOldServer(stored, null);
        return async () => (await storedServer(id)).ssh_key;
      },
    ],
    [
      "env_vars",
      async (stored) => {
        const { id } = await seedEnvVar(stored);
        return async () => (await storedEnvVar(id)).value;
      },
    ],
    [
      "users",
      async (stored) => {
        await setMfa(OWNER, stored);
        return async () => (await storedMfa(OWNER)).mfa_secret;
      },
    ],
    [
      "system_settings",
      async (stored) => {
        const id = await seedSetting("smtpPassword", stored);
        return async () => (await storedSetting(id)).value;
      },
    ],
  ])(
    "%s: opens under it, and ends up under the active key",
    async (_name, seed) => {
      const stored = await seed(old(PASSWORD));
      useKeys(NEW_KEY, [OLD_KEY]);

      const report = await encryptLegacySecrets();

      expect(report.failures).toEqual([]);
      expect(report.remaining).toBe(0);
      const next = await stored();
      expect(next!.split(".")[2]).toBe(getSecretVault().keyIds()[0]!.keyId);
    },
  );

  it("starts working for a read that couldn't open it", async () => {
    const id = await seedOldServer(old(SSH_KEY), null);
    useKeys(NEW_KEY, [OLD_KEY]);
    await expect(storage.getServerForExecution(id, OWNER)).rejects.toThrow();

    await encryptLegacySecrets();

    // With the old key gone too, so this can only be the new one.
    useKeys(NEW_KEY);
    expect((await storage.getServerForExecution(id, OWNER))?.sshKey).toBe(
      SSH_KEY,
    );
  });
});

describe("a value that reads as ciphertext", () => {
  // The old `encrypt` took any non-empty string, and its `decrypt` passed anything under
  // 50 characters through. So this is real: a value this short came back as its
  // ciphertext, then and now.
  const SHORT = "1";

  it("is what the old scheme really did to a short value", () => {
    const stored = encryptionService.encrypt(SHORT);
    expect(stored.length).toBeLessThan(50);
    expect(encryptionService.decrypt(stored)).toBe(stored);
  });

  it.each([
    ["a short value", () => old(SHORT)],
    ["a value encrypted twice", () => old(old(ENV_VALUE))],
  ])(
    "%s: keeps reading the same, and is named instead of guessed at",
    async (_name, seed) => {
      const { id, eventId, key } = await seedEnvVar(seed());
      const readsBefore = decryptEnvVarValue(
        (await storedEnvVar(id)).value,
        eventId,
        key,
      );

      const report = await encryptLegacySecrets();

      expect(report.failures).toEqual([]);
      expect(report.remaining).toBe(0);
      expect(report.readsAsCiphertext).toEqual([
        { surface: "env_vars", id, column: "value" },
      ]);
      const { value } = await storedEnvVar(id);
      expect(decryptedWith(value, envBinding(eventId, key))).toBe(readsBefore);
      expect(decryptEnvVarValue(value, eventId, key)).toBe(readsBefore);

      // A later run still says so, because the row still has the problem.
      const again = await encryptLegacySecrets();
      expect(again.totalEncrypted).toBe(0);
      expect(again.readsAsCiphertext).toEqual([
        { surface: "env_vars", id, column: "value" },
      ]);
    },
  );

  it("names a value already in the vault with ciphertext inside it", async () => {
    // What the event form did after the vault: handed the old ciphertext, it saved that.
    const eventId = await seedEvent(OWNER);
    const envelope = encryptEnvVarValue(old(ENV_VALUE), eventId, "WRAPPED");
    const { id } = await seedEnvVar(envelope, "WRAPPED", eventId);

    const report = await encryptLegacySecrets();

    expect(surface(report, "env_vars").upToDate).toBe(1);
    expect((await storedEnvVar(id)).value).toBe(envelope);
    expect(report.readsAsCiphertext).toEqual([
      { surface: "env_vars", id, column: "value" },
    ]);
  });

  it("doesn't name a value that only resembles ciphertext", async () => {
    await seedOldServer(old(SSH_KEY), null);
    await seedEnvVar("QWxhZGRpbjpvcGVuIHNlc2FtZQ==QWxhZGRpbjpvcGVuIHNlc2F");

    const report = await encryptLegacySecrets();

    expect(report.readsAsCiphertext).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("stops being named once it's saved again", async () => {
    const { eventId, key } = await seedEnvVar(old(SHORT));
    await encryptLegacySecrets();

    await storage.deleteEnvVarsByEventId(eventId);
    await storage.createEnvVar({ eventId, key, value: SHORT } as never);

    const report = await encryptLegacySecrets();

    expect(report.readsAsCiphertext).toEqual([]);
  });

  it("says so from the CLI, without a value, and doesn't fail the run for it", async () => {
    const { id } = await seedEnvVar(old(SHORT));
    const { value: before } = await storedEnvVar(id);

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(0);
    expect(output).toContain(`NOTE: env_vars id=${id} column=value`);
    expect(output).toContain("Legacy rows remaining: 0");
    expect(output).not.toContain(before);
  });
});

describe("tool credentials", () => {
  it("encrypts plaintext, and the row says so, all in one write", async () => {
    const stored = JSON.stringify(CREDENTIALS);
    const id = await seedTool(stored, false);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "tool_credentials").encrypted).toBe(1);
    const row = await storedTool(id);
    expect(row.encrypted).toBe(true);
    expect(row.encryption_metadata?.algorithm).toBe("aes-256-gcm");
    expect(row.credentials).not.toContain(CREDENTIALS.apiKey);
    expect(parseEncryptedData(row.credentials)).not.toBeNull();
    expect(readTool(row)).toEqual(CREDENTIALS);
    expect(row.updated_at).toEqual(before.updated_at);
    expect(readTool(before)).toEqual(CREDENTIALS);
  });

  it("keeps the exact text, down to key order", async () => {
    const stored = '{"z":1,"a":{"b":[1,2]}}';
    const id = await seedTool(stored, false);

    await encryptLegacySecrets();

    const row = await storedTool(id);
    expect(JSON.stringify(readTool(row))).toBe(stored);
  });

  it.each([
    ["an empty string", ""],
    ["an empty object", "{}"],
    ["an empty array", "[]"],
    ["spaces", "  "],
  ])("doesn't touch %s, which holds nothing", async (_name, stored) => {
    const id = await seedTool(stored, false);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "tool_credentials").upToDate).toBe(1);
    expect(report.failures).toEqual([]);
    expect((await storedTool(id)).version).toBe(before.version);
  });

  it("doesn't touch a row marked encrypted that holds nothing", async () => {
    const id = await seedTool("{}", true);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect((await storedTool(id)).version).toBe(before.version);
  });

  it("doesn't touch what the app encrypted itself", async () => {
    const id = await seedTool(encryptedCredential(CREDENTIALS), true);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "tool_credentials").upToDate).toBe(1);
    expect((await storedTool(id)).version).toBe(before.version);
  });

  it.each<[string, () => { stored: string; encrypted: boolean }, string]>([
    [
      "marked encrypted, holding something else",
      () => ({ stored: "legacy-encrypted-string", encrypted: true }),
      "marked as encrypted, but isn't in the encrypted format",
    ],
    [
      "marked encrypted, holding plain JSON",
      () => ({ stored: JSON.stringify(CREDENTIALS), encrypted: true }),
      "marked as encrypted, but isn't in the encrypted format",
    ],
    [
      "marked not encrypted, holding ciphertext",
      () => ({ stored: encryptedCredential(CREDENTIALS), encrypted: false }),
      "marked as not encrypted, but holds encrypted data",
    ],
    [
      "marked not encrypted, holding something that isn't JSON",
      () => ({ stored: "not-json-canary", encrypted: false }),
      "not a JSON object of credentials",
    ],
    [
      "marked not encrypted, holding a JSON scalar",
      () => ({ stored: '"just a string"', encrypted: false }),
      "not a JSON object of credentials",
    ],
  ])("reports a row %s, and leaves it", async (_name, make, reason) => {
    const { stored, encrypted } = make();
    const id = await seedTool(stored, encrypted);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      { surface: "tool_credentials", id, column: "credentials", reason },
    ]);
    expect(report.remaining).toBe(1);
    expect((await storedTool(id)).version).toBe(before.version);
    expect(JSON.stringify(report)).not.toContain("canary");
  });

  it("reports a credential under a key that's gone", async () => {
    useKeys(LOST_KEY);
    const id = await seedTool(encryptedCredential(CREDENTIALS), true);
    useKeys(OLD_KEY);
    await seedOldServer(old(SSH_KEY), null);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "tool_credentials",
        id,
        column: "credentials",
        reason: "encrypted, but this keyring can't decrypt it",
      },
    ]);
  });

  it("is up to date under a retired key, which is rotation's job", async () => {
    const id = await seedTool(encryptedCredential(CREDENTIALS), true);
    useKeys(NEW_KEY, [OLD_KEY]);
    const before = await storedTool(id);

    const report = await encryptLegacySecrets();

    expect(surface(report, "tool_credentials").upToDate).toBe(1);
    expect((await storedTool(id)).version).toBe(before.version);
  });
});

describe("OAuth tokens", () => {
  it("encrypts plaintext, and the app reads the same tokens", async () => {
    const { id, toolId } = await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);
    const before = await storedTokens(id);
    const tokensBefore = await readTokens(toolId);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "oauth_tokens").encrypted).toBe(1);
    const row = await storedTokens(id);
    expect(parseEncryptedData(row.access_token)).not.toBeNull();
    expect(parseEncryptedData(row.refresh_token)).not.toBeNull();
    expect(row.updated_at).toEqual(before.updated_at);
    expect(await readTokens(toolId)).toEqual(tokensBefore);
    expect(tokensBefore?.accessToken).toBe(ACCESS_TOKEN);
  });

  it("leaves a missing refresh token missing", async () => {
    const { id, toolId } = await seedTokens(ACCESS_TOKEN, null);

    await encryptLegacySecrets();

    const row = await storedTokens(id);
    expect(row.refresh_token).toBeNull();
    expect((await readTokens(toolId))?.accessToken).toBe(ACCESS_TOKEN);
  });

  it("encrypts only the column that needs it", async () => {
    const encrypted = encryptedCredential(REFRESH_TOKEN);
    const { id, toolId } = await seedTokens(ACCESS_TOKEN, encrypted);

    await encryptLegacySecrets();

    const row = await storedTokens(id);
    expect(row.refresh_token).toBe(encrypted);
    expect(parseEncryptedData(row.access_token)).not.toBeNull();
    expect((await readTokens(toolId))?.refreshToken).toBe(REFRESH_TOKEN);
  });

  it.each([
    ["a number that wouldn't come back the same", "1.0"],
    ["JSON that wouldn't come back the same", '{"token":"canary"}'],
    ["a quoted string that wouldn't come back the same", '"canary"'],
  ])("reports %s, and leaves it", async (_name, token) => {
    const { id, toolId } = await seedTokens(token, null);
    const before = await storedTokens(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "oauth_tokens",
        id,
        column: "accessToken",
        reason: "did not read back unchanged after encrypting",
      },
    ]);
    expect((await storedTokens(id)).version).toBe(before.version);
    expect((await readTokens(toolId))?.accessToken).toBe(token);
  });

  it("keeps a token that JSON reads as itself", async () => {
    const { toolId } = await seedTokens("12345", null);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect((await readTokens(toolId))?.accessToken).toBe("12345");
  });

  it("is all or nothing: a token that fails keeps the other as it was", async () => {
    const { id } = await seedTokens(ACCESS_TOKEN, "1.0");

    const report = await encryptLegacySecrets();

    expect(report.failures.map((f) => f.column)).toEqual(["refreshToken"]);
    expect((await storedTokens(id)).access_token).toBe(ACCESS_TOKEN);
  });
});

describe("running it again", () => {
  async function seedEverything() {
    const server = await seedOldServer(old(SSH_KEY), old(PASSWORD));
    const env = await seedEnvVar(old(ENV_VALUE));
    await setMfa(OWNER, old(TOTP_SECRET));
    await seedSetting("smtpPassword", old(SMTP_PASSWORD));
    const tool = await seedTool(JSON.stringify(CREDENTIALS), false);
    const tokens = await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);
    return { server, env, tool, tokens };
  }

  it("rewrites nothing on a second run", async () => {
    await seedEverything();
    await encryptLegacySecrets();
    const before = await allVersions();

    const report = await encryptLegacySecrets();

    expect(report.totalEncrypted).toBe(0);
    expect(report.remaining).toBe(0);
    expect(await allVersions()).toBe(before);
  });

  it("writes nothing in a dry run, and says what a real run would do", async () => {
    await seedEverything();
    const before = await allVersions();

    const dry = await encryptLegacySecrets({ dryRun: true });

    expect(await allVersions()).toBe(before);
    expect(dry.remaining).toBe(6);
    expect(dry.totalEncrypted).toBe(6);
    const real = await encryptLegacySecrets();
    expect(real.totalEncrypted).toBe(6);
    expect(real.remaining).toBe(0);
  });

  it("writes each row once when two runs overlap", async () => {
    const { server } = await seedEverything();

    const [one_, two] = await Promise.all([
      encryptLegacySecrets(),
      encryptLegacySecrets(),
    ]);

    expect(one_.failures).toEqual([]);
    expect(two.failures).toEqual([]);
    expect(
      surface(one_, "servers").encrypted + surface(two, "servers").encrypted,
    ).toBe(1);
    expect((await storage.getServerForExecution(server, OWNER))?.password).toBe(
      PASSWORD,
    );
  });

  it("reports a failed write, leaves the row, and finishes it on the next run", async () => {
    const id = await seedOldServer(old(SSH_KEY), old(PASSWORD));
    const other = await seedOldServer(old(SSH_KEY), null);
    await addTrigger(
      "servers",
      "BEFORE",
      `IF OLD.id = ${id} THEN RAISE EXCEPTION 'refused for the test'; END IF`,
    );
    const before = await storedServer(id);

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "servers",
        id,
        column: "sshKey+password",
        reason: "database error P0001",
      },
    ]);
    expect((await storedServer(id)).version).toBe(before.version);
    expect(isSecretEnvelope((await storedServer(other)).ssh_key)).toBe(true);

    await dropTrigger();
    const next = await encryptLegacySecrets();

    expect(next.failures).toEqual([]);
    expect(next.remaining).toBe(0);
    expect((await storage.getServerForExecution(id, OWNER))?.password).toBe(
      PASSWORD,
    );
  });
});

describe("while the app keeps running", () => {
  it("servers: doesn't overwrite a password changed after the run read it", async () => {
    const first = await seedOldServer(old(SSH_KEY), null);
    const second = await seedOldServer(old(SSH_KEY), old(PASSWORD));
    const changed = encryptServerSecret("changed", "password", OWNER);
    await addTrigger(
      "servers",
      "AFTER",
      `IF OLD.id = ${first} THEN
         UPDATE servers SET password = '${changed}' WHERE id = ${second};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "servers").changedDuringRun).toBe(1);
    expect((await storedServer(second)).password).toBe(changed);
    // The other column was in that write, so it hasn't moved, and the count says so.
    expect(report.remaining).toBe(1);

    await dropTrigger();
    const next = await encryptLegacySecrets();

    expect(next.remaining).toBe(0);
    const server = await storage.getServerForExecution(second, OWNER);
    expect(server?.password).toBe("changed");
    expect(server?.sshKey).toBe(SSH_KEY);
  });

  it("env vars: doesn't overwrite a value saved after the run read it", async () => {
    const eventId = await seedEvent(OWNER);
    const first = await seedEnvVar(old(ENV_VALUE), "FIRST", eventId);
    const second = await seedEnvVar(old(ENV_VALUE), "SECOND", eventId);
    const saved = encryptEnvVarValue("saved-mid-run", eventId, "SECOND");
    await addTrigger(
      "env_vars",
      "AFTER",
      `IF OLD.id = ${first.id} THEN
         UPDATE env_vars SET value = '${saved}' WHERE id = ${second.id};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "env_vars").changedDuringRun).toBe(1);
    expect((await storedEnvVar(second.id)).value).toBe(saved);
    expect(report.remaining).toBe(0);
  });

  it("env vars: leaves a row the event's save deleted", async () => {
    const eventId = await seedEvent(OWNER);
    const first = await seedEnvVar(old(ENV_VALUE), "FIRST", eventId);
    const second = await seedEnvVar(old(ENV_VALUE), "SECOND", eventId);
    await addTrigger(
      "env_vars",
      "AFTER",
      `IF OLD.id = ${first.id} THEN
         DELETE FROM env_vars WHERE id = ${second.id};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([]);
    expect(surface(report, "env_vars").changedDuringRun).toBe(1);
    expect(report.remaining).toBe(0);
  });

  it("MFA: leaves a secret changed by enrolling again", async () => {
    const other = await seedUser({ id: "zz-other-user" });
    await setMfa(OWNER, old(TOTP_SECRET));
    await setMfa(other, old("OTHERSECRET"));
    await addTrigger(
      "users",
      "AFTER",
      `IF OLD.id = '${OWNER}' THEN
         UPDATE users SET mfa_secret = NULL WHERE id = '${other}';
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "users").changedDuringRun).toBe(1);
    expect((await storedMfa(other)).mfa_secret).toBeNull();
  });

  it("settings: doesn't overwrite one the admin just saved", async () => {
    const first = await seedSetting("smtpPassword", old(SMTP_PASSWORD));
    const second = await seedSetting("openaiApiKey", old("old-api-key"));
    await addTrigger(
      "system_settings",
      "AFTER",
      `IF OLD.id = ${first} THEN
         UPDATE system_settings SET value = 'crn.saved' WHERE id = ${second};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "system_settings").changedDuringRun).toBe(1);
    expect((await storedSetting(second)).value).toBe("crn.saved");
  });

  it("tool credentials: doesn't overwrite ones saved after the run read them", async () => {
    const first = await seedTool(JSON.stringify(CREDENTIALS), false);
    const second = await seedTool(JSON.stringify(CREDENTIALS), false);
    const saved = encryptedCredential({ apiKey: "saved-during-the-run" });
    await addTrigger(
      "tool_credentials",
      "AFTER",
      `IF OLD.id = ${first} THEN
         UPDATE tool_credentials SET credentials = '${saved}', encrypted = true WHERE id = ${second};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "tool_credentials").changedDuringRun).toBe(1);
    expect((await storedTool(second)).credentials).toBe(saved);
    expect(report.remaining).toBe(0);
  });

  it("OAuth: doesn't overwrite a token refreshed after the run read it", async () => {
    const first = await seedTokens(ACCESS_TOKEN, null);
    const second = await seedTokens(ACCESS_TOKEN, null);
    const refreshed = encryptedCredential("refreshed-token");
    await addTrigger(
      "oauth_tokens",
      "AFTER",
      `IF OLD.id = ${first.id} THEN
         UPDATE oauth_tokens SET access_token = '${refreshed}' WHERE id = ${second.id};
       END IF`,
    );

    const report = await encryptLegacySecrets();

    expect(surface(report, "oauth_tokens").changedDuringRun).toBe(1);
    expect((await readTokens(second.toolId))?.accessToken).toBe(
      "refreshed-token",
    );
    expect(report.remaining).toBe(0);
  });
});

describe("the worker's boot warning", () => {
  it("counts each surface once a row, and writes nothing", async () => {
    await seedOldServer(old(SSH_KEY), old(PASSWORD));
    await seedEnvVar(ENV_VALUE);
    await setMfa(OWNER, TOTP_SECRET);
    await seedSetting("smtpPassword", SMTP_PASSWORD);
    await seedTool(JSON.stringify(CREDENTIALS), false);
    await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);
    const before = await allVersions();

    expect(await countLegacyRows()).toBe(6);
    const warning = await legacySecretsBootWarning();

    expect(warning).toContain("6 row(s)");
    expect(warning).toContain("--encrypt-legacy");
    expect(await allVersions()).toBe(before);
    for (const canary of CANARIES) expect(warning).not.toContain(canary);
  });

  it("agrees with what a dry run would encrypt, and with a real run", async () => {
    await seedOldServer(old(SSH_KEY), null);
    await seedOldServer(null, null);
    await seedOldServer("", "");
    await seedEnvVar(old(ENV_VALUE), "A");
    await seedEnvVar("", "B");
    await setMfa(OWNER, old(TOTP_SECRET));
    await seedSetting("smtpPassword", old(SMTP_PASSWORD));
    await seedSetting("smtpHost", "mail.example");
    await seedTool(JSON.stringify(CREDENTIALS), false);
    await seedTool("{}", false);
    await seedTool("", false);
    await seedTool(encryptedCredential(CREDENTIALS), true);
    await seedTokens(ACCESS_TOKEN, null);
    await seedTokens(encryptedCredential(ACCESS_TOKEN), REFRESH_TOKEN);
    await seedTokens(encryptedCredential(ACCESS_TOKEN), null);

    const dryRun = await encryptLegacySecrets({ dryRun: true });
    expect(dryRun.failures).toEqual([]);
    expect(dryRun.totalEncrypted).toBe(7);
    expect(await countLegacyRows()).toBe(7);

    const realRun = await encryptLegacySecrets();
    expect(realRun.totalEncrypted).toBe(7);
    expect(await countLegacyRows()).toBe(0);
    expect(await legacySecretsBootWarning()).toBeNull();
  });

  it("doesn't count a credential row encrypting wouldn't help, though a run reports it", async () => {
    await seedOldServer(null, null);
    await seedTool("legacy-encrypted-string", true);
    await seedTool(encryptedCredential(CREDENTIALS), false);
    await seedTool("not-json", false);
    await seedTool('"a string"', false);

    expect(await countLegacyRows()).toBe(0);

    const { remaining, failures } = await encryptLegacySecrets({
      dryRun: true,
    });
    expect(remaining).toBe(4);
    expect(failures).toHaveLength(4);
  });

  it("needs no usable key, and decrypts nothing", async () => {
    await seedOldServer(old(SSH_KEY), null);
    await seedTool(encryptedCredential(CREDENTIALS), true);
    await seedTokens(encryptedCredential(ACCESS_TOKEN), null);
    const decrypt = jest.spyOn(credentialEncryption, "decrypt");
    delete process.env.ENCRYPTION_KEY;
    __resetSecretVaultForTests();

    expect(await countLegacyRows()).toBe(1);

    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRestore();
  });
});

describe("alongside key rotation", () => {
  async function seedOldDatabase() {
    const server = await seedOldServer(old(SSH_KEY), old(PASSWORD));
    const env = await seedEnvVar(old(ENV_VALUE));
    await setMfa(OWNER, old(TOTP_SECRET));
    const tool = await seedTool(JSON.stringify(CREDENTIALS), false);
    const tokens = await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);
    return { server, env, tool, tokens };
  }

  async function expectEverythingReads(seeded: {
    server: number;
    env: { eventId: number; id: number; key: string };
    tool: number;
    tokens: { toolId: number };
  }) {
    const server = await storage.getServerForExecution(seeded.server, OWNER);
    expect(server?.sshKey).toBe(SSH_KEY);
    expect(server?.password).toBe(PASSWORD);
    expect(
      decryptEnvVarValue(
        (await storedEnvVar(seeded.env.id)).value,
        seeded.env.eventId,
        seeded.env.key,
      ),
    ).toBe(ENV_VALUE);
    expect(await storage.getMfaSecret(OWNER)).toBe(TOTP_SECRET);
    expect(readTool(await storedTool(seeded.tool))).toEqual(CREDENTIALS);
    const tokens = await readTokens(seeded.tokens.toolId);
    expect(tokens?.accessToken).toBe(ACCESS_TOKEN);
    expect(tokens?.refreshToken).toBe(REFRESH_TOKEN);
  }

  it("counts what rotation can't move, and says a key change would orphan only the ciphertext", async () => {
    await seedOldServer(old(SSH_KEY), PASSWORD);
    await seedEnvVar(ENV_VALUE);
    await setMfa(OWNER, old(TOTP_SECRET));
    await seedTool(JSON.stringify(CREDENTIALS), false);
    await seedTool("legacy-encrypted-string", true);
    await seedTool("{}", false);
    await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);

    const report = await rotateAllSecrets({ dryRun: true });

    const find = (name: string) =>
      report.surfaces.find((s) => s.surface === name)!;
    expect(find("servers.sshKey/password").legacy).toBe(2);
    expect(find("servers.sshKey/password").legacyCiphertext).toBe(1);
    expect(find("env_vars.value").legacy).toBe(1);
    expect(find("env_vars.value").legacyCiphertext).toBe(0);
    expect(find("users.mfaSecret").legacyCiphertext).toBe(1);
    // Two rows hold something, and the two with `{}` hold nothing.
    expect(find("tool_credentials.credentials").legacy).toBe(2);
    expect(find("oauth_tokens.access/refresh").legacy).toBe(2);
    expect(report.totalLegacy).toBe(8);
    expect(report.plaintextLegacy).toBe(6);
  });

  it("counts nothing once it has run, so the key can change", async () => {
    await seedOldDatabase();
    await encryptLegacySecrets();

    const report = await rotateAllSecrets({ dryRun: true });

    expect(report.totalLegacy).toBe(0);
    expect(report.plaintextLegacy).toBe(0);
  });

  it("lets a whole old database survive a key change, in the runbook's order", async () => {
    const seeded = await seedOldDatabase();

    // Under the key it was all written with.
    expect((await encryptLegacySecrets()).remaining).toBe(0);

    // Rotate, then the old key goes.
    useKeys(NEW_KEY, [OLD_KEY]);
    const rotated = await rotateAllSecrets();
    expect(rotated.totalErrors).toBe(0);
    expect(rotated.totalLegacy).toBe(0);
    expect((await rotateAllSecrets()).totalReencrypted).toBe(0);

    useKeys(NEW_KEY);
    await expectEverythingReads(seeded);
  });

  it("does the same if the key already changed before this ran", async () => {
    const seeded = await seedOldDatabase();

    useKeys(NEW_KEY, [OLD_KEY]);
    expect((await encryptLegacySecrets()).remaining).toBe(0);
    await rotateAllSecrets();

    useKeys(NEW_KEY);
    await expectEverythingReads(seeded);
  });

  it("is right to warn: without it, the old key going loses the ciphertext", async () => {
    const id = await seedOldServer(old(SSH_KEY), null);
    useKeys(NEW_KEY, [OLD_KEY]);
    await rotateAllSecrets();

    useKeys(NEW_KEY);

    await expect(storage.getServerForExecution(id, OWNER)).rejects.toThrow();
  });
});

describe("the CLI", () => {
  async function seedForCli() {
    await seedOldServer(old(SSH_KEY), PASSWORD);
    await seedEnvVar(old(ENV_VALUE));
    await setMfa(OWNER, TOTP_SECRET);
    await seedSetting("smtpPassword", SMTP_PASSWORD);
    await seedTool(JSON.stringify(CREDENTIALS), false);
    await seedTokens(ACCESS_TOKEN, REFRESH_TOKEN);
  }

  it("reports without writing in a dry run, and with no values", async () => {
    await seedForCli();
    const before = await allVersions();

    const { code, output } = await runCli("--encrypt-legacy", "--dry-run");

    expect(code).toBe(0);
    for (const name of [
      "servers",
      "env_vars",
      "users",
      "system_settings",
      "tool_credentials",
      "oauth_tokens",
    ]) {
      expect(output).toMatch(new RegExp(`${name}: scanned=\\d+ to-encrypt=1`));
    }
    expect(output).toContain("Legacy rows remaining: 6");
    expect(await allVersions()).toBe(before);
    for (const canary of CANARIES) expect(output).not.toContain(canary);
  });

  it("encrypts, says none remain, and exits 0", async () => {
    await seedForCli();

    const { code, output } = await runCli("--encrypt-legacy");

    expect(code).toBe(0);
    expect(output).toContain("Legacy rows remaining: 0");
    expect(output).toContain("VACUUM FULL");
    for (const canary of CANARIES) expect(output).not.toContain(canary);

    const again = await runCli("--encrypt-legacy");
    expect(again.code).toBe(0);
    expect(again.output).not.toMatch(/encrypted=[1-9]/);
  });

  it("warns rotation about ciphertext and plaintext separately, and points at this", async () => {
    await seedForCli();

    const { code, output } = await runCli("--dry-run");

    expect(code).toBe(0);
    expect(output).toContain("ORPHAN");
    expect(output).toContain("--encrypt-legacy");
    expect(output).not.toContain("next saved");
    for (const canary of CANARIES) expect(output).not.toContain(canary);
  });

  it("stops warning rotation once it has run", async () => {
    await seedForCli();
    await encryptLegacySecrets();

    const { output } = await runCli("--dry-run");

    expect(output).not.toContain("WARNING");
    expect(output).toContain("env_vars.value: scanned=1");
  });

  it("picks up where a killed run stopped", async () => {
    const eventId = await seedEvent(OWNER);
    const seeded: { id: number; key: string }[] = [];
    for (let i = 0; i < 40; i++) {
      seeded.push(await seedEnvVar(old(`value-${i}`), `KEY_${i}`, eventId));
    }
    await addTrigger("env_vars", "BEFORE", "PERFORM pg_sleep(0.05)");

    const countDone = async () =>
      (
        await one<{ count: number }>(
          `SELECT count(*)::int AS count FROM env_vars WHERE value LIKE 'crn.%'`,
        )
      ).count;

    const { child, finished } = spawnCli(["--encrypt-legacy"]);
    const deadline = Date.now() + 60_000;
    while ((await countDone()) < 5) {
      if (Date.now() > deadline) throw new Error("The run never got going");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    child.kill("SIGKILL");
    expect((await finished).signal).toBe("SIGKILL");

    // The killed client's last UPDATE may still be finishing on the server.
    for (;;) {
      const { count } = await one<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE query LIKE 'update "env_vars"%' AND state = 'active'`,
      );
      if (count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await dropTrigger();

    const stopped = await countDone();
    expect(stopped).toBeGreaterThanOrEqual(5);
    expect(stopped).toBeLessThan(40);
    // Every row is either done or untouched, and the app can read all of them.
    for (const [i, { id, key }] of seeded.entries()) {
      const { value } = await storedEnvVar(id);
      expect(decryptEnvVarValue(value, eventId, key)).toBe(`value-${i}`);
    }

    const resumed = await runCli("--encrypt-legacy");

    expect(resumed.code).toBe(0);
    expect(resumed.output).toContain(
      `env_vars: scanned=40 encrypted=${40 - stopped} up-to-date=${stopped}`,
    );
    expect(resumed.output).toContain("Legacy rows remaining: 0");
    expect(await countDone()).toBe(40);
  });
});
