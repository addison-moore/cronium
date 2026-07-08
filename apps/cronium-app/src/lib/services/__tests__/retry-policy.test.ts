import {
  shouldRetry,
  computeRetryBackoffMs,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from "../retry-policy";

describe("shouldRetry", () => {
  it("does not retry when maxAttempts is 0", () => {
    expect(shouldRetry(0, 0)).toBe(false);
  });

  it("retries while under the cap", () => {
    expect(shouldRetry(0, 3)).toBe(true);
    expect(shouldRetry(2, 3)).toBe(true);
  });

  it("stops at or over the cap", () => {
    expect(shouldRetry(3, 3)).toBe(false);
    expect(shouldRetry(4, 3)).toBe(false);
  });
});

describe("computeRetryBackoffMs", () => {
  it("doubles the base delay per attempt", () => {
    expect(computeRetryBackoffMs(0)).toBe(RETRY_BASE_DELAY_MS);
    expect(computeRetryBackoffMs(1)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(computeRetryBackoffMs(2)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it("caps at the maximum delay", () => {
    expect(computeRetryBackoffMs(100)).toBe(RETRY_MAX_DELAY_MS);
  });

  it("never exceeds the cap", () => {
    for (let attempts = 0; attempts < 20; attempts++) {
      expect(computeRetryBackoffMs(attempts)).toBeLessThanOrEqual(
        RETRY_MAX_DELAY_MS,
      );
    }
  });
});
