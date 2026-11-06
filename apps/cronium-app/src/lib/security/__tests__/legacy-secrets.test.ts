/**
 * @jest-environment node
 *
 * What `--encrypt-legacy` decides about each value, with the database faked and the
 * cryptography real. tests/storage/legacy-secrets.test.ts runs the same pass against
 * real Postgres, and is what covers row versions, jsonb round trips, the SQL itself
 * and the CLI.
 */
import { createCipheriv, randomBytes } from "crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { credentialEncryption } from "@/lib/security/credential-encryption";
import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";
import {
  countLegacyPlaintextRows,
  encryptLegacySecrets,
  legacySecretsBootWarning,
  LegacySecretsRefusedError,
} from "@/lib/security/legacy-secrets";
import {
  __resetSecretVaultForTests,
  getSecretVault,
} from "@/lib/security/secret-vault";
import {
  decryptWebhookHeaders,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  encryptWebhookSecret,
} from "@/lib/webhooks/webhook-secret";
import { userVariables, webhooks } from "@/shared/schema";

interface FakeDatabase {
  /** What each read of a table returns in turn: the pass, then a real run's recount. */
  webhookReads: unknown[][];
  variableReads: unknown[][];
  envelopes: { source: string; key_id: string; count: number }[];
  credentials: { source: string; stored: string }[];
  legacyCiphertext: { source: string; stored: string }[];
  plaintextCount: number;
  stringHeaders: { headers: unknown }[];
  writes: { table: unknown; set: Record<string, unknown> }[];
  writeResult: () => { rowCount: number };
}

let mockDatabase: FakeDatabase;

function mockExecute(query: SQL): { rows: unknown[] } {
  const text = new PgDialect().sqlToQuery(query).sql;
  if (text.includes("split_part")) return { rows: mockDatabase.envelopes };
  if (text.includes("tool_credentials")) {
    return { rows: mockDatabase.credentials };
  }
  if (text.includes("api_tokens")) {
    return { rows: mockDatabase.legacyCiphertext };
  }
  if (text.includes("count(*)")) {
    return { rows: [{ count: String(mockDatabase.plaintextCount) }] };
  }
  throw new Error(`Unexpected query: ${text}`);
}

function mockReadsOf(table: unknown): unknown[][] {
  return table === webhooks
    ? mockDatabase.webhookReads
    : mockDatabase.variableReads;
}

// env.mjs is ESM-only, and only `encryption-service` reaches for it here, lazily.
jest.mock("@/env.mjs", () => ({ env: {} }));

jest.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        orderBy: async () => mockReadsOf(table).shift() ?? [],
        where: async () => mockDatabase.stringHeaders,
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
    execute: async (query: SQL) => mockExecute(query),
  },
}));

const OWNER = "owner-1";
const WEBHOOK_KEY = "webhook-key-1";
const VARIABLE_KEY = "API_KEY";
const SECRET = "legacy-secret-canary";
const VALUE = "legacy-value-canary";
const HEADERS = { Authorization: "Bearer legacy-token-canary" };
const CANARIES = [SECRET, VALUE, HEADERS.Authorization];

const KEY_A = "0123456789abcdef".repeat(4);
const KEY_B = "fedcba9876543210".repeat(4);
const KEY_C = "a1b2c3d4e5f60718".repeat(4);

function useKeys(active: string, retired?: string[]) {
  process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
  credentialEncryption.initialize(active);
}

const webhookRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: OWNER,
  key: WEBHOOK_KEY,
  secret: "",
  headers: null as unknown,
  version: "100",
  ...overrides,
});

const variableRow = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  userId: OWNER,
  key: VARIABLE_KEY,
  value: "",
  version: "100",
  ...overrides,
});

/** Rows for the pass. Real runs then recount from an empty table unless told otherwise. */
function givenWebhooks(...rows: unknown[]) {
  mockDatabase.webhookReads = [rows];
}

function givenVariables(...rows: unknown[]) {
  mockDatabase.variableReads = [rows];
}

const webhookResult = (report: { surfaces: { surface: string }[] }) =>
  report.surfaces.find((s) => s.surface === "webhooks");
const variableResult = (report: { surfaces: { surface: string }[] }) =>
  report.surfaces.find((s) => s.surface === "user_variables");

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

/** A tool credential or OAuth token as this key would have stored it. */
function storedCredential(keyHex: string): string {
  credentialEncryption.initialize(keyHex);
  const stored = JSON.stringify(credentialEncryption.encrypt("a credential"));
  credentialEncryption.initialize(process.env.ENCRYPTION_KEY!);
  return stored;
}

const keyIdOf = (keyHex: string) => {
  const active = process.env.ENCRYPTION_KEY!;
  process.env.ENCRYPTION_KEY = keyHex;
  __resetSecretVaultForTests();
  const keyId = getSecretVault().keyIds()[0]!.keyId;
  process.env.ENCRYPTION_KEY = active;
  __resetSecretVaultForTests();
  return keyId;
};

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  mockDatabase = {
    webhookReads: [],
    variableReads: [],
    envelopes: [],
    credentials: [],
    legacyCiphertext: [],
    plaintextCount: 0,
    stringHeaders: [],
    writes: [],
    writeResult: () => ({ rowCount: 1 }),
  };
  useKeys(KEY_A);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
});

describe("a row with something to encrypt", () => {
  it("encrypts a webhook's secret and headers under that webhook", async () => {
    givenWebhooks(webhookRow({ secret: SECRET, headers: HEADERS }));

    const report = await encryptLegacySecrets();

    expect(webhookResult(report)).toMatchObject({ scanned: 1, encrypted: 1 });
    expect(report.totalEncrypted).toBe(1);
    const [{ table, set }] = mockDatabase.writes as [
      { table: unknown; set: { secret: string; headers: { __enc: string } } },
    ];
    expect(table).toBe(webhooks);
    expect(decryptWebhookSecret(set.secret, WEBHOOK_KEY, OWNER)).toBe(SECRET);
    expect(decryptWebhookHeaders(set.headers, WEBHOOK_KEY, OWNER)).toEqual(
      HEADERS,
    );
    expect(() =>
      decryptWebhookSecret(set.secret, WEBHOOK_KEY, "someone-else"),
    ).toThrow();
    expect(() =>
      decryptWebhookSecret(set.secret, "another-webhook", OWNER),
    ).toThrow();
    expect(JSON.stringify(set)).not.toContain(SECRET);
    expect(JSON.stringify(set)).not.toContain(HEADERS.Authorization);
  });

  it("encrypts a variable under its owner and key", async () => {
    givenVariables(variableRow({ value: VALUE }));

    const report = await encryptLegacySecrets();

    expect(variableResult(report)).toMatchObject({ scanned: 1, encrypted: 1 });
    const [{ table, set }] = mockDatabase.writes as [
      { table: unknown; set: { value: string } },
    ];
    expect(table).toBe(userVariables);
    expect(decryptVariableValue(set.value, OWNER, VARIABLE_KEY)).toBe(VALUE);
    expect(() =>
      decryptVariableValue(set.value, OWNER, "ANOTHER_KEY"),
    ).toThrow();
  });

  it("writes only the plaintext half of a row", async () => {
    const secret = encryptWebhookSecret(SECRET, WEBHOOK_KEY, OWNER);
    givenWebhooks(webhookRow({ secret, headers: HEADERS }));

    await encryptLegacySecrets();

    expect(Object.keys(mockDatabase.writes[0]!.set)).toEqual(["headers"]);
  });

  it("uses the active key while a rotation is under way", async () => {
    useKeys(KEY_B, [KEY_A]);
    givenWebhooks(webhookRow({ secret: SECRET }));

    await encryptLegacySecrets();

    const { secret } = mockDatabase.writes[0]!.set as { secret: string };
    expect(secret.split(".")[2]).toBe(keyIdOf(KEY_B));
  });

  it("writes nothing in a dry run, and says what a real run would do", async () => {
    givenWebhooks(webhookRow({ secret: SECRET, headers: HEADERS }));
    givenVariables(variableRow({ value: VALUE }));

    const report = await encryptLegacySecrets({ dryRun: true });

    expect(mockDatabase.writes).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.totalEncrypted).toBe(2);
    expect(report.remaining).toBe(2);
  });
});

describe("a row with nothing to encrypt", () => {
  it.each([
    ["an empty secret and null headers", { secret: "", headers: null }],
    ["empty object headers", { secret: "", headers: {} }],
    ["an empty array of headers", { secret: "", headers: [] }],
    ["falsy headers", { secret: "", headers: 0 }],
  ])("leaves %s alone", async (_name, row) => {
    givenWebhooks(webhookRow(row));

    const report = await encryptLegacySecrets();

    expect(webhookResult(report)).toMatchObject({ upToDate: 1, encrypted: 0 });
    expect(mockDatabase.writes).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("leaves what's already encrypted alone", async () => {
    givenWebhooks(
      webhookRow({
        secret: encryptWebhookSecret(SECRET, WEBHOOK_KEY, OWNER),
        headers: encryptWebhookHeaders(HEADERS, WEBHOOK_KEY, OWNER),
      }),
    );
    givenVariables(
      variableRow({ value: encryptVariableValue(VALUE, OWNER, VARIABLE_KEY) }),
    );

    const report = await encryptLegacySecrets();

    expect(report.totalEncrypted).toBe(0);
    expect(report.remaining).toBe(0);
    expect(mockDatabase.writes).toEqual([]);
  });
});

describe("a row that fails", () => {
  const READS_AS_ENCRYPTED =
    "looks encrypted, but this keyring can't decrypt it for this row";
  const NOT_HEADERS = "not a JSON object of headers";

  function expectNoValueIn(report: { failures: unknown[] }) {
    const text = JSON.stringify(report.failures);
    for (const canary of CANARIES) expect(text).not.toContain(canary);
  }

  it.each<[string, string]>([
    ["garbage", "crn.1.deadbeef.AAAA.BBBB.CCCC"],
    ["a plaintext that starts like an envelope", `crn.${SECRET}`],
  ])(
    "reports a secret that's %s, and doesn't wrap it",
    async (_name, secret) => {
      givenWebhooks(webhookRow({ secret }));

      const report = await encryptLegacySecrets();

      expect(report.failures).toEqual([
        {
          surface: "webhooks",
          id: 1,
          column: "secret",
          reason: READS_AS_ENCRYPTED,
        },
      ]);
      expect(webhookResult(report)).toMatchObject({ failed: 1, encrypted: 0 });
      expect(mockDatabase.writes).toEqual([]);
      expectNoValueIn(report);
    },
  );

  it("reports an envelope copied from another row", async () => {
    givenWebhooks(
      webhookRow({
        secret: encryptWebhookSecret(SECRET, "another-webhook", OWNER),
      }),
    );
    givenVariables(
      variableRow({
        value: encryptVariableValue(VALUE, "another-owner", VARIABLE_KEY),
      }),
    );

    const report = await encryptLegacySecrets();

    expect(report.failures.map((f) => [f.surface, f.column])).toEqual([
      ["webhooks", "secret"],
      ["user_variables", "value"],
    ]);
  });

  it.each<[string, unknown]>([
    ["an array", ["Authorization: Bearer x"]],
    ["a string", "Bearer x"],
    ["a number", 5],
    ["true", true],
  ])(
    "reports headers that are %s, which could hold a credential",
    async (_name, headers) => {
      givenWebhooks(webhookRow({ headers }));

      const report = await encryptLegacySecrets();

      expect(report.failures).toEqual([
        { surface: "webhooks", id: 1, column: "headers", reason: NOT_HEADERS },
      ]);
      expect(mockDatabase.writes).toEqual([]);
    },
  );

  it("reports encrypted headers it can't read", async () => {
    givenWebhooks(
      webhookRow({
        headers: encryptWebhookHeaders(HEADERS, "another-webhook", OWNER),
      }),
    );

    const report = await encryptLegacySecrets();

    expect(report.failures).toEqual([
      {
        surface: "webhooks",
        id: 1,
        column: "headers",
        reason: READS_AS_ENCRYPTED,
      },
    ]);
  });

  it("doesn't encrypt the readable half, and reports every column that failed", async () => {
    givenWebhooks(
      webhookRow({ id: 1, secret: SECRET, headers: ["x"] }),
      webhookRow({ id: 2, secret: "crn.nope", headers: HEADERS }),
      webhookRow({ id: 3, secret: "crn.nope", headers: ["x"] }),
    );

    const report = await encryptLegacySecrets();

    expect(report.failures.map((f) => [f.id, f.column])).toEqual([
      [1, "headers"],
      [2, "secret"],
      [3, "secret"],
      [3, "headers"],
    ]);
    expect(webhookResult(report)).toMatchObject({ failed: 3, encrypted: 0 });
    expect(mockDatabase.writes).toEqual([]);
    expectNoValueIn(report);
  });

  it("doesn't let one failed row stop the rest", async () => {
    givenWebhooks(
      webhookRow({ id: 1, secret: "crn.nope" }),
      webhookRow({ id: 2, secret: SECRET }),
    );

    const report = await encryptLegacySecrets();

    expect(webhookResult(report)).toMatchObject({ failed: 1, encrypted: 1 });
    expect(mockDatabase.writes).toHaveLength(1);
  });

  describe("when encrypting doesn't read back", () => {
    it("reports a secret and doesn't write it", async () => {
      givenWebhooks(webhookRow({ secret: SECRET }));
      jest.spyOn(getSecretVault(), "decrypt").mockReturnValue("something else");

      const report = await encryptLegacySecrets();

      expect(report.failures[0]).toMatchObject({
        column: "secret",
        reason: "did not read back unchanged after encrypting",
      });
      expect(mockDatabase.writes).toEqual([]);
    });

    it("reports headers and doesn't write them", async () => {
      givenWebhooks(webhookRow({ headers: HEADERS }));
      jest
        .spyOn(getSecretVault(), "decrypt")
        .mockReturnValue('{"Authorization":"something else"}');

      const report = await encryptLegacySecrets();

      expect(report.failures[0]).toMatchObject({
        column: "headers",
        reason: "did not read back unchanged after encrypting",
      });
      expect(mockDatabase.writes).toEqual([]);
    });
  });

  describe("when the write fails", () => {
    const failWrite = (error: unknown) => {
      mockDatabase.writeResult = () => {
        throw error;
      };
    };

    it("gives the database's code, naming the columns it was writing", async () => {
      givenWebhooks(webhookRow({ secret: SECRET, headers: HEADERS }));
      failWrite(
        Object.assign(new Error(`Failed query with params: ${SECRET}`), {
          cause: { code: "22001", message: `value too long: ${SECRET}` },
        }),
      );

      const report = await encryptLegacySecrets();

      expect(report.failures).toEqual([
        {
          surface: "webhooks",
          id: 1,
          column: "secret+headers",
          reason: "database error 22001",
        },
      ]);
      expect(webhookResult(report)).toMatchObject({ failed: 1, encrypted: 0 });
      expectNoValueIn(report);
    });

    it("gives an error's name and not its message", async () => {
      givenVariables(variableRow({ value: VALUE }));
      failWrite(new TypeError(`bad value ${VALUE}`));

      const report = await encryptLegacySecrets();

      expect(report.failures[0]!.reason).toBe("TypeError");
      expectNoValueIn(report);
    });

    it("copes with something that isn't an error", async () => {
      givenVariables(variableRow({ value: VALUE }));
      failWrite(VALUE);

      const report = await encryptLegacySecrets();

      expect(report.failures[0]!.reason).toBe("unknown error");
      expectNoValueIn(report);
    });
  });

  it("counts a row the app changed first, and leaves it to the recount", async () => {
    givenWebhooks(webhookRow({ secret: SECRET }));
    mockDatabase.webhookReads.push([webhookRow({ secret: "regenerated" })]);
    mockDatabase.writeResult = () => ({ rowCount: 0 });

    const report = await encryptLegacySecrets();

    expect(webhookResult(report)).toMatchObject({
      changedDuringRun: 1,
      encrypted: 0,
    });
    expect(report.failures).toEqual([]);
    expect(report.remaining).toBe(1);
  });

  it("treats a driver that gives no row count as not written", async () => {
    givenVariables(variableRow({ value: VALUE }));
    mockDatabase.writeResult = () => ({}) as { rowCount: number };

    const report = await encryptLegacySecrets();

    expect(variableResult(report)).toMatchObject({ changedDuringRun: 1 });
  });

  it("counts rows that failed in the recount as remaining", async () => {
    givenWebhooks(webhookRow({ secret: "crn.nope" }));
    mockDatabase.webhookReads.push([webhookRow({ secret: "crn.nope" })]);

    const report = await encryptLegacySecrets();

    expect(report.remaining).toBe(1);
  });
});

describe("whether the keyring fits the database", () => {
  const refused = () =>
    encryptLegacySecrets({ dryRun: true }).catch((e: Error) => e);

  const expectRefusal = async (...found: string[]) => {
    const error = (await refused()) as Error;
    expect(error).toBeInstanceOf(LegacySecretsRefusedError);
    for (const text of found) expect(error.message).toContain(text);
    expect(error.message).toContain("Nothing was changed");
    return error.message;
  };

  const expectAllowed = async () => {
    await expect(encryptLegacySecrets({ dryRun: true })).resolves.toMatchObject(
      { dryRun: true },
    );
  };

  beforeEach(() => {
    // Every case holds plaintext a wrong key would ruin, and must write none of it.
    givenWebhooks(webhookRow({ secret: SECRET }));
  });

  it("refuses to run with no usable key", async () => {
    delete process.env.ENCRYPTION_KEY;
    __resetSecretVaultForTests();
    await expect(encryptLegacySecrets()).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );

    process.env.ENCRYPTION_KEY = "not-hex";
    __resetSecretVaultForTests();
    await expect(encryptLegacySecrets()).rejects.toThrow(/64 hex characters/);
    expect(mockDatabase.writes).toEqual([]);
  });

  it("goes ahead when nothing is encrypted, because there's nothing to check", async () => {
    await expectAllowed();
  });

  describe("envelopes", () => {
    it("goes ahead when one names a key in the ring, without decrypting anything else", async () => {
      mockDatabase.envelopes = [
        { source: "webhooks.secret", key_id: "deadbeef", count: 3 },
        { source: "webhooks.secret", key_id: keyIdOf(KEY_A), count: 1 },
      ];
      mockDatabase.credentials = [
        { source: "tool_credentials.credentials", stored: "unreachable" },
      ];
      const decrypt = jest.spyOn(credentialEncryption, "decrypt");

      await expectAllowed();

      expect(decrypt).not.toHaveBeenCalled();
    });

    it("goes ahead when one names a retired key", async () => {
      useKeys(KEY_B, [KEY_A]);
      mockDatabase.envelopes = [
        { source: "env_vars.value", key_id: keyIdOf(KEY_A), count: 1 },
      ];

      await expectAllowed();
    });

    it("refuses when none does, with the counts and not what it found", async () => {
      mockDatabase.envelopes = [
        { source: "webhooks.secret", key_id: SECRET, count: 2 },
        { source: "webhooks.secret", key_id: "deadbeef", count: 1 },
        { source: "users.mfa_secret", key_id: "deadbeef", count: 4 },
      ];

      const message = await expectRefusal(
        "webhooks.secret (3)",
        "users.mfa_secret (4)",
        keyIdOf(KEY_A),
      );

      expect(message).not.toContain(SECRET);
      expect(message).not.toContain("deadbeef");
    });
  });

  describe("tool credentials and OAuth tokens", () => {
    it("goes ahead when one decrypts", async () => {
      mockDatabase.credentials = [
        {
          source: "tool_credentials.credentials",
          stored: storedCredential(KEY_A),
        },
      ];

      await expectAllowed();
    });

    it("goes ahead when one decrypts under a retired key", async () => {
      useKeys(KEY_B, [KEY_A]);
      mockDatabase.credentials = [
        {
          source: "oauth_tokens.access_token",
          stored: storedCredential(KEY_A),
        },
      ];

      await expectAllowed();
    });

    it("keeps looking past one that doesn't", async () => {
      mockDatabase.credentials = [
        {
          source: "oauth_tokens.access_token",
          stored: storedCredential(KEY_B),
        },
        {
          source: "tool_credentials.credentials",
          stored: storedCredential(KEY_A),
        },
      ];

      await expectAllowed();
    });

    it("refuses when none does, with the counts and not what it found", async () => {
      const stored = storedCredential(KEY_B);
      mockDatabase.credentials = [
        { source: "tool_credentials.credentials", stored },
        { source: "tool_credentials.credentials", stored },
        { source: "oauth_tokens.refresh_token", stored },
      ];

      const message = await expectRefusal(
        "tool_credentials.credentials (2)",
        "oauth_tokens.refresh_token (1)",
      );

      expect(message).not.toContain(
        (JSON.parse(stored) as { encrypted: string }).encrypted,
      );
    });

    it("takes plaintext as saying nothing either way", async () => {
      mockDatabase.credentials = [
        { source: "oauth_tokens.access_token", stored: '{"token":"plain"}' },
        { source: "oauth_tokens.access_token", stored: "{not json" },
      ];

      await expectAllowed();
    });

    it("refuses if the credential service was never given a key", async () => {
      mockDatabase.credentials = [
        {
          source: "tool_credentials.credentials",
          stored: storedCredential(KEY_A),
        },
      ];
      jest.spyOn(credentialEncryption, "decrypt").mockImplementation(() => {
        throw new Error("Encryption not initialized");
      });

      await expectRefusal("tool_credentials.credentials (1)");
    });
  });

  describe("older static-AAD ciphertext", () => {
    it("goes ahead when one authenticates under the active key", async () => {
      mockDatabase.legacyCiphertext = [
        { source: "servers.password", stored: staticAad("a password", KEY_A) },
      ];

      await expectAllowed();
    });

    it("goes ahead when one authenticates under a retired key", async () => {
      useKeys(KEY_B, [KEY_A]);
      mockDatabase.legacyCiphertext = [
        { source: "env_vars.value", stored: staticAad("a value", KEY_A) },
      ];

      await expectAllowed();
    });

    it("refuses when none does, with the counts and not what it found", async () => {
      const stored = staticAad("a password", KEY_B);
      mockDatabase.legacyCiphertext = [
        { source: "servers.password", stored },
        { source: "api_tokens.token", stored },
      ];

      const message = await expectRefusal(
        "servers.password (1)",
        "api_tokens.token (1)",
      );

      expect(message).not.toContain(stored);
    });

    it("refuses a long plaintext of base64 characters, which a read can't open either", async () => {
      mockDatabase.legacyCiphertext = [
        { source: "env_vars.value", stored: "A".repeat(64) },
      ];

      await expectRefusal("env_vars.value (1)");
    });

    it("doesn't count anything a read would pass through, either way", async () => {
      mockDatabase.legacyCiphertext = [
        { source: "env_vars.value", stored: "=".repeat(64) },
        { source: "servers.password", stored: "short" },
      ];

      await expectAllowed();
    });
  });

  it("goes ahead on one fit anywhere, whatever else doesn't", async () => {
    mockDatabase.envelopes = [
      { source: "webhooks.secret", key_id: "deadbeef", count: 1 },
    ];
    mockDatabase.credentials = [
      { source: "oauth_tokens.access_token", stored: storedCredential(KEY_C) },
    ];
    mockDatabase.legacyCiphertext = [
      { source: "servers.password", stored: staticAad("a password", KEY_C) },
      { source: "servers.ssh_key", stored: staticAad("a key", KEY_A) },
    ];

    await expectAllowed();
  });

  it("adds up everything it couldn't read when it refuses", async () => {
    mockDatabase.envelopes = [
      { source: "servers.password", key_id: "deadbeef", count: 2 },
    ];
    mockDatabase.legacyCiphertext = [
      { source: "servers.password", stored: staticAad("a password", KEY_C) },
    ];

    await expectRefusal("servers.password (3)");
  });

  it("refuses a real run before writing a row", async () => {
    mockDatabase.legacyCiphertext = [
      { source: "servers.password", stored: staticAad("a password", KEY_C) },
    ];

    await expect(encryptLegacySecrets()).rejects.toThrow(
      LegacySecretsRefusedError,
    );

    expect(mockDatabase.writes).toEqual([]);
  });
});

describe("the worker's boot warning", () => {
  it("adds the SQL count to the rows SQL can't classify, using the same rule as a run", async () => {
    mockDatabase.plaintextCount = 2;
    mockDatabase.stringHeaders = [
      { headers: HEADERS },
      { headers: {} },
      { headers: ["x"] },
      { headers: "Bearer x" },
      { headers: null },
      { headers: { __enc: "crn.1.a.b.c.d" } },
      { headers: { __enc: "plain" } },
    ];

    await expect(countLegacyPlaintextRows()).resolves.toBe(4);
  });

  it("says how many rows hold plaintext, what to run, and what it may report", async () => {
    mockDatabase.plaintextCount = 3;

    const warning = await legacySecretsBootWarning();

    expect(warning).toContain("3 webhook or user-variable row(s)");
    expect(warning).toContain("still hold plaintext");
    expect(warning).toContain(
      "node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy",
    );
    expect(warning).toContain("names any row it can't encrypt");
  });

  it("says nothing when there's nothing to encrypt", async () => {
    await expect(legacySecretsBootWarning()).resolves.toBeNull();
  });

  it("doesn't touch the key", async () => {
    mockDatabase.plaintextCount = 1;
    delete process.env.ENCRYPTION_KEY;
    __resetSecretVaultForTests();
    const decrypt = jest.spyOn(credentialEncryption, "decrypt");

    await expect(legacySecretsBootWarning()).resolves.toContain("1 webhook");

    expect(decrypt).not.toHaveBeenCalled();
  });
});
