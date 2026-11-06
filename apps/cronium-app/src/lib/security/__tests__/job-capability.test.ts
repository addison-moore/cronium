import { createHmac, hkdfSync } from "crypto";
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
  delete process.env.ENCRYPTION_KEYS_RETIRED;
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
      { jobId: "job-1", userId: "user-1", ttlSeconds: 99_999_999 },
      NOW,
    );
    const v = verifyJobCapability(token, NOW + 10);
    expect(v.expiresAt - NOW).toBe(7 * 24 * 60 * 60);
  });

  it("lasts as long as a long-running job needs", () => {
    // CRONIUM_MAX_EXECUTION_TIMEOUT defaults to 24h, and a job has to be able to
    // report completion at the end of it.
    const dayPlusBuffer = 24 * 60 * 60 + 5 * 60;
    const token = mintJobCapability(
      { jobId: "job-1", userId: "user-1", ttlSeconds: dayPlusBuffer },
      NOW,
    );
    expect(verifyJobCapability(token, NOW + dayPlusBuffer - 1).jobId).toBe(
      "job-1",
    );
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

describe("job capability tokens across an ENCRYPTION_KEY change", () => {
  const OLD = "a".repeat(64);
  const NEW = "b".repeat(64);
  const OTHER = "c".repeat(64);
  const SCOPE = { jobId: "job-1", userId: "user-1", serverId: "7" };

  /** The process restarting with these settings. */
  function restartWith(active: string | undefined, retired?: string): void {
    if (active === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = active;
    if (retired === undefined) delete process.env.ENCRYPTION_KEYS_RETIRED;
    else process.env.ENCRYPTION_KEYS_RETIRED = retired;
    __resetJobCapabilityKeyForTests();
  }

  function mintUnder(active: string, ttlSeconds?: number): string {
    restartWith(active);
    return mintJobCapability({ ...SCOPE, ttlSeconds }, NOW);
  }

  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    restartWith(KEY);
  });

  describe("active key", () => {
    it("verifies with no retired keys, or an empty list", () => {
      const token = mintUnder(NEW);

      restartWith(NEW);
      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
      restartWith(NEW, "");
      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
      restartWith(NEW, "[]");
      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
      expect(warn).not.toHaveBeenCalled();
    });

    it("verifies alongside a retired key", () => {
      restartWith(NEW, JSON.stringify([OLD]));
      const token = mintJobCapability(SCOPE, NOW);

      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
    });

    it("is the only key new tokens are signed with", () => {
      restartWith(NEW, JSON.stringify([OLD]));
      const token = mintJobCapability(SCOPE, NOW);

      restartWith(OLD);
      expect(() => verifyJobCapability(token, NOW + 10)).toThrow(
        CapabilityError,
      );
      restartWith(NEW);
      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
    });

    it("is required: a retired key alone verifies and signs nothing", () => {
      const token = mintUnder(OLD);

      restartWith(undefined, JSON.stringify([OLD]));
      expect(() => verifyJobCapability(token, NOW + 10)).toThrow(
        CapabilityError,
      );
      expect(() => mintJobCapability(SCOPE, NOW)).toThrow(CapabilityError);
    });
  });

  describe("retired key", () => {
    it("verifies a token signed before the change, with its claims intact", () => {
      const token = mintUnder(OLD);

      restartWith(NEW, JSON.stringify([OLD]));
      const verified = verifyJobCapability(token, NOW + 10);

      expect(verified).toEqual({
        jobId: "job-1",
        userId: "user-1",
        serverId: "7",
        capabilities: DEFAULT_JOB_CAPABILITIES,
        expiresAt: NOW + 60 * 60,
      });
    });

    it("verifies under any key in the list", () => {
      const first = mintUnder(OLD);
      const second = mintUnder(OTHER);

      restartWith(NEW, JSON.stringify([OLD, OTHER]));

      expect(verifyJobCapability(first, NOW + 10).jobId).toBe("job-1");
      expect(verifyJobCapability(second, NOW + 10).jobId).toBe("job-1");
    });

    it("reads a key the way the secret vault does", () => {
      const token = mintUnder(OLD);

      restartWith(NEW, JSON.stringify([` ${OLD.toUpperCase()}\n`]));

      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
      expect(warn).not.toHaveBeenCalled();
    });

    it("still enforces expiry", () => {
      const token = mintUnder(OLD, 30);

      restartWith(NEW, JSON.stringify([OLD]));

      expect(verifyJobCapability(token, NOW + 29).jobId).toBe("job-1");
      expect(() => verifyJobCapability(token, NOW + 31)).toThrow(/expired/);
    });

    it("still rejects a changed signature or payload", () => {
      const token = mintUnder(OLD);
      const cut = token.lastIndexOf(".");
      const signature = Buffer.from(token.slice(cut + 1), "base64url");

      const wrongPayload = Buffer.from(
        JSON.stringify({
          jid: "job-2",
          uid: "user-2",
          cap: DEFAULT_JOB_CAPABILITIES,
          iat: NOW,
          exp: NOW + 60,
        }),
      ).toString("base64url");
      const swapped = `cap.1.${wrongPayload}.${token.slice(cut + 1)}`;

      signature[0]! ^= 0xff;
      const tampered = `${token.slice(0, cut + 1)}${signature.toString("base64url")}`;

      restartWith(NEW, JSON.stringify([OLD]));

      expect(() => verifyJobCapability(tampered, NOW + 10)).toThrow(
        /signature is invalid/,
      );
      expect(() => verifyJobCapability(swapped, NOW + 10)).toThrow(
        /signature is invalid/,
      );
    });

    it("carries the token's own capabilities, not more", () => {
      restartWith(OLD);
      const token = mintJobCapability(
        { ...SCOPE, capabilities: ["job:status"] },
        NOW,
      );

      restartWith(NEW, JSON.stringify([OLD]));
      const verified = verifyJobCapability(token, NOW + 10);

      expect(() => assertCapability(verified, "job:status")).not.toThrow();
      expect(() => assertCapability(verified, "variable:read")).toThrow(
        CapabilityError,
      );
    });
  });

  describe("removed key", () => {
    it("rejects a token once its key has left the list", () => {
      const token = mintUnder(OLD);

      restartWith(NEW, JSON.stringify([OLD]));
      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");

      restartWith(NEW);
      expect(() => verifyJobCapability(token, NOW + 10)).toThrow(
        /signature is invalid/,
      );
    });

    it("rejects it when other keys are still listed", () => {
      const token = mintUnder(OLD);

      restartWith(NEW, JSON.stringify([OTHER]));

      expect(() => verifyJobCapability(token, NOW + 10)).toThrow(
        /signature is invalid/,
      );
    });
  });

  describe("malformed retired keys", () => {
    /** Sign the way the module does, from a master key it should refuse to use. */
    function forge(master: Buffer): string {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          master,
          Buffer.alloc(0),
          Buffer.from("cronium-job-capability-v1"),
          32,
        ),
      );
      const payload = Buffer.from(
        JSON.stringify({
          jid: "job-1",
          uid: "user-1",
          cap: DEFAULT_JOB_CAPABILITIES,
          iat: NOW,
          exp: NOW + 60,
        }),
      ).toString("base64url");
      const signingInput = `cap.1.${payload}`;
      const signature = createHmac("sha256", key)
        .update(signingInput)
        .digest("base64url");
      return `${signingInput}.${signature}`;
    }

    it.each([
      ["not JSON", "not json"],
      ["shell-stripped quotes", `[${OLD}]`],
      ["a JSON string", JSON.stringify(OLD)],
      ["a JSON object", JSON.stringify({ key: OLD })],
      ["a JSON number", "123"],
      ["JSON null", "null"],
      ["an empty string entry", '[""]'],
      ["non-string entries", "[123, null, {}]"],
      ["a short entry", '["abc123"]'],
      ["a 32-character entry", JSON.stringify(["a".repeat(32)])],
      ["a too-long entry", JSON.stringify([`${OLD}00`])],
      ["a non-hex entry", JSON.stringify(["z".repeat(64)])],
    ])("%s: rejects the old token and keeps the active key", (_, list) => {
      const old = mintUnder(OLD);

      restartWith(NEW, list);
      const current = mintJobCapability(SCOPE, NOW);

      expect(verifyJobCapability(current, NOW + 10).jobId).toBe("job-1");
      expect(() => verifyJobCapability(old, NOW + 10)).toThrow(CapabilityError);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("ENCRYPTION_KEYS_RETIRED");
      expect(warn.mock.calls[0]?.[0]).not.toContain(OLD.slice(0, 8));
    });

    it("keeps the good entries in a list with a bad one", () => {
      const token = mintUnder(OLD);

      restartWith(NEW, JSON.stringify(["nope", OLD, 42]));

      expect(verifyJobCapability(token, NOW + 10).jobId).toBe("job-1");
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["an empty string", "", Buffer.alloc(0)],
      ["a short string", "abc123", Buffer.from("abc123")],
    ])(
      "never treats %s as a key anyone could sign with",
      (_, entry, master) => {
        restartWith(NEW, JSON.stringify([entry]));

        expect(() => verifyJobCapability(forge(master), NOW + 10)).toThrow(
          /signature is invalid/,
        );
      },
    );

    it("keeps key material out of the warning", () => {
      restartWith(NEW, JSON.stringify([OLD.slice(0, 40)]));
      mintJobCapability(SCOPE, NOW);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(OLD.slice(0, 40));
    });
  });
});
