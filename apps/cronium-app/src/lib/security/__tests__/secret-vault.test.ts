import {
  SecretVault,
  SecretDecryptionError,
  isSecretEnvelope,
} from "@/lib/security/secret-vault";

const KEY_A =
  "1111111111111111111111111111111111111111111111111111111111111111";
const KEY_B =
  "2222222222222222222222222222222222222222222222222222222222222222";

const binding = {
  purpose: "tool-credential",
  table: "tool_credentials",
  column: "credentials",
  recordId: 42,
  tenantId: "user-1",
};

describe("SecretVault round-trip + record binding", () => {
  const vault = new SecretVault({ activeKeyHex: KEY_A });

  it("encrypts to a versioned crn.1 envelope and decrypts back", () => {
    const env = vault.encrypt("s3cret", binding);
    expect(env.startsWith("crn.1.")).toBe(true);
    expect(isSecretEnvelope(env)).toBe(true);
    expect(vault.decrypt(env, binding)).toBe("s3cret");
  });

  it("fails closed when the binding differs (wrong row)", () => {
    const env = vault.encrypt("s3cret", binding);
    expect(() => vault.decrypt(env, { ...binding, recordId: 99 })).toThrow(
      SecretDecryptionError,
    );
  });

  it("fails closed when the binding differs (wrong purpose)", () => {
    const env = vault.encrypt("s3cret", binding);
    expect(() =>
      vault.decrypt(env, { ...binding, purpose: "server-ssh-key" }),
    ).toThrow(SecretDecryptionError);
  });

  it("fails closed when the binding differs (wrong tenant)", () => {
    const env = vault.encrypt("s3cret", binding);
    expect(() =>
      vault.decrypt(env, { ...binding, tenantId: "user-2" }),
    ).toThrow(SecretDecryptionError);
  });

  it("rejects a ciphertext-swap (envelope from another value)", () => {
    const a = vault.encrypt("value-a", binding);
    const b = vault.encrypt("value-b", { ...binding, recordId: 7 });
    // Swap: try to read b's ciphertext under a's binding.
    const swapped =
      a.split(".").slice(0, 3).join(".") +
      "." +
      b.split(".").slice(3).join(".");
    expect(() => vault.decrypt(swapped, binding)).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects tampering with the tag/ciphertext", () => {
    const env = vault.encrypt("s3cret", binding);
    const parts = env.split(".");
    parts[4] = parts[4]!.slice(0, -2) + "AA";
    expect(() => vault.decrypt(parts.join("."), binding)).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects non-envelope / wrong version / unknown key", () => {
    expect(() => vault.decrypt("plaintext", binding)).toThrow(
      SecretDecryptionError,
    );
    expect(() => vault.decrypt("crn.9.abc.a.b.c", binding)).toThrow(/version/i);
    expect(() =>
      vault.decrypt("crn.1.deadbeef.AAAA.BBBB.CCCC", binding),
    ).toThrow(/keyring/i);
  });

  it("never returns the input unchanged on failure", () => {
    let returned: string | undefined;
    try {
      returned = vault.decrypt("crn.1.deadbeef.AAAA.BBBB.CCCC", binding);
    } catch {
      returned = undefined;
    }
    expect(returned).toBeUndefined();
  });
});

describe("SecretVault keyring rotation", () => {
  it("decrypts values written under a retired key and flags them for re-encryption", () => {
    const oldVault = new SecretVault({ activeKeyHex: KEY_A });
    const env = oldVault.encrypt("legacy", binding);

    // New active key B, with A retired (decrypt-only).
    const rotated = new SecretVault({
      activeKeyHex: KEY_B,
      retiredKeysHex: [KEY_A],
    });
    expect(rotated.decrypt(env, binding)).toBe("legacy");
    expect(rotated.needsReencryption(env)).toBe(true);

    const reencrypted = rotated.encrypt("legacy", binding);
    expect(rotated.needsReencryption(reencrypted)).toBe(false);
  });

  it("cannot decrypt an envelope whose key is not in the ring", () => {
    const a = new SecretVault({ activeKeyHex: KEY_A });
    const env = a.encrypt("x", binding);
    const b = new SecretVault({ activeKeyHex: KEY_B }); // no KEY_A
    expect(() => b.decrypt(env, binding)).toThrow(/keyring/i);
  });
});

describe("SecretVault key validation", () => {
  it("rejects a short/invalid active key", () => {
    expect(() => new SecretVault({ activeKeyHex: "abc" })).toThrow();
  });
});
