/**
 * ME-03 regression: single-use MCP OAuth credentials must be consumed
 * atomically so a replay cannot use the same code/refresh token twice.
 */
// Self-contained mock: the factory owns its store (jest.mock is hoisted above
// module-scope consts, so it cannot close over them). GETDEL is emulated so the
// consume path exercises the real atomic single-use semantics.
jest.mock("@/lib/cache/cache-service", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    cacheService: {
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, JSON.stringify(value));
        return true;
      }),
      get: jest.fn(async (key: string) => {
        const v = store.get(key);
        return v === undefined ? null : (JSON.parse(v) as unknown);
      }),
      delete: jest.fn(async (key: string) => store.delete(key)),
      getdel: jest.fn(async (key: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        store.delete(key);
        return JSON.parse(v) as unknown;
      }),
    },
  };
});

import {
  allowRefresh,
  consumeRefresh,
  putAuthCode,
  takeAuthCode,
} from "@/lib/mcp-oauth/store";

const mocked = jest.requireMock("@/lib/cache/cache-service") as {
  __store: Map<string, string>;
  cacheService: { getdel: jest.Mock };
};

beforeEach(() => {
  mocked.__store.clear();
  mocked.cacheService.getdel.mockClear();
});

describe("takeAuthCode (single use via GETDEL)", () => {
  it("returns the code data on first use and null on replay", async () => {
    await putAuthCode("code-1", {
      sub: "u1",
      cid: "c1",
      redirectUri: "https://app/cb",
      codeChallenge: "chal",
      scope: "mcp",
      resource: "r",
    });

    const first = await takeAuthCode("code-1");
    expect(first?.sub).toBe("u1");
    expect(mocked.cacheService.getdel).toHaveBeenCalledTimes(1);

    const replay = await takeAuthCode("code-1");
    expect(replay).toBeNull();
  });

  it("only one of two concurrent consumers wins", async () => {
    await putAuthCode("code-2", {
      sub: "u2",
      cid: "c2",
      redirectUri: "https://app/cb",
      codeChallenge: "chal",
      scope: "mcp",
      resource: "r",
    });

    const [a, b] = await Promise.all([
      takeAuthCode("code-2"),
      takeAuthCode("code-2"),
    ]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });
});

describe("consumeRefresh (single use via GETDEL)", () => {
  it("rotates once, rejects a replayed jti", async () => {
    await allowRefresh("jti-1", {
      sub: "u1",
      cid: "c1",
      scope: "mcp",
      aud: "a",
    });
    expect(await consumeRefresh("jti-1")).not.toBeNull();
    expect(await consumeRefresh("jti-1")).toBeNull();
  });
});
