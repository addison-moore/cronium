/**
 * @jest-environment node
 *
 * MCP OAuth: what a grant can be for, and when it stops working.
 */
process.env.AUTH_SECRET = "test-auth-secret-for-mcp-oauth";

const store = new Map<string, unknown>();
const clients = new Map<string, unknown>();

jest.mock("@/lib/mcp-oauth/store", () => ({
  getClient: jest.fn((id: string) => Promise.resolve(clients.get(id) ?? null)),
  putAuthCode: jest.fn((code: string, data: unknown) => {
    store.set(`code:${code}`, data);
    return Promise.resolve();
  }),
  takeAuthCode: jest.fn((code: string) => {
    const data = store.get(`code:${code}`) ?? null;
    store.delete(`code:${code}`);
    return Promise.resolve(data);
  }),
  allowRefresh: jest.fn((jti: string, data: unknown) => {
    store.set(`rt:${jti}`, data);
    return Promise.resolve();
  }),
  consumeRefresh: jest.fn((jti: string) => {
    const data = store.get(`rt:${jti}`) ?? null;
    store.delete(`rt:${jti}`);
    return Promise.resolve(data);
  }),
}));
jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn(),
}));
jest.mock("@/lib/api-auth", () => ({
  getBearerToken: (headers: Headers) =>
    headers.get("authorization")?.replace("Bearer ", "") ?? null,
  authenticateApiToken: jest.fn(),
}));
jest.mock("@/server/security/authorization", () => ({
  getAuthorizedPrincipal: jest.fn(),
}));
jest.mock("@/server/storage", () => ({ storage: { getUser: jest.fn() } }));

import { createHash } from "node:crypto";
import { GET as authorize } from "../authorize/route";
import { POST as token } from "../token/route";
import { sessionFromOAuthToken } from "@/lib/mcp-oauth/resource";
import { getCachedServerSession } from "@/lib/auth-cache";
import { authenticateApiToken } from "@/lib/api-auth";
import { getAuthorizedPrincipal } from "@/server/security/authorization";
import { storage } from "@/server/storage";
import { mintAccessToken } from "@/lib/mcp-oauth/tokens";
import {
  AccountCheckFailedError,
  CREDENTIAL_CHECK_FAILED_MESSAGE,
  CredentialCheckFailedError,
} from "@/server/security/credential-check";

const CLIENT = "mcp_client";
const REDIRECT = "https://client.example/callback";
const VERIFIER = "a-long-enough-pkce-verifier-for-this-test";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const sessionMock = getCachedServerSession as jest.Mock;
const apiTokenMock = authenticateApiToken as jest.Mock;
const principalMock = getAuthorizedPrincipal as jest.Mock;
const getUserMock = storage.getUser as jest.Mock;

function authorizeUrl(params: Record<string, string> = {}) {
  const url = new URL("https://cronium.example.com/api/mcp/oauth/authorize");
  const all: Record<string, string> = {
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...params,
  };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  return url.toString();
}

const get = (url: string, headers: Record<string, string> = {}) =>
  authorize(new Request(url, { headers }));

/** Run the browser half: render consent, follow Approve, return the auth code. */
async function approve(params: Record<string, string> = {}) {
  const page = await get(authorizeUrl(params));
  expect(page.status).toBe(200);
  const html = await page.text();
  const href = /href="([^"]*consent=(?!deny)[^"]*)"/.exec(html)![1]!;
  const res = await get(href.replace(/&amp;/g, "&"));
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!).searchParams.get("code")!;
}

function exchange(fields: Record<string, string>) {
  return token(
    new Request("https://cronium.example.com/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

const exchangeCode = (code: string) =>
  exchange({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
  });

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  clients.clear();
  clients.set(CLIENT, { client_id: CLIENT, redirect_uris: [REDIRECT] });
  sessionMock.mockResolvedValue({
    user: { id: "user-1", sessionVersion: 3 },
  });
  apiTokenMock.mockResolvedValue(null);
  principalMock.mockResolvedValue({ id: "user-1", sessionVersion: 3 });
  getUserMock.mockResolvedValue({
    id: "user-1",
    status: "ACTIVE",
    sessionVersion: 3,
    role: "USER",
    email: "user@example.com",
  });
});

describe("scope", () => {
  it.each(["full", "mcp full", "admin"])(
    "refuses to grant %s, which this server does not offer",
    async (scope) => {
      const res = await get(authorizeUrl({ scope }));
      expect(res.status).toBe(302);
      const redirected = new URL(res.headers.get("location")!);
      expect(redirected.origin + redirected.pathname).toBe(REDIRECT);
      expect(redirected.searchParams.get("error")).toBe("invalid_scope");
    },
  );

  it("grants mcp", async () => {
    const code = await approve({ scope: "mcp" });
    const res = await exchangeCode(code);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scope: string }).scope).toBe("mcp");
  });

  it("will not let a consent ticket be replayed for a different scope", async () => {
    clients.set(CLIENT, { client_id: CLIENT, redirect_uris: [REDIRECT] });
    const page = await get(authorizeUrl({ scope: "mcp" }));
    const html = await page.text();
    const href = /href="([^"]*consent=(?!deny)[^"]*)"/
      .exec(html)![1]!
      .replace(/&amp;/g, "&");

    const tampered = new URL(href);
    tampered.searchParams.set("scope", "");
    const res = await get(tampered.toString());

    expect(new URL(res.headers.get("location")!).searchParams.has("code")).toBe(
      false,
    );
  });

  it("does not honor a broader scope on a token minted before this was enforced", async () => {
    const { token: access } = mintAccessToken({
      sub: "user-1",
      cid: CLIENT,
      scope: "full",
      aud: "x",
      sv: 3,
    });
    const auth = await sessionFromOAuthToken(
      new Headers({ authorization: `Bearer ${access}` }),
    );
    expect(auth?.scopes).toEqual([]);
  });
});

describe("resource owner", () => {
  it("sends a revoked session to sign-in instead of showing consent", async () => {
    principalMock.mockRejectedValue(new Error("Session is no longer valid"));
    const res = await get(authorizeUrl());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/api/auth/signin");
  });

  it.each([
    ["deny-all", []],
    ["unknown-scope", ["nonsense"]],
  ])("does not let a %s API token approve a grant", async (_label, scopes) => {
    sessionMock.mockResolvedValue(null);
    apiTokenMock.mockResolvedValue({ userId: "user-1", tokenId: 1, scopes });
    const res = await get(authorizeUrl(), { authorization: "Bearer t" });
    expect(res.headers.get("location")).toContain("/api/auth/signin");
  });

  it.each([["mcp"], ["full"]])("lets a %s API token approve", async (scope) => {
    sessionMock.mockResolvedValue(null);
    apiTokenMock.mockResolvedValue({
      userId: "user-1",
      tokenId: 1,
      scopes: [scope],
    });
    const res = await get(authorizeUrl(), { authorization: "Bearer t" });
    expect(res.status).toBe(200);
  });
});

describe("credentials that couldn't be checked", () => {
  const accessToken = () =>
    mintAccessToken({
      sub: "user-1",
      cid: CLIENT,
      scope: "mcp",
      aud: "https://cronium.example.com/api/mcp",
      sv: 3,
    }).token;

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("throws from the access token's check, rather than say it's bad", async () => {
    getUserMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      sessionFromOAuthToken(
        new Headers({ authorization: `Bearer ${accessToken()}` }),
      ),
    ).rejects.toBeInstanceOf(CredentialCheckFailedError);
  });

  it.each<[string, () => void]>([
    [
      "a session whose account can't be read",
      () => principalMock.mockRejectedValue(new AccountCheckFailedError()),
    ],
    [
      "an API token that can't be looked up",
      () => {
        sessionMock.mockResolvedValue(null);
        apiTokenMock.mockRejectedValue(new CredentialCheckFailedError());
      },
    ],
    [
      "an API token whose account can't be read",
      () => {
        sessionMock.mockResolvedValue(null);
        apiTokenMock.mockResolvedValue({
          userId: "user-1",
          tokenId: 1,
          scopes: ["mcp"],
        });
        principalMock.mockRejectedValue(new AccountCheckFailedError());
      },
    ],
  ])(
    "answers 503 for %s, not a sign-in that can't work",
    async (_name, arrange) => {
      arrange();

      const res = await get(authorizeUrl(), { authorization: "Bearer t" });

      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toContain(
        CREDENTIAL_CHECK_FAILED_MESSAGE.replaceAll("'", "&#39;"),
      );
    },
  );
});

describe("revocation", () => {
  async function grant() {
    const res = await exchangeCode(await approve());
    return (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };
  }
  const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` });

  it("access token works until the user's session version moves", async () => {
    const { access_token } = await grant();
    await expect(
      sessionFromOAuthToken(bearer(access_token)),
    ).resolves.toMatchObject({ scopes: ["mcp"] });

    getUserMock.mockResolvedValue({
      id: "user-1",
      status: "ACTIVE",
      sessionVersion: 4,
    });
    await expect(
      sessionFromOAuthToken(bearer(access_token)),
    ).resolves.toBeNull();
  });

  it("refresh token rotates normally, and stops after revocation", async () => {
    const { refresh_token } = await grant();

    const rotated = await exchange({
      grant_type: "refresh_token",
      refresh_token,
    });
    expect(rotated.status).toBe(200);
    const next = (await rotated.json()) as { refresh_token: string };

    getUserMock.mockResolvedValue({
      id: "user-1",
      status: "ACTIVE",
      sessionVersion: 4,
    });
    const refused = await exchange({
      grant_type: "refresh_token",
      refresh_token: next.refresh_token,
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
  });

  it("refresh token stops when the user is disabled", async () => {
    const { refresh_token } = await grant();
    getUserMock.mockResolvedValue({
      id: "user-1",
      status: "DISABLED",
      sessionVersion: 3,
    });
    const refused = await exchange({
      grant_type: "refresh_token",
      refresh_token,
    });
    expect(refused.status).toBe(400);
  });

  it("an authorization code cannot be exchanged after revocation", async () => {
    const code = await approve();
    getUserMock.mockResolvedValue({
      id: "user-1",
      status: "ACTIVE",
      sessionVersion: 4,
    });
    const res = await exchangeCode(code);
    expect(res.status).toBe(400);
  });
});
