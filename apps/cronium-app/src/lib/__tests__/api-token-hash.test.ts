import { hashApiToken } from "../api-token-hash";

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
});
