/**
 * Account-security writes whose correctness depends on the database itself: an
 * atomic jsonb update, and the bulk token revocation.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { apiTokens, users } from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";

const USER = "account-security-user";

async function seedUser(codes: string[] = []) {
  await db.insert(users).values({
    id: USER,
    email: "user@example.test",
    username: "user",
    role: "USER",
    status: "ACTIVE",
    mfaEnabled: true,
    mfaRecoveryCodes: codes,
  } as never);
}

async function remainingCodes() {
  const [row] = await db
    .select({ codes: users.mfaRecoveryCodes })
    .from(users)
    .where(eq(users.id, USER));
  return row!.codes;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("consumeMfaRecoveryCode", () => {
  it("consumes a code once and removes only that code", async () => {
    await seedUser(["a", "b", "c"]);

    await expect(storage.consumeMfaRecoveryCode(USER, "b")).resolves.toBe(true);
    await expect(storage.consumeMfaRecoveryCode(USER, "b")).resolves.toBe(
      false,
    );
    await expect(remainingCodes()).resolves.toEqual(["a", "c"]);
  });

  it("refuses an unknown code and leaves the set alone", async () => {
    await seedUser(["a"]);
    await expect(storage.consumeMfaRecoveryCode(USER, "x")).resolves.toBe(
      false,
    );
    await expect(remainingCodes()).resolves.toEqual(["a"]);
  });

  it("does not resurrect codes when different ones are consumed concurrently", async () => {
    // Reading the set, filtering in JS, and writing it back loses updates here:
    // each writer restores the code the other one just spent.
    const codes = Array.from({ length: 10 }, (_, i) => `code-${i}`);
    await seedUser(codes);

    const results = await Promise.all(
      codes.map((code) => storage.consumeMfaRecoveryCode(USER, code)),
    );

    expect(results.every(Boolean)).toBe(true);
    await expect(remainingCodes()).resolves.toEqual([]);
  });

  it("lets only one of many concurrent uses of the same code win", async () => {
    await seedUser(["only"]);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        storage.consumeMfaRecoveryCode(USER, "only"),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("revokeUserSessions", () => {
  it("bumps the session version and revokes the user's API tokens", async () => {
    await seedUser();
    const before = await storage.getUser(USER);
    const created = await storage.createApiToken({
      userId: USER,
      name: "t",
      token: "raw-token-value",
      status: "ACTIVE",
      scopes: ["full"],
    } as never);

    await storage.revokeUserSessions(USER);

    const after = await storage.getUser(USER);
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);
    const [row] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, created.id));
    expect(row!.status).toBe("REVOKED");
    await expect(
      storage.getApiTokenByToken("raw-token-value"),
    ).resolves.toBeUndefined();
  });
});

describe("getApiTokenByToken", () => {
  it("finds a token by hash and does not match on unknown input", async () => {
    await seedUser();
    await storage.createApiToken({
      userId: USER,
      name: "t",
      token: "raw-token-value",
      status: "ACTIVE",
      scopes: ["full"],
    } as never);

    await expect(
      storage.getApiTokenByToken("raw-token-value"),
    ).resolves.toMatchObject({ userId: USER });
    await expect(
      storage.getApiTokenByToken("something-else"),
    ).resolves.toBeUndefined();
  });
});
