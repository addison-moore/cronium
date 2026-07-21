import { hashApiToken, isHashedApiToken } from "../api-token-hash";

describe("api-token-hash", () => {
  it("produces a deterministic 64-char hex digest", () => {
    const a = hashApiToken("my-secret-token");
    const b = hashApiToken("my-secret-token");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different tokens", () => {
    expect(hashApiToken("token-a")).not.toBe(hashApiToken("token-b"));
  });

  it("is not reversible to the raw token", () => {
    const raw = "cronium_live_abc123";
    const hash = hashApiToken(raw);
    expect(hash).not.toContain(raw);
  });

  it("recognizes a hashed value and rejects a raw/encrypted value", () => {
    expect(isHashedApiToken(hashApiToken("anything"))).toBe(true);
    // Raw nanoid token (not a hash)
    expect(isHashedApiToken("V1StGXR8_Z5jdHi6B-myT")).toBe(false);
    // Legacy encrypted values are longer base64 blobs, not 64-hex
    expect(isHashedApiToken("dGhpcyBpcyBub3QgYSBoYXNo/base64==")).toBe(false);
  });
});
