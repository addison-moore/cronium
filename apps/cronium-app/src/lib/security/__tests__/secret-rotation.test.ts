/**
 * @jest-environment node
 *
 * What the rotation driver decides about each value, with the database faked and the
 * cryptography real. tests/storage/secret-rotation-race.test.ts runs it against real
 * Postgres, and is what covers row versions and what a concurrent change does.
 */
import { createCipheriv, randomBytes } from "crypto";
import { credentialEncryption } from "@/lib/security/credential-encryption";
import {
  decryptEnvVarValue,
  decryptMfaSecret,
  decryptServerSecret,
  decryptSystemSetting,
  encryptEnvVarValue,
  encryptMfaSecret,
  encryptServerSecret,
  encryptSystemSetting,
} from "@/lib/security/field-secret";
import { rotateAllSecrets } from "@/lib/security/secret-rotation";
import {
  __resetSecretVaultForTests,
  getSecretVault,
} from "@/lib/security/secret-vault";
import {
  decryptVariableValue,
  encryptVariableValue,
} from "@/lib/security/variable-secret";
import {
  decryptWebhookHeaders,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  encryptWebhookSecret,
} from "@/lib/webhooks/webhook-secret";
import {
  envVars,
  oauthTokens,
  servers,
  systemSettings,
  toolCredentials,
  userVariables,
  users,
  webhooks,
} from "@/shared/schema";

interface FakeDatabase {
  rows: Map<unknown, unknown[]>;
  writes: { table: unknown; set: Record<string, unknown> }[];
  writeResult: () => { rowCount: number | null };
}

let mockDatabase: FakeDatabase;

// env.mjs is ESM-only, and only `encryption-service` reaches for it here, lazily.
jest.mock("@/env.mjs", () => ({ env: {} }));

jest.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        orderBy: async () => mockDatabase.rows.get(table) ?? [],
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          const result = mockDatabase.writeResult();
          mockDatabase.writes.push({ table, set });
          return result;
        },
      }),
    }),
  },
}));

const OWNER = "owner-1";
const OLD_KEY = "0123456789abcdef".repeat(4);
const NEW_KEY = "fedcba9876543210".repeat(4);
const LOST_KEY = "a1b2c3d4e5f60718".repeat(4);
const VERSION = "100";

function useKeys(active: string, retired?: string[]) {
  process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
  credentialEncryption.initialize(active);
}

/** Runs `write` under a key, as an earlier version of the app did. */
function underKey<T>(keyHex: string, write: () => T): T {
  useKeys(keyHex);
  try {
    return write();
  } finally {
    useKeys(NEW_KEY, [OLD_KEY]);
  }
}

const under = <T>(write: () => T) => underKey(OLD_KEY, write);

function staticAad(plaintext: string, keyHex: string): string {
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

const storedCredential = (value: unknown) =>
  JSON.stringify(credentialEncryption.encrypt(value));

const activeKeyId = () => getSecretVault().keyIds()[0]!.keyId;

const serverRow = (overrides: Record<string, unknown>) => ({
  id: 1,
  userId: OWNER,
  sshKey: null as string | null,
  password: null as string | null,
  version: VERSION,
  ...overrides,
});

const webhookRow = (overrides: Record<string, unknown>) => ({
  id: 2,
  userId: OWNER,
  key: "webhook-key",
  secret: "",
  headers: null as unknown,
  version: VERSION,
  ...overrides,
});

const surface = (report: { surfaces: { surface: string }[] }, name: string) =>
  report.surfaces.find((s) => s.surface === name)!;

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  mockDatabase = {
    rows: new Map(),
    writes: [],
    writeResult: () => ({ rowCount: 1 }),
  };
  useKeys(NEW_KEY, [OLD_KEY]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
});

describe("moving values to the active key", () => {
  it("writes both of a server's columns in one UPDATE, as a row version requires", async () => {
    mockDatabase.rows.set(servers, [
      serverRow({
        sshKey: under(() => encryptServerSecret("a key", "sshKey", OWNER)),
        password: under(() =>
          encryptServerSecret("a password", "password", OWNER),
        ),
      }),
    ]);

    const report = await rotateAllSecrets();

    expect(mockDatabase.writes).toHaveLength(1);
    const { sshKey, password } = mockDatabase.writes[0]!.set as {
      sshKey: string;
      password: string;
    };
    expect(sshKey.split(".")[2]).toBe(activeKeyId());
    expect(decryptServerSecret(sshKey, "sshKey", OWNER)).toBe("a key");
    expect(decryptServerSecret(password, "password", OWNER)).toBe("a password");
    expect(surface(report, "servers.sshKey/password").reencrypted).toBe(2);
    expect(report.remaining).toBe(0);
  });

  it("moves each single-value surface", async () => {
    mockDatabase.rows.set(envVars, [
      {
        id: 3,
        eventId: 42,
        key: "API_KEY",
        value: under(() => encryptEnvVarValue("env", 42, "API_KEY")),
        version: VERSION,
      },
    ]);
    mockDatabase.rows.set(systemSettings, [
      {
        key: "smtpPassword",
        value: under(() => encryptSystemSetting("smtp", "smtpPassword")),
        version: VERSION,
      },
    ]);
    mockDatabase.rows.set(users, [
      {
        id: OWNER,
        mfaSecret: under(() => encryptMfaSecret("TOTP", OWNER)),
        version: VERSION,
      },
    ]);
    mockDatabase.rows.set(userVariables, [
      {
        id: 4,
        userId: OWNER,
        key: "VAR",
        value: under(() => encryptVariableValue("var", OWNER, "VAR")),
        version: VERSION,
      },
    ]);

    const report = await rotateAllSecrets();

    expect(report.totalReencrypted).toBe(4);
    const written = new Map(mockDatabase.writes.map((w) => [w.table, w.set]));
    expect(
      decryptEnvVarValue(written.get(envVars)!.value as string, 42, "API_KEY"),
    ).toBe("env");
    expect(
      decryptSystemSetting(
        written.get(systemSettings)!.value as string,
        "smtpPassword",
      ),
    ).toBe("smtp");
    expect(
      decryptMfaSecret(written.get(users)!.mfaSecret as string, OWNER),
    ).toBe("TOTP");
    expect(
      decryptVariableValue(
        written.get(userVariables)!.value as string,
        OWNER,
        "VAR",
      ),
    ).toBe("var");
  });

  it("moves a webhook's secret and headers in one UPDATE", async () => {
    mockDatabase.rows.set(webhooks, [
      webhookRow({
        secret: under(() =>
          encryptWebhookSecret("a secret", "webhook-key", OWNER),
        ),
        headers: under(() =>
          encryptWebhookHeaders({ A: "b" }, "webhook-key", OWNER),
        ),
      }),
    ]);

    const report = await rotateAllSecrets();

    expect(mockDatabase.writes).toHaveLength(1);
    const { secret, headers } = mockDatabase.writes[0]!.set;
    expect(decryptWebhookSecret(secret as string, "webhook-key", OWNER)).toBe(
      "a secret",
    );
    expect(decryptWebhookHeaders(headers, "webhook-key", OWNER)).toEqual({
      A: "b",
    });
    expect(surface(report, "webhooks.secret/headers").reencrypted).toBe(2);
  });

  it("moves a tool credential and its metadata, and OAuth tokens in one UPDATE", async () => {
    const credentials = under(() => storedCredential({ apiKey: "x" }));
    const access = under(() => storedCredential("access"));
    const refresh = under(() => storedCredential("refresh"));
    mockDatabase.rows.set(toolCredentials, [
      { id: 5, credentials, encrypted: true, version: VERSION },
    ]);
    mockDatabase.rows.set(oauthTokens, [
      {
        id: 6,
        accessToken: access,
        refreshToken: refresh,
        version: VERSION,
      },
    ]);

    const report = await rotateAllSecrets();

    expect(report.totalReencrypted).toBe(3);
    const written = new Map(mockDatabase.writes.map((w) => [w.table, w.set]));
    const tool = written.get(toolCredentials)!;
    expect(tool.credentials).not.toBe(credentials);
    expect(tool.encryptionMetadata).toMatchObject({ algorithm: "aes-256-gcm" });
    expect(Object.keys(written.get(oauthTokens)!).sort()).toEqual([
      "accessToken",
      "refreshToken",
    ]);
  });

  it("leaves what's already under the active key, and writes nothing", async () => {
    mockDatabase.rows.set(servers, [
      serverRow({ sshKey: encryptServerSecret("a key", "sshKey", OWNER) }),
    ]);
    mockDatabase.rows.set(toolCredentials, [
      {
        id: 5,
        credentials: storedCredential({ apiKey: "x" }),
        encrypted: true,
        version: VERSION,
      },
    ]);
    mockDatabase.rows.set(oauthTokens, [
      {
        id: 6,
        accessToken: storedCredential("access"),
        refreshToken: null,
        version: VERSION,
      },
    ]);

    const report = await rotateAllSecrets();

    expect(mockDatabase.writes).toEqual([]);
    expect(report.totalReencrypted).toBe(0);
    expect(surface(report, "servers.sshKey/password").skipped).toBe(2);
    expect(surface(report, "oauth_tokens.access/refresh").skipped).toBe(2);
  });

  it("writes nothing in a dry run, and counts what a real run would move", async () => {
    mockDatabase.rows.set(servers, [
      serverRow({
        sshKey: under(() => encryptServerSecret("a key", "sshKey", OWNER)),
      }),
    ]);

    const report = await rotateAllSecrets({ dryRun: true });

    expect(mockDatabase.writes).toEqual([]);
    expect(report.totalReencrypted).toBe(1);
    expect(report.remaining).toBe(1);
  });
});

describe("a write that doesn't apply", () => {
  const seed = () =>
    mockDatabase.rows.set(servers, [
      serverRow({
        sshKey: under(() => encryptServerSecret("a key", "sshKey", OWNER)),
        password: under(() =>
          encryptServerSecret("a password", "password", OWNER),
        ),
      }),
    ]);

  it.each([
    ["no row", { rowCount: 0 }],
    ["no row count at all", { rowCount: null }],
  ])(
    "counts %s as changed, not re-encrypted and not an error",
    async (_n, r) => {
      seed();
      mockDatabase.writeResult = () => r;

      const report = await rotateAllSecrets();

      const result = surface(report, "servers.sshKey/password");
      expect(result).toMatchObject({
        reencrypted: 0,
        errors: 0,
        changedDuringRun: 2,
      });
      expect(report.totalChangedDuringRun).toBe(2);
      expect(report.totalErrors).toBe(0);
      expect(report.remaining).toBe(2);
    },
  );

  it("counts a failed write as errors, carries on, and logs no value", async () => {
    seed();
    mockDatabase.rows.set(users, [
      {
        id: OWNER,
        mfaSecret: under(() => encryptMfaSecret("TOTP", OWNER)),
        version: VERSION,
      },
    ]);
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let calls = 0;
    mockDatabase.writeResult = () => {
      calls += 1;
      if (calls > 1) return { rowCount: 1 };
      throw Object.assign(new Error("Failed query: params: crn.1.secret"), {
        cause: { code: "23514" },
      });
    };

    const report = await rotateAllSecrets();

    expect(surface(report, "servers.sshKey/password").errors).toBe(2);
    expect(surface(report, "users.mfaSecret").reencrypted).toBe(1);
    expect(report.remaining).toBe(2);
    const output = logged.mock.calls.flat().join("\n");
    expect(output).toContain("column=sshKey+password");
    expect(output).toContain("database error 23514");
    expect(output).not.toContain("crn.1.");
  });
});

describe("a value it can't read", () => {
  it("records an error for that column, and still moves the other", async () => {
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockDatabase.rows.set(servers, [
      serverRow({
        sshKey: under(() => encryptServerSecret("a key", "sshKey", OWNER)),
        password: "crn.1.plaintext-canary.a.b.c",
      }),
    ]);

    const report = await rotateAllSecrets();

    const result = surface(report, "servers.sshKey/password");
    expect(result).toMatchObject({ reencrypted: 1, errors: 1 });
    const output = logged.mock.calls.flat().join("\n");
    expect(output).toContain("column=password");
    expect(output).not.toContain("plaintext-canary");
  });

  it.each<[string, unknown, () => void, string]>([
    [
      "an env var",
      envVars,
      () =>
        mockDatabase.rows.set(envVars, [
          {
            id: 3,
            eventId: 42,
            key: "K",
            value: "crn.1.x.a.b.c",
            version: VERSION,
          },
        ]),
      "env_vars.value",
    ],
    [
      "a setting",
      systemSettings,
      () =>
        mockDatabase.rows.set(systemSettings, [
          { key: "smtpPassword", value: "crn.1.x.a.b.c", version: VERSION },
        ]),
      "system_settings.value",
    ],
    [
      "an MFA secret",
      users,
      () =>
        mockDatabase.rows.set(users, [
          { id: OWNER, mfaSecret: "crn.1.x.a.b.c", version: VERSION },
        ]),
      "users.mfaSecret",
    ],
    [
      "a variable",
      userVariables,
      () =>
        mockDatabase.rows.set(userVariables, [
          {
            id: 4,
            userId: OWNER,
            key: "VAR",
            value: "crn.1.x.a.b.c",
            version: VERSION,
          },
        ]),
      "user_variables.value",
    ],
    [
      "a webhook secret",
      webhooks,
      () =>
        mockDatabase.rows.set(webhooks, [
          webhookRow({ secret: "crn.1.x.a.b.c" }),
        ]),
      "webhooks.secret/headers",
    ],
    [
      "webhook headers",
      webhooks,
      () =>
        mockDatabase.rows.set(webhooks, [
          webhookRow({ headers: { __enc: "crn.1.x.a.b.c" } }),
        ]),
      "webhooks.secret/headers",
    ],
    [
      "a credential under a key that's gone",
      toolCredentials,
      () =>
        mockDatabase.rows.set(toolCredentials, [
          {
            id: 5,
            credentials: underKey(LOST_KEY, () => storedCredential({ a: 1 })),
            encrypted: true,
            version: VERSION,
          },
        ]),
      "tool_credentials.credentials",
    ],
    [
      "a token under a key that's gone",
      oauthTokens,
      () =>
        mockDatabase.rows.set(oauthTokens, [
          {
            id: 6,
            accessToken: underKey(LOST_KEY, () => storedCredential("t")),
            refreshToken: null,
            version: VERSION,
          },
        ]),
      "oauth_tokens.access/refresh",
    ],
  ])(
    "records an error for %s, and writes nothing",
    async (_n, _t, seed, name) => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      seed();

      const report = await rotateAllSecrets();

      expect(surface(report, name).errors).toBe(1);
      expect(mockDatabase.writes).toEqual([]);
      expect(report.remaining).toBe(1);
    },
  );
});

describe("what it can't move", () => {
  it("tells ciphertext a key change can orphan from plaintext it can't", async () => {
    mockDatabase.rows.set(servers, [
      serverRow({
        sshKey: staticAad("an old key", OLD_KEY),
        password: "a plaintext password",
      }),
    ]);
    mockDatabase.rows.set(envVars, [
      {
        id: 3,
        eventId: 42,
        key: "K",
        value: staticAad("an old value", OLD_KEY),
        version: VERSION,
      },
    ]);
    mockDatabase.rows.set(users, [
      { id: OWNER, mfaSecret: "PLAINTOTP", version: VERSION },
    ]);

    const report = await rotateAllSecrets();

    expect(report.totalLegacy).toBe(4);
    expect(report.plaintextLegacy).toBe(2);
    expect(mockDatabase.writes).toEqual([]);
  });

  it("counts a variable as plaintext whatever it looks like", async () => {
    mockDatabase.rows.set(userVariables, [
      {
        id: 4,
        userId: OWNER,
        key: "VAR",
        value: "A".repeat(64),
        version: VERSION,
      },
    ]);

    const report = await rotateAllSecrets();

    expect(report.totalLegacy).toBe(1);
    expect(report.plaintextLegacy).toBe(1);
  });

  it.each<[string, string, boolean, number]>([
    ["plaintext marked plaintext", '{"a":1}', false, 1],
    ["something else marked encrypted", "garbage", true, 1],
    ["ciphertext marked plaintext", '{"encrypted":"x"}', false, 1],
    ["an empty string", "", false, 0],
    ["an empty object", "{}", false, 0],
    ["an empty object marked encrypted", "{}", true, 0],
  ])(
    "counts a tool credential row holding %s as legacy only if it holds something",
    async (_name, credentials, encrypted, legacy) => {
      mockDatabase.rows.set(toolCredentials, [
        { id: 5, credentials, encrypted, version: VERSION },
      ]);

      const result = surface(
        await rotateAllSecrets(),
        "tool_credentials.credentials",
      );

      expect(result.legacy).toBe(legacy);
      expect(result.skipped).toBe(1 - legacy);
      expect(mockDatabase.writes).toEqual([]);
    },
  );

  it("counts plaintext OAuth tokens as legacy, and a missing one as nothing", async () => {
    mockDatabase.rows.set(oauthTokens, [
      { id: 6, accessToken: "plain", refreshToken: null, version: VERSION },
    ]);

    const result = surface(
      await rotateAllSecrets(),
      "oauth_tokens.access/refresh",
    );

    expect(result).toMatchObject({ legacy: 1, skipped: 1 });
    expect(mockDatabase.writes).toEqual([]);
  });

  it("counts plaintext webhook values as legacy", async () => {
    mockDatabase.rows.set(webhooks, [
      webhookRow({ secret: "plain", headers: { A: "b" } }),
    ]);

    const result = surface(await rotateAllSecrets(), "webhooks.secret/headers");

    expect(result.legacy).toBe(2);
  });
});
