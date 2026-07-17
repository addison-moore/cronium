import {
  createHmac,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Signing + PKCE primitives for the MCP OAuth 2.1 authorization server.
 *
 * Access and refresh tokens are compact HMAC-signed tokens (`<b64url(payload)>.
 * <b64url(mac)>`) — Cronium is both issuer and verifier, so a symmetric key
 * derived from AUTH_SECRET is sufficient and avoids a JWT dependency. Auth codes
 * are opaque random strings stored server-side (see store.ts) for single use.
 *
 * The key is derived lazily from process.env.AUTH_SECRET (required; validated at
 * app boot by env.mjs) so this module carries no env-wrapper import.
 */
let cachedKey: Buffer | null = null;
function signingKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for MCP OAuth token signing");
  }
  cachedKey = scryptSync(secret, "cronium-mcp-oauth-v1", 32);
  return cachedKey;
}

export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SEC = 60; // 1 minute

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Cryptographically-random URL-safe id (client ids, codes, jtis). */
export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

interface TokenPayload {
  typ: "at" | "rt";
  sub: string; // user id
  cid: string; // client id
  scope: string;
  aud: string; // resource (RFC 8707)
  jti?: string; // refresh tokens only
  iat: number;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(createHmac("sha256", signingKey()).update(body).digest());
  return `${body}.${mac}`;
}

function verify(token: string, typ: "at" | "rt"): TokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", signingKey()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return null;
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as TokenPayload;
  } catch {
    return null;
  }
  if (payload.typ !== typ) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowSec()) return null;
  return payload;
}

export interface MintTokenInput {
  sub: string;
  cid: string;
  scope: string;
  aud: string;
}

export function mintAccessToken(input: MintTokenInput): {
  token: string;
  expiresIn: number;
} {
  const iat = nowSec();
  const token = sign({
    typ: "at",
    ...input,
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SEC,
  });
  return { token, expiresIn: ACCESS_TOKEN_TTL_SEC };
}

export function mintRefreshToken(
  input: MintTokenInput & { jti: string },
): string {
  const iat = nowSec();
  return sign({
    typ: "rt",
    ...input,
    iat,
    exp: iat + REFRESH_TOKEN_TTL_SEC,
  });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  return verify(token, "at");
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  return verify(token, "rt");
}

/**
 * Short-lived signed "consent ticket" — bound to the authenticated user + the
 * authorization params — so the approve step can't be CSRF'd (an attacker can't
 * forge a ticket, and a ticket minted for one user is rejected for another).
 * Domain-separated from access/refresh tokens via a "ticket:" MAC prefix.
 */
export function signTicket(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(
    createHmac("sha256", signingKey()).update(`ticket:${body}`).digest(),
  );
  return `${body}.${mac}`;
}

export function verifyTicket<T = Record<string, unknown>>(
  token: string,
): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", signingKey())
    .update(`ticket:${body}`)
    .digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return null;
  }
  let payload: { exp?: number } & Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      exp?: number;
    } & Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < nowSec()) return null;
  return payload as T;
}

/** PKCE S256: base64url(SHA-256(verifier)) must equal the stored challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = b64url(createHash("sha256").update(verifier).digest());
  // Constant-time compare over equal-length buffers.
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
