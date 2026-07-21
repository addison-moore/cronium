import {
  buildOtpAuthUri,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from "@/lib/security/totp";

// RFC 6238 uses an ASCII-seed test vector, but our API takes a base32 secret.
// We validate internal consistency + drift behavior instead of the RFC vectors.

describe("TOTP generate/verify", () => {
  const secret = "JBSWY3DPEHPK3PXP"; // a fixed base32 secret

  it("generates a 6-digit code", () => {
    const code = generateTotp(secret, 1_000_000_000);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("verifies the code for the current step", () => {
    const t = 1_700_000_000;
    const code = generateTotp(secret, t);
    expect(verifyTotp(secret, code, { unixSeconds: t })).toBe(true);
  });

  it("accepts a code from the previous/next step (±1 drift)", () => {
    const t = 1_700_000_000;
    const prev = generateTotp(secret, t - 30);
    const next = generateTotp(secret, t + 30);
    expect(verifyTotp(secret, prev, { unixSeconds: t })).toBe(true);
    expect(verifyTotp(secret, next, { unixSeconds: t })).toBe(true);
  });

  it("rejects a code two steps away", () => {
    const t = 1_700_000_000;
    const far = generateTotp(secret, t + 120);
    expect(verifyTotp(secret, far, { unixSeconds: t })).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(verifyTotp(secret, "abc")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
  });

  it("tolerates spaces in the submitted code", () => {
    const t = 1_700_000_000;
    const code = generateTotp(secret, t);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced, { unixSeconds: t })).toBe(true);
  });
});

describe("secret + otpauth", () => {
  it("generates a valid base32 secret usable end to end", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const t = 1_700_000_000;
    const code = generateTotp(secret, t);
    expect(verifyTotp(secret, code, { unixSeconds: t })).toBe(true);
  });

  it("builds an otpauth URI with the standard params", () => {
    const uri = buildOtpAuthUri("JBSWY3DPEHPK3PXP", "admin@example.com");
    expect(uri).toContain("otpauth://totp/Cronium:admin%40example.com");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Cronium");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
