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

import { DrizzleQueryError } from "drizzle-orm/errors";
import type { NextRequest } from "next/server";
import { format } from "node:util";
import { getAuthorizedPrincipal } from "@/server/security/authorization";
import {
  AccountCheckFailedError,
  CREDENTIAL_CHECK_FAILED_MESSAGE,
  CredentialCheckFailedError,
} from "@/server/security/credential-check";
import { storage } from "@/server/storage";
import {
  getBearerToken,
  authenticateApiToken,
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "../api-auth";
import { TokenStatus } from "@/shared/schema";

const mockGet = storage.getApiTokenByToken as jest.Mock;
const mockUpdate = storage.updateApiToken as jest.Mock;
const mockPrincipal = getAuthorizedPrincipal as jest.Mock;

const databaseDown = () =>
  new DrizzleQueryError(
    "select from api_tokens",
    ["a-hash-of-the-token"],
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  );

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(() => consoleError.mockRestore());

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

  describe("when the lookup fails", () => {
    it("throws, because null would say the token is bad", async () => {
      mockGet.mockRejectedValue(databaseDown());

      await expect(authenticateApiToken("tok")).rejects.toBeInstanceOf(
        CredentialCheckFailedError,
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("logs why, without the query's values", async () => {
      mockGet.mockRejectedValue(databaseDown());

      await authenticateApiToken("tok").catch(() => undefined);

      const logged = consoleError.mock.calls
        .map((args) => format(...(args as unknown[])))
        .join("\n");
      expect(logged).toContain("Error validating API token");
      expect(logged).toContain("ECONNREFUSED");
      expect(logged).not.toContain("a-hash-of-the-token");
    });
  });

  it("accepts a good token when recording its use fails", async () => {
    mockGet.mockResolvedValue({
      id: 7,
      userId: "user-1",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes: ["mcp"],
    });
    mockUpdate.mockRejectedValueOnce(databaseDown());

    await expect(authenticateApiToken("tok")).resolves.toEqual({
      userId: "user-1",
      tokenId: 7,
      scopes: ["mcp"],
    });
    expect(format(...(consoleError.mock.calls[0] as unknown[]))).toContain(
      "Error recording API token use",
    );
  });

  it("still rejects a bad token when it can't write", async () => {
    mockGet.mockResolvedValue(undefined);
    mockUpdate.mockRejectedValueOnce(databaseDown());

    expect(await authenticateApiToken("nope")).toBeNull();
  });
});

describe("authenticateRestPrincipal when credentials can't be checked", () => {
  const goodToken = {
    id: 1,
    userId: "u",
    status: TokenStatus.ACTIVE,
    expiresAt: null,
    scopes: ["full"],
  };

  it("is a 503 when the token's lookup fails, without trying the cookie", async () => {
    mockGet.mockRejectedValue(databaseDown());

    await expect(
      authenticateRestPrincipal(bearerRequest("t"), "view", "events.getAll"),
    ).resolves.toEqual({ ok: false, status: 503 });
  });

  it("is a 503 when the live check on its account fails", async () => {
    mockGet.mockResolvedValue(goodToken);
    mockPrincipal.mockRejectedValueOnce(new AccountCheckFailedError());

    await expect(
      authenticateRestPrincipal(bearerRequest("t"), "view", "events.getAll"),
    ).resolves.toEqual({ ok: false, status: 503 });
  });

  it("is still a 401 when the live check finds the account revoked", async () => {
    mockGet.mockResolvedValue(goodToken);
    mockPrincipal.mockRejectedValueOnce(new Error("Account is not active"));

    await expect(
      authenticateRestPrincipal(bearerRequest("t"), "view", "events.getAll"),
    ).resolves.toEqual({ ok: false, status: 401 });
  });
});

describe("restPrincipalErrorResponse", () => {
  it.each([
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [503, CREDENTIAL_CHECK_FAILED_MESSAGE],
  ] as const)("answers %i with its own words", async (status, error) => {
    const response = restPrincipalErrorResponse({ ok: false, status });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
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
    // events.fork is NOT in the mcp scope set.
    const res = await authenticateRestPrincipal(
      bearerRequest("t"),
      "edit",
      "events.fork",
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

  describe("a route that declares no scope path", () => {
    // /api/admin/*, /api/logs*, ... call authenticateRestPrincipal without a
    // path. That used to skip scope enforcement entirely.
    const token = (scopes: string[] | null) => ({
      id: 1,
      userId: "user-1",
      status: TokenStatus.ACTIVE,
      expiresAt: null,
      scopes,
    });

    it.each([
      ["mcp-scoped", ["mcp"]],
      ["unknown-scoped", ["nonsense"]],
      ["empty-scoped", []],
      ["legacy unscoped", null],
    ])("denies a %s token", async (_label, scopes) => {
      mockGet.mockResolvedValue(token(scopes));
      await expect(
        authenticateRestPrincipal(bearerRequest("t"), "view"),
      ).resolves.toEqual({ ok: false, status: 403 });
    });

    it("allows a full token", async () => {
      mockGet.mockResolvedValue(token(["full"]));
      await expect(
        authenticateRestPrincipal(bearerRequest("t"), "view"),
      ).resolves.toMatchObject({ ok: true, scopes: ["full"] });
    });
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
