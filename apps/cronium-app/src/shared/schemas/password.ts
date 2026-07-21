import { z } from "zod";

/**
 * Minimum password length (security plan Phase 1.3). Raised from 8 to 12 to
 * meaningfully resist offline brute force; length is the single highest-impact
 * password control, so it is enforced everywhere a password is set (register,
 * reset, invite activation, first-admin setup) via this shared schema.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_MIN_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE)
  // A generous ceiling keeps bcrypt input bounded without constraining
  // passphrases. (bcrypt truncates at 72 bytes; this is a DoS guard, not a
  // security assertion about the tail.)
  .max(200, "Password must be at most 200 characters");
