/**
 * Credential encryption service for securing sensitive data at rest
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "crypto";

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
  algorithm: string;
  keyDerivation: {
    method: string;
    salt: string;
    iterations: number;
  };
}

export interface EncryptionConfig {
  algorithm?: string;
  keyLength?: number;
  ivLength?: number;
  saltLength?: number;
  iterations?: number;
  tagLength?: number;
}

// Store singleton on global to persist across hot reloads in development
declare global {
  var __credentialEncryption: CredentialEncryption | undefined;
}

/**
 * Credential encryption service using AES-256-GCM
 */
export class CredentialEncryption {
  private static instance: CredentialEncryption;
  private readonly algorithm = "aes-256-gcm";
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly saltLength = 32; // 256 bits
  private readonly iterations = 100000; // PBKDF2 iterations
  private readonly tagLength = 16; // 128 bits

  private masterKey: Buffer | null = null;
  // Retired master keys (derived from ENCRYPTION_KEYS_RETIRED) that decrypt is
  // allowed to fall back to during a key rotation, so credentials written under
  // a previous ENCRYPTION_KEY keep decrypting until the rotation driver has
  // re-encrypted them under the active key (security plan Phase 2.1).
  private retiredMasterKeys: Buffer[] = [];
  private keyCache = new Map<string, { key: Buffer; expires: Date }>();

  // Static KDF salt for deriving a master key from ENCRYPTION_KEY. MUST match
  // the value used at rest — see the note in initialize().
  private static readonly MASTER_SALT = Buffer.from(
    "cronium-tool-credentials-v1",
    "utf8",
  );

  private constructor(private config?: EncryptionConfig) {
    if (config) {
      Object.assign(this, config);
    }
  }

  static getInstance(config?: EncryptionConfig): CredentialEncryption {
    global.__credentialEncryption ??= new CredentialEncryption(config);
    return global.__credentialEncryption;
  }

  /**
   * Initialize with master key
   */
  initialize(masterKey: string): void {
    if (!masterKey || masterKey.length < 32) {
      throw new Error("Master key must be at least 32 characters long");
    }

    // Entropy sanity check. We intentionally do NOT use validateKeyStrength()
    // here: it demands uppercase/special characters and would reject the
    // recommended `openssl rand -hex 32` key (128 bits of entropy, all
    // lowercase hex). A distinct-character count instead catches genuinely weak
    // keys (e.g. "changeme..." or a repeated character) without false alarms on
    // random hex/base64.
    const distinctChars = new Set(masterKey).size;
    if (distinctChars < 8) {
      console.warn(
        `[Security] ENCRYPTION_KEY has very low entropy (${distinctChars} distinct characters). ` +
          `Use a random key, e.g. \`openssl rand -hex 32\`.`,
      );
    }

    // Derive a consistent key from the master key. The KDF salt is static by
    // design: the ENCRYPTION_KEY is already unique and secret per deployment, so
    // a fixed (non-secret) salt is sufficient. It must NOT change — the derived
    // master key encrypts every stored credential, so changing it would make all
    // existing credentials undecryptable.
    this.masterKey = scryptSync(
      masterKey,
      CredentialEncryption.MASTER_SALT,
      this.keyLength,
    );

    // Load any retired keys so decrypt can fall back to them during a rotation.
    this.retiredMasterKeys = [];
    const retiredRaw = process.env.ENCRYPTION_KEYS_RETIRED;
    if (retiredRaw) {
      try {
        const retired = JSON.parse(retiredRaw) as unknown;
        if (Array.isArray(retired)) {
          for (const k of retired) {
            if (typeof k === "string" && k.length >= 32) {
              this.retiredMasterKeys.push(
                scryptSync(k, CredentialEncryption.MASTER_SALT, this.keyLength),
              );
            }
          }
        }
      } catch {
        console.warn(
          "[Security] ENCRYPTION_KEYS_RETIRED is not valid JSON; ignoring retired keys",
        );
      }
    }

    console.log(
      `Credential encryption initialized${this.retiredMasterKeys.length ? ` (+${this.retiredMasterKeys.length} retired key(s) for rotation)` : ""}`,
    );
  }

  /**
   * Check if encryption is available
   */
  isAvailable(): boolean {
    return this.masterKey !== null;
  }

  /**
   * Encrypt credential data
   */
  encrypt(data: unknown): EncryptedData {
    if (!this.isAvailable()) {
      throw new Error(
        "Encryption not initialized. Set ENCRYPTION_KEY environment variable.",
      );
    }

    // Convert data to string
    const plaintext = typeof data === "string" ? data : JSON.stringify(data);

    // Generate random IV and salt
    const iv = randomBytes(this.ivLength);
    const salt = randomBytes(this.saltLength);

    // Derive encryption key from master key and salt
    const key = this.deriveKey(salt);

    // Create cipher
    const cipher = createCipheriv(this.algorithm, key, iv);

    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    // Get auth tag
    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      algorithm: this.algorithm,
      keyDerivation: {
        method: "scrypt",
        salt: salt.toString("base64"),
        iterations: this.iterations,
      },
    };
  }

  /**
   * Decrypt credential data. Tries the active master key first, then any retired
   * keys (rotation fallback), so a credential written under a previous
   * ENCRYPTION_KEY still decrypts until it is re-encrypted.
   */
  decrypt(encryptedData: EncryptedData): unknown {
    if (!this.isAvailable()) {
      throw new Error("Encryption not initialized");
    }
    if (
      !encryptedData.encrypted ||
      !encryptedData.iv ||
      !encryptedData.authTag
    ) {
      throw new Error("Invalid encrypted data format");
    }

    const active = this.tryDecryptWith(this.masterKey!, encryptedData);
    if (active.ok) return active.value;

    for (const retired of this.retiredMasterKeys) {
      const attempt = this.tryDecryptWith(retired, encryptedData);
      if (attempt.ok) return attempt.value;
    }

    throw new Error("Credential failed authenticated decryption");
  }

  /**
   * Whether the credential decrypts under the ACTIVE key alone (i.e. it does not
   * need re-encryption). Used by the rotation driver to skip already-rotated
   * rows. Never throws.
   */
  isUnderActiveKey(encryptedData: EncryptedData): boolean {
    if (
      !this.isAvailable() ||
      !encryptedData?.encrypted ||
      !encryptedData?.iv ||
      !encryptedData?.authTag
    ) {
      return false;
    }
    return this.tryDecryptWith(this.masterKey!, encryptedData).ok;
  }

  private tryDecryptWith(
    masterKey: Buffer,
    encryptedData: EncryptedData,
  ): { ok: true; value: unknown } | { ok: false } {
    try {
      const encrypted = Buffer.from(encryptedData.encrypted, "base64");
      const iv = Buffer.from(encryptedData.iv, "base64");
      const authTag = Buffer.from(encryptedData.authTag, "base64");
      const salt = Buffer.from(encryptedData.keyDerivation.salt, "base64");

      const key = this.deriveKeyFrom(masterKey, salt);
      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      const plaintext = decrypted.toString("utf8");
      try {
        return { ok: true, value: JSON.parse(plaintext) };
      } catch {
        return { ok: true, value: plaintext };
      }
    } catch {
      // Authentication failure (wrong key) — let the caller try the next key.
      return { ok: false };
    }
  }

  /** Derive the per-value key from the active master key and a salt. */
  private deriveKey(salt: Buffer): Buffer {
    return this.deriveKeyFrom(this.masterKey!, salt);
  }

  /**
   * Derive the per-value key from a specific master key and salt. Cached by
   * (master-key fingerprint, salt) so the active and retired keys never collide.
   */
  private deriveKeyFrom(masterKey: Buffer, salt: Buffer): Buffer {
    // A fast non-reversible fingerprint of the (already-derived) master key
    // namespaces the cache so active/retired keys never collide. It only keys an
    // in-process cache, so a plain hash is sufficient (and must be fast — scrypt
    // here would run on every lookup).
    const fp = createHash("sha256").update(masterKey).digest("base64");
    const cacheKey = `${fp}:${salt.toString("base64")}`;

    const cached = this.keyCache.get(cacheKey);
    if (cached && cached.expires > new Date()) {
      return cached.key;
    }

    const key = scryptSync(masterKey, salt, this.keyLength);
    this.keyCache.set(cacheKey, {
      key,
      expires: new Date(Date.now() + 5 * 60 * 1000),
    });
    this.cleanKeyCache();
    return key;
  }

  /**
   * Clean expired keys from cache
   */
  private cleanKeyCache(): void {
    const now = new Date();
    for (const [key, value] of this.keyCache.entries()) {
      if (value.expires < now) {
        this.keyCache.delete(key);
      }
    }
  }

  /**
   * Rotate master key
   */
  async rotateMasterKey(
    newMasterKey: string,
    reencryptCallback: (
      decrypt: (data: EncryptedData) => unknown,
      encrypt: (data: unknown) => EncryptedData,
    ) => Promise<void>,
  ): Promise<void> {
    if (!newMasterKey || newMasterKey.length < 32) {
      throw new Error("New master key must be at least 32 characters long");
    }

    // Store old decrypt function
    const oldDecrypt = this.decrypt.bind(this);

    // Update master key
    const salt = Buffer.from("cronium-tool-credentials-v1", "utf8");
    this.masterKey = scryptSync(newMasterKey, salt, this.keyLength);

    // Clear key cache
    this.keyCache.clear();

    // Re-encrypt all data
    await reencryptCallback(oldDecrypt, this.encrypt.bind(this));

    console.log("Master key rotation completed");
  }

  /**
   * Generate secure random key
   */
  static generateKey(length = 32): string {
    return randomBytes(length).toString("base64");
  }

  /**
   * Validate master key strength
   */
  static validateKeyStrength(key: string): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (key.length < 32) {
      issues.push("Key must be at least 32 characters long");
    }

    if (!/[A-Z]/.test(key)) {
      issues.push("Key should contain uppercase letters");
    }

    if (!/[a-z]/.test(key)) {
      issues.push("Key should contain lowercase letters");
    }

    if (!/[0-9]/.test(key)) {
      issues.push("Key should contain numbers");
    }

    if (!/[^A-Za-z0-9]/.test(key)) {
      issues.push("Key should contain special characters");
    }

    // Check for common patterns
    if (/(.)\1{3,}/.test(key)) {
      issues.push("Key should not contain repeated characters");
    }

    if (/^[A-Za-z]+$/.test(key) || /^[0-9]+$/.test(key)) {
      issues.push("Key should not be only letters or only numbers");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

// Export singleton instance
export const credentialEncryption = CredentialEncryption.getInstance();

// Initialize from environment variable if available
const encryptionKey = process.env.ENCRYPTION_KEY;
if (encryptionKey) {
  try {
    credentialEncryption.initialize(encryptionKey);
  } catch (error) {
    console.error("Failed to initialize credential encryption:", error);
  }
}
