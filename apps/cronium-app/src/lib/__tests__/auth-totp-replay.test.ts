/**
 * @jest-environment node
 *
 * The credentials provider's second-factor step: a valid TOTP code is accepted
 * once. RFC 6238 §5.2 requires this; the code is otherwise reusable for as long
 * as it verifies, by anyone who saw it.
 */
const limiter = jest.fn();

jest.mock("@/lib/security/atomic-rate-limiter", () => ({
  consumeAtomicRateLimit: (...args: unknown[]) => limiter(...args) as unknown,
}));
jest.mock("bcrypt", () => ({ compare: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@/lib/security/totp", () => ({ verifyTotp: jest.fn() }));
jest.mock("@/server/storage", () => ({
  storage: {
    getUserByUsername: jest.fn(),
    getUserByEmail: jest.fn(),
    getMfaSecret: jest.fn(() => Promise.resolve("SECRET")),
    consumeMfaRecoveryCode: jest.fn(() => Promise.resolve(false)),
    updateUser: jest.fn(() => Promise.resolve({})),
  },
}));

import { authOptions } from "../auth";
import { verifyTotp } from "@/lib/security/totp";
import { storage } from "@/server/storage";

const provider = authOptions.providers[0] as unknown as {
  options: {
    authorize: (
      credentials: Record<string, string>,
      req: { headers: Record<string, string> },
    ) => Promise<unknown>;
  };
};

const login = (totp: string, headers: Record<string, string> = {}) =>
  provider.options.authorize(
    { username: "alice", password: "pw", totp },
    { headers },
  );

const allowFirstUseOnly = () => {
  const seen = new Set<string>();
  limiter.mockImplementation((identifier: string, bucket: string) => {
    if (bucket !== "auth:totp-used") return Promise.resolve({ allowed: true });
    const key = `${bucket}:${identifier}`;
    const allowed = !seen.has(key);
    seen.add(key);
    return Promise.resolve({ allowed });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  allowFirstUseOnly();
  (storage.getUserByUsername as jest.Mock).mockResolvedValue({
    id: "user-1",
    status: "ACTIVE",
    password: "hash",
    mfaEnabled: true,
    sessionVersion: 1,
  });
  (verifyTotp as jest.Mock).mockReturnValue(true);
});

describe("TOTP replay", () => {
  it("accepts a valid code the first time and refuses it the second", async () => {
    await expect(login("123456")).resolves.toMatchObject({ id: "user-1" });
    await expect(login("123456")).rejects.toThrow(
      "Invalid authenticator or recovery code.",
    );
  });

  it("accepts the next code", async () => {
    await login("123456");
    await expect(login("654321")).resolves.toMatchObject({ id: "user-1" });
  });

  it("tracks codes per user", async () => {
    await login("123456");
    expect(limiter).toHaveBeenCalledWith(
      "user-1:123456",
      "auth:totp-used",
      expect.objectContaining({ maxRequests: 1 }),
    );
  });
});

describe("login rate limit identity", () => {
  it("does not take the bucket from a client-supplied X-Real-IP", async () => {
    await login("123456", { "x-real-ip": "1.2.3.4" });
    await login("654321", { "x-real-ip": "5.6.7.8" });

    const loginBuckets = limiter.mock.calls.filter(
      ([, bucket]) => bucket === "auth:credentials-login",
    );
    expect(loginBuckets.map(([identifier]) => identifier as string)).toEqual([
      "unknown-ip",
      "unknown-ip",
    ]);
  });
});
