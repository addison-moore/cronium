import {
  CredentialEncryption,
  parseEncryptedData,
  type EncryptedData,
} from "../credential-encryption";

/**
 * Phase 2.1 rotation: credential-encryption must decrypt values written under a
 * retired ENCRYPTION_KEY (so a rotation does not break tool/OAuth credentials
 * before the driver re-encrypts them), and must report which values still need
 * re-encryption.
 */
const KEY_A =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("CredentialEncryption key rotation", () => {
  const svc = CredentialEncryption.getInstance();
  const secret = { token: "s3cr3t", scope: "read" };

  afterEach(() => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
  });

  it("decrypts a value written under a retired key and flags it for re-encryption", () => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const underA = svc.encrypt(secret);

    // Rotate: B active, A retired.
    process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([KEY_A]);
    svc.initialize(KEY_B);

    expect(svc.decrypt(underA)).toEqual(secret); // via retired fallback
    expect(svc.isUnderActiveKey(underA)).toBe(false);

    const underB = svc.encrypt(secret);
    expect(svc.isUnderActiveKey(underB)).toBe(true);
    expect(svc.decrypt(underB)).toEqual(secret);
  });

  it("resumes an interrupted rotation: skips already-rotated values, re-encrypts the rest", () => {
    // Simulate an interrupted rotation: value1 was reached (now under B),
    // value2 was not (still under A). Both keys are in the ring.
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const value2StillOldA = svc.encrypt({ id: 2 });

    process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([KEY_A]);
    svc.initialize(KEY_B);
    const value1AlreadyNewB = svc.encrypt({ id: 1 });

    // A resumed pass must re-encrypt only value2, and leave value1 untouched.
    expect(svc.isUnderActiveKey(value1AlreadyNewB)).toBe(true); // skip
    expect(svc.isUnderActiveKey(value2StillOldA)).toBe(false); // re-encrypt

    const value2Rotated = svc.encrypt(svc.decrypt(value2StillOldA));
    expect(svc.isUnderActiveKey(value2Rotated)).toBe(true);
    expect(svc.decrypt(value2Rotated)).toEqual({ id: 2 });
  });

  it("cannot decrypt a retired-key value once the retired key is removed", () => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const underA = svc.encrypt(secret);

    // Rotation complete: only B, no retired keys.
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_B);

    expect(() => svc.decrypt(underA)).toThrow(
      /failed authenticated decryption/,
    );
  });

  it("derives a retired key with whitespace around it as the key it is", () => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const underA = svc.encrypt(secret);

    process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([` ${KEY_A}\n`]);
    svc.initialize(KEY_B);

    expect(svc.decrypt(underA)).toEqual(secret);
  });

  // A process refuses to start on these, so this is for one that got past that.
  describe("a malformed list", () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      warn.mockRestore();
    });

    function underAWith(retired: string): EncryptedData {
      delete process.env.ENCRYPTION_KEYS_RETIRED;
      svc.initialize(KEY_A);
      const underA = svc.encrypt(secret);

      process.env.ENCRYPTION_KEYS_RETIRED = retired;
      svc.initialize(KEY_B);
      return underA;
    }

    it.each([
      ["the inner quotes left out", `[${KEY_A}]`],
      ["a JSON string, which used to say nothing", JSON.stringify(KEY_A)],
      ["a key cut short", JSON.stringify([KEY_A.slice(0, 63)])],
    ])(
      "%s: warns without quoting it, and uses the active key",
      (_, retired) => {
        const underA = underAWith(retired);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("ENCRYPTION_KEYS_RETIRED");
        expect(warn.mock.calls[0]?.[0]).not.toContain(KEY_A.slice(0, 8));
        expect(() => svc.decrypt(underA)).toThrow(
          /failed authenticated decryption/,
        );
        expect(svc.decrypt(svc.encrypt(secret))).toEqual(secret);
      },
    );

    it("keeps the good keys in a list with a bad one", () => {
      const underA = underAWith(JSON.stringify(["nope", KEY_A]));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(svc.decrypt(underA)).toEqual(secret);
    });

    it("doesn't derive a key from a string that isn't one", () => {
      // Long enough for the old rule, and varied enough not to set off the entropy warning.
      const notAKey = "not-a-hex-key-but-32-or-more-characters-long";
      delete process.env.ENCRYPTION_KEYS_RETIRED;
      svc.initialize(notAKey);
      const underIt = svc.encrypt(secret);
      expect(warn).not.toHaveBeenCalled();

      process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([notAKey]);
      svc.initialize(KEY_B);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(() => svc.decrypt(underIt)).toThrow(
        /failed authenticated decryption/,
      );
    });
  });
});

describe("parseEncryptedData", () => {
  it("reads back what encrypt stores", () => {
    const svc = CredentialEncryption.getInstance();
    svc.initialize(KEY_A);
    const encrypted = svc.encrypt({ token: "s3cr3t" });

    expect(parseEncryptedData(JSON.stringify(encrypted))).toEqual(encrypted);
  });

  it.each([
    ["nothing", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["plaintext", "xoxb-plain-token"],
    ["a JSON number", "5"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["credentials as plain JSON", '{"token":"s3cr3t"}'],
    ["a partial shape", '{"encrypted":"a","iv":"b","authTag":"c"}'],
  ])("treats %s as not encrypted", (_name, stored) => {
    expect(parseEncryptedData(stored)).toBeNull();
  });
});
