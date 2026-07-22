import { revocationKey } from "@/lib/security/execution-token-revocation";

describe("execution-token revocation (HI-14)", () => {
  // This key string is a CONTRACT with the Go runtime, which checks
  // `cronium:exec-revoked:<jobId>` via EXISTS
  // (apps/runtime/cronium-runtime/internal/cache/valkey.go IsJobRevoked).
  // If this format changes, the runtime must change in lockstep or revocation
  // silently stops working.
  it("produces the exact key the runtime reads", () => {
    expect(revocationKey("job_abc123")).toBe("cronium:exec-revoked:job_abc123");
  });

  it("scopes the marker to a single job", () => {
    expect(revocationKey("job_A")).not.toBe(revocationKey("job_B"));
    expect(revocationKey("job_A").startsWith("cronium:exec-revoked:")).toBe(
      true,
    );
  });
});
