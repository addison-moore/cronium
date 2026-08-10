import {
  mintJobCapability,
  verifyJobCapability,
  assertCapability,
  CapabilityError,
  __resetJobCapabilityKeyForTests,
  DEFAULT_JOB_CAPABILITIES,
} from "@/lib/security/job-capability";

const KEY = "5555555555555555555555555555555555555555555555555555555555555555";
const NOW = 1_700_000_000;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  __resetJobCapabilityKeyForTests();
});
afterAll(() => __resetJobCapabilityKeyForTests());

describe("job capability tokens (HI-10)", () => {
  it("mints and verifies a token bound to job + user + server", () => {
    const token = mintJobCapability(
      { jobId: "job-1", userId: "user-1", serverId: "7" },
      NOW,
    );
    expect(token.startsWith("cap.1.")).toBe(true);

    const v = verifyJobCapability(token, NOW + 10);
    expect(v.jobId).toBe("job-1");
    expect(v.userId).toBe("user-1");
    expect(v.serverId).toBe("7");
    expect(v.capabilities).toEqual(DEFAULT_JOB_CAPABILITIES);
  });

  it("rejects a token whose signature was tampered with", () => {
    const token = mintJobCapability({ jobId: "job-1", userId: "user-1" }, NOW);

    // Flip a bit in the DECODED signature rather than rewriting its trailing
    // base64url characters. The final character of a 32-byte HMAC carries only
    // 4 significant bits, so a character-level rewrite can decode to the exact
    // same signature — the old form did so about once in 1365 runs and the
    // test then failed because the "tampered" token was genuinely valid.
    const cut = token.lastIndexOf(".");
    const signature = Buffer.from(token.slice(cut + 1), "base64url");
    signature[0]! ^= 0xff;
    const tampered = `${token.slice(0, cut + 1)}${signature.toString("base64url")}`;

    expect(tampered).not.toBe(token);
    expect(() => verifyJobCapability(tampered, NOW + 10)).toThrow(
      CapabilityError,
    );
  });

  it("rejects a token whose payload (scope) was swapped", () => {
    const a = mintJobCapability({ jobId: "job-1", userId: "user-1" }, NOW);
    const b = mintJobCapability({ jobId: "job-2", userId: "user-2" }, NOW);
    // Splice job-2's payload onto job-1's signature — the MAC must not verify.
    const aPayload = a.split(".").slice(2, 3)[0];
    const bParts = b.split(".");
    const forged = `cap.1.${aPayload}.${bParts[bParts.length - 1]}`;
    expect(() => verifyJobCapability(forged, NOW + 10)).toThrow(
      CapabilityError,
    );
  });

  it("fails closed once expired", () => {
    const token = mintJobCapability(
      { jobId: "job-1", userId: "user-1", ttlSeconds: 30 },
      NOW,
    );
    expect(() => verifyJobCapability(token, NOW + 31)).toThrow(/expired/);
    // still valid a second before expiry
    expect(verifyJobCapability(token, NOW + 29).jobId).toBe("job-1");
  });

  it("clamps an over-long TTL to the ceiling", () => {
    const token = mintJobCapability(
      { jobId: "job-1", userId: "user-1", ttlSeconds: 999_999 },
      NOW,
    );
    const v = verifyJobCapability(token, NOW + 10);
    expect(v.expiresAt - NOW).toBeLessThanOrEqual(6 * 60 * 60);
  });

  it("rejects tokens signed under a different master key", () => {
    const token = mintJobCapability({ jobId: "job-1", userId: "user-1" }, NOW);
    process.env.ENCRYPTION_KEY =
      "6666666666666666666666666666666666666666666666666666666666666666";
    __resetJobCapabilityKeyForTests();
    try {
      expect(() => verifyJobCapability(token, NOW + 10)).toThrow(
        CapabilityError,
      );
    } finally {
      process.env.ENCRYPTION_KEY = KEY;
      __resetJobCapabilityKeyForTests();
    }
  });

  it("rejects malformed tokens", () => {
    expect(() => verifyJobCapability("not-a-token", NOW)).toThrow(
      CapabilityError,
    );
    expect(() => verifyJobCapability("cap.1.onlypayload", NOW)).toThrow(
      CapabilityError,
    );
  });

  it("enforces least-privilege capability subsets", () => {
    const token = mintJobCapability(
      { jobId: "job-1", userId: "user-1", capabilities: ["job:status"] },
      NOW,
    );
    const v = verifyJobCapability(token, NOW + 10);
    expect(() => assertCapability(v, "job:status")).not.toThrow();
    expect(() => assertCapability(v, "variable:write")).toThrow(
      CapabilityError,
    );
  });
});
