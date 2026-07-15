/**
 * @jest-environment node
 */
import { withTimeout } from "../with-timeout";

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("propagates the original rejection", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects with a labeled timeout when the promise is too slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 50));
    await expect(withTimeout(slow, 10, 'Action "x"')).rejects.toThrow(
      /Action "x" timed out after 10ms/,
    );
  });
});
