/**
 * @jest-environment node
 */
jest.mock("@/server/storage", () => ({
  storage: {
    getApiTokenByToken: jest.fn(),
    updateApiToken: jest.fn().mockResolvedValue(undefined),
  },
}));

// authenticateRestPrincipal dynamically imports the authorization module; mock
// it so the live-principal check resolves to a known role without a database.
jest.mock("@/server/security/authorization", () => ({
  getAuthorizedPrincipal: jest.fn(async (userId: string) => ({
    id: userId,
    role: "USER",
    roleId: 2,
    status: "ACTIVE",
    sessionVersion: 1,
  })),
  roleAllowsCapability: () => true,
}));

import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import {
  getBearerToken,
  authenticateApiToken,
  authenticateRestPrincipal,
} from "../api-auth";
import { TokenStatus } from "@/shared/schema";

const mockGet = storage.getApiTokenByToken as jest.Mock;
const mockUpdate = storage.updateApiToken as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function bearerRequest(token: string): NextRequest {
  return {
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  } as unknown as NextRequest;
}

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

describe("authenticateRestPrincipal — bearer token scope enforcement (HI-25)", () => {
  it("allows an mcp-scoped token on a path its scope permits", async () => {
    mockGet.mockResolvedValue({
      id: 1,
      userId: "u",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: ["mcp"],
    });
    const res = await authenticateRestPrincipal(
      bearerRequest("t"),
      "view",
      "events.getAll",
    );
    expect(res.ok).toBe(true);
  });

  it("denies an mcp-scoped token on a path outside its scope (REST cannot bypass scope)", async () => {
    mockGet.mockResolvedValue({
      id: 1,
      userId: "u",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: ["mcp"],
    });
    // events.update is NOT in the mcp scope set.
    const res = await authenticateRestPrincipal(
      bearerRequest("t"),
      "edit",
      "events.update",
    );
    expect(res).toEqual({ ok: false, status: 403 });
  });

  it("denies a legacy null-scope (deny-all) token everywhere", async () => {
    mockGet.mockResolvedValue({
      id: 1,
      userId: "u",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: null,
    });
    const res = await authenticateRestPrincipal(
      bearerRequest("t"),
      "view",
      "events.getAll",
    );
    expect(res).toEqual({ ok: false, status: 403 });
  });

  it("allows a full-scope token on any path", async () => {
    mockGet.mockResolvedValue({
      id: 1,
      userId: "u",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: ["full"],
    });
    const res = await authenticateRestPrincipal(
      bearerRequest("t"),
      "edit",
      "servers.delete",
    );
    expect(res.ok).toBe(true);
  });
});
