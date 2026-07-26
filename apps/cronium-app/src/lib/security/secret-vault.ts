import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * One versioned, record-bound secret encryption boundary (security plan Phase
 * 2.1). Replaces the two legacy schemes (shape-detected AES with a static AAD,
 * and per-record-scrypt with no AAD) which failed open on decrypt and did not
 * bind ciphertext to its record.
 *
 * Envelope format (compact, self-describing):
 *   crn.1.<keyId>.<b64u iv>.<b64u ciphertext>.<b64u tag>
 *
 * Every field is authenticated:
 *   - `crn.1` — scheme + version. An unknown version fails closed.
 *   - `keyId` — selects the key from the keyring (enables rotation).
 *   - AES-256-GCM `iv`/`ciphertext`/`tag`.
 *   - AAD binds the ciphertext to `{purpose, table, column, recordId, tenantId}`
 *     so a value cannot be swapped to another purpose/row/tenant — a mismatch
 *     fails the GCM tag check and throws.
 *
 * Decryption NEVER returns the raw input on failure; there is no plaintext
 * passthrough. Startup fails closed when no valid active key is configured.
 */

const SCHEME = "crn";
const VERSION = "1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce
const KEY_LENGTH = 32; // AES-256

export interface SecretBinding {
  /** Semantic purpose, e.g. "tool-credential", "server-ssh-key". */
  purpose: string;
  /** Table the value lives in. */
  table: string;
  /** Column/field name. */
  column: string;
  /** Row identity (id). Use "" only for values with no stable row yet. */
  recordId: string | number;
  /** Owning tenant/user id, when the value is tenant-scoped. */
  tenantId?: string | null;
}

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

export class SecretVaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretVaultUnavailableError";
  }
}

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64u(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** Deterministic, non-secret 8-char identifier for a key (rotation selector). */
function keyIdFor(keyBytes: Buffer): string {
  return createHash("sha256").update(keyBytes).digest("hex").slice(0, 8);
}

function canonicalAad(binding: SecretBinding): Buffer {
  // Stable field order; the exact bytes are part of the authenticated data.
  const canonical = JSON.stringify({
    p: binding.purpose,
    t: binding.table,
    c: binding.column,
    r: String(binding.recordId ?? ""),
    u: binding.tenantId ?? "",
  });
  return Buffer.from(canonical, "utf8");
}

function parseHexKey(value: string, label: string): Buffer {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new SecretVaultUnavailableError(
      `${label} must be exactly 64 hex characters (32 bytes)`,
    );
  }
  return Buffer.from(trimmed, "hex");
}

interface KeyringEntry {
  keyId: string;
  key: Buffer;
}

export class SecretVault {
  private readonly activeKeyId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(options: {
    activeKeyHex: string;
    retiredKeysHex?: string[] | undefined;
  }) {
    const active = parseHexKey(options.activeKeyHex, "ENCRYPTION_KEY");
    this.keys = new Map();
    const activeId = keyIdFor(active);
    this.keys.set(activeId, active);
    this.activeKeyId = activeId;

    for (const [i, hex] of (options.retiredKeysHex ?? []).entries()) {
      const key = parseHexKey(hex, `ENCRYPTION_KEYS_RETIRED[${i}]`);
      this.keys.set(keyIdFor(key), key);
    }
  }

  /** All keyIds this vault can decrypt with (active first). */
  keyIds(): KeyringEntry[] {
    return [...this.keys.entries()].map(([keyId, key]) => ({ keyId, key }));
  }

  activeKeyIdValue(): string {
    return this.activeKeyId;
  }

  encrypt(plaintext: string, binding: SecretBinding): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(canonicalAad(binding));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      SCHEME,
      VERSION,
      this.activeKeyId,
      b64u(iv),
      b64u(ciphertext),
      b64u(tag),
    ].join(".");
  }

  /**
   * Decrypt a `crn.1` envelope. Throws SecretDecryptionError on any problem
   * (bad format, unknown key, wrong version, wrong binding, tampering). Never
   * returns the input unchanged.
   */
  decrypt(envelope: string, binding: SecretBinding): string {
    const parts = envelope.split(".");
    if (parts.length !== 6 || parts[0] !== SCHEME) {
      throw new SecretDecryptionError("Not a Cronium secret envelope");
    }
    const [, version, keyId, ivB64, ctB64, tagB64] = parts;
    if (version !== VERSION) {
      throw new SecretDecryptionError(
        `Unsupported envelope version ${String(version)}`,
      );
    }
    const key = this.keys.get(keyId!);
    if (!key) {
      throw new SecretDecryptionError(
        `No key ${String(keyId)} in keyring for this envelope`,
      );
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, fromB64u(ivB64!));
      decipher.setAAD(canonicalAad(binding));
      decipher.setAuthTag(fromB64u(tagB64!));
      const plaintext = Buffer.concat([
        decipher.update(fromB64u(ctB64!)),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      // Wrong key, wrong binding (AAD), or tampering — all fail closed.
      throw new SecretDecryptionError("Secret failed authenticated decryption");
    }
  }

  /** Whether an envelope was written with a retired (non-active) key. */
  needsReencryption(envelope: string): boolean {
    const parts = envelope.split(".");
    if (parts.length !== 6 || parts[0] !== SCHEME) return false;
    return parts[2] !== this.activeKeyId;
  }
}

/** Whether a stored value is a `crn.v` secret envelope (vs. legacy/plaintext). */
export function isSecretEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${SCHEME}.`);
}

let vault: SecretVault | null = null;

/**
 * The process-wide secret vault. Fails closed: throws if ENCRYPTION_KEY is
 * absent or invalid (no ephemeral development fallback — Phase 2.1).
 */
export function getSecretVault(): SecretVault {
  if (vault) return vault;
  const activeKeyHex = process.env.ENCRYPTION_KEY;
  if (!activeKeyHex) {
    throw new SecretVaultUnavailableError(
      "ENCRYPTION_KEY is required — refusing to start the secret vault without it",
    );
  }
  const retired = process.env.ENCRYPTION_KEYS_RETIRED;
  const retiredKeysHex = retired
    ? (JSON.parse(retired) as string[])
    : undefined;
  vault = new SecretVault({ activeKeyHex, retiredKeysHex });
  return vault;
}

/** Test hook: reset the memoized vault so env changes take effect. */
export function __resetSecretVaultForTests(): void {
  vault = null;
}
