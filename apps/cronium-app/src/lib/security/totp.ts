import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * RFC 6238 TOTP (time-based one-time passwords) implemented on Node crypto, so
 * MFA needs no third-party dependency. Standard parameters: SHA-1, 6 digits,
 * 30-second time step — compatible with Google Authenticator, 1Password, etc.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a new random base32 TOTP secret (default 20 bytes = 160 bits). */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Compute the TOTP code for a secret at a given unix time (seconds). */
export function generateTotp(secret: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / PERIOD_SECONDS);
  const key = base32Decode(secret);

  const counterBuffer = Buffer.alloc(8);
  // 64-bit big-endian counter (high word is 0 for any realistic time).
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Verify a submitted TOTP code against a secret, allowing ±`window` time steps
 * of clock drift (default ±1 = the current, previous, and next 30-second code).
 * Constant-time comparison per candidate.
 */
export function verifyTotp(
  secret: string,
  token: string,
  options: { unixSeconds?: number; window?: number } = {},
): boolean {
  const normalized = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;

  const now = options.unixSeconds ?? Math.floor(Date.now() / 1000);
  const window = options.window ?? 1;
  const submitted = Buffer.from(normalized);

  for (let drift = -window; drift <= window; drift++) {
    const candidate = generateTotp(secret, now + drift * PERIOD_SECONDS);
    const candidateBuffer = Buffer.from(candidate);
    if (
      candidateBuffer.length === submitted.length &&
      timingSafeEqual(candidateBuffer, submitted)
    ) {
      return true;
    }
  }
  return false;
}

/** Build the otpauth:// URI a QR code / authenticator app consumes. */
export function buildOtpAuthUri(
  secret: string,
  accountName: string,
  issuer = "Cronium",
): string {
  // otpauth labels keep the issuer:account colon literal; encode each part.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
