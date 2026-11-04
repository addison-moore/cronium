import { createHash } from "crypto";

/**
 * One-way hash used to store API tokens at rest.
 *
 * API tokens are high-entropy secrets (`nanoid(32)` ~ 190 bits), so a plain
 * SHA-256 is the correct primitive here — no salt/KDF is needed for a value
 * that isn't guessable, and an unsalted hash lets us look the token up with a
 * single indexed equality query instead of decrypting every row. Storing a
 * hash (rather than a reversible ciphertext) means a database compromise does
 * not yield usable tokens.
 */
export function hashApiToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
