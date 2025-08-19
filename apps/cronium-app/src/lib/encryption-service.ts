/**
 * Encryption/Decryption Service for Cronium Platform
 *
 * This service provides both client-side and server-side encryption capabilities
 * to secure sensitive data like SSH keys, passwords, environment variables, and API tokens.
 *
 * Client-side encryption ensures data is encrypted before transmission,
 * while server-side encryption provides additional security for data at rest.
 */

import crypto from "crypto";
import { env } from "../env.mjs";

// Encryption configuration
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16; // 128 bits for client-side encryption

/**
 * Server-side encryption service
 */
class EncryptionService {
  private masterKey: Buffer;

  constructor() {
    // Get master key from environment variable or generate a default one for development
    let masterKeyHex = env.ENCRYPTION_KEY;

    if (!masterKeyHex) {
      // Generate a default key for development (not secure for production)
      console.warn(
        "ENCRYPTION_KEY not set, generating temporary key for development",
      );
      masterKeyHex = crypto.randomBytes(KEY_LENGTH).toString("hex");
    }

    if (masterKeyHex.length !== KEY_LENGTH * 2) {
      throw new Error(
        `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`,
      );
    }

    this.masterKey = Buffer.from(masterKeyHex, "hex");
  }

  /**
   * Encrypt sensitive data on the server
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
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

    // Check if data is actually encrypted (should be base64)
    try {
      Buffer.from(encryptedData, "base64");
    } catch {
      // If it's not valid base64, it's probably unencrypted legacy data
      return encryptedData;
    }

    // If it doesn't look like encrypted data, return as-is
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

      const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
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
   * Generate a secure random key for client-side encryption
   */
  generateClientKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString("hex");
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

/**
 * Decrypt sensitive fields in data object
 */
export function decryptSensitiveData<T extends Record<string, unknown>>(
  data: T,
  tableName: string,
): T {
  const result = { ...data };

  Object.keys(data).forEach((key) => {
    const value = data[key as keyof T];
    if (shouldEncrypt(tableName, key) && typeof value === "string" && value) {
      (result as Record<string, unknown>)[key] =
        encryptionService.decrypt(value);
    }
  });

  return result;
}

/**
 * Client-side encryption utilities
 * These functions can be used in the browser for client-side encryption
 */
export class ClientEncryptionUtils {
  /**
   * Generate a key from password using PBKDF2
   */
  static async deriveKey(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Encrypt data on the client side
   */
  static async encrypt(plaintext: string, password: string): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const key = await this.deriveKey(password, salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoder.encode(plaintext),
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(
      salt.length + iv.length + encrypted.byteLength,
    );
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return btoa(
      Array.from(combined)
        .map((byte) => String.fromCharCode(byte))
        .join(""),
    );
  }

  /**
   * Decrypt data on the client side
   */
  static async decrypt(
    encryptedData: string,
    password: string,
  ): Promise<string> {
    const combined = new Uint8Array(
      atob(encryptedData)
        .split("")
        .map((char) => char.charCodeAt(0)),
    );

    // Extract components
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = await this.deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encrypted,
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Generate a secure random password/key
   */
  static generateSecureKey(length = 32): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let result = "";
    const randomArray = crypto.getRandomValues(new Uint8Array(length));

    for (let i = 0; i < length; i++) {
      const randomValue = randomArray[i];
      if (randomValue !== undefined) {
        result += chars.charAt(randomValue % chars.length);
      }
    }

    return result;
  }
}

/**
 * Field encryption markers for compatibility
 */
export const ENCRYPTED_FIELDS = SENSITIVE_FIELDS;

/**
 * Utility to check if a field should be encrypted (alternative function name)
 */
export function shouldEncryptField(table: string, field: string): boolean {
  return shouldEncrypt(table, field);
}

/**
 * Encrypt multiple fields in an object (alternative function name)
 */
export function encryptFields<T extends Record<string, unknown>>(
  data: T,
  table: string,
): T {
  return encryptSensitiveData(data, table);
}

/**
 * Decrypt multiple fields in an object (alternative function name)
 */
export function decryptFields<T extends Record<string, unknown>>(
  data: T,
  table: string,
): T {
  return decryptSensitiveData(data, table);
}

/**
 * Create server encryption instance for compatibility
 */
export const serverEncryption = encryptionService;
