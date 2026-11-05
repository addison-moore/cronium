/**
 * @jest-environment node
 */
jest.mock("@/server/storage", () => ({ storage: {} }));
jest.mock("@/lib/security/atomic-rate-limiter", () => ({
  consumeAtomicRateLimit: jest.fn(),
}));

import { authOptions } from "../auth";

const BASE = "https://cronium.example.com";
const redirect = (url: string) =>
  authOptions.callbacks!.redirect!({ url, baseUrl: BASE });

describe("NextAuth redirect callback", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    [`${BASE}/dashboard`, `${BASE}/dashboard`],
  ])("keeps %s", async (input, expected) => {
    await expect(redirect(input)).resolves.toBe(expected);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    `${BASE}.evil.example/`,
    `${BASE}@evil.example/`,
    "javascript:alert(1)",
  ])("sends %s back to the base URL", async (input) => {
    await expect(redirect(input)).resolves.toBe(BASE);
  });
});
