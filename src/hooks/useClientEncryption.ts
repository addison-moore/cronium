/**
 * Client-side encryption hook
 * 
 * This hook provides client-side encryption capabilities for sensitive data
 * before it's transmitted to the server, ensuring end-to-end security.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * Client-side encryption utilities (browser-compatible)
 */
class ClientEncryption {
  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async encrypt(plaintext: string, userKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(16));
    
    const key = await this.deriveKey(userKey, salt);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(plaintext)
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64 without using spread operator to avoid TS2802 error
    let binaryString = '';
    for (let i = 0; i < combined.length; i++) {
      const byte = combined[i];
      if (byte !== undefined) {
        binaryString += String.fromCharCode(byte);
      }
    }
    return btoa(binaryString);
  }

  static async decrypt(encryptedData: string, userKey: string): Promise<string> {
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(char => char.charCodeAt(0))
    );

    // Extract components
    const salt = combined.slice(0, 32);
    const iv = combined.slice(32, 48);
    const encrypted = combined.slice(48);

    const key = await this.deriveKey(userKey, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  static generateSecureKey(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
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

interface EncryptionState {
  isSupported: boolean;
  userKey: string | null;
  isInitialized: boolean;
}

/**
 * Hook for client-side encryption operations
 */
export function useClientEncryption() {
  const { user } = useAuth();
  const [state, setState] = useState<EncryptionState>({
    isSupported: false,
    userKey: null,
    isInitialized: false,
  });

  // Check if Web Crypto API is supported
  useEffect(() => {
    const checkSupport = () => {
      const isSupported = typeof window !== 'undefined' && 
                         'crypto' in window && 
                         'subtle' in window.crypto;
      
      setState(prev => ({ ...prev, isSupported, isInitialized: true }));
    };

    checkSupport();
  }, []);

  // Generate or retrieve user-specific encryption key
  const initializeUserKey = useCallback(async () => {
    if (!state.isSupported || !user?.id) return;

    try {
      // Try to get existing key from sessionStorage (temporary storage)
      let userKey = sessionStorage.getItem(`cronium_key_${user.id}`);
      
      if (!userKey) {
        // Generate new key if none exists
        userKey = ClientEncryption.generateSecureKey();
        sessionStorage.setItem(`cronium_key_${user.id}`, userKey);
      }

      setState(prev => ({ ...prev, userKey }));
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
    }
  }, [state.isSupported, user?.id]);

  // Initialize key when user is available
  useEffect(() => {
    if (state.isSupported && user?.id && !state.userKey) {
      initializeUserKey();
    }
  }, [state.isSupported, user?.id, state.userKey, initializeUserKey]);

  /**
   * Encrypt sensitive data before sending to server
   */
  const encryptData = useCallback(async (plaintext: string): Promise<string> => {
    if (!state.isSupported) {
      throw new Error('Client-side encryption is not supported in this browser');
    }

    if (!state.userKey) {
      throw new Error('Encryption key not initialized');
    }

    return ClientEncryption.encrypt(plaintext, state.userKey);
  }, [state.isSupported, state.userKey]);

  /**
   * Decrypt data received from server
   */
  const decryptData = useCallback(async (encryptedData: string): Promise<string> => {
    if (!state.isSupported) {
      throw new Error('Client-side encryption is not supported in this browser');
    }

    if (!state.userKey) {
      throw new Error('Encryption key not initialized');
    }

    return ClientEncryption.decrypt(encryptedData, state.userKey);
  }, [state.isSupported, state.userKey]);

  /**
   * Encrypt multiple fields in an object
   */
  const encryptFields = useCallback(async <T extends Record<string, any>>(
    data: T,
    fieldsToEncrypt: (keyof T)[]
  ): Promise<T> => {
    if (!state.isSupported || !state.userKey) {
      return data;
    }

    const result = { ...data };
    
    for (const field of fieldsToEncrypt) {
      const value = data[field];
      if (typeof value === 'string' && value.trim()) {
        try {
          // Fix TS2322 by using type assertion
          result[field] = await encryptData(value) as T[keyof T];
        } catch (error) {
          console.error(`Failed to encrypt field ${String(field)}:`, error);
          // Keep original value if encryption fails
        }
      }
    }
    
    return result;
  }, [state.isSupported, state.userKey, encryptData]);

  /**
   * Decrypt multiple fields in an object
   */
  const decryptFields = useCallback(async <T extends Record<string, any>>(
    data: T,
    fieldsToDecrypt: (keyof T)[]
  ): Promise<T> => {
    if (!state.isSupported || !state.userKey) {
      return data;
    }

    const result = { ...data };
    
    for (const field of fieldsToDecrypt) {
      const value = data[field];
      if (typeof value === 'string' && value.trim()) {
        try {
          // Fix TS2322 by using type assertion
          result[field] = await decryptData(value) as T[keyof T];
        } catch (error) {
          console.error(`Failed to decrypt field ${String(field)}:`, error);
          // Keep original value if decryption fails
        }
      }
    }
    
    return result;
  }, [state.isSupported, state.userKey, decryptData]);

  /**
   * Clear encryption key (useful for logout)
   */
  const clearEncryptionKey = useCallback(() => {
    if (user?.id) {
      sessionStorage.removeItem(`cronium_key_${user.id}`);
      setState(prev => ({ ...prev, userKey: null }));
    }
  }, [user?.id]);

  /**
   * Generate a new encryption key
   */
  const regenerateKey = useCallback(() => {
    if (!state.isSupported || !user?.id) return;

    const newKey = ClientEncryption.generateSecureKey();
    sessionStorage.setItem(`cronium_key_${user.id}`, newKey);
    setState(prev => ({ ...prev, userKey: newKey }));
  }, [state.isSupported, user?.id]);

  return {
    isSupported: state.isSupported,
    isReady: state.isInitialized && state.isSupported && !!state.userKey,
    encryptData,
    decryptData,
    encryptFields,
    decryptFields,
    clearEncryptionKey,
    regenerateKey,
  };
}

/**
 * Predefined field configurations for different data types
 */
export const SENSITIVE_FIELDS = {
  servers: ['sshKey'] as const,
  envVars: ['value'] as const,
  apiTokens: ['token'] as const,
  users: ['password'] as const,
} as const;

// Type definitions to help with the readonly arrays
type SensitiveFieldsType = typeof SENSITIVE_FIELDS;
type ServerFields = SensitiveFieldsType['servers'][number];
type EnvVarFields = SensitiveFieldsType['envVars'][number];
type ApiTokenFields = SensitiveFieldsType['apiTokens'][number];
type UserFields = SensitiveFieldsType['users'][number];

/**
 * Hook specifically for server configuration encryption
 */
export function useServerEncryption() {
  const encryption = useClientEncryption();

  const encryptServerData = useCallback(async (serverData: any) => {
    return encryption.encryptFields(serverData, [...SENSITIVE_FIELDS.servers]);
  }, [encryption]);

  const decryptServerData = useCallback(async (serverData: any) => {
    return encryption.decryptFields(serverData, [...SENSITIVE_FIELDS.servers]);
  }, [encryption]);

  return {
    ...encryption,
    encryptServerData,
    decryptServerData,
  };
}

/**
 * Hook specifically for environment variables encryption
 */
export function useEnvVarEncryption() {
  const encryption = useClientEncryption();

  const encryptEnvVar = useCallback(async (envVarData: any) => {
    return encryption.encryptFields(envVarData, [...SENSITIVE_FIELDS.envVars]);
  }, [encryption]);

  const decryptEnvVar = useCallback(async (envVarData: any) => {
    return encryption.decryptFields(envVarData, [...SENSITIVE_FIELDS.envVars]);
  }, [encryption]);

  return {
    ...encryption,
    encryptEnvVar,
    decryptEnvVar,
  };
}