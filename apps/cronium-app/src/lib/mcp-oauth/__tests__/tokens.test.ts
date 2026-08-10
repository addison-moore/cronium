/**
 * @jest-environment node
 */
process.env.AUTH_SECRET = "test-auth-secret-for-mcp-oauth";

import { createHash } from "node:crypto";
import {
  mintAccessToken,
  verifyAccessToken,
  mintRefreshToken,
  verifyRefreshToken,
  pkceMatches,
  signTicket,
  verifyTicket,
  randomId,
} from "../tokens";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Flip a bit in the last dot-separated segment (the MAC), by decoding it,
 * mutating a byte, and re-encoding.
 *
 * Rewriting the trailing base64url *characters* does not reliably change what
 * the segment decodes to: a 32-byte HMAC encodes to 43 base64url characters
 * and the last one carries only the digest's final 4 bits, so its low 2 bits
 * are padding the decoder throws away. Character-level tampering therefore
 * produced a byte-identical MAC about once in 1024 runs, and the assertion
 * that it must be rejected failed.
 */
function tamperSignature(token: string): string {
  const cut = token.lastIndexOf(".");
  const signature = Buffer.from(token.slice(cut + 1), "base64url");
  signature[0]! ^= 0xff;
  return `${token.slice(0, cut + 1)}${signature.toString("base64url")}`;
}

describe("pkceMatches (S256)", () => {
  it("accepts the matching verifier", () => {
    const verifier = randomId(32);
    expect(pkceMatches(verifier, challengeFor(verifier))).toBe(true);
  });
  it("rejects a wrong verifier and empty inputs", () => {
    const verifier = randomId(32);
    expect(pkceMatches("wrong", challengeFor(verifier))).toBe(false);
    expect(pkceMatches("", "")).toBe(false);
    expect(pkceMatches(verifier, "")).toBe(false);
  });
});

describe("access / refresh tokens", () => {
  const input = {
    sub: "u1",
    cid: "c1",
    scope: "mcp",
    aud: "https://x/api/mcp",
  };

  it("access token round-trips and carries claims", () => {
    const { token, expiresIn } = mintAccessToken(input);
    expect(expiresIn).toBeGreaterThan(0);
    const p = verifyAccessToken(token);
    expect(p).toMatchObject({
      typ: "at",
      sub: "u1",
      cid: "c1",
      aud: input.aud,
    });
  });

  it("rejects a tampered access token", () => {
    const { token } = mintAccessToken(input);
    const tampered = tamperSignature(token);
    // Same length as the original: this exercises the MAC comparison, not the
    // length check that a truncating tamper would have tripped first.
    expect(tampered).toHaveLength(token.length);
    expect(tampered).not.toBe(token);
    expect(verifyAccessToken(tampered)).toBeNull();
    expect(verifyAccessToken("garbage")).toBeNull();
  });

  it("does not accept a refresh token as an access token (typ separation)", () => {
    const rt = mintRefreshToken({ ...input, jti: "j1" });
    expect(verifyAccessToken(rt)).toBeNull();
    expect(verifyRefreshToken(rt)).toMatchObject({ typ: "rt", jti: "j1" });
  });

  it("does not accept an access token as a refresh token", () => {
    const { token } = mintAccessToken(input);
    expect(verifyRefreshToken(token)).toBeNull();
  });
});

describe("consent tickets", () => {
  const now = Math.floor(Date.now() / 1000);

  it("round-trips and rejects tampering", () => {
    const t = signTicket({ sub: "u1", cid: "c1", exp: now + 300 });
    expect(verifyTicket(t)).toMatchObject({ sub: "u1", cid: "c1" });
    expect(verifyTicket(tamperSignature(t))).toBeNull();
  });

  it("rejects an expired ticket", () => {
    const t = signTicket({ sub: "u1", exp: now - 1 });
    expect(verifyTicket(t)).toBeNull();
  });

  it("a ticket does not verify as an access token (domain separation)", () => {
    const t = signTicket({ sub: "u1", exp: now + 300 });
    expect(verifyAccessToken(t)).toBeNull();
  });
});
