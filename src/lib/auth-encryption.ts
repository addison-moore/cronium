/**
 * Authentication-specific client-side encryption utilities
 *
 * This module provides password encryption for authentication forms
 * without requiring user session or pre-initialized keys.
 */

const TEMP_AUTH_KEY = "cronium-auth-temp-key-2025";

export class AuthEncryption {
  /**
   * Check if Web Crypto API is supported
   */
  static isSupported(): boolean {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.getRandomValues !== "undefined"
    );
  }

  /**
   * Derive a key from the temporary auth key and salt
   */
  private static async deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(TEMP_AUTH_KEY),
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
   * Encrypt password for authentication
   */
  static async encryptPassword(password: string): Promise<string> {
    if (!this.isSupported()) {
      throw new Error("Web Crypto API not supported");
    }

    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(16));

    const key = await this.deriveKey(salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoder.encode(password),
    );

    // For AES-GCM, the encrypted result includes both ciphertext and auth tag
    const encryptedArray = new Uint8Array(encrypted);

    // Combine salt + iv + encrypted data (which includes auth tag)
    const combined = new Uint8Array(
      salt.length + iv.length + encryptedArray.length,
    );
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(encryptedArray, salt.length + iv.length);

    return btoa(
      Array.from(combined)
        .map((byte) => String.fromCharCode(byte))
        .join(""),
    );
  }

  /**
   * Decrypt password for authentication (server-side compatible)
   */
  static async decryptPassword(encryptedData: string): Promise<string> {
    if (!this.isSupported()) {
      throw new Error("Web Crypto API not supported");
    }

    const combined = new Uint8Array(
      atob(encryptedData)
        .split("")
        .map((char) => char.charCodeAt(0)),
    );

    // Extract components
    const salt = combined.slice(0, 32);
    const iv = combined.slice(32, 48);
    const encrypted = combined.slice(48);

    const key = await this.deriveKey(salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encrypted,
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }
}

/**
 * React hook for authentication password encryption
 */
export function useAuthEncryption() {
  const isSupported = AuthEncryption.isSupported();

  const encryptPassword = async (password: string): Promise<string> => {
    if (!isSupported) {
      // Return plaintext if encryption not supported (legacy fallback)
      return password;
    }
    return AuthEncryption.encryptPassword(password);
  };

  return {
    isSupported,
    encryptPassword,
  };
}
