/**
 * Three things that break at the restart which changes ENCRYPTION_KEY, and which the
 * rotation driver's dry run used to say nothing about:
 *
 *   - sensitive settings outside the vault, which the bootstrap seed used to write
 *   - API tokens from before hashing, which only the active key can read, and which
 *     it now hashes itself
 *   - the copies of env vars in `jobs.payload`, which it didn't touch
 *
 * Real Postgres on purpose: the job write depends on jsonb operators and on what a
 * blocked UPDATE sees when the lock is released, and the seed is a real process
 * writing bytes the app's own code then has to read. `restartWith` does to this process
 * what a restart does to a service: only the keys it was given, and nothing cached.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { format, promisify } from "node:util";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as claimJobs } from "@/app/api/internal/jobs/claim/route";
import { authenticateApiToken } from "@/lib/api-auth";
import { hashApiToken } from "@/lib/api-token-hash";
import { getSmtpSettings } from "@/lib/email";
import { encryptionService } from "@/lib/encryption-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import {
  decryptEnvVarValue,
  decryptSystemSetting,
  encryptEnvVarValue,
  encryptSystemSetting,
} from "@/lib/security/field-secret";
import {
  rotateAllSecrets,
  type RotationReport,
} from "@/lib/security/secret-rotation";
import {
  __resetSecretVaultForTests,
  getSecretVault,
  isSecretEnvelope,
} from "@/lib/security/secret-vault";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import {
  apiTokens,
  envVars,
  jobs,
  JobStatus,
  TokenStatus,
  UserRole,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const OWNER = "rotation-owner";
// Random, because a repeated character makes the CLI print a low-entropy warning first.
const KEY_OLD = randomBytes(32).toString("hex");
const KEY_NEW = randomBytes(32).toString("hex");
const KEY_OLDER = randomBytes(32).toString("hex");
const KEY_LOST = randomBytes(32).toString("hex");
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ORCHESTRATOR_KEY = "rotation-test-orchestrator-key";

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

function restartWith(active: string, retired?: string[]) {
  process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
  // Held for the life of the process, which is why a restart is what changes it.
  (encryptionService as unknown as { cachedKey: Buffer | null }).cachedKey =
    null;
}

/** The vault's id for a key, which an envelope carries as its third part. */
function keyIdOf(keyHex: string): string {
  const before = process.env.ENCRYPTION_KEY!;
  const beforeRetired = process.env.ENCRYPTION_KEYS_RETIRED;
  restartWith(keyHex);
  const { keyId } = getSecretVault().keyIds()[0]!;
  restartWith(
    before,
    beforeRetired ? (JSON.parse(beforeRetired) as string[]) : undefined,
  );
  return keyId;
}

const keyIdIn = (envelope: string) => envelope.split(".")[2];

function surface(report: RotationReport, name: string) {
  const found = report.surfaces.find((s) => s.surface === name);
  if (!found) throw new Error(`no surface ${name} in the report`);
  return found;
}

const JOBS = "jobs.payload.environment";
const SETTINGS = "system_settings.value";
const TOKENS = "api_tokens.token";

const seedSetting = (key: string, value: string) =>
  pool.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2)`, [
    key,
    value,
  ]);

const storedSetting = async (key: string) => {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value;
};

/** A job row with everything a real one holds besides its environment. */
async function seedJobWith(
  eventId: number,
  environment: unknown,
  overrides: Partial<typeof jobs.$inferInsert> = {},
): Promise<string> {
  return seedJob(eventId, OWNER, {
    payload: {
      input: { from: "webhook" },
      script: { type: "BASH", content: "echo $TOKEN" },
      environment,
      target: { containerImage: "cronium/bash:latest" },
    },
    scheduledFor: new Date(Date.now() - 1000),
    ...overrides,
  });
}

async function storedJob(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row!;
}

const environmentOf = (job: { payload: unknown }) =>
  (job.payload as { environment: Record<string, string> }).environment;

function claim(): Promise<Response> {
  return claimJobs(
    new NextRequest("http://localhost:5001/api/internal/jobs/claim", {
      method: "POST",
      headers: { authorization: `Bearer ${ORCHESTRATOR_KEY}` },
      body: JSON.stringify({ orchestratorId: "orch-rotation", batchSize: 10 }),
    }),
  );
}

interface ClaimedJob {
  id: string;
  execution: { environment: Record<string, string> };
}

async function claimedJobs(): Promise<ClaimedJob[]> {
  const response = await claim();
  expect(response.status).toBe(200);
  return ((await response.json()) as { jobs: ClaimedJob[] }).jobs;
}

/** Hold the row, as a claim or a status change does, while `during` runs. */
async function withRowHeld(
  table: "jobs" | "api_tokens",
  id: string | number,
  during: (client: {
    query: (text: string, values?: unknown[]) => Promise<unknown>;
  }) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    await during(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Resolves once this many writes to the table are waiting on a row lock. */
async function untilWritesAreBlocked(table: "jobs" | "api_tokens", writes = 1) {
  // A long limit, because the driver gets through every other surface first.
  for (let attempt = 0; attempt < 2400; attempt++) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ILIKE $1`,
      [`update "${table}"%`],
    );
    if (Number(rows[0]!.count) >= writes) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${writes} write(s) to ${table} never blocked`);
}

/** The CLI in its own process, as an operator runs it. */
function runCli(...args: string[]) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/scripts/rotate-secrets.ts", ...args],
    { cwd: APP_DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, output }));
  });
}

const execFileAsync = promisify(execFile);

/** The real seed script, run the way start.sh runs it. */
function runSeed(env: Record<string, string>) {
  return execFileAsync(process.execPath, ["scripts/bootstrap-seed.cjs"], {
    cwd: APP_DIR,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
      AUTO_SEED_ADMIN: "true",
      ADMIN_PASSWORD: "seed-admin-password",
      ...env,
    },
  });
}

let eventId: number;

beforeAll(() => {
  process.env.CRONIUM_ORCHESTRATOR_KEY = ORCHESTRATOR_KEY;
});

beforeEach(async () => {
  await resetDatabase();
  await seedUser({ id: OWNER, role: UserRole.ADMIN });
  eventId = await seedEvent(OWNER);
  restartWith(KEY_OLD);
});

afterEach(() => {
  jest.restoreAllMocks();
  restartWith(ORIGINAL_KEY!);
});

afterAll(async () => {
  delete process.env.CRONIUM_ORCHESTRATOR_KEY;
  await closePool();
});

describe("sensitive settings outside the vault", () => {
  it("counts them as legacy, names them, and leaves them as they are", async () => {
    const oldScheme = encryptionService.encrypt("smtp-canary");
    await seedSetting("smtpPassword", oldScheme);
    await seedSetting("openaiApiKey", "short-plaintext");
    await seedSetting("anthropicApiKey", "");
    await seedSetting(
      "geminiApiKey",
      encryptSystemSetting("g", "geminiApiKey"),
    );
    await seedSetting("smtpHost", "mail.example.test");
    // Long and base64-shaped, but not one of the keys meant to be encrypted.
    await seedSetting("customAiBaseUrl", "A".repeat(80));
    restartWith(KEY_NEW, [KEY_OLD]);

    const dryRun = surface(await rotateAllSecrets({ dryRun: true }), SETTINGS);
    expect(dryRun).toMatchObject({
      scanned: 6,
      reencrypted: 1,
      skipped: 3,
      legacy: 2,
      errors: 0,
    });
    expect(dryRun.legacyNames?.slice().sort()).toEqual([
      "openaiApiKey",
      "smtpPassword",
    ]);

    const real = surface(await rotateAllSecrets(), SETTINGS);
    expect(real).toMatchObject({ reencrypted: 1, legacy: 2 });
    expect(await storedSetting("smtpPassword")).toBe(oldScheme);
    expect(await storedSetting("openaiApiKey")).toBe("short-plaintext");
    expect(await storedSetting("smtpHost")).toBe("mail.example.test");
  });

  it("is right to warn: a key change turns one into a wrong password", async () => {
    const oldScheme = encryptionService.encrypt("smtp-canary");
    await seedSetting("smtpPassword", oldScheme);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await getSmtpSettings()).password).toBe("smtp-canary");

    restartWith(KEY_NEW, [KEY_OLD]);
    expect((await getSmtpSettings()).password).toBe(oldScheme);
  });

  it("stops counting one saved again, which then survives the rotation", async () => {
    await seedSetting("smtpPassword", encryptionService.encrypt("smtp-canary"));

    await storage.upsertSetting("smtpPassword", "smtp-canary");

    restartWith(KEY_NEW, [KEY_OLD]);
    const report = await rotateAllSecrets();
    expect(surface(report, SETTINGS)).toMatchObject({
      legacy: 0,
      reencrypted: 1,
    });

    restartWith(KEY_NEW);
    expect((await getSmtpSettings()).password).toBe("smtp-canary");
  });
});

describe("the bootstrap seed", () => {
  const SMTP_PASSWORD = "pässwörd-canary-✓";
  const smtpEnv = {
    SMTP_HOST: "mail.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "mailer",
    SMTP_PASSWORD,
    SMTP_FROM_EMAIL: "noreply@example.test",
  };

  it("stores SMTP_PASSWORD in the vault, where the app reads it back", async () => {
    const { stdout, stderr } = await runSeed({
      ...smtpEnv,
      ENCRYPTION_KEY: KEY_OLD,
    });

    const stored = (await storedSetting("smtpPassword"))!;
    expect(isSecretEnvelope(stored)).toBe(true);
    expect(keyIdIn(stored)).toBe(keyIdOf(KEY_OLD));
    expect(stored).not.toContain(SMTP_PASSWORD);
    expect(stdout + stderr).not.toContain(SMTP_PASSWORD);

    // Under field-secret's binding for this key, and no other.
    expect(decryptSystemSetting(stored, "smtpPassword")).toBe(SMTP_PASSWORD);
    expect(() => decryptSystemSetting(stored, "openaiApiKey")).toThrow();

    expect((await getSmtpSettings()).password).toBe(SMTP_PASSWORD);
    expect((await storage.getSetting("smtpPassword"))?.value).toBe(
      SMTP_PASSWORD,
    );
    // Not one of the sensitive keys, so it stays readable.
    expect(await storedSetting("smtpHost")).toBe("mail.example.test");
  });

  it("writes what the driver can move, so a key change doesn't lose it", async () => {
    await runSeed({ ...smtpEnv, ENCRYPTION_KEY: KEY_OLD });

    restartWith(KEY_NEW, [KEY_OLD]);
    expect(
      surface(await rotateAllSecrets({ dryRun: true }), SETTINGS),
    ).toMatchObject({ legacy: 0, reencrypted: 1 });
    await rotateAllSecrets();
    expect(keyIdIn((await storedSetting("smtpPassword"))!)).toBe(
      keyIdOf(KEY_NEW),
    );

    restartWith(KEY_NEW);
    expect((await getSmtpSettings()).password).toBe(SMTP_PASSWORD);
  });

  it("leaves a stored value alone when it runs again", async () => {
    await runSeed({ ...smtpEnv, ENCRYPTION_KEY: KEY_OLD });
    const stored = await storedSetting("smtpPassword");

    await runSeed({
      ...smtpEnv,
      SMTP_PASSWORD: "a-different-password",
      ENCRYPTION_KEY: KEY_OLD,
    });

    expect(await storedSetting("smtpPassword")).toBe(stored);
  });

  it("still refuses to store the password without a usable key", async () => {
    await expect(
      runSeed({ ...smtpEnv, ENCRYPTION_KEY: "not-a-key" }),
    ).rejects.toMatchObject({ code: 1 });

    expect(await storedSetting("smtpPassword")).toBeUndefined();
  });
});

describe("API tokens from before hashing", () => {
  async function seedStoredToken(
    name: string,
    stored: string,
    overrides: Partial<typeof apiTokens.$inferInsert> = {},
  ): Promise<number> {
    const [row] = await db
      .insert(apiTokens)
      .values({ userId: OWNER, name, token: stored, ...overrides })
      .returning({ id: apiTokens.id });
    return row!.id;
  }

  /** As the app stored one before hashing, under the active key. */
  const seedOldToken = (
    name: string,
    raw: string,
    overrides: Partial<typeof apiTokens.$inferInsert> = {},
  ) => seedStoredToken(name, encryptionService.encrypt(raw), overrides);

  async function seedTokenUnder(
    key: string,
    name: string,
    raw: string,
  ): Promise<number> {
    const before = process.env.ENCRYPTION_KEY!;
    restartWith(key);
    const id = await seedOldToken(name, raw);
    restartWith(before);
    return id;
  }

  async function storedToken(id: number) {
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    return row!;
  }

  const allTokens = () => db.select().from(apiTokens).orderBy(apiTokens.id);

  it("is right to hash them: without that, the old key going loses one", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await seedOldToken("unused", "raw-unused");

    restartWith(KEY_NEW);

    expect(await authenticateApiToken("raw-unused")).toBeNull();
  });

  it("authenticates one nobody has used, once the old key is gone", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const id = await seedOldToken("unused", "raw-unused", {
      scopes: ["events:read"],
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();
    expect(surface(report, TOKENS)).toMatchObject({ hashed: 1, legacy: 0 });
    expect(report.totalHashed).toBe(1);
    expect((await storedToken(id)).token).toBe(hashApiToken("raw-unused"));

    restartWith(KEY_NEW);
    expect(await authenticateApiToken("raw-unused")).toEqual({
      userId: OWNER,
      tokenId: id,
      scopes: ["events:read"],
    });
    expect((await storedToken(id)).lastUsed).not.toBeNull();
    expect(await authenticateApiToken("raw-other")).toBeNull();
    // Nothing is left for the lookup to try, so nothing fails to decrypt.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("only counts in a dry run, then hashes what it counted and nothing else", async () => {
    const unused = await seedOldToken("deploy bot", "raw-unused-canary");
    const expiresLater = await seedOldToken("later", "raw-later", {
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ["events:read"],
      lastUsed: new Date("2026-01-02T03:04:05Z"),
      updatedAt: new Date("2026-01-02T03:04:05Z"),
    });
    await seedOldToken("revoked", "raw-revoked", {
      status: TokenStatus.REVOKED,
    });
    await seedOldToken("expired", "raw-expired", {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await storage.createApiToken({
      userId: OWNER,
      name: "hashed",
      token: "raw-hashed",
    });
    const before = await allTokens();
    const unusedCiphertext = (await storedToken(unused)).token;
    restartWith(KEY_NEW, [KEY_OLD]);

    const dryRun = await rotateAllSecrets({ dryRun: true });
    expect(surface(dryRun, TOKENS)).toMatchObject({
      scanned: 5,
      reencrypted: 0,
      hashed: 2,
      skipped: 3,
      legacy: 0,
      errors: 0,
      legacyNames: [],
    });
    expect(dryRun.totalHashed).toBe(2);
    expect(dryRun.totalLegacy).toBe(0);
    expect(dryRun.remaining).toBe(2);
    expect(await allTokens()).toEqual(before);

    const real = await rotateAllSecrets();
    expect(surface(real, TOKENS)).toMatchObject({
      scanned: 5,
      reencrypted: 0,
      hashed: 2,
      skipped: 3,
      legacy: 0,
      errors: 0,
    });
    expect(real.totalHashed).toBe(2);
    expect(real.remaining).toBe(0);
    for (const report of [dryRun, real]) {
      for (const value of ["raw-unused-canary", unusedCiphertext]) {
        expect(JSON.stringify(report)).not.toContain(value);
      }
      expect(JSON.stringify(report)).not.toContain(hashApiToken("raw-later"));
    }

    // Only the token column of those two moved, and none of the others.
    const expected = before.map((row) => {
      if (row.id === unused) {
        return { ...row, token: hashApiToken("raw-unused-canary") };
      }
      if (row.id === expiresLater) {
        return { ...row, token: hashApiToken("raw-later") };
      }
      return row;
    });
    expect(await allTokens()).toEqual(expected);

    const again = await rotateAllSecrets();
    expect(surface(again, TOKENS)).toMatchObject({ hashed: 0, skipped: 5 });
    expect(again.totalHashed).toBe(0);
    const check = await rotateAllSecrets({ dryRun: true });
    expect(check.remaining).toBe(0);
    expect(await allTokens()).toEqual(expected);
  });

  it("opens a token under any key in the ring", async () => {
    const underActive = await seedTokenUnder(KEY_NEW, "active", "raw-active");
    const underOld = await seedTokenUnder(KEY_OLD, "old", "raw-old");
    const underOlder = await seedTokenUnder(KEY_OLDER, "older", "raw-older");
    restartWith(KEY_NEW, [KEY_OLD, KEY_OLDER]);

    expect(
      surface(await rotateAllSecrets({ dryRun: true }), TOKENS),
    ).toMatchObject({ hashed: 3, legacy: 0 });
    expect(surface(await rotateAllSecrets(), TOKENS)).toMatchObject({
      hashed: 3,
      legacy: 0,
    });

    restartWith(KEY_NEW);
    for (const [id, raw] of [
      [underActive, "raw-active"],
      [underOld, "raw-old"],
      [underOlder, "raw-older"],
    ] as const) {
      expect(await authenticateApiToken(raw)).toMatchObject({ tokenId: id });
    }
  });

  it("leaves one no key in the ring opens as legacy, and names it", async () => {
    const lost = await seedTokenUnder(KEY_LOST, "bad\u001b[2Jname", "raw-lost");
    // Long and base64-shaped, so it looks like ciphertext and fails to open.
    const lookalike = await seedStoredToken("lookalike", "A".repeat(88));
    // Never ciphertext at all, so it's under no key either.
    const plain = await seedStoredToken("plain", "a-plaintext-token");
    const opens = await seedOldToken("opens", "raw-opens");
    const before = await allTokens();
    const lostCiphertext = (await storedToken(lost)).token;
    restartWith(KEY_NEW, [KEY_OLD]);

    const dryRun = await rotateAllSecrets({ dryRun: true });
    const real = await rotateAllSecrets();

    for (const report of [dryRun, real]) {
      expect(surface(report, TOKENS)).toMatchObject({
        scanned: 4,
        hashed: 1,
        skipped: 0,
        legacy: 3,
        errors: 0,
        legacyNames: [
          // A name can't move the operator's cursor or clear their screen.
          `id=${lost} "bad\\u001b[2Jname"`,
          `id=${lookalike} "lookalike"`,
          `id=${plain} "plain"`,
        ],
      });
      expect(report.totalLegacy).toBe(3);
      expect(JSON.stringify(report)).not.toContain(lostCiphertext);
    }
    const unopened = (rows: Awaited<ReturnType<typeof allTokens>>) =>
      rows.filter((row) => row.id !== opens);
    expect(unopened(await allTokens())).toEqual(unopened(before));
  });

  it("hashes one it couldn't open once its key is back in the ring", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const lost = await seedTokenUnder(KEY_LOST, "lost", "raw-lost");
    restartWith(KEY_NEW, [KEY_OLD]);
    expect(surface(await rotateAllSecrets(), TOKENS).legacy).toBe(1);
    expect(await authenticateApiToken("raw-lost")).toBeNull();

    restartWith(KEY_NEW, [KEY_OLD, KEY_LOST]);
    expect(surface(await rotateAllSecrets(), TOKENS)).toMatchObject({
      hashed: 1,
      legacy: 0,
    });

    restartWith(KEY_NEW);
    expect(await authenticateApiToken("raw-lost")).toMatchObject({
      tokenId: lost,
    });
  });

  it("gets a 401 from the restart until a pass reaches it, then works", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const used = await seedOldToken("used", "raw-used");
    const unused = await seedOldToken("unused", "raw-unused");
    expect(await authenticateApiToken("raw-used")).toMatchObject({
      tokenId: used,
    });

    restartWith(KEY_NEW, [KEY_OLD]);
    expect(
      surface(await rotateAllSecrets({ dryRun: true }), TOKENS),
    ).toMatchObject({ scanned: 2, hashed: 1, skipped: 1 });
    expect(await authenticateApiToken("raw-used")).toMatchObject({
      tokenId: used,
    });
    expect(await authenticateApiToken("raw-unused")).toBeNull();

    await rotateAllSecrets();
    expect(await authenticateApiToken("raw-unused")).toMatchObject({
      tokenId: unused,
    });

    restartWith(KEY_NEW);
    expect(await authenticateApiToken("raw-used")).toMatchObject({
      tokenId: used,
    });
    expect(await authenticateApiToken("raw-unused")).toMatchObject({
      tokenId: unused,
    });
  });

  it("closes that gap if it runs on the current key alone before the restart", async () => {
    const value = encryptEnvVarValue("env-canary", eventId, "TOKEN");
    await db.insert(envVars).values({ eventId, key: "TOKEN", value });
    const id = await seedOldToken("unused", "raw-unused");

    const report = await rotateAllSecrets();

    expect(surface(report, TOKENS)).toMatchObject({ hashed: 1 });
    expect(report.totalReencrypted).toBe(0);
    const [row] = await db.select().from(envVars);
    expect(row!.value).toBe(value);

    restartWith(KEY_NEW, [KEY_OLD]);
    expect(await authenticateApiToken("raw-unused")).toMatchObject({
      tokenId: id,
    });
  });

  it("survives a rollback, because a hash needs no key", async () => {
    const id = await seedOldToken("unused", "raw-unused");
    restartWith(KEY_NEW, [KEY_OLD]);
    await rotateAllSecrets();
    const hashed = await storedToken(id);

    restartWith(KEY_OLD, [KEY_NEW]);
    expect(surface(await rotateAllSecrets(), TOKENS)).toMatchObject({
      hashed: 0,
      skipped: 1,
    });
    expect(await storedToken(id)).toEqual(hashed);

    restartWith(KEY_OLD);
    expect(await authenticateApiToken("raw-unused")).toMatchObject({
      tokenId: id,
    });
  });

  it("reports a row it can't write, with no token in the log, and hashes the rest", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const stuck = await seedOldToken("stuck", "raw-stuck-canary");
    const fine = await seedOldToken("fine", "raw-fine");
    // Token values are unique, so this row stops the write of the other's hash.
    await db.insert(apiTokens).values({
      userId: OWNER,
      name: "same value",
      token: hashApiToken("raw-stuck-canary"),
      status: TokenStatus.REVOKED,
    });
    const ciphertext = (await storedToken(stuck)).token;
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    expect(surface(report, TOKENS)).toMatchObject({
      hashed: 1,
      skipped: 1,
      legacy: 0,
      errors: 1,
    });
    expect(report.totalErrors).toBe(1);
    expect((await storedToken(stuck)).token).toBe(ciphertext);
    expect((await storedToken(fine)).token).toBe(hashApiToken("raw-fine"));

    // format, because joining the arguments would hide an error object's own fields.
    const logged = consoleError.mock.calls
      .map((args) => format(...args))
      .join("\n");
    expect(logged).toContain(`api_tokens.token id=${stuck} column=token`);
    expect(logged).toContain("23505");
    for (const text of [logged, JSON.stringify(report)]) {
      expect(text).not.toContain("raw-stuck-canary");
      expect(text).not.toContain(ciphertext);
      expect(text).not.toContain(hashApiToken("raw-stuck-canary"));
    }
  });

  describe("while the token's row is busy", () => {
    /** Each write waits on the row in the order given, so `first` goes first. */
    async function raceForRow<First, Second>(
      id: number,
      first: () => Promise<First>,
      second: () => Promise<Second>,
    ): Promise<[First, Second]> {
      let firstRun: Promise<First> | undefined;
      let secondRun: Promise<Second> | undefined;
      await withRowHeld("api_tokens", id, async () => {
        firstRun = first();
        await untilWritesAreBlocked("api_tokens", 1);
        secondRun = second();
        await untilWritesAreBlocked("api_tokens", 2);
      });
      return Promise.all([firstRun!, secondRun!]);
    }

    it("skips a token the lookup hashes first", async () => {
      // Still under the active key, so the lookup can open it too.
      const id = await seedOldToken("racing", "raw-racing");

      const [auth, report] = await raceForRow(
        id,
        () => authenticateApiToken("raw-racing"),
        () => rotateAllSecrets(),
      );

      expect(auth).toMatchObject({ userId: OWNER, tokenId: id });
      expect(surface(report, TOKENS)).toMatchObject({
        hashed: 0,
        skipped: 1,
        errors: 0,
      });
      expect((await storedToken(id)).token).toBe(hashApiToken("raw-racing"));
    });

    it("hashes a token first and the lookup still works after it", async () => {
      const id = await seedOldToken("racing", "raw-racing");

      const [report, auth] = await raceForRow(
        id,
        () => rotateAllSecrets(),
        () => authenticateApiToken("raw-racing"),
      );

      expect(auth).toMatchObject({ userId: OWNER, tokenId: id });
      expect(surface(report, TOKENS)).toMatchObject({
        hashed: 1,
        skipped: 0,
        errors: 0,
      });
      expect((await storedToken(id)).token).toBe(hashApiToken("raw-racing"));

      restartWith(KEY_NEW);
      expect(await authenticateApiToken("raw-racing")).toMatchObject({
        tokenId: id,
      });
    });

    it("doesn't overwrite a token replaced under it", async () => {
      const id = await seedOldToken("replaced", "raw-replaced");
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("api_tokens", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("api_tokens");
        await client.query(`UPDATE api_tokens SET token = $2 WHERE id = $1`, [
          id,
          hashApiToken("raw-newer"),
        ]);
      });
      const report = await run!;

      expect(surface(report, TOKENS)).toMatchObject({
        hashed: 0,
        skipped: 1,
        errors: 0,
      });
      expect(await authenticateApiToken("raw-newer")).toMatchObject({
        tokenId: id,
      });
      expect(await authenticateApiToken("raw-replaced")).toBeNull();
    });

    it("keeps a revocation it had to wait for", async () => {
      const id = await seedOldToken("revoked now", "raw-revoked-now");
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("api_tokens", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("api_tokens");
        await client.query(
          `UPDATE api_tokens SET status = $2, updated_at = now() WHERE id = $1`,
          [id, TokenStatus.REVOKED],
        );
      });
      const report = await run!;

      // What it read is still there, so it hashes it, and the status isn't its to change.
      expect(surface(report, TOKENS)).toMatchObject({ hashed: 1, errors: 0 });
      expect((await storedToken(id)).status).toBe(TokenStatus.REVOKED);
      expect(await authenticateApiToken("raw-revoked-now")).toBeNull();
    });

    it("gets past a token deleted under it", async () => {
      const id = await seedOldToken("deleted", "raw-deleted");
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("api_tokens", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("api_tokens");
        await client.query(`DELETE FROM api_tokens WHERE id = $1`, [id]);
      });
      const report = await run!;

      expect(surface(report, TOKENS)).toMatchObject({
        hashed: 0,
        skipped: 1,
        errors: 0,
      });
      expect(await allTokens()).toEqual([]);
    });
  });
});

describe("env var copies in jobs that haven't finished", () => {
  it.each([JobStatus.QUEUED, JobStatus.CLAIMED, JobStatus.RUNNING])(
    "moves a %s job's copies, and nothing else about the job",
    async (status) => {
      const token = encryptEnvVarValue("token-canary", eventId, "TOKEN");
      const region = encryptEnvVarValue("eu-west-1", eventId, "REGION");
      const id = await seedJobWith(
        eventId,
        { TOKEN: token, REGION: region },
        {
          status,
          attempts: 2,
          updatedAt: new Date("2026-01-02T03:04:05Z"),
          orchestratorId: "orch-1",
        },
      );
      const before = await storedJob(id);
      restartWith(KEY_NEW, [KEY_OLD]);

      const report = await rotateAllSecrets();

      expect(surface(report, JOBS)).toMatchObject({
        scanned: 2,
        reencrypted: 2,
        skipped: 0,
        legacy: 0,
        errors: 0,
      });
      const after = await storedJob(id);
      const environment = environmentOf(after);
      expect(keyIdIn(environment.TOKEN!)).toBe(keyIdOf(KEY_NEW));
      expect(keyIdIn(environment.REGION!)).toBe(keyIdOf(KEY_NEW));
      expect(decryptEnvVarValue(environment.TOKEN!, eventId, "TOKEN")).toBe(
        "token-canary",
      );
      expect(decryptEnvVarValue(environment.REGION!, eventId, "REGION")).toBe(
        "eu-west-1",
      );

      // The rest of the payload and the row are as they were. updated_at matters:
      // the sweeper reads it to decide a claimed job has stalled.
      const { environment: _new, ...payloadAfter } = after.payload as Record<
        string,
        unknown
      >;
      const { environment: _old, ...payloadBefore } = before.payload as Record<
        string,
        unknown
      >;
      expect(payloadAfter).toEqual(payloadBefore);
      expect({ ...after, payload: null }).toEqual({ ...before, payload: null });
    },
  );

  it.each([
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.TIMED_OUT,
    JobStatus.CANCELLED,
  ])(
    "leaves a %s job alone: nothing decrypts its copies again",
    async (status) => {
      const id = await seedJobWith(
        eventId,
        { TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN") },
        { status },
      );
      const before = await storedJob(id);
      restartWith(KEY_NEW, [KEY_OLD]);

      const report = await rotateAllSecrets();

      expect(surface(report, JOBS)).toMatchObject({
        scanned: 0,
        reencrypted: 0,
      });
      expect(await storedJob(id)).toEqual(before);
    },
  );

  it("writes nothing in a dry run, and a second real run has nothing to do", async () => {
    const id = await seedJobWith(eventId, {
      TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
    });
    const before = await storedJob(id);
    restartWith(KEY_NEW, [KEY_OLD]);

    const dryRun = await rotateAllSecrets({ dryRun: true });
    expect(surface(dryRun, JOBS)).toMatchObject({ scanned: 1, reencrypted: 1 });
    expect(dryRun.remaining).toBe(1);
    expect(await storedJob(id)).toEqual(before);

    await rotateAllSecrets();
    const moved = await storedJob(id);

    const again = await rotateAllSecrets();
    expect(surface(again, JOBS)).toMatchObject({
      scanned: 1,
      reencrypted: 0,
      skipped: 1,
    });
    expect(again.totalReencrypted).toBe(0);
    expect(await storedJob(id)).toEqual(moved);
  });

  it.each([
    ["no environment", undefined],
    ["a null one", null],
    ["a string", "A=B"],
    ["an array", ["A=B"]],
    ["an empty one", {}],
  ])("gets past a job with %s", async (_label, environment) => {
    const id = await seedJobWith(eventId, environment);
    const before = await storedJob(id);
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    expect(surface(report, JOBS)).toMatchObject({ scanned: 0, errors: 0 });
    expect(await storedJob(id)).toEqual(before);
  });

  it("counts a copy from before the vault as legacy, and names its job", async () => {
    const oldScheme = encryptionService.encrypt("old-scheme-canary");
    const id = await seedJobWith(eventId, {
      OLD_ONE: oldScheme,
      OLD_TWO: encryptionService.encrypt("old-scheme-canary-2"),
      TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    const result = surface(report, JOBS);
    expect(result).toMatchObject({
      scanned: 3,
      reencrypted: 1,
      legacy: 2,
      errors: 0,
    });
    expect(result.legacyNames).toEqual([id]);
    expect(JSON.stringify(report)).not.toContain(oldScheme);

    const environment = environmentOf(await storedJob(id));
    expect(environment.OLD_ONE).toBe(oldScheme);
    expect(keyIdIn(environment.TOKEN!)).toBe(keyIdOf(KEY_NEW));
  });

  it("doesn't count plaintext, which reads back under any key", async () => {
    const id = await seedJobWith(eventId, { PLAIN: "short-plaintext", N: 42 });
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    expect(surface(report, JOBS)).toMatchObject({
      scanned: 2,
      skipped: 2,
      legacy: 0,
    });
    expect(environmentOf(await storedJob(id))).toEqual({
      PLAIN: "short-plaintext",
      N: 42,
    });
  });

  it("reports what it can't read and moves everything else", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    restartWith(KEY_LOST);
    const lost = encryptEnvVarValue("lost-canary", eventId, "LOST");
    restartWith(KEY_OLD);
    const wrongBinding = encryptEnvVarValue("moved-canary", eventId, "OTHER");
    const token = encryptEnvVarValue("token-canary", eventId, "TOKEN");
    const broken = await seedJobWith(eventId, {
      LOST: lost,
      MOVED_HERE: wrongBinding,
      TOKEN: token,
    });
    const other = await seedJobWith(eventId, { TOKEN: token });
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    expect(surface(report, JOBS)).toMatchObject({
      scanned: 4,
      reencrypted: 2,
      errors: 2,
    });
    expect(report.totalErrors).toBe(2);
    const environment = environmentOf(await storedJob(broken));
    expect(environment.LOST).toBe(lost);
    expect(environment.MOVED_HERE).toBe(wrongBinding);
    expect(keyIdIn(environment.TOKEN!)).toBe(keyIdOf(KEY_NEW));
    expect(keyIdIn(environmentOf(await storedJob(other)).TOKEN!)).toBe(
      keyIdOf(KEY_NEW),
    );

    const logged = consoleError.mock.calls.flat().join("\n");
    expect(logged).toContain(broken);
    expect(logged).not.toContain("canary");
    expect(logged).not.toContain(lost);
  });

  it("flattens a copy of a value encrypted twice, as it does the row", async () => {
    // Rows corrupted by the old edit form hold an envelope inside an envelope.
    const inner = encryptEnvVarValue("token-canary", eventId, "TOKEN");
    const id = await seedJobWith(eventId, {
      TOKEN: encryptEnvVarValue(inner, eventId, "TOKEN"),
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    await rotateAllSecrets();

    restartWith(KEY_NEW);
    const stored = environmentOf(await storedJob(id)).TOKEN!;
    expect(
      getSecretVault().decrypt(stored, {
        purpose: "env-var",
        table: "env_vars",
        column: "value",
        recordId: "TOKEN",
        tenantId: String(eventId),
      }),
    ).toBe("token-canary");
  });

  it("handles a key name that means something to a plain object", async () => {
    const value = encryptEnvVarValue("proto-canary", eventId, "__proto__");
    await pool.query(
      `INSERT INTO jobs (id, event_id, user_id, type, status, payload)
       VALUES ('job_proto', $1, $2, 'SCRIPT', 'queued', $3::jsonb)`,
      [eventId, OWNER, `{"environment":{"__proto__":"${value}"}}`],
    );
    restartWith(KEY_NEW, [KEY_OLD]);

    const report = await rotateAllSecrets();

    expect(surface(report, JOBS)).toMatchObject({
      reencrypted: 1,
      errors: 0,
    });
    const { rows } = await pool.query<{ value: string }>(
      `SELECT payload->'environment'->>'__proto__' AS value
       FROM jobs WHERE id = 'job_proto'`,
    );
    expect(keyIdIn(rows[0]!.value)).toBe(keyIdOf(KEY_NEW));
  });

  describe("while the job's row is busy", () => {
    it("keeps a status change it had to wait for", async () => {
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("jobs", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("jobs");
        await client.query(
          `UPDATE jobs
           SET status = 'claimed', orchestrator_id = 'orch-2',
               lease_expires_at = now() + interval '1 minute'
           WHERE id = $1`,
          [id],
        );
      });
      const report = await run!;

      expect(surface(report, JOBS)).toMatchObject({ reencrypted: 1 });
      const after = await storedJob(id);
      expect(after.status).toBe(JobStatus.CLAIMED);
      expect(after.orchestratorId).toBe("orch-2");
      expect(after.leaseExpiresAt).not.toBeNull();
      expect(keyIdIn(environmentOf(after).TOKEN!)).toBe(keyIdOf(KEY_NEW));
    });

    it("keeps a change to the rest of the payload it had to wait for", async () => {
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("jobs", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("jobs");
        await client.query(
          `UPDATE jobs SET payload = payload || '{"retries": 3}'::jsonb WHERE id = $1`,
          [id],
        );
      });
      await run;

      const after = await storedJob(id);
      expect((after.payload as { retries?: number }).retries).toBe(3);
      expect(keyIdIn(environmentOf(after).TOKEN!)).toBe(keyIdOf(KEY_NEW));
    });

    it("doesn't overwrite a value changed under it, and a later pass finishes", async () => {
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
        REGION: encryptEnvVarValue("eu-west-1", eventId, "REGION"),
      });
      const newer = encryptEnvVarValue("newer-canary", eventId, "TOKEN");
      restartWith(KEY_NEW, [KEY_OLD]);

      let run: Promise<RotationReport> | undefined;
      await withRowHeld("jobs", id, async (client) => {
        run = rotateAllSecrets();
        await untilWritesAreBlocked("jobs");
        await client.query(
          `UPDATE jobs
           SET payload = jsonb_set(payload, '{environment,TOKEN}', to_jsonb($2::text))
           WHERE id = $1`,
          [id, newer],
        );
      });
      const report = await run!;

      // Neither moved nor failed, and none of that job's values were written.
      expect(surface(report, JOBS)).toMatchObject({
        scanned: 2,
        reencrypted: 0,
        skipped: 2,
        errors: 0,
      });
      expect(environmentOf(await storedJob(id)).TOKEN).toBe(newer);

      const again = await rotateAllSecrets();
      expect(surface(again, JOBS)).toMatchObject({ reencrypted: 2 });
      const environment = environmentOf(await storedJob(id));
      expect(keyIdIn(environment.TOKEN!)).toBe(keyIdOf(KEY_NEW));
      expect(decryptEnvVarValue(environment.TOKEN!, eventId, "TOKEN")).toBe(
        "newer-canary",
      );
    });
  });

  describe("through the real claim route", () => {
    it("is right to move them: without that, the old key going fails the job", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });

      restartWith(KEY_NEW);
      expect(await claimedJobs()).toEqual([]);

      expect((await storedJob(id)).status).toBe(JobStatus.FAILED);
      const { rows } = await pool.query<{ reason: string }>(
        `SELECT reason FROM job_transitions WHERE job_id = $1 AND to_status = 'failed'`,
        [id],
      );
      expect(rows[0]?.reason).toContain("Could not prepare this job to run");
    });

    it("delivers a job queued before the rotation once the old key is gone", async () => {
      await db.insert(envVars).values({
        eventId,
        key: "TOKEN",
        value: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });
      // Queued the way the app queues it, so this is the payload dispatch really writes.
      const event = await storage.getEventWithRelations(eventId);
      const { job } = await dispatchEventJob(event!, {
        triggeredBy: "manual",
      });
      await db
        .update(jobs)
        .set({ scheduledFor: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, job!.id));
      expect(keyIdIn(environmentOf(await storedJob(job!.id)).TOKEN!)).toBe(
        keyIdOf(KEY_OLD),
      );

      restartWith(KEY_NEW, [KEY_OLD]);
      const report = await rotateAllSecrets();
      expect(surface(report, "env_vars.value").reencrypted).toBe(1);
      expect(surface(report, JOBS).reencrypted).toBe(1);

      restartWith(KEY_NEW);
      const claimed = await claimedJobs();

      expect(claimed.map((j) => j.id)).toEqual([job!.id]);
      expect(claimed[0]!.execution.environment).toEqual({
        TOKEN: "token-canary",
      });
      expect((await storedJob(job!.id)).status).toBe(JobStatus.CLAIMED);
    });

    it("delivers a job claimed while both keys are held, before or after it moves", async () => {
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });
      restartWith(KEY_NEW, [KEY_OLD]);

      const claimed = await claimedJobs();
      expect(claimed[0]!.execution.environment.TOKEN).toBe("token-canary");

      // Still re-encrypted: a lost lease can put it back in the queue.
      const report = await rotateAllSecrets();
      expect(surface(report, JOBS).reencrypted).toBe(1);
      expect(keyIdIn(environmentOf(await storedJob(id)).TOKEN!)).toBe(
        keyIdOf(KEY_NEW),
      );
    });

    it("rolls back the same way, with the keys swapped", async () => {
      const id = await seedJobWith(eventId, {
        TOKEN: encryptEnvVarValue("token-canary", eventId, "TOKEN"),
      });
      restartWith(KEY_NEW, [KEY_OLD]);
      await rotateAllSecrets();

      restartWith(KEY_OLD, [KEY_NEW]);
      const report = await rotateAllSecrets();
      expect(surface(report, JOBS).reencrypted).toBe(1);
      expect(keyIdIn(environmentOf(await storedJob(id)).TOKEN!)).toBe(
        keyIdOf(KEY_OLD),
      );

      restartWith(KEY_OLD);
      const claimed = await claimedJobs();
      expect(claimed[0]!.execution.environment.TOKEN).toBe("token-canary");
    });
  });
});

describe("what an operator sees from the CLI", () => {
  it("names each gap in a dry run, with no values, and writes nothing", async () => {
    const smtp = encryptionService.encrypt("smtp-canary");
    await seedSetting("smtpPassword", smtp);
    const oldToken = encryptionService.encrypt("raw-token-canary");
    await db
      .insert(apiTokens)
      .values({ userId: OWNER, name: "old bot", token: oldToken });
    restartWith(KEY_LOST);
    const lostToken = encryptionService.encrypt("lost-token-canary");
    restartWith(KEY_OLD);
    const [token] = await db
      .insert(apiTokens)
      .values({ userId: OWNER, name: "deploy bot", token: lostToken })
      .returning({ id: apiTokens.id });
    const moved = await seedJobWith(eventId, {
      TOKEN: encryptEnvVarValue("job-canary", eventId, "TOKEN"),
    });
    const legacy = await seedJobWith(eventId, {
      OLD: encryptionService.encrypt("old-job-canary"),
    });
    const before = await storedJob(moved);
    const tokensBefore = await db.select().from(apiTokens);
    restartWith(KEY_NEW, [KEY_OLD]);

    const { code, output } = await runCli("--dry-run");

    expect(code).toBe(0);
    expect(output).toContain("Secret rotation (dry run) starting");
    expect(output).toContain(
      "jobs.payload.environment: scanned=2 re-encrypted=1 skipped=0 legacy=1 errors=0",
    );
    expect(output).toContain(
      "system_settings.value: scanned=1 re-encrypted=0 skipped=0 legacy=1 errors=0",
    );
    expect(output).toContain(
      "api_tokens.token: scanned=2 hashed=1 skipped=0 legacy=1 errors=0",
    );
    expect(output).toContain("Total to re-encrypt: 1; to hash: 1; errors: 0");

    expect(output).toContain("WARNING: 1 sensitive setting(s)");
    expect(output).toContain("  smtpPassword\n");
    expect(output).toContain("WARNING: 1 API token(s)");
    expect(output).toContain(`  id=${token!.id} "deploy bot"\n`);
    expect(output).not.toContain('"old bot"');
    expect(output).toContain("WARNING: 1 env var value(s)");
    expect(output).toContain(`  ${legacy}\n`);

    // Each of these has its own advice, so none of them is told it re-encrypts on save.
    expect(output).not.toContain("legacy (pre-vault)");
    expect(output).not.toContain("canary");
    expect(output).not.toContain(smtp);
    expect(output).not.toContain(oldToken);
    expect(output).not.toContain(lostToken);
    expect(output).not.toContain(hashApiToken("raw-token-canary"));

    expect(await storedJob(moved)).toEqual(before);
    expect(await db.select().from(apiTokens)).toEqual(tokensBefore);
  });

  it("keeps the save-it-again warning to the rows saving fixes", async () => {
    await seedSetting("smtpPassword", encryptionService.encrypt("smtp-canary"));
    await db.insert(envVars).values({
      eventId,
      key: "OLD",
      value: encryptionService.encrypt("env-canary"),
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const { output } = await runCli("--dry-run");

    expect(output).toContain("WARNING: 1 legacy (pre-vault) secret value(s)");
    expect(output).toContain("WARNING: 1 sensitive setting(s)");
  });

  it("cuts a long list short", async () => {
    restartWith(KEY_LOST);
    await db.insert(apiTokens).values(
      Array.from({ length: 23 }, (_, i) => ({
        userId: OWNER,
        name: `bot-${i}`,
        token: encryptionService.encrypt(`raw-token-${i}`),
      })),
    );
    restartWith(KEY_NEW, [KEY_OLD]);

    const { output } = await runCli("--dry-run");

    expect(output).toContain("WARNING: 23 API token(s)");
    expect(output).toContain('"bot-19"');
    expect(output).not.toContain('"bot-20"');
    expect(output).toContain("…and 3 more");
  });

  it("moves the copies in a real run and says so", async () => {
    const id = await seedJobWith(eventId, {
      TOKEN: encryptEnvVarValue("job-canary", eventId, "TOKEN"),
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const first = await runCli();
    expect(first.code).toBe(0);
    expect(first.output).toContain("Total re-encrypted: 1; errors: 0");
    expect(keyIdIn(environmentOf(await storedJob(id)).TOKEN!)).toBe(
      keyIdOf(KEY_NEW),
    );

    const second = await runCli();
    expect(second.output).toContain("Total re-encrypted: 0; errors: 0");
  });

  it("hashes old tokens in a real run, and only then prints the line that says it's done", async () => {
    const oldToken = encryptionService.encrypt("raw-token-canary");
    const [token] = await db
      .insert(apiTokens)
      .values({ userId: OWNER, name: "old bot", token: oldToken })
      .returning({ id: apiTokens.id });
    restartWith(KEY_NEW, [KEY_OLD]);

    // A token is all that's left, and this still isn't the line step 5 of the runbook
    // waits for.
    const preview = await runCli("--dry-run");
    expect(preview.code).toBe(0);
    expect(preview.output).toContain(
      "Total to re-encrypt: 0; to hash: 1; errors: 0",
    );
    expect(preview.output).not.toContain("Total to re-encrypt: 0; errors: 0");

    const first = await runCli();
    expect(first.code).toBe(0);
    expect(first.output).toContain(
      "api_tokens.token: scanned=1 hashed=1 skipped=0 legacy=0 errors=0",
    );
    expect(first.output).toContain(
      "Total re-encrypted: 0; hashed: 1; errors: 0",
    );
    expect(first.output).not.toContain("API token(s)");

    const second = await runCli();
    expect(second.output).toContain("Total re-encrypted: 0; errors: 0");
    const check = await runCli("--dry-run");
    expect(check.output).toContain("Total to re-encrypt: 0; errors: 0");

    for (const { output } of [preview, first, second, check]) {
      expect(output).not.toContain("canary");
      expect(output).not.toContain(oldToken);
      expect(output).not.toContain(hashApiToken("raw-token-canary"));
    }

    restartWith(KEY_NEW);
    expect(await authenticateApiToken("raw-token-canary")).toMatchObject({
      tokenId: token!.id,
    });
  });

  it("hashes old tokens on the current key alone, and moves nothing else", async () => {
    const value = encryptEnvVarValue("env-canary", eventId, "TOKEN");
    await db.insert(envVars).values({ eventId, key: "TOKEN", value });
    await db.insert(apiTokens).values({
      userId: OWNER,
      name: "old bot",
      token: encryptionService.encrypt("raw-token-canary"),
    });

    const { code, output } = await runCli();

    expect(code).toBe(0);
    expect(output).toContain("Total re-encrypted: 0; hashed: 1; errors: 0");
    const [row] = await db.select().from(envVars);
    expect(row!.value).toBe(value);
  });

  it("exits non-zero when a token can't be written, with nothing to read in the output", async () => {
    const oldToken = encryptionService.encrypt("raw-token-canary");
    const [token] = await db
      .insert(apiTokens)
      .values({ userId: OWNER, name: "old bot", token: oldToken })
      .returning({ id: apiTokens.id });
    await db.insert(apiTokens).values({
      userId: OWNER,
      name: "same value",
      token: hashApiToken("raw-token-canary"),
      status: TokenStatus.REVOKED,
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const { code, output } = await runCli();

    expect(code).toBe(1);
    expect(output).toContain("Total re-encrypted: 0; errors: 1");
    expect(output).toContain(`api_tokens.token id=${token!.id} column=token`);
    expect(output).not.toContain("canary");
    expect(output).not.toContain(oldToken);
    expect(output).not.toContain(hashApiToken("raw-token-canary"));
  });

  it("exits non-zero when a job's copy can't be read", async () => {
    restartWith(KEY_LOST);
    await seedJobWith(eventId, {
      LOST: encryptEnvVarValue("lost-canary", eventId, "LOST"),
    });
    restartWith(KEY_NEW, [KEY_OLD]);

    const { code, output } = await runCli();

    expect(code).toBe(1);
    expect(output).toContain("jobs.payload.environment");
    expect(output).toContain("errors=1");
    expect(output).not.toContain("canary");
  });
});
