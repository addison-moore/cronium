import {
  encryptServerSecret,
  decryptServerSecret,
  encryptEnvVarValue,
  decryptEnvVarValue,
  encryptSystemSetting,
  decryptSystemSetting,
  encryptMfaSecret,
  decryptMfaSecret,
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

  it("passes legacy/plaintext values through the decrypt (non-breaking migration)", () => {
    // A value that is not a crn.1 envelope goes through the legacy path; a plain
    // short string is returned unchanged.
    expect(decryptServerSecret("plainkey", "sshKey", "user-1")).toBe(
      "plainkey",
    );
    expect(decryptEnvVarValue("plainval", 42, "API_KEY")).toBe("plainval");
    expect(decryptSystemSetting("plainpw", "smtpPassword")).toBe("plainpw");
  });
});
