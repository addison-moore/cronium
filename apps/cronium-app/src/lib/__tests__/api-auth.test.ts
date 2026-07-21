/**
 * @jest-environment node
 */
jest.mock("@/server/storage", () => ({
  storage: {
    getApiTokenByToken: jest.fn(),
    updateApiToken: jest.fn().mockResolvedValue(undefined),
  },
}));

import { storage } from "@/server/storage";
import { getBearerToken, authenticateApiToken } from "../api-auth";
import { TokenStatus } from "@/shared/schema";

const mockGet = storage.getApiTokenByToken as jest.Mock;
const mockUpdate = storage.updateApiToken as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("getBearerToken", () => {
  it("extracts a bearer token", () => {
    expect(
      getBearerToken(new Headers({ Authorization: "Bearer abc123" })),
    ).toBe("abc123");
  });
  it("is case-insensitive on the header name", () => {
    expect(getBearerToken(new Headers({ authorization: "Bearer xyz" }))).toBe(
      "xyz",
    );
  });
  it("returns null for missing / non-bearer / empty", () => {
    expect(getBearerToken(new Headers())).toBeNull();
    expect(
      getBearerToken(new Headers({ Authorization: "Basic abc" })),
    ).toBeNull();
    expect(
      getBearerToken(new Headers({ Authorization: "Bearer " })),
    ).toBeNull();
  });
});

describe("authenticateApiToken", () => {
  it("accepts an active, unexpired token; a null-scope token is deny-all", async () => {
    mockGet.mockResolvedValue({
      id: 7,
      userId: "user-1",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: null,
    });
    const res = await authenticateApiToken("tok");
    // A stored null scope is coerced to an explicit empty (deny-all) set so a
    // legacy unscoped token fails closed rather than acting with full rights.
    expect(res).toEqual({ userId: "user-1", tokenId: 7, scopes: [] });
    expect(mockUpdate).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ lastUsed: expect.any(Date) }),
    );
  });

  it("preserves explicit scopes", async () => {
    mockGet.mockResolvedValue({
      id: 8,
      userId: "user-2",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: ["mcp"],
    });
    const res = await authenticateApiToken("tok2");
    expect(res).toEqual({ userId: "user-2", tokenId: 8, scopes: ["mcp"] });
  });

  it("rejects an unknown token", async () => {
    mockGet.mockResolvedValue(undefined);
    expect(await authenticateApiToken("nope")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a revoked token", async () => {
    mockGet.mockResolvedValue({
      id: 1,
      userId: "u",
      status: TokenStatus.REVOKED,
      expiresAt: null,
    });
    expect(await authenticateApiToken("tok")).toBeNull();
  });

  it("rejects an expired token", async () => {
    mockGet.mockResolvedValue({
      id: 2,
      userId: "u",
      status: TokenStatus.ACTIVE,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await authenticateApiToken("tok")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns null (not throw) when the lookup errors", async () => {
    mockGet.mockRejectedValue(new Error("db down"));
    expect(await authenticateApiToken("tok")).toBeNull();
  });
});
