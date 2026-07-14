/**
 * @jest-environment node
 */
import { credentialEncryption } from "../credential-encryption";

// A 64-char random-looking hex key: >= 32 chars and plenty of distinct
// characters, so initialize() accepts it without the low-entropy warning.
const TEST_KEY =
  "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

beforeAll(() => {
  credentialEncryption.initialize(TEST_KEY);
});

describe("credentialEncryption", () => {
  it("round-trips an OAuth token payload", () => {
    const token = {
      accessToken: "ya29.a0AeExampleAccessToken",
      refreshToken: "1//0gExampleRefreshToken",
      expiresAt: 1893456000000,
      scope: "https://www.googleapis.com/auth/spreadsheets",
    };
    const encrypted = credentialEncryption.encrypt(token);
    const decrypted = credentialEncryption.decrypt(encrypted);
    expect(decrypted).toEqual(token);
  });

  it("round-trips a plain string secret", () => {
    const encrypted = credentialEncryption.encrypt("plain-secret-token");
    expect(credentialEncryption.decrypt(encrypted)).toBe("plain-secret-token");
  });

  it("produces AES-256-GCM ciphertext with iv, authTag, and salt", () => {
    const encrypted = credentialEncryption.encrypt({ apiKey: "x" });
    expect(encrypted.algorithm).toBe("aes-256-gcm");
    expect(encrypted.encrypted).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    expect(encrypted.keyDerivation.method).toBe("scrypt");
    expect(encrypted.keyDerivation.salt).toBeTruthy();
  });

  it("does not leak the plaintext into the stored ciphertext", () => {
    const secret = "super-secret-refresh-token-value";
    const encrypted = credentialEncryption.encrypt({ refreshToken: secret });
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("refreshToken");
  });

  it("uses a fresh IV per encryption (no deterministic ciphertext)", () => {
    const a = credentialEncryption.encrypt("same-input");
    const b = credentialEncryption.encrypt("same-input");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("fails to decrypt when the auth tag is tampered with (GCM integrity)", () => {
    const encrypted = credentialEncryption.encrypt({ apiKey: "x" });
    // Flip the auth tag to a different valid-length base64 value.
    const tampered = {
      ...encrypted,
      authTag: Buffer.from("0".repeat(16), "utf8").toString("base64"),
    };
    expect(() => credentialEncryption.decrypt(tampered)).toThrow();
  });

  it("rejects malformed encrypted data", () => {
    expect(() =>
      credentialEncryption.decrypt({
        encrypted: "",
        iv: "",
        authTag: "",
        algorithm: "aes-256-gcm",
        keyDerivation: { method: "scrypt", salt: "", iterations: 100000 },
      }),
    ).toThrow("Invalid encrypted data format");
  });
});
