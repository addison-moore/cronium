import { normalizeValkeyUrl } from "../valkey-url";

describe("Valkey URL normalization", () => {
  it.each([
    ["valkey://valkey:6379", "redis://valkey:6379"],
    ["VALKEYS://cache.example:6380/1", "rediss://cache.example:6380/1"],
    ["redis://redis:6379", "redis://redis:6379"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeValkeyUrl(input)).toBe(expected);
  });
});
