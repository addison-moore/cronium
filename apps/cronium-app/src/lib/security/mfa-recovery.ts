import { createHash, randomBytes } from "crypto";

/**
 * Single-use MFA recovery codes. Codes are shown to the user once at
 * generation; only their SHA-256 hashes are stored, and consumption is atomic
 * (see storage.consumeMfaRecoveryCode).
 */

const RECOVERY_CODE_COUNT = 10;

export function hashRecoveryCode(code: string): string {
  // Normalize so formatting/casing differences don't matter on redemption.
  const normalized = code.replace(/[\s-]/g, "").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export function generateRecoveryCodes(): {
  plaintext: string[];
  hashes: string[];
} {
  const plaintext: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    plaintext.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { plaintext, hashes };
}
