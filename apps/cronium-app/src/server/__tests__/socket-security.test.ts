/**
 * @jest-environment node
 */
import {
  isAllowedSocketOrigin,
  resolveAllowedSocketOrigins,
  verifyInternalBroadcastAuthorization,
} from "../socket-security";

describe("socket origin policy", () => {
  it("normalizes and deduplicates explicitly configured origins", () => {
    expect(
      // NODE_ENV is included because next's global.d.ts makes it a required
      // ProcessEnv key whenever another suite pulls those globals into the
      // ts-jest program.
      resolveAllowedSocketOrigins({
        NODE_ENV: "test",
        SOCKET_ALLOWED_ORIGINS:
          "https://cronium.example/path, https://admin.example,https://cronium.example",
      }),
    ).toEqual(["https://cronium.example", "https://admin.example"]);
  });

  it("falls back to the canonical app and auth origins", () => {
    expect(
      resolveAllowedSocketOrigins({
        NODE_ENV: "test",
        PUBLIC_APP_URL: "https://cronium.example",
        AUTH_URL: "https://cronium.example/auth",
      }),
    ).toEqual(["https://cronium.example"]);
  });

  it("requires an exact configured origin", () => {
    const allowed = ["https://cronium.example"];
    expect(isAllowedSocketOrigin("https://cronium.example", allowed)).toBe(
      true,
    );
    expect(
      isAllowedSocketOrigin("https://cronium.example.evil.test", allowed),
    ).toBe(false);
    expect(isAllowedSocketOrigin(undefined, allowed)).toBe(false);
  });
});

describe("internal broadcast authentication", () => {
  const key = "a-secure-internal-broadcast-key";

  it("accepts only the exact bearer key", () => {
    expect(verifyInternalBroadcastAuthorization(`Bearer ${key}`, key)).toBe(
      true,
    );
    expect(verifyInternalBroadcastAuthorization("Bearer wrong", key)).toBe(
      false,
    );
    expect(verifyInternalBroadcastAuthorization(`Basic ${key}`, key)).toBe(
      false,
    );
    expect(verifyInternalBroadcastAuthorization(undefined, key)).toBe(false);
    expect(
      verifyInternalBroadcastAuthorization(`Bearer ${key}`, undefined),
    ).toBe(false);
  });
});
