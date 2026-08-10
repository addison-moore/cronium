/**
 * Server-side encryption service for Cronium.
 *
 * Protects sensitive data at rest — SSH keys, passwords, environment variables,
 * API tokens — under a single AES-256-GCM master key.
 */

import crypto from "crypto";
import { env } from "../env.mjs";

// Encryption configuration
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Server-side encryption service
 */
class EncryptionService {
  private cachedKey: Buffer | null = null;

  /**
   * Resolve and validate the master key LAZILY, on first cryptographic use —
   * not at construction. This keeps the service fail-closed at runtime (any
   * real encrypt/decrypt without a valid key throws) while allowing tooling
   * that merely imports the module without ever encrypting — notably
   * `next build`'s "Collecting page data" pass, which has no ENCRYPTION_KEY in
   * the builder stage — to load it. There is deliberately no ephemeral
   * development fallback (Phase 2.1): an absent or malformed key stops the
   * operation rather than silently generating a random key that would make all
   * existing ciphertext undecryptable.
   */
  private getMasterKey(): Buffer {
    if (this.cachedKey) return this.cachedKey;

    const masterKeyHex = env.ENCRYPTION_KEY;

    if (!masterKeyHex) {
      throw new Error(
        "ENCRYPTION_KEY is required — refusing to encrypt or decrypt without it.",
      );
    }

    if (masterKeyHex.length !== KEY_LENGTH * 2) {
      throw new Error(
        `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`,
      );
    }

    this.cachedKey = Buffer.from(masterKeyHex, "hex");
    return this.cachedKey;
  }

  /**
   * Encrypt sensitive data on the server
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.getMasterKey(), iv);
      cipher.setAAD(Buffer.from("cronium-server-encryption"));

      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      // Combine IV + encrypted data + auth tag
      const combined = Buffer.concat([
        iv,
        Buffer.from(encrypted, "hex"),
        authTag,
      ]);

      return combined.toString("base64");
    } catch (error: unknown) {
      throw new Error(`Encryption failed: ${String(error)}`);
    }
  }

  /**
   * Decrypt sensitive data on the server
   */
  decrypt(encryptedData: string): string {
    if (!encryptedData) return encryptedData;

    // If it doesn't look like our ciphertext, treat it as unencrypted legacy
    // data and pass it through. (There is no base64 well-formedness check here:
    // Buffer.from(_, "base64") never throws — it silently skips invalid
    // characters — so a try/catch around it could only ever be dead code.)
    if (encryptedData.length < 50 || !/^[A-Za-z0-9+/=]+$/.exec(encryptedData)) {
      return encryptedData;
    }

    try {
      const combined = Buffer.from(encryptedData, "base64");

      // Check if buffer is large enough for our encryption format
      if (combined.length < IV_LENGTH + TAG_LENGTH + 1) {
        return encryptedData;
      }

      // Extract components
      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(-TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH, -TAG_LENGTH);

      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.getMasterKey(),
        iv,
      );
      decipher.setAAD(Buffer.from("cronium-server-encryption"));
      decipher.setAuthTag(authTag);

      const decryptedBuffer = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      const decrypted = decryptedBuffer.toString("utf8");

      return decrypted;
    } catch (error: unknown) {
      throw new Error(`Decryption failed: ${String(error)}`);
    }
  }

  /**
   * Hash passwords securely
   */
  async hashPassword(password: string): Promise<string> {
    const bcrypt = await import("bcrypt");
    return bcrypt.hash(password, 12);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    const bcrypt = await import("bcrypt");
    return bcrypt.compare(password, hash);
  }
}

// Create singleton instance
export const encryptionService = new EncryptionService();

/**
 * Configuration for which fields need encryption by table
 */
export const SENSITIVE_FIELDS = {
  servers: ["sshKey", "password"],
  users: ["password"],
  envVars: ["value"],
  apiTokens: ["token"],
  settings: ["value"],
  systemSettings: ["value"],
} as const;

/**
 * List of system settings keys that contain sensitive data
 */
export const SENSITIVE_SYSTEM_SETTINGS = [
  "smtpPassword",
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
  "customAiApiKey",
  // Add more sensitive keys here as needed
] as const;

/**
 * Check if a system setting key contains sensitive data
 */
export function isSystemSettingSensitive(key: string): boolean {
  return SENSITIVE_SYSTEM_SETTINGS.includes(
    key as (typeof SENSITIVE_SYSTEM_SETTINGS)[number],
  );
}

/**
 * Check if a field should be encrypted
 */
export function shouldEncrypt(table: string, field: string): boolean {
  const fields = SENSITIVE_FIELDS[table as keyof typeof SENSITIVE_FIELDS];
  return fields?.includes(field as never) ?? false;
}

/**
 * Encrypt sensitive fields in data object
 */
export function encryptSensitiveData<T extends Record<string, unknown>>(
  data: T,
  tableName: string,
): T {
  const result = { ...data };

  Object.keys(data).forEach((key) => {
    if (
      shouldEncrypt(tableName, key) &&
      typeof data[key] === "string" &&
      data[key]
    ) {
      // Use proper type assertion for the result object
      (result as Record<string, unknown>)[key] = encryptionService.encrypt(
        data[key],
      );
    }
  });

  return result;
}
