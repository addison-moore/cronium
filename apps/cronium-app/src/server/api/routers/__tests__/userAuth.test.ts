/** @jest-environment node */
/**
 * Router tests for userAuth.ts, run through the REAL protectedProcedure /
 * publicProcedure middleware chain from trpc.ts (live-principal re-check,
 * role capability enforcement, fail-closed auth rate limiting), with the
 * database, storage, email, and crypto boundaries mocked.
 *
 * Security regressions covered:
 * - login: uniform failure (message AND a bcrypt compare on every path — the
 *   unknown-user / passwordless-user timing oracle fix).
 * - forgotPassword: indistinguishable responses for registered vs unknown
 *   emails, including when SMTP is unconfigured (enumeration fix).
 * - register: role/status can never be injected by the caller.
 * - resetPassword: single-use token claim, sessionVersion-bumping password
 *   update, active API tokens revoked.
 * - No procedure ever echoes password / mfaSecret / mfaRecoveryCodes.
 */
const dbState: {
  rows: Array<Record<string, unknown>>;
  error: Error | null;
} = { rows: [], error: null };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => {
            if (dbState.error) return Promise.reject(dbState.error);
            return Promise.resolve(dbState.rows);
          }),
        })),
      })),
    })),
  },
}));

jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(true)),
    delete: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: {
    checkLimit: jest.fn(() => Promise.resolve()),
    tryCheckLimit: jest.fn(() => Promise.resolve({ allowed: true })),
  },
}));

const rateLimitState = { allowed: true };

jest.mock("@/lib/security/atomic-rate-limiter", () => ({
  consumeAtomicRateLimit: jest.fn(() =>
    Promise.resolve({
      allowed: rateLimitState.allowed,
      remaining: rateLimitState.allowed ? 1 : 0,
      resetAt: new Date(Date.now() + 60_000),
    }),
  ),
}));

jest.mock("@/lib/security/client-ip", () => ({
  clientIpFromHeaders: jest.fn(() => "203.0.113.7"),
}));

jest.mock("@/server/storage", () => ({
  storage: {
    getUser: jest.fn(),
    getUserByUsername: jest.fn(),
    getUserByEmail: jest.fn(),
    getUserByInviteToken: jest.fn(),
    getSetting: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    createPasswordResetToken: jest.fn(),
    consumePasswordResetToken: jest.fn(),
    getPasswordResetToken: jest.fn(),
    deleteExpiredPasswordResetTokens: jest.fn(),
    getUserApiTokens: jest.fn(),
    revokeApiToken: jest.fn(),
  },
}));

jest.mock("@/lib/first-run", () => ({
  isSetupRequired: jest.fn(),
}));

jest.mock("@/lib/email", () => ({
  getSmtpSettings: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock("@/lib/encryption-service", () => ({
  encryptionService: {
    hashPassword: jest.fn(),
    verifyPassword: jest.fn(),
  },
}));

// nanoid v5 is ESM-only (next/jest does not transform it); the mock also lets
// tests assert the reset-token entropy contract (nanoid(32)).
jest.mock("nanoid", () => ({
  nanoid: jest.fn((size?: number) => `nanoid-${size ?? 21}`),
}));

import type { Session } from "next-auth";
// Pull the next-auth module augmentation (id/role/status/sessionVersion) into
// this test's TypeScript program.
import type {} from "@/types/next-auth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { userAuthRouter } from "@/server/api/routers/userAuth";
import { TokenStatus, UserRole, UserStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { isSetupRequired } from "@/lib/first-run";
import { getSmtpSettings, sendPasswordResetEmail } from "@/lib/email";
import { encryptionService } from "@/lib/encryption-service";
import { consumeAtomicRateLimit } from "@/lib/security/atomic-rate-limiter";
import { nanoid } from "nanoid";

// Mount under "userAuth" so route paths match route-capabilities.ts entries
// (e.g. "userAuth.updateProfile" -> "edit", denied to Viewer).
const rootRouter = createTRPCRouter({ userAuth: userAuthRouter });
const createCaller = createCallerFactory(rootRouter);

type AnyMock = jest.Mock;
const mocked = <T>(fn: T): AnyMock => fn as unknown as AnyMock;

const s = storage as unknown as Record<
  | "getUser"
  | "getUserByUsername"
  | "getUserByEmail"
  | "getUserByInviteToken"
  | "getSetting"
  | "createUser"
  | "updateUser"
  | "deleteUser"
  | "createPasswordResetToken"
  | "consumePasswordResetToken"
  | "getPasswordResetToken"
  | "deleteExpiredPasswordResetTokens"
  | "getUserApiTokens"
  | "revokeApiToken",
  AnyMock
>;

const SMTP_CONFIGURED = {
  host: "smtp.example.com",
  port: 587,
  user: "mailer",
  password: "mailer-pass",
  fromEmail: "noreply@example.com",
  fromName: "Cronium",
};

const SECRET_FIELDS = ["password", "mfaSecret", "mfaRecoveryCodes"] as const;

function expectNoSecrets(obj: Record<string, unknown>) {
  for (const field of SECRET_FIELDS) {
    expect(obj).not.toHaveProperty(field);
  }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    username: "alice",
    email: "alice@example.com",
    password: "$2b$12$storedHashForAlicexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    firstName: null,
    lastName: null,
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mfaEnabled: false,
    mfaSecret: "encrypted-totp-secret",
    mfaRecoveryCodes: ["recovery-hash-1"],
    inviteToken: null,
    inviteExpiry: null,
    lastLogin: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function principalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    mfaEnabled: false,
    ...overrides,
  };
}

function sessionFor(overrides: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: "user-1",
      email: "alice@example.com",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

function callerWith(session: Session | null) {
  return createCaller({
    session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const publicCaller = () => callerWith(null);

const VALID_PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "brand-new-password-1";

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitState.allowed = true;
  dbState.rows = [principalRow()];
  dbState.error = null;

  mocked(isSetupRequired).mockResolvedValue(false);
  mocked(getSmtpSettings).mockResolvedValue(SMTP_CONFIGURED);
  mocked(sendPasswordResetEmail).mockResolvedValue(true);
  mocked(encryptionService.hashPassword).mockImplementation((pw: string) =>
    Promise.resolve(`hashed:${pw}`),
  );
  mocked(encryptionService.verifyPassword).mockResolvedValue(false);

  s.getUser.mockResolvedValue(undefined);
  s.getUserByUsername.mockResolvedValue(undefined);
  s.getUserByEmail.mockResolvedValue(undefined);
  s.getUserByInviteToken.mockResolvedValue(undefined);
  s.getSetting.mockResolvedValue(undefined);
  s.createUser.mockImplementation((data: Record<string, unknown>) =>
    Promise.resolve(userRow(data)),
  );
  s.updateUser.mockImplementation((id: string, data: Record<string, unknown>) =>
    Promise.resolve(userRow({ id, ...data })),
  );
  s.deleteUser.mockResolvedValue(true);
  s.createPasswordResetToken.mockResolvedValue({});
  s.consumePasswordResetToken.mockResolvedValue(undefined);
  s.getPasswordResetToken.mockResolvedValue(undefined);
  s.deleteExpiredPasswordResetTokens.mockResolvedValue(undefined);
  s.getUserApiTokens.mockResolvedValue([]);
  s.revokeApiToken.mockResolvedValue({});
});

describe("userAuth.register", () => {
  const input = {
    username: "newuser",
    email: "new@example.com",
    password: "a-long-valid-password",
  };

  it("creates a regular USER with ACTIVE status when registration is open", async () => {
    const result = await publicCaller().userAuth.register(input);

    expect(s.createUser).toHaveBeenCalledTimes(1);
    const created = s.createUser.mock.calls[0]![0] as Record<string, unknown>;
    expect(created).toMatchObject({
      username: "newuser",
      email: "new@example.com",
      password: "a-long-valid-password", // hashing is storage.createUser's contract
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
    expectNoSecrets(result as Record<string, unknown>);
    expect(result.username).toBe("newuser");
  });

  it("never honors a caller-supplied role or status (privilege injection)", async () => {
    await publicCaller().userAuth.register({
      ...input,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    } as never);

    const created = s.createUser.mock.calls[0]![0] as Record<string, unknown>;
    expect(created.role).toBe(UserRole.USER);
  });

  it("creates a PENDING user when admin approval is required", async () => {
    s.getSetting.mockImplementation((key: string) =>
      Promise.resolve(
        key === "requireAdminApproval" ? { value: "true" } : undefined,
      ),
    );
    await publicCaller().userAuth.register(input);
    const created = s.createUser.mock.calls[0]![0] as Record<string, unknown>;
    expect(created.status).toBe(UserStatus.PENDING);
  });

  it("rejects registration before first-run setup", async () => {
    mocked(isSetupRequired).mockResolvedValue(true);
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it("rejects a taken username with CONFLICT", async () => {
    s.getUserByUsername.mockResolvedValue(userRow());
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "CONFLICT", message: "Username already taken" },
    );
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it("rejects a registered email with CONFLICT", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "CONFLICT", message: "Email already registered" },
    );
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it.each([
    ["inviteOnly", "true"],
    ["allowRegistration", "false"],
  ])("rejects when %s=%s", async (key, value) => {
    s.getSetting.mockImplementation((k: string) =>
      Promise.resolve(k === key ? { value } : undefined),
    );
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "FORBIDDEN", message: "Registration is currently closed" },
    );
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 12 characters (zod)", async () => {
    await expect(
      publicCaller().userAuth.register({ ...input, password: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it("rejects invalid email and short username (zod)", async () => {
    await expect(
      publicCaller().userAuth.register({ ...input, email: "not-an-email" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      publicCaller().userAuth.register({ ...input, username: "ab" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is denied before touching storage when the auth rate limit is exhausted", async () => {
    rateLimitState.allowed = false;
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "TOO_MANY_REQUESTS" },
    );
    expect(s.getUserByUsername).not.toHaveBeenCalled();
    expect(mocked(consumeAtomicRateLimit)).toHaveBeenCalledWith(
      "203.0.113.7",
      "userAuth.register",
      { maxRequests: 5, windowMs: 60_000 },
    );
  });

  it("wraps unexpected failures as INTERNAL_SERVER_ERROR", async () => {
    s.getUserByUsername.mockRejectedValue(new Error("db down"));
    await expect(publicCaller().userAuth.register(input)).rejects.toMatchObject(
      { code: "INTERNAL_SERVER_ERROR" },
    );
  });
});

describe("userAuth.forgotPassword", () => {
  const GENERIC = {
    success: true,
    message:
      "If an account with that email exists, we've sent a password reset link.",
  };

  it("creates a 1-hour single-use token and emails it for an active account", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    const before = Date.now();

    const result = await publicCaller().userAuth.forgotPassword({
      email: "alice@example.com",
    });

    expect(result).toEqual(GENERIC);
    expect(mocked(nanoid)).toHaveBeenCalledWith(32);
    expect(s.createPasswordResetToken).toHaveBeenCalledTimes(1);
    const token = s.createPasswordResetToken.mock.calls[0]![0] as {
      userId: string;
      token: string;
      expiresAt: Date;
      used: boolean;
    };
    expect(token.userId).toBe("user-1");
    expect(token.token).toBe("nanoid-32");
    expect(token.used).toBe(false);
    const ttlMs = token.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(59 * 60 * 1000);
    expect(ttlMs).toBeLessThan(61 * 60 * 1000);
    expect(mocked(sendPasswordResetEmail)).toHaveBeenCalledWith(
      "alice@example.com",
      "nanoid-32",
    );
  });

  it("returns the identical generic response for unknown and inactive accounts (no enumeration)", async () => {
    const unknown = await publicCaller().userAuth.forgotPassword({
      email: "nobody@example.com",
    });

    s.getUserByEmail.mockResolvedValue(userRow({ status: UserStatus.PENDING }));
    const inactive = await publicCaller().userAuth.forgotPassword({
      email: "alice@example.com",
    });

    s.getUserByEmail.mockResolvedValue(userRow());
    const active = await publicCaller().userAuth.forgotPassword({
      email: "alice@example.com",
    });

    expect(unknown).toEqual(GENERIC);
    expect(inactive).toEqual(GENERIC);
    expect(active).toEqual(GENERIC);
    // Only the active path did any work.
    expect(s.createPasswordResetToken).toHaveBeenCalledTimes(1);
    expect(mocked(sendPasswordResetEmail)).toHaveBeenCalledTimes(1);
  });

  it("reports unconfigured SMTP identically for registered and unknown emails (enumeration fix)", async () => {
    mocked(getSmtpSettings).mockResolvedValue({
      ...SMTP_CONFIGURED,
      host: undefined,
    });

    s.getUserByEmail.mockResolvedValue(userRow());
    const registered = await publicCaller()
      .userAuth.forgotPassword({ email: "alice@example.com" })
      .catch((e: unknown) => e);

    s.getUserByEmail.mockResolvedValue(undefined);
    const unknown = await publicCaller()
      .userAuth.forgotPassword({ email: "nobody@example.com" })
      .catch((e: unknown) => e);

    expect(registered).toMatchObject({
      code: "BAD_REQUEST",
      message: "Email is not configured. Please contact your administrator.",
    });
    expect(unknown).toMatchObject({
      code: "BAD_REQUEST",
      message: "Email is not configured. Please contact your administrator.",
    });
    // The account is never even looked up, and no token is minted.
    expect(s.getUserByEmail).not.toHaveBeenCalled();
    expect(s.createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("still maps a mid-flight SMTP_CONFIG_MISSING send failure to BAD_REQUEST", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    mocked(sendPasswordResetEmail).mockRejectedValue(
      new Error("SMTP_CONFIG_MISSING"),
    );
    await expect(
      publicCaller().userAuth.forgotPassword({ email: "alice@example.com" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects malformed email (zod) and rate-limited callers", async () => {
    await expect(
      publicCaller().userAuth.forgotPassword({ email: "nope" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    rateLimitState.allowed = false;
    await expect(
      publicCaller().userAuth.forgotPassword({ email: "alice@example.com" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("userAuth.resetPassword", () => {
  const input = { token: "reset-token", password: NEW_PASSWORD };

  it("consumes the token, stores only the hash, and revokes active API tokens", async () => {
    s.consumePasswordResetToken.mockResolvedValue({
      id: 1,
      userId: "user-1",
      token: "reset-token",
      used: true,
    });
    s.getUser.mockResolvedValue(userRow());
    s.getUserApiTokens.mockResolvedValue([
      { id: 11, status: TokenStatus.ACTIVE },
      { id: 12, status: TokenStatus.REVOKED },
      { id: 13, status: TokenStatus.ACTIVE },
    ]);

    const result = await publicCaller().userAuth.resetPassword(input);

    expect(result.success).toBe(true);
    expect(s.consumePasswordResetToken).toHaveBeenCalledWith("reset-token");
    expect(mocked(encryptionService.hashPassword)).toHaveBeenCalledWith(
      NEW_PASSWORD,
    );
    // The plaintext password never reaches updateUser; the password-bearing
    // update is what bumps sessionVersion in storage (same UPDATE statement).
    expect(s.updateUser).toHaveBeenCalledWith("user-1", {
      password: `hashed:${NEW_PASSWORD}`,
    });
    expect(s.revokeApiToken).toHaveBeenCalledTimes(2);
    expect(s.revokeApiToken).toHaveBeenCalledWith(11);
    expect(s.revokeApiToken).toHaveBeenCalledWith(13);
    expect(s.deleteExpiredPasswordResetTokens).toHaveBeenCalled();
  });

  it("rejects an invalid, used, or expired token without touching any account", async () => {
    await expect(
      publicCaller().userAuth.resetPassword(input),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid or expired reset token.",
    });
    expect(mocked(encryptionService.hashPassword)).not.toHaveBeenCalled();
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the token's user no longer exists", async () => {
    s.consumePasswordResetToken.mockResolvedValue({
      userId: "ghost",
      token: "reset-token",
    });
    await expect(
      publicCaller().userAuth.resetPassword(input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("enforces the password policy (zod) and the rate limit", async () => {
    await expect(
      publicCaller().userAuth.resetPassword({ ...input, password: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.consumePasswordResetToken).not.toHaveBeenCalled();

    rateLimitState.allowed = false;
    await expect(
      publicCaller().userAuth.resetPassword(input),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("userAuth.verifyToken", () => {
  it("reports valid for a live token and invalid otherwise", async () => {
    s.getPasswordResetToken.mockResolvedValue({ id: 1, userId: "user-1" });
    await expect(
      publicCaller().userAuth.verifyToken({ token: "t" }),
    ).resolves.toMatchObject({ valid: true });

    s.getPasswordResetToken.mockResolvedValue(undefined);
    await expect(
      publicCaller().userAuth.verifyToken({ token: "t" }),
    ).resolves.toMatchObject({ valid: false });
  });

  it("rejects empty tokens (zod), rate-limited callers, and wraps storage failures", async () => {
    await expect(
      publicCaller().userAuth.verifyToken({ token: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    s.getPasswordResetToken.mockRejectedValue(new Error("db down"));
    await expect(
      publicCaller().userAuth.verifyToken({ token: "t" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    rateLimitState.allowed = false;
    await expect(
      publicCaller().userAuth.verifyToken({ token: "t" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("userAuth.login", () => {
  const input = { username: "alice", password: VALID_PASSWORD };

  it("authenticates an active user and never echoes credential material", async () => {
    s.getUserByUsername.mockResolvedValue(userRow());
    mocked(encryptionService.verifyPassword).mockResolvedValue(true);

    const result = await publicCaller().userAuth.login(input);

    expect(mocked(encryptionService.verifyPassword)).toHaveBeenCalledWith(
      VALID_PASSWORD,
      userRow().password,
    );
    expect(s.updateUser).toHaveBeenCalledWith("user-1", {
      lastLogin: expect.any(Date),
    });
    expect(result.success).toBe(true);
    if (!result.success || !("user" in result)) {
      throw new Error("expected a success result with user");
    }
    expectNoSecrets(result.user as unknown as Record<string, unknown>);
  });

  it("falls back to email lookup when the username is unknown", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    mocked(encryptionService.verifyPassword).mockResolvedValue(true);

    const result = await publicCaller().userAuth.login({
      ...input,
      username: "alice@example.com",
    });
    expect(result.success).toBe(true);
    expect(s.getUserByEmail).toHaveBeenCalledWith("alice@example.com");
  });

  it("fails uniformly (same code and message) for unknown user, wrong password, and inactive account", async () => {
    const failureOf = async () =>
      publicCaller()
        .userAuth.login(input)
        .then(() => {
          throw new Error("expected login to fail");
        })
        .catch((e: { code: string; message: string }) => e);

    // Unknown user
    const unknown = await failureOf();

    // Known user, wrong password
    s.getUserByUsername.mockResolvedValue(userRow());
    mocked(encryptionService.verifyPassword).mockResolvedValue(false);
    const wrongPassword = await failureOf();

    // Correct password but not ACTIVE
    s.getUserByUsername.mockResolvedValue(
      userRow({ status: UserStatus.DISABLED }),
    );
    mocked(encryptionService.verifyPassword).mockResolvedValue(true);
    const disabled = await failureOf();

    for (const failure of [unknown, wrongPassword, disabled]) {
      expect(failure).toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(unknown.message).toBe(wrongPassword.message);
    expect(wrongPassword.message).toBe(disabled.message);
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("performs a bcrypt comparison even for unknown users (timing-oracle regression)", async () => {
    await expect(publicCaller().userAuth.login(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const verify = mocked(encryptionService.verifyPassword);
    expect(verify).toHaveBeenCalledTimes(1);
    const [password, hash] = verify.mock.calls[0] as [string, string];
    expect(password).toBe(VALID_PASSWORD);
    // A real bcrypt dummy hash, not "" (empty-hash compares short-circuit fast).
    expect(hash).toMatch(/^\$2b\$12\$/);
  });

  it("compares against the dummy hash for accounts with no password set", async () => {
    s.getUserByUsername.mockResolvedValue(userRow({ password: null }));
    await expect(publicCaller().userAuth.login(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const [, hash] = mocked(encryptionService.verifyPassword).mock.calls[0] as [
      string,
      string,
    ];
    expect(hash).toMatch(/^\$2b\$12\$/);
  });

  it("demands a second factor for MFA-enabled accounts before reporting success", async () => {
    s.getUserByUsername.mockResolvedValue(userRow({ mfaEnabled: true }));
    mocked(encryptionService.verifyPassword).mockResolvedValue(true);

    const challenge = await publicCaller().userAuth.login(input);
    expect(challenge).toEqual({ success: false, mfaRequired: true });
    expect(s.updateUser).not.toHaveBeenCalled();

    const withTotp = await publicCaller().userAuth.login({
      ...input,
      totp: "123456",
    });
    expect(withTotp.success).toBe(true);
  });

  it("rejects empty credentials (zod) and rate-limited attempts", async () => {
    await expect(
      publicCaller().userAuth.login({ username: "", password: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      publicCaller().userAuth.login({ username: "alice", password: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    rateLimitState.allowed = false;
    await expect(publicCaller().userAuth.login(input)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(s.getUserByUsername).not.toHaveBeenCalled();
    expect(mocked(consumeAtomicRateLimit)).toHaveBeenCalledWith(
      "203.0.113.7",
      "userAuth.login",
      { maxRequests: 10, windowMs: 60_000 },
    );
  });

  it("wraps unexpected failures as INTERNAL_SERVER_ERROR", async () => {
    s.getUserByUsername.mockRejectedValue(new Error("db down"));
    await expect(publicCaller().userAuth.login(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("userAuth.getCurrentUser", () => {
  it("returns the caller's profile without credential material", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    const result = await callerWith(sessionFor()).userAuth.getCurrentUser();
    expect(result.id).toBe("user-1");
    expectNoSecrets(result as Record<string, unknown>);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      publicCaller().userAuth.getCurrentUser(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a session without a usable email", async () => {
    await expect(
      callerWith(sessionFor({ email: "" })).userAuth.getCurrentUser(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns NOT_FOUND when the account row is gone", async () => {
    await expect(
      callerWith(sessionFor()).userAuth.getCurrentUser(),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is readable by a Viewer (view capability)", async () => {
    dbState.rows = [principalRow({ role: UserRole.VIEWER, roleId: 3 })];
    s.getUserByEmail.mockResolvedValue(userRow({ role: UserRole.VIEWER }));
    await expect(
      callerWith(
        sessionFor({ role: UserRole.VIEWER }),
      ).userAuth.getCurrentUser(),
    ).resolves.toMatchObject({ id: "user-1" });
  });

  it("wraps storage failures as INTERNAL_SERVER_ERROR", async () => {
    s.getUserByEmail.mockRejectedValue(new Error("db down"));
    await expect(
      callerWith(sessionFor()).userAuth.getCurrentUser(),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("userAuth.updateProfile", () => {
  it("updates only the caller's own row, resolved from the session", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    s.getUserByUsername.mockResolvedValue(undefined);

    const result = await callerWith(sessionFor()).userAuth.updateProfile({
      username: "newalice",
    });

    expect(s.updateUser).toHaveBeenCalledTimes(1);
    const [targetId, patch] = s.updateUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(targetId).toBe("user-1"); // the session's user, never caller-chosen
    expect(patch).toEqual({
      username: "newalice",
      updatedAt: expect.any(Date),
    });
    expectNoSecrets(result as Record<string, unknown>);
  });

  it("strips smuggled fields so user A cannot retarget or escalate (zod strips unknown keys)", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    await callerWith(sessionFor()).userAuth.updateProfile({
      username: "newalice",
      id: "victim-user",
      role: UserRole.ADMIN,
      sessionVersion: 99,
    } as never);

    const [targetId, patch] = s.updateUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(targetId).toBe("user-1");
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("role");
    expect(patch).not.toHaveProperty("sessionVersion");
  });

  it("rejects a taken username or email with CONFLICT", async () => {
    s.getUserByEmail.mockImplementation((email: string) =>
      Promise.resolve(
        email === "alice@example.com" ? userRow() : userRow({ id: "user-2" }),
      ),
    );
    s.getUserByUsername.mockResolvedValue(userRow({ id: "user-2" }));

    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({ username: "taken" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({
        email: "taken@example.com",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("skips the conflict check when the values are unchanged", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    await callerWith(sessionFor()).userAuth.updateProfile({
      username: "alice",
      email: "alice@example.com",
    });
    expect(s.getUserByUsername).not.toHaveBeenCalled();
    // Only the self-lookup; no second conflict lookup for the same email.
    expect(s.getUserByEmail).toHaveBeenCalledTimes(1);
    expect(s.updateUser).toHaveBeenCalled();
  });

  it("is FORBIDDEN for Viewers (edit capability) and UNAUTHORIZED without a session", async () => {
    dbState.rows = [principalRow({ role: UserRole.VIEWER, roleId: 3 })];
    await expect(
      callerWith(sessionFor({ role: UserRole.VIEWER })).userAuth.updateProfile({
        username: "newalice",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      publicCaller().userAuth.updateProfile({ username: "newalice" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("validates input shape (zod)", async () => {
    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({ username: "ab" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({ email: "nope" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a session without a usable email, and a vanished account row", async () => {
    await expect(
      callerWith(sessionFor({ email: "" })).userAuth.updateProfile({
        username: "newalice",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // Session email no longer maps to an account.
    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({ username: "newalice" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });
});

describe("userAuth.deleteAccount", () => {
  it("deletes only the caller's own account", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    await expect(
      callerWith(sessionFor()).userAuth.deleteAccount(),
    ).resolves.toEqual({ success: true });
    expect(s.deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("is FORBIDDEN for Viewers and UNAUTHORIZED without a session", async () => {
    dbState.rows = [principalRow({ role: UserRole.VIEWER, roleId: 3 })];
    await expect(
      callerWith(
        sessionFor({ role: UserRole.VIEWER }),
      ).userAuth.deleteAccount(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(publicCaller().userAuth.deleteAccount()).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the account row is already gone", async () => {
    await expect(
      callerWith(sessionFor()).userAuth.deleteAccount(),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects a session without a usable email", async () => {
    await expect(
      callerWith(sessionFor({ email: "" })).userAuth.deleteAccount(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.deleteUser).not.toHaveBeenCalled();
  });
});

describe("userAuth.activateAccount", () => {
  const input = { token: "invite-token", password: NEW_PASSWORD };
  const invitedUser = () =>
    userRow({
      status: UserStatus.INVITED,
      password: null,
      inviteToken: "invite-token",
      inviteExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

  it("activates an invited account, storing only the password hash and clearing the token", async () => {
    s.getUserByInviteToken.mockResolvedValue(invitedUser());

    const result = await publicCaller().userAuth.activateAccount(input);
    expect(result.success).toBe(true);
    expect(mocked(encryptionService.hashPassword)).toHaveBeenCalledWith(
      NEW_PASSWORD,
    );
    expect(s.updateUser).toHaveBeenCalledWith("user-1", {
      status: UserStatus.ACTIVE,
      password: `hashed:${NEW_PASSWORD}`,
      inviteToken: null,
      inviteExpiry: null,
      updatedAt: expect.any(Date),
    });
  });

  it("rejects an unknown invite token", async () => {
    await expect(
      publicCaller().userAuth.activateAccount(input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an expired invite token", async () => {
    s.getUserByInviteToken.mockResolvedValue(
      userRow({
        status: UserStatus.INVITED,
        inviteExpiry: new Date(Date.now() - 1000),
      }),
    );
    await expect(
      publicCaller().userAuth.activateAccount(input),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invitation token has expired",
    });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("rejects re-activation of an already-active account (invite token replay)", async () => {
    s.getUserByInviteToken.mockResolvedValue(
      userRow({ inviteToken: "invite-token", status: UserStatus.ACTIVE }),
    );
    await expect(
      publicCaller().userAuth.activateAccount(input),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This account has already been activated",
    });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("enforces the password policy (zod) and the rate limit", async () => {
    await expect(
      publicCaller().userAuth.activateAccount({ ...input, password: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.getUserByInviteToken).not.toHaveBeenCalled();

    rateLimitState.allowed = false;
    await expect(
      publicCaller().userAuth.activateAccount(input),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("userAuth.verifyInviteToken", () => {
  it("returns the invitee's email for a valid token", async () => {
    s.getUserByInviteToken.mockResolvedValue(
      userRow({
        status: UserStatus.INVITED,
        inviteToken: "invite-token",
        inviteExpiry: new Date(Date.now() + 60_000),
      }),
    );
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "invite-token" }),
    ).resolves.toEqual({
      valid: true,
      message: "Token verified successfully",
      email: "alice@example.com",
    });
  });

  it("rejects unknown, expired, and already-used tokens distinctly by state", async () => {
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    s.getUserByInviteToken.mockResolvedValue(
      userRow({
        status: UserStatus.INVITED,
        inviteExpiry: new Date(Date.now() - 1000),
      }),
    );
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "expired" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    s.getUserByInviteToken.mockResolvedValue(
      userRow({ status: UserStatus.ACTIVE }),
    );
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "used" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty tokens (zod) and rate-limited callers", async () => {
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    rateLimitState.allowed = false;
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "t" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("unexpected-failure wrapping (INTERNAL_SERVER_ERROR, no detail leak)", () => {
  it("forgotPassword: token persistence failure", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    s.createPasswordResetToken.mockRejectedValue(new Error("db down"));
    await expect(
      publicCaller().userAuth.forgotPassword({ email: "alice@example.com" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("forgotPassword: non-config email transport error", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    mocked(sendPasswordResetEmail).mockRejectedValue(
      new Error("connection refused"),
    );
    await expect(
      publicCaller().userAuth.forgotPassword({ email: "alice@example.com" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("resetPassword: user lookup failure", async () => {
    s.consumePasswordResetToken.mockResolvedValue({ userId: "user-1" });
    s.getUser.mockRejectedValue(new Error("db down"));
    await expect(
      publicCaller().userAuth.resetPassword({
        token: "t",
        password: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("updateProfile / deleteAccount: storage write failures", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());
    s.updateUser.mockRejectedValue(new Error("db down"));
    await expect(
      callerWith(sessionFor()).userAuth.updateProfile({ username: "newalice" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    s.deleteUser.mockRejectedValue(new Error("db down"));
    await expect(
      callerWith(sessionFor()).userAuth.deleteAccount(),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("activateAccount / verifyInviteToken: lookup failures", async () => {
    s.getUserByInviteToken.mockRejectedValue(new Error("db down"));
    await expect(
      publicCaller().userAuth.activateAccount({
        token: "t",
        password: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(
      publicCaller().userAuth.verifyInviteToken({ token: "t" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("live-principal enforcement on userAuth protected procedures", () => {
  it("rejects a disabled account and a stale sessionVersion despite a valid JWT", async () => {
    s.getUserByEmail.mockResolvedValue(userRow());

    dbState.rows = [principalRow({ status: UserStatus.DISABLED })];
    await expect(
      callerWith(sessionFor()).userAuth.getCurrentUser(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    dbState.rows = [principalRow({ sessionVersion: 2 })];
    await expect(
      callerWith(sessionFor({ sessionVersion: 1 })).userAuth.deleteAccount(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.deleteUser).not.toHaveBeenCalled();
  });
});
