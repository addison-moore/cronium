/**
 * The difference between a token that's bad and one that couldn't be checked, with failures
 * Postgres really sends. A mock can't hold this: what matters is that its errors, wrapped by
 * Drizzle, come out as "couldn't check" and don't quote the query's values in the log.
 */
import { eq } from "drizzle-orm";
import { format } from "node:util";
import { authenticateApiToken } from "@/lib/api-auth";
import { hashApiToken } from "@/lib/api-token-hash";
import { encryptionService } from "@/lib/encryption-service";
import { db, pool } from "@/server/db";
import { CredentialCheckFailedError } from "@/server/security/credential-check";
import { storage } from "@/server/storage";
import { apiTokens, users } from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";

const USER = "credential-check-user";
const RAW_TOKEN = "credential-check-raw-token";

async function seed() {
  await db.insert(users).values({
    id: USER,
    email: "user@example.test",
    username: "user",
    role: "USER",
    status: "ACTIVE",
  } as never);
}

const seedHashedToken = () =>
  storage.createApiToken({
    userId: USER,
    name: "hashed",
    token: RAW_TOKEN,
    status: "ACTIVE",
    scopes: ["mcp"],
  } as never);

/** A token from before tokens were hashed: stored encrypted, and hashed on first use. */
const seedLegacyToken = (stored = encryptionService.encrypt(RAW_TOKEN)) =>
  db.insert(apiTokens).values({
    userId: USER,
    name: "legacy",
    token: stored,
    status: "ACTIVE",
    scopes: ["mcp"],
  } as never);

/** Stored by the real service and then changed, so its authentication tag won't pass. */
const undecryptable = () => {
  const stored = encryptionService.encrypt("some-other-token");
  const last = stored.at(-2) === "A" ? "B" : "A";
  return `${stored.slice(0, -2)}${last}${stored.at(-1)}`;
};

const refuseTokenWrites = () =>
  pool.query(`
    CREATE FUNCTION refuse_token_writes() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'writes are refused'; END
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_token_writes BEFORE UPDATE ON api_tokens
    FOR EACH ROW EXECUTE FUNCTION refuse_token_writes();
  `);

const allowTokenWrites = () =>
  pool.query(`
    DROP TRIGGER IF EXISTS refuse_token_writes ON api_tokens;
    DROP FUNCTION IF EXISTS refuse_token_writes();
  `);

let consoleError: jest.SpyInstance;
const logged = () =>
  consoleError.mock.calls
    .map((args) => format(...(args as unknown[])))
    .join("\n");

beforeEach(async () => {
  await resetDatabase();
  await seed();
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(async () => {
  consoleError.mockRestore();
  await allowTokenWrites();
});

afterAll(async () => {
  await closePool();
});

describe("a lookup Postgres refuses", () => {
  // Rather than stop the server, which every other query here needs.
  async function withTheTableGone(run: () => Promise<void>) {
    await pool.query("ALTER TABLE api_tokens RENAME TO api_tokens_away");
    try {
      await run();
    } finally {
      await pool.query("ALTER TABLE api_tokens_away RENAME TO api_tokens");
    }
  }

  it("is a failed check, not a bad token", async () => {
    await seedHashedToken();

    await withTheTableGone(async () => {
      await expect(authenticateApiToken(RAW_TOKEN)).rejects.toBeInstanceOf(
        CredentialCheckFailedError,
      );
    });
  });

  it("logs why, without the hash it was looking for", async () => {
    await withTheTableGone(async () => {
      await authenticateApiToken(RAW_TOKEN).catch(() => undefined);
    });

    expect(logged()).toContain("Error validating API token");
    expect(logged()).toContain("42P01");
    expect(logged()).not.toContain(hashApiToken(RAW_TOKEN));
  });
});

describe("a database that reads but won't write", () => {
  it("passes a good token, whose use it can't record", async () => {
    await seedHashedToken();
    await refuseTokenWrites();

    await expect(authenticateApiToken(RAW_TOKEN)).resolves.toMatchObject({
      userId: USER,
    });
    expect(logged()).toContain("Error recording API token use");
    expect(logged()).toContain("P0001");
  });

  it("still knows a bad token is bad", async () => {
    await seedHashedToken();
    await refuseTokenWrites();

    await expect(authenticateApiToken("not-a-token")).resolves.toBeNull();
  });

  it("doesn't take a good token from before hashing for an unknown one", async () => {
    await seedLegacyToken();
    await refuseTokenWrites();

    await expect(authenticateApiToken(RAW_TOKEN)).rejects.toBeInstanceOf(
      CredentialCheckFailedError,
    );
    expect(logged()).not.toContain("Failed to decrypt");
  });

  it("hashes that token on its next use, once writes are back", async () => {
    await seedLegacyToken();
    await refuseTokenWrites();
    await authenticateApiToken(RAW_TOKEN).catch(() => undefined);
    await allowTokenWrites();

    await expect(authenticateApiToken(RAW_TOKEN)).resolves.toMatchObject({
      userId: USER,
    });
    const [row] = await db
      .select({ token: apiTokens.token })
      .from(apiTokens)
      .where(eq(apiTokens.userId, USER));
    expect(row?.token).toBe(hashApiToken(RAW_TOKEN));
  });
});

describe("a stored token that can't be decrypted", () => {
  it("is only skipped, so the search finds the good one after it", async () => {
    await seedLegacyToken(undecryptable());
    await seedLegacyToken();

    await expect(authenticateApiToken(RAW_TOKEN)).resolves.toMatchObject({
      userId: USER,
    });
    expect(logged()).toContain("Failed to decrypt legacy API token");
  });

  it("leaves a token nobody holds as unknown, not as a failed check", async () => {
    await seedLegacyToken(undecryptable());

    await expect(authenticateApiToken("not-a-token")).resolves.toBeNull();
    expect(logged()).toContain("Failed to decrypt legacy API token");
  });
});
