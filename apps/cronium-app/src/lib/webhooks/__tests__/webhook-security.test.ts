/**
 * @jest-environment node
 */
// Stub the rate-limit service so importing WebhookSecurity does not pull the
// ESM-only env chain (@t3-oss/env-nextjs) into the transform.
jest.mock("@/lib/rate-limit-service", () => ({ RateLimitService: {} }));

import { WebhookSecurity } from "../WebhookSecurity";

const sec = new WebhookSecurity();

describe("WebhookSecurity.verifyTimestamp (replay window)", () => {
  it("accepts a current timestamp", () => {
    expect(sec.verifyTimestamp(new Date().toISOString()).isValid).toBe(true);
  });

  it("rejects a timestamp far outside the tolerance window", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(sec.verifyTimestamp(old).isValid).toBe(false);
  });

  it("rejects a malformed (non-finite) timestamp instead of letting it pass (HI-12)", () => {
    // new Date("not-a-date").getTime() is NaN; Math.abs(NaN) > tol is false, so
    // the old code accepted it. It must now be rejected.
    const result = sec.verifyTimestamp("not-a-date");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Invalid timestamp");
  });

  it("rejects an empty timestamp", () => {
    expect(sec.verifyTimestamp("").isValid).toBe(false);
  });
});

describe("WebhookSecurity.verifySignature", () => {
  it("accepts a correct HMAC and rejects a tampered one", () => {
    const secret = "shhh";
    const body = JSON.stringify({ hello: "world" });
    const sig = sec.generateSignature(body, secret);
    expect(sec.verifySignature(body, sig, secret).isValid).toBe(true);
    expect(sec.verifySignature(body + "x", sig, secret).isValid).toBe(false);
  });
});
