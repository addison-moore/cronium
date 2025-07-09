/**
 * Credential encryption service for securing sensitive data at rest
 */

import {
  createCipheriv,
  createDecipheriv,
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
  private keyCache = new Map<string, { key: Buffer; expires: Date }>();

  private constructor(private config?: EncryptionConfig) {
    if (config) {
      Object.assign(this, config);
    }
  }

  static getInstance(config?: EncryptionConfig): CredentialEncryption {
    if (!CredentialEncryption.instance) {
      CredentialEncryption.instance = new CredentialEncryption(config);
    }
    return CredentialEncryption.instance;
  }

  /**
   * Initialize with master key
   */
  initialize(masterKey: string): void {
    if (!masterKey || masterKey.length < 32) {
      throw new Error("Master key must be at least 32 characters long");
    }

    // Derive a consistent key from the master key
    const salt = Buffer.from("cronium-tool-credentials-v1", "utf8");
    this.masterKey = scryptSync(masterKey, salt, this.keyLength);

    console.log("Credential encryption initialized");
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
        "Encryption not initialized. Set CREDENTIAL_ENCRYPTION_KEY environment variable.",
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
   * Decrypt credential data
   */
  decrypt(encryptedData: EncryptedData): unknown {
    if (!this.isAvailable()) {
      throw new Error("Encryption not initialized");
    }

    // Validate encrypted data
    if (
      !encryptedData.encrypted ||
      !encryptedData.iv ||
      !encryptedData.authTag
    ) {
      throw new Error("Invalid encrypted data format");
    }

    // Decode from base64
    const encrypted = Buffer.from(encryptedData.encrypted, "base64");
    const iv = Buffer.from(encryptedData.iv, "base64");
    const authTag = Buffer.from(encryptedData.authTag, "base64");
    const salt = Buffer.from(encryptedData.keyDerivation.salt, "base64");

    // Derive decryption key
    const key = this.deriveKey(salt);

    // Create decipher
    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    const plaintext = decrypted.toString("utf8");

    // Try to parse as JSON, otherwise return as string
    try {
      return JSON.parse(plaintext);
    } catch {
      return plaintext;
    }
  }

  /**
   * Derive key from salt
   */
  private deriveKey(salt: Buffer): Buffer {
    const cacheKey = salt.toString("base64");

    // Check cache
    const cached = this.keyCache.get(cacheKey);
    if (cached && cached.expires > new Date()) {
      return cached.key;
    }

    // Derive new key
    const key = scryptSync(this.masterKey!, salt, this.keyLength);

    // Cache for 5 minutes
    this.keyCache.set(cacheKey, {
      key,
      expires: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Clean old cache entries
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
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
if (encryptionKey) {
  try {
    credentialEncryption.initialize(encryptionKey);
  } catch (error) {
    console.error("Failed to initialize credential encryption:", error);
  }
}
