/**
 * Key rotation runs on a live instance, so a row can change between the driver's read
 * and its write. A webhook secret regenerated in that gap is the one the owner was
 * just shown, and writing back what the driver read would quietly replace it with the
 * old one. So every write has to apply only to the row version it read, on all eight
 * surfaces, and a row that moved on gets picked up by a later run.
 *
 * Real Postgres on purpose: this is about row versions and what a concurrent change
 * does to an UPDATE. Each trigger stands in for the app changing a row: it fires when
 * the driver writes the first row of a table, which lands after the driver has read
 * the second and before it writes it.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { TokenManager } from "@/lib/oauth/TokenManager";
import {
  credentialEncryption,
  parseEncryptedData,
} from "@/lib/security/credential-encryption";
import {
  decryptEnvVarValue,
  encryptEnvVarValue,
  encryptMfaSecret,
  encryptServerSecret,
  encryptSystemSetting,
} from "@/lib/security/field-secret";
import {
  rotateAllSecrets,
  type RotationReport,
} from "@/lib/security/secret-rotation";
import {
  __resetSecretVaultForTests,
  getSecretVault,
} from "@/lib/security/secret-vault";
import { encryptVariableValue } from "@/lib/security/variable-secret";
import {
  decryptWebhookHeaders,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  encryptWebhookSecret,
} from "@/lib/webhooks/webhook-secret";
import { pool } from "@/server/db";
import { storage } from "@/server/storage";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const OWNER = "rotation-owner";
// Random, because a repeated character makes the CLI print a low-entropy warning first.
const OLD_KEY = randomBytes(32).toString("hex");
const NEW_KEY = randomBytes(32).toString("hex");
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

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

const encryptCredential = (value: unknown) =>
  JSON.stringify(credentialEncryption.encrypt(value));

async function insert(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(sql, params);
  return rows[0]!.id;
}

async function column(
  table: string,
  name: string,
  id: number | string,
): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT ${name} AS value FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]!.value;
}

/** A row of one surface: what to call it, and how to read and change one value in it. */
interface Row {
  id: number | string;
  /** The value the app reads back from it, through the app's own read path. */
  read: () => Promise<string | null | undefined>;
  /** The SET clause for the app saving this value, encrypted under the keys in use. */
  change: (value: string) => string;
  /** The same value's stored text, to tell which key it's under. */
  stored: () => Promise<string>;
}

interface Surface {
  name: string;
  table: string;
  /** How many secret values each seeded row holds. */
  valuesPerRow: number;
  /** Two rows under the keys in use, holding `original-1` and `original-2`. */
  seed: () => Promise<[Row, Row]>;
}

const SURFACES: Surface[] = [
  {
    name: "servers.sshKey/password",
    table: "servers",
    valuesPerRow: 2,
    seed: async () => {
      const row = async (n: number): Promise<Row> => {
        const id = await seedServer(OWNER, {
          sshKey: encryptServerSecret(`original-${n}`, "sshKey", OWNER),
          password: encryptServerSecret(`password-${n}`, "password", OWNER),
        });
        return {
          id,
          read: async () =>
            (await storage.getServerForExecution(id, OWNER))?.sshKey,
          change: (value) =>
            `ssh_key = '${encryptServerSecret(value, "sshKey", OWNER)}'`,
          stored: () => column("servers", "ssh_key", id),
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "env_vars.value",
    table: "env_vars",
    valuesPerRow: 1,
    seed: async () => {
      const eventId = await seedEvent(OWNER);
      const row = async (n: number): Promise<Row> => {
        const key = `VAR_${n}`;
        const id = await insert(
          `INSERT INTO env_vars (event_id, key, value) VALUES ($1, $2, $3) RETURNING id`,
          [eventId, key, encryptEnvVarValue(`original-${n}`, eventId, key)],
        );
        const stored = () => column("env_vars", "value", id);
        return {
          id,
          read: async () => decryptEnvVarValue(await stored(), eventId, key),
          change: (value) =>
            `value = '${encryptEnvVarValue(value, eventId, key)}'`,
          stored,
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "system_settings.value",
    table: "system_settings",
    valuesPerRow: 1,
    seed: async () => {
      const row = async (key: string, n: number): Promise<Row> => {
        const id = await insert(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2) RETURNING id`,
          [key, encryptSystemSetting(`original-${n}`, key)],
        );
        return {
          id,
          read: async () => (await storage.getSetting(key))?.value,
          change: (value) => `value = '${encryptSystemSetting(value, key)}'`,
          stored: () => column("system_settings", "value", id),
        };
      };
      return [await row("smtpPassword", 1), await row("openaiApiKey", 2)];
    },
  },
  {
    name: "users.mfaSecret",
    table: "users",
    valuesPerRow: 1,
    seed: async () => {
      const row = async (n: number): Promise<Row> => {
        const id = `rotation-user-${n}`;
        await seedUser({
          id,
          mfaSecret: encryptMfaSecret(`original-${n}`, id),
        });
        return {
          id,
          read: () => storage.getMfaSecret(id),
          change: (value) => `mfa_secret = '${encryptMfaSecret(value, id)}'`,
          stored: () => column("users", "mfa_secret", id),
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "user_variables.value",
    table: "user_variables",
    valuesPerRow: 1,
    seed: async () => {
      const row = async (n: number): Promise<Row> => {
        const key = `VARIABLE_${n}`;
        const id = await insert(
          `INSERT INTO user_variables (user_id, key, value) VALUES ($1, $2, $3) RETURNING id`,
          [OWNER, key, encryptVariableValue(`original-${n}`, OWNER, key)],
        );
        return {
          id,
          read: async () => (await storage.getUserVariable(OWNER, key))?.value,
          change: (value) =>
            `value = '${encryptVariableValue(value, OWNER, key)}'`,
          stored: () => column("user_variables", "value", id),
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "webhooks.secret/headers",
    table: "webhooks",
    valuesPerRow: 2,
    seed: async () => {
      const row = async (n: number): Promise<Row> => {
        const key = `webhook-key-${n}`;
        const id = await insert(
          `INSERT INTO webhooks (user_id, name, url, key, secret, events, headers)
           VALUES ($1, 'hook', 'https://receiver.example/hook', $2, $3, '[]', $4::jsonb)
           RETURNING id`,
          [
            OWNER,
            key,
            encryptWebhookSecret(`original-${n}`, key, OWNER),
            JSON.stringify(
              encryptWebhookHeaders({ "X-Token": `token-${n}` }, key, OWNER),
            ),
          ],
        );
        const stored = () => column("webhooks", "secret", id);
        return {
          id,
          read: async () => decryptWebhookSecret(await stored(), key, OWNER),
          change: (value) =>
            `secret = '${encryptWebhookSecret(value, key, OWNER)}'`,
          stored,
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "tool_credentials.credentials",
    table: "tool_credentials",
    valuesPerRow: 1,
    seed: async () => {
      const row = async (n: number): Promise<Row> => {
        const id = await insert(
          `INSERT INTO tool_credentials (user_id, name, type, credentials, encrypted)
           VALUES ($1, $2, 'SLACK', $3, true) RETURNING id`,
          [OWNER, `tool-${n}`, encryptCredential({ token: `original-${n}` })],
        );
        const stored = () => column("tool_credentials", "credentials", id);
        return {
          id,
          read: async () => {
            const decrypted = credentialEncryption.decrypt(
              parseEncryptedData(await stored())!,
            ) as { token: string };
            return decrypted.token;
          },
          change: (value) =>
            `credentials = '${encryptCredential({ token: value })}'`,
          stored,
        };
      };
      return [await row(1), await row(2)];
    },
  },
  {
    name: "oauth_tokens.access/refresh",
    table: "oauth_tokens",
    valuesPerRow: 2,
    seed: async () => {
      const tokens = new TokenManager({ id: "slack" } as never);
      const row = async (n: number): Promise<Row> => {
        const toolId = await insert(
          `INSERT INTO tool_credentials (user_id, name, type, credentials, encrypted)
           VALUES ($1, $2, 'SLACK', '{}', false) RETURNING id`,
          [OWNER, `oauth-tool-${n}`],
        );
        const id = await insert(
          `INSERT INTO oauth_tokens (user_id, tool_id, provider_id, access_token, refresh_token)
           VALUES ($1, $2, 'slack', $3, $4) RETURNING id`,
          [
            OWNER,
            toolId,
            encryptCredential(`original-${n}`),
            encryptCredential(`refresh-${n}`),
          ],
        );
        return {
          id,
          read: async () =>
            (await tokens.getTokens(OWNER, toolId))?.accessToken,
          change: (value) => `access_token = '${encryptCredential(value)}'`,
          stored: () => column("oauth_tokens", "access_token", id),
        };
      };
      return [await row(1), await row(2)];
    },
  },
];

const TRIGGERS_ON = SURFACES.map((s) => s.table);

const literal = (id: number | string) =>
  typeof id === "number" ? String(id) : `'${id}'`;

/** The app changes `second` when the driver writes `first`, so after its read. */
async function changeDuringRun(
  surface: Surface,
  first: Row,
  second: Row,
  setClause: string,
): Promise<void> {
  await pool.query(
    `CREATE FUNCTION rotation_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.id = ${literal(first.id)} THEN
         UPDATE ${surface.table} SET ${setClause} WHERE id = ${literal(second.id)};
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER rotation_test_trigger AFTER UPDATE ON ${surface.table}
     FOR EACH ROW EXECUTE FUNCTION rotation_test_fn()`,
  );
}

async function dropTriggers(): Promise<void> {
  for (const table of TRIGGERS_ON) {
    await pool.query(
      `DROP TRIGGER IF EXISTS rotation_test_trigger ON ${table}`,
    );
  }
  await pool.query(`DROP FUNCTION IF EXISTS rotation_test_fn`);
}

const resultFor = (report: RotationReport, surface: Surface) =>
  report.surfaces.find((s) => s.surface === surface.name)!;

const activeKeyId = () => getSecretVault().keyIds()[0]!.keyId;

/** Whether a stored value decrypts with the active key alone, however it's stored. */
function isUnderActiveKey(stored: string): boolean {
  const credential = parseEncryptedData(stored);
  return credential
    ? credentialEncryption.isUnderActiveKey(credential)
    : stored.split(".")[2] === activeKeyId();
}

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

/** The CLI in its own process, with the keys in force now. */
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

beforeEach(async () => {
  await dropTriggers();
  await resetDatabase();
  await seedUser({ id: OWNER });
  useKeys(OLD_KEY);
});

afterEach(async () => {
  await dropTriggers();
  useKeys(ORIGINAL_KEY!);
});

afterAll(async () => {
  await closePool();
});

describe.each(SURFACES.map((s) => [s.name, s] as const))(
  "%s, while the app keeps running",
  (_name, surface) => {
    it("doesn't overwrite a value saved after the run read it", async () => {
      const [first, second] = await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);
      await changeDuringRun(
        surface,
        first,
        second,
        second.change("saved-during-the-run"),
      );

      const report = await rotateAllSecrets();

      expect(await second.read()).toBe("saved-during-the-run");
      expect(await first.read()).toBe("original-1");
      const result = resultFor(report, surface);
      expect(result.errors).toBe(0);
      expect(result.reencrypted).toBe(surface.valuesPerRow);
      expect(result.changedDuringRun).toBe(surface.valuesPerRow);
      expect(report.totalErrors).toBe(0);
    });

    it("counts each value once, as one thing or another", async () => {
      const [first, second] = await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);
      await changeDuringRun(
        surface,
        first,
        second,
        second.change("saved-during-the-run"),
      );

      const result = resultFor(await rotateAllSecrets(), surface);

      expect(result.scanned).toBe(
        result.reencrypted +
          result.skipped +
          result.legacy +
          result.errors +
          result.changedDuringRun,
      );
    });

    it("says there's more to do, and a later run finishes it", async () => {
      const [first, second] = await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);
      // Saved under the old key, as a service still on it would. So it has to move too.
      useKeys(OLD_KEY);
      const underOldKey = second.change("saved-during-the-run");
      useKeys(NEW_KEY, [OLD_KEY]);
      await changeDuringRun(surface, first, second, underOldKey);

      const interrupted = await rotateAllSecrets();

      expect(interrupted.remaining).toBe(surface.valuesPerRow);
      expect(isUnderActiveKey(await second.stored())).toBe(false);

      await dropTriggers();
      const finished = await rotateAllSecrets();

      expect(finished.totalErrors).toBe(0);
      expect(resultFor(finished, surface).reencrypted).toBe(
        surface.valuesPerRow,
      );
      expect(resultFor(finished, surface).changedDuringRun).toBe(0);
      expect(finished.remaining).toBe(0);
      const confirm = await rotateAllSecrets();
      expect(confirm.totalReencrypted).toBe(0);

      // The old key is gone, so a read proves both rows moved and kept their values.
      useKeys(NEW_KEY);
      expect(await second.read()).toBe("saved-during-the-run");
      expect(await first.read()).toBe("original-1");
    });

    it("moves everything in a row with one write, so it doesn't get in its own way", async () => {
      const [first, second] = await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);

      const report = await rotateAllSecrets();

      const result = resultFor(report, surface);
      expect(result.reencrypted).toBe(surface.valuesPerRow * 2);
      expect(result.changedDuringRun).toBe(0);
      expect(report.remaining).toBe(0);
      useKeys(NEW_KEY);
      expect(await first.read()).toBe("original-1");
      expect(await second.read()).toBe("original-2");
    });

    it("writes nothing in a dry run, and says what a real run would move", async () => {
      await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);
      const versions = async () =>
        (
          await pool.query<{ versions: string }>(
            `SELECT string_agg(id::text || ':' || xmin::text, ',' ORDER BY id) AS versions
             FROM ${surface.table}`,
          )
        ).rows[0]!.versions;
      const before = await versions();

      const report = await rotateAllSecrets({ dryRun: true });

      expect(resultFor(report, surface).reencrypted).toBe(
        surface.valuesPerRow * 2,
      );
      expect(await versions()).toBe(before);
    });
  },
);

describe("a value in a row that moved on", () => {
  it("keeps the column nobody changed under the old key until a later run", async () => {
    const eventless = SURFACES.find((s) => s.table === "webhooks")!;
    const [first, second] = await eventless.seed();
    useKeys(NEW_KEY, [OLD_KEY]);
    await changeDuringRun(
      eventless,
      first,
      second,
      second.change("regenerated"),
    );

    await rotateAllSecrets();

    // Both columns are one write, so the headers wait with the secret.
    const { rows } = await pool.query<{ key: string; headers: { __enc: string } }>(
      `SELECT key, headers FROM webhooks WHERE id = $1`,
      [second.id],
    );
    expect(rows[0]!.headers.__enc.split(".")[2]).not.toBe(activeKeyId());

    await dropTriggers();
    await rotateAllSecrets();

    const { rows: after } = await pool.query<{
      key: string;
      headers: { __enc: string };
    }>(`SELECT key, headers FROM webhooks WHERE id = $1`, [second.id]);
    expect(after[0]!.headers.__enc.split(".")[2]).toBe(activeKeyId());
    useKeys(NEW_KEY);
    expect(
      decryptWebhookHeaders(after[0]!.headers, after[0]!.key, OWNER),
    ).toEqual({ "X-Token": "token-2" });
  });
});

describe("a write that fails", () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s: is an error on that row, and the run carries on",
    async (_name, surface) => {
      const [first, second] = await surface.seed();
      useKeys(NEW_KEY, [OLD_KEY]);
      await pool.query(
        `CREATE FUNCTION rotation_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF OLD.id = ${literal(first.id)} THEN
             RAISE EXCEPTION 'refused for the test';
           END IF;
           RETURN NEW;
         END $$`,
      );
      await pool.query(
        `CREATE TRIGGER rotation_test_trigger BEFORE UPDATE ON ${surface.table}
         FOR EACH ROW EXECUTE FUNCTION rotation_test_fn()`,
      );
      const logged = jest.spyOn(console, "error").mockImplementation(() => {
        return undefined;
      });
      const stored = await first.stored();

      const report = await rotateAllSecrets();

      const result = resultFor(report, surface);
      expect(result.errors).toBe(surface.valuesPerRow);
      expect(result.reencrypted).toBe(surface.valuesPerRow);
      expect(report.remaining).toBe(surface.valuesPerRow);
      expect(await first.stored()).toBe(stored);
      expect(isUnderActiveKey(await second.stored())).toBe(true);

      const output = logged.mock.calls.flat().join("\n");
      logged.mockRestore();
      expect(output).toContain(String(first.id));
      // Drizzle's message repeats every parameter, ciphertext and row version included.
      expect(output).not.toContain("crn.1.");
      expect(output).not.toContain("authTag");
      expect(output).not.toContain("params");
    },
  );
});

describe("what it logs about a row it can't read", () => {
  it("doesn't quote the stored value, which may be plaintext", async () => {
    // Six parts, so it reads as an envelope naming a key the ring doesn't hold, and the
    // vault's error quotes that part. A plaintext can look like this.
    const canary = "plaintext-canary-part";
    await pool.query(
      `INSERT INTO user_variables (user_id, key, value) VALUES ($1, 'ODD', $2)`,
      [OWNER, `crn.1.${canary}.a.b.c`],
    );
    const logged = jest.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });
    useKeys(NEW_KEY, [OLD_KEY]);

    const report = await rotateAllSecrets();

    expect(report.totalErrors).toBe(1);
    const output = logged.mock.calls.flat().join("\n");
    logged.mockRestore();
    expect(output).toContain("column=value");
    expect(output).not.toContain(canary);
  });
});

describe("the CLI", () => {
  it("says what changed during the run, exits 1, and finishes on the next run", async () => {
    const surface = SURFACES.find((s) => s.table === "webhooks")!;
    const [first, second] = await surface.seed();
    useKeys(NEW_KEY, [OLD_KEY]);
    await changeDuringRun(surface, first, second, second.change("regenerated"));

    const { code, output } = await runCli();

    expect(code).toBe(1);
    expect(output).toContain(
      "webhooks.secret/headers: scanned=4 re-encrypted=2 skipped=0 legacy=0 changed-during-run=2 errors=0",
    );
    expect(output).toContain("2 value(s) changed during this run");
    expect(output).toContain("Run this again");
    expect(output).not.toContain("Rotation pass complete");

    await dropTriggers();
    const next = await runCli();

    expect(next.code).toBe(0);
    expect(next.output).toContain("changed-during-run=0");
    expect(next.output).toContain("Rotation pass complete");
    expect(await second.read()).toBe("regenerated");
  });

  it("doesn't exit 1 for a dry run that only finds work to do", async () => {
    const surface = SURFACES.find((s) => s.table === "webhooks")!;
    await surface.seed();
    useKeys(NEW_KEY, [OLD_KEY]);

    const { code, output } = await runCli("--dry-run");

    expect(code).toBe(0);
    expect(output).toContain("re-encrypted=4");
    expect(output).toContain("changed-during-run=0");
  });
});
