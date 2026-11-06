import { createCipheriv, randomBytes } from "crypto";
import {
  encryptServerSecret,
  decryptServerSecret,
  encryptEnvVarValue,
  decryptEnvVarValue,
  isEnvVarCiphertext,
  encryptSystemSetting,
  decryptSystemSetting,
  encryptMfaSecret,
  decryptMfaSecret,
  isLegacyCiphertextUnderKey,
  looksLikeLegacyCiphertext,
  readLegacyValue,
  readsAsLegacyCiphertext,
} from "@/lib/security/field-secret";
import { __resetSecretVaultForTests } from "@/lib/security/secret-vault";

const KEY = "8888888888888888888888888888888888888888888888888888888888888888";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  __resetSecretVaultForTests();
});
afterAll(() => __resetSecretVaultForTests());

describe("field-secret record-bound migration (2.1)", () => {
  it("round-trips server credentials bound to (userId, column)", () => {
    const env = encryptServerSecret("ssh-private-key", "sshKey", "user-1");
    expect(env.startsWith("crn.1.")).toBe(true);
    expect(decryptServerSecret(env, "sshKey", "user-1")).toBe(
      "ssh-private-key",
    );
  });

  it("fails closed reading a server secret under a different tenant", () => {
    const env = encryptServerSecret("ssh-key", "sshKey", "user-1");
    expect(() => decryptServerSecret(env, "sshKey", "user-2")).toThrow();
  });

  it("fails closed reading an sshKey ciphertext as a password", () => {
    const env = encryptServerSecret("secret", "sshKey", "user-1");
    expect(() => decryptServerSecret(env, "password", "user-1")).toThrow();
  });

  it("round-trips env var values bound to (eventId, key)", () => {
    const env = encryptEnvVarValue("s3cret", 42, "API_KEY");
    expect(decryptEnvVarValue(env, 42, "API_KEY")).toBe("s3cret");
  });

  it("fails closed reading an env var under a different event or key", () => {
    const env = encryptEnvVarValue("s3cret", 42, "API_KEY");
    expect(() => decryptEnvVarValue(env, 99, "API_KEY")).toThrow();
    expect(() => decryptEnvVarValue(env, 42, "OTHER")).toThrow();
  });

  it("round-trips system settings bound to the key", () => {
    const env = encryptSystemSetting("smtp-pw", "smtpPassword");
    expect(decryptSystemSetting(env, "smtpPassword")).toBe("smtp-pw");
    expect(() => decryptSystemSetting(env, "openaiApiKey")).toThrow();
  });

  it("round-trips the mfa secret bound to the user", () => {
    const env = encryptMfaSecret("TOTPSEED", "user-1");
    expect(decryptMfaSecret(env, "user-1")).toBe("TOTPSEED");
    expect(() => decryptMfaSecret(env, "user-2")).toThrow();
  });

  it("unwraps env var values encrypted more than once under the same binding", () => {
    const once = encryptEnvVarValue("s3cret", 42, "API_KEY");
    const thrice = encryptEnvVarValue(
      encryptEnvVarValue(once, 42, "API_KEY"),
      42,
      "API_KEY",
    );
    expect(decryptEnvVarValue(thrice, 42, "API_KEY")).toBe("s3cret");
  });

  it("does not unwrap an inner envelope bound to a different record", () => {
    const foreign = encryptEnvVarValue("s3cret", 99, "API_KEY");
    const outer = encryptEnvVarValue(foreign, 42, "API_KEY");
    // The inner layer does not authenticate here, so it stays opaque rather
    // than being treated as a decryption failure.
    expect(decryptEnvVarValue(outer, 42, "API_KEY")).toBe(foreign);
  });

  it("recognizes only ciphertext for this exact binding", () => {
    const env = encryptEnvVarValue("s3cret", 42, "API_KEY");
    expect(isEnvVarCiphertext(env, 42, "API_KEY")).toBe(true);
    expect(isEnvVarCiphertext(env, 99, "API_KEY")).toBe(false);
    expect(isEnvVarCiphertext(env, 42, "OTHER")).toBe(false);
    expect(isEnvVarCiphertext("plain", 42, "API_KEY")).toBe(false);
    expect(isEnvVarCiphertext("crn.1.fake.a.b.c", 42, "API_KEY")).toBe(false);
  });

  it("passes legacy/plaintext values through the decrypt (non-breaking migration)", () => {
    // A value that is not a crn.1 envelope goes through the legacy path; a plain
    // short string is returned unchanged.
    expect(decryptServerSecret("plainkey", "sshKey", "user-1")).toBe(
      "plainkey",
    );
    expect(decryptEnvVarValue("plainval", 42, "API_KEY")).toBe("plainval");
    expect(decryptSystemSetting("plainpw", "smtpPassword")).toBe("plainpw");
  });

  describe("legacy static-AAD ciphertext", () => {
    /** The frozen format: IV[16] || ciphertext || tag[16], base64, static AAD. */
    function legacyEncrypt(plaintext: string, keyHex = KEY): string {
      const iv = randomBytes(16);
      const cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(keyHex, "hex"),
        iv,
      );
      cipher.setAAD(Buffer.from("cronium-server-encryption"));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
        "base64",
      );
    }
    const OTHER_KEY = "77".repeat(32);
    const key = (hex: string) => Buffer.from(hex, "hex");

    it("still decrypts on read", () => {
      const stored = legacyEncrypt("an old ssh key");
      expect(decryptServerSecret(stored, "sshKey", "user-1")).toBe(
        "an old ssh key",
      );
    });

    it("still fails a read of something the key can't authenticate", () => {
      const stored = legacyEncrypt("an old ssh key", OTHER_KEY);
      expect(() => decryptServerSecret(stored, "sshKey", "user-1")).toThrow();
    });

    it("recognizes only the shape a read would try to decrypt", () => {
      expect(looksLikeLegacyCiphertext(legacyEncrypt("an old ssh key"))).toBe(
        true,
      );
      expect(looksLikeLegacyCiphertext("A".repeat(64))).toBe(true);

      expect(looksLikeLegacyCiphertext("")).toBe(false);
      expect(looksLikeLegacyCiphertext("short")).toBe(false);
      expect(looksLikeLegacyCiphertext("A".repeat(49))).toBe(false);
      expect(looksLikeLegacyCiphertext(`${"A".repeat(60)}-`)).toBe(false);
      expect(
        looksLikeLegacyCiphertext(`-----BEGIN KEY-----\n${"A".repeat(60)}`),
      ).toBe(false);
      // Long enough, but it decodes to too little to hold an IV and a tag.
      expect(looksLikeLegacyCiphertext("=".repeat(64))).toBe(false);
    });

    it("says whether a key authenticates it, and a passthrough never counts", () => {
      const stored = legacyEncrypt("an old ssh key");

      expect(isLegacyCiphertextUnderKey(stored, key(KEY))).toBe(true);
      expect(isLegacyCiphertextUnderKey(stored, key(OTHER_KEY))).toBe(false);

      // Tampering with the middle fails the tag.
      const bytes = Buffer.from(stored, "base64");
      bytes[20] = bytes[20]! ^ 0xff;
      expect(
        isLegacyCiphertextUnderKey(bytes.toString("base64"), key(KEY)),
      ).toBe(false);

      // A read returns each of these unchanged, or fails on the last, under any key.
      for (const plaintext of ["", "plainkey", "A".repeat(64)]) {
        expect(isLegacyCiphertextUnderKey(plaintext, key(KEY))).toBe(false);
      }
      expect(decryptServerSecret("plainkey", "sshKey", "user-1")).toBe(
        "plainkey",
      );
    });

    describe("telling what a value holds", () => {
      afterEach(() => {
        delete process.env.ENCRYPTION_KEYS_RETIRED;
        __resetSecretVaultForTests();
      });

      function withRetired(keyHex: string) {
        process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([keyHex]);
        __resetSecretVaultForTests();
      }

      it("takes what doesn't have the shape for what it says it is", () => {
        expect(readLegacyValue("plainkey")).toBe("plainkey");
        expect(readLegacyValue(`${"A".repeat(60)}-`)).toBe(
          `${"A".repeat(60)}-`,
        );
      });

      it("opens what authenticates", () => {
        expect(readLegacyValue(legacyEncrypt("an old ssh key"))).toBe(
          "an old ssh key",
        );
      });

      it("opens what authenticates under a retired key, which a read can't", () => {
        const stored = legacyEncrypt("an old ssh key", OTHER_KEY);
        expect(readLegacyValue(stored)).toBeNull();

        withRetired(OTHER_KEY);

        expect(readLegacyValue(stored)).toBe("an old ssh key");
        expect(() => decryptServerSecret(stored, "sshKey", "user-1")).toThrow();
      });

      it("doesn't guess at what has the shape and doesn't open", () => {
        expect(readLegacyValue("A".repeat(64))).toBeNull();
        expect(
          readLegacyValue(legacyEncrypt("x", OTHER_KEY).repeat(2)),
        ).toBeNull();
      });

      it.each(["1", "ab", "abc", "abcd"])(
        "finds that %j, which reads back as its ciphertext, is ciphertext",
        (plaintext) => {
          const stored = legacyEncrypt(plaintext);
          expect(stored.length).toBeLessThan(50);
          expect(decryptEnvVarValue(stored, 42, "API_KEY")).toBe(stored);

          expect(readsAsLegacyCiphertext(stored)).toBe(true);
        },
      );

      it("finds a value encrypted twice, whose read is its inner ciphertext", () => {
        const inner = legacyEncrypt("an old value");
        const read = decryptEnvVarValue(legacyEncrypt(inner), 42, "API_KEY");

        expect(read).toBe(inner);
        expect(readsAsLegacyCiphertext(read)).toBe(true);
      });

      it("finds ciphertext under a retired key too, and none under a key it doesn't hold", () => {
        const stored = legacyEncrypt("1", OTHER_KEY);
        expect(readsAsLegacyCiphertext(stored)).toBe(false);

        withRetired(OTHER_KEY);

        expect(readsAsLegacyCiphertext(stored)).toBe(true);
      });

      it.each([
        ["an empty string", ""],
        ["ordinary text", "plain value"],
        ["base64 too short to hold an IV and a tag", "QUJD"],
        ["base64 of the right length that isn't ciphertext", "A".repeat(44)],
        ["a long one", "A".repeat(64)],
      ])("doesn't take %s for ciphertext", (_name, value) => {
        expect(readsAsLegacyCiphertext(value)).toBe(false);
      });
    });
  });
});
