/**
 * Server-side authentication encryption utilities
 *
 * This module provides server-side decryption for passwords encrypted
 * with the client-side authentication encryption.
 */

import crypto from "crypto";

const TEMP_AUTH_KEY = "cronium-auth-temp-key-2025";

export class AuthEncryptionServer {
  /**
   * Derive a key from the temporary auth key and salt
   */
  private static async deriveKey(salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        TEMP_AUTH_KEY,
        salt,
        100000,
        32,
        "sha256",
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        },
      );
    });
  }

  /**
   * Decrypt password that was encrypted with client-side authentication encryption
   */
  static async decryptPassword(encryptedData: string): Promise<string> {
    try {
      const combined = Buffer.from(encryptedData, "base64");

      // Extract components
      const salt = combined.slice(0, 32);
      const iv = combined.slice(32, 48);
      const encrypted = combined.slice(48);

      const key = await this.deriveKey(salt);

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

      // For Web Crypto API AES-GCM, the auth tag is the last 16 bytes
      const authTagLength = 16;
      const authTag = encrypted.slice(-authTagLength);
      const ciphertext = encrypted.slice(0, -authTagLength);

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString("utf8");
    } catch (error) {
      throw new Error(`Failed to decrypt password: ${error}`);
    }
  }

  /**
   * Check if a string looks like an encrypted password from auth encryption
   */
  static isAuthEncrypted(password: string): boolean {
    // Auth encrypted passwords are base64 strings of specific length
    if (password.length < 80 || password.length > 200) return false;

    // Check if it's valid base64
    if (!/^[A-Za-z0-9+/]+=*$/.test(password)) return false;

    try {
      const decoded = Buffer.from(password, "base64");
      // Should have at least salt (32) + iv (16) + some encrypted data + auth tag (16)
      return decoded.length >= 64;
    } catch {
      return false;
    }
  }
}
