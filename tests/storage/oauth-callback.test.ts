/**
 * Connecting a tool through OAuth, the whole way round: the authorize route, the
 * provider's redirect back, the token exchange, what gets stored, and what then reads
 * it. Real Postgres, because the claim on the state, the ON CONFLICT on the tokens and
 * their encryption are what a test has to reach, and they never ran for real:
 * every redirect used to stop at the callback's schema.
 *
 * Only the provider is a stub, and only at `fetch`, so the real exchangeCodeForTokens
 * builds the request Google would receive and these tests can check it.
 */
// Only the session is faked. The real NextAuth stack needs a request scope this suite
// does not have.
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { POST as authorize } from "@/app/api/oauth/authorize/route";
import { GET as oauthCallback } from "@/app/api/oauth/callback/route";
import { cacheService } from "@/lib/cache/cache-service";
import { injectOAuthToken } from "@/lib/oauth/credential-bridge";
import { createProviderFromEnv } from "@/lib/oauth/providers";
import { TokenManager } from "@/lib/oauth/TokenManager";
import { runRetention } from "@/lib/scheduling/retention";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { oauthStates, oauthTokens, toolCredentials } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Where a person reaches Cronium, behind a proxy. Next never tells the route this. */
const BROWSER_ORIGIN = "https://cronium.example.test";
/**
 * What request.url starts with in the Docker image, whatever Host and X-Forwarded-Host
 * say, because the standalone server builds it from the address it listens on.
 */
const LISTEN_ORIGIN = "http://0.0.0.0:3000";

const FRESH_TOKENS = {
  access_token: "the-access-token",
  refresh_token: "the-refresh-token",
  expires_in: 3599,
  token_type: "Bearer",
  scope: SHEETS_SCOPE,
};

let owner: string;
let toolId: number;
let requests: Array<{ url: string; form: URLSearchParams }>;
let answer: (url: string) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Calls to the token endpoint, which is what "the exchange ran" means here. */
const exchanges = () => requests.filter(({ url }) => url === TOKEN_URL);

interface Started {
  state: string;
  challenge: string;
  nonce: string;
  redirectUri: string;
}

/** Presses Connect: the real route, with its real cookie and its real state row. */
async function startFlow(providerId = "google"): Promise<Started> {
  const response = await authorize(
    new NextRequest(`${LISTEN_ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId, providerId, scope: SHEETS_SCOPE }),
    }),
  );
  expect(response.status).toBe(200);
  const { authUrl } = (await response.json()) as { authUrl: string };
  const query = new URL(authUrl).searchParams;
  expect(query.get("code_challenge_method")).toBe("S256");
  return {
    state: query.get("state")!,
    challenge: query.get("code_challenge")!,
    redirectUri: query.get("redirect_uri")!,
    nonce: response.cookies.get("cronium-oauth-nonce")!.value,
  };
}

/** The provider sends the browser back, carrying the browser's cookie if it has one. */
async function callback(
  query: Record<string, string>,
  { nonce }: { nonce?: string } = {},
) {
  const url = new URL("/api/oauth/callback", LISTEN_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const response = await oauthCallback(
    new NextRequest(url, {
      headers: nonce ? { cookie: `cronium-oauth-nonce=${nonce}` } : {},
    }),
  );
  expect(response.status).toBe(307);
  const location = response.headers.get("location")!;
  // Resolved as a browser would: against the address it asked, not the listen address.
  const landed = new URL(location, BROWSER_ORIGIN);
  return { response, location, landed, params: landed.searchParams };
}

async function connect() {
  const started = await startFlow();
  const result = await callback(
    { code: "the-code", state: started.state, scope: SHEETS_SCOPE },
    { nonce: started.nonce },
  );
  return { started, ...result };
}

const tokenRows = () =>
  db.select().from(oauthTokens).where(eq(oauthTokens.toolId, toolId));
const stateRows = () => db.select().from(oauthStates);

function manager() {
  return new TokenManager(createProviderFromEnv("google")!);
}

const OAUTH_ENV = {
  OAUTH_GOOGLE_CLIENT_ID: "the-client-id",
  OAUTH_GOOGLE_CLIENT_SECRET: "the-client-secret",
  OAUTH_MICROSOFT_CLIENT_ID: "the-client-id",
  OAUTH_MICROSOFT_CLIENT_SECRET: "the-client-secret",
  OAUTH_SLACK_CLIENT_ID: "the-client-id",
  OAUTH_SLACK_CLIENT_SECRET: "the-client-secret",
};

beforeAll(() => {
  Object.assign(process.env, OAUTH_ENV);
});

afterAll(async () => {
  for (const name of Object.keys(OAUTH_ENV)) {
    delete process.env[name];
  }
  await closePool();
  await cacheService.disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  owner = await seedUser();
  const user = await storage.getUser(owner);
  jest.mocked(getServerSession).mockResolvedValue({
    user: { id: owner, sessionVersion: user!.sessionVersion },
  });
  const [tool] = await db
    .insert(toolCredentials)
    .values({
      userId: owner,
      name: "sheets",
      type: "GOOGLE-SHEETS",
      credentials: JSON.stringify({ scope: SHEETS_SCOPE }),
    })
    .returning({ id: toolCredentials.id });
  toolId = tool!.id;

  requests = [];
  answer = () => json(FRESH_TOKENS);
  jest.spyOn(global, "fetch").mockImplementation((input, init) => {
    const url = String(input as string);
    requests.push({ url, form: new URLSearchParams(String(init?.body)) });
    return Promise.resolve(answer(url));
  });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a normal redirect", () => {
  it("exchanges the code and stores the tokens", async () => {
    const { params, landed } = await connect();

    expect(params.get("error")).toBeNull();
    expect(params.get("oauth")).toBe("success");
    expect(landed.pathname).toBe("/dashboard/tools");
    expect(exchanges()).toHaveLength(1);

    const [row, ...others] = await tokenRows();
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      userId: owner,
      toolId,
      providerId: "google",
      tokenType: "Bearer",
      scope: SHEETS_SCOPE,
    });
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
    expect(row!.expiresAt!.getTime()).toBeLessThan(Date.now() + 3_700_000);
  });

  it("sends the provider what it needs, including the PKCE verifier", async () => {
    const { started } = await connect();

    const { form } = exchanges()[0]!;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_id")).toBe("the-client-id");
    expect(form.get("client_secret")).toBe("the-client-secret");
    // Google refuses an exchange whose redirect_uri differs from the authorization's.
    expect(form.get("redirect_uri")).toBe(started.redirectUri);
    expect(
      createHash("sha256")
        .update(form.get("code_verifier")!)
        .digest("base64url"),
    ).toBe(started.challenge);
  });

  it("stores the tokens encrypted, and reads them back for a tool's action", async () => {
    await connect();

    const [row] = await tokenRows();
    expect(row!.accessToken).not.toContain("the-access-token");
    expect(row!.refreshToken).not.toContain("the-refresh-token");

    await expect(manager().hasValidTokens(owner, toolId)).resolves.toBe(true);
    await expect(
      injectOAuthToken(
        { scope: SHEETS_SCOPE },
        { userId: owner, toolId, toolType: "GOOGLE-SHEETS" },
      ),
    ).resolves.toEqual({
      scope: SHEETS_SCOPE,
      oauthToken: "the-access-token",
    });
  });

  it("uses up the state, so the same redirect can't run twice", async () => {
    const { started } = await connect();
    expect(await stateRows()).toEqual([]);

    const replay = await callback(
      { code: "the-code", state: started.state },
      { nonce: started.nonce },
    );

    expect(replay.params.get("error")).toBe("invalid_state");
    expect(exchanges()).toHaveLength(1);
  });

  it("clears the nonce cookie at the path it was set on", async () => {
    const { response } = await connect();

    // A cookie is deleted only by naming its path, so Path=/ would leave this one.
    const cleared = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("cronium-oauth-nonce="));
    expect(cleared).toMatch(/^cronium-oauth-nonce=;/);
    expect(cleared).toMatch(/Path=\/api\/oauth(;|$)/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("replaces the tokens when the account is connected again", async () => {
    await connect();
    answer = () =>
      json({ ...FRESH_TOKENS, access_token: "the-second-access-token" });

    const { params } = await connect();

    expect(params.get("oauth")).toBe("success");
    expect(await tokenRows()).toHaveLength(1);
    await expect(manager().getValidAccessToken(owner, toolId)).resolves.toBe(
      "the-second-access-token",
    );
  });
});

describe("the other providers", () => {
  it("connects Microsoft, whose answer is the standard one", async () => {
    const { state, nonce, redirectUri } = await startFlow("microsoft");

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("oauth")).toBe("success");
    const { url, form } = requests.at(-1)!;
    expect(url).toContain("login.microsoftonline.com");
    expect(form.get("redirect_uri")).toBe(redirectUri);
    const [row] = await tokenRows();
    expect(row!.providerId).toBe("microsoft");
  });

  it("connects Slack, which answers in its own shape", async () => {
    const { state, nonce } = await startFlow("slack");
    answer = () =>
      json({
        ok: true,
        access_token: "the-slack-token",
        token_type: "bot",
        scope: "chat:write",
      });

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("oauth")).toBe("success");
    expect(requests.at(-1)!.url).toContain("slack.com");
    const [row] = await tokenRows();
    expect(row).toMatchObject({ providerId: "slack", scope: "chat:write" });
  });

  it("says why when Slack refuses, which it does with a 200", async () => {
    const { state, nonce } = await startFlow("slack");
    answer = () => json({ ok: false, error: "invalid_code" });

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "Failed to exchange code: Slack OAuth error: invalid_code",
    );
    expect(await tokenRows()).toEqual([]);
  });
});

describe("the nonce cookie", () => {
  async function nonceCookieFor(env: Record<string, string>) {
    jest.replaceProperty(process, "env", { ...process.env, ...env });
    const response = await authorize(
      new NextRequest(`${LISTEN_ORIGIN}/api/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId, providerId: "google" }),
      }),
    );
    return response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("cronium-oauth-nonce="))!;
  }

  it("is Secure when people reach the app over https", async () => {
    const cookie = await nonceCookieFor({
      AUTH_URL: BROWSER_ORIGIN,
      NODE_ENV: "production",
    });

    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=lax/i);
    expect(cookie).toMatch(/; Path=\/api\/oauth/);
  });

  it("isn't Secure on the quick start's http://localhost, where Safari would drop it", async () => {
    const cookie = await nonceCookieFor({
      AUTH_URL: "http://localhost:3000",
      NODE_ENV: "production",
    });

    expect(cookie).not.toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
  });
});

describe("where the browser ends up", () => {
  async function outcome(
    run: () => Promise<{ location: string; landed: URL }>,
  ) {
    const { location, landed } = await run();
    expect(location).not.toContain("0.0.0.0");
    expect(landed.origin).toBe(BROWSER_ORIGIN);
    expect(landed.pathname).toBe("/dashboard/tools");
  }

  it("stays on the address it's at when the flow works", async () => {
    await outcome(connect);
  });

  it("stays there when the provider refused", async () => {
    await outcome(async () => {
      const { state, nonce } = await startFlow();
      return callback({ error: "access_denied", state }, { nonce });
    });
  });

  it("stays there when the exchange fails", async () => {
    answer = () => json({ error: "invalid_grant" }, 400);
    await outcome(connect);
  });

  it("stays there for a state nobody issued", async () => {
    await outcome(() => callback({ code: "the-code", state: "nobody-issued" }));
  });

  it("stays there when the redirect can't be read at all", async () => {
    await outcome(() => callback({ code: "the-code" }));
  });
});

describe("which tool the page opens on", () => {
  it("is the one being connected, when that works", async () => {
    const { params } = await connect();

    expect(params.get("tool")).toBe("GOOGLE-SHEETS");
  });

  it("is the one being connected, when the provider refused", async () => {
    const { state, nonce } = await startFlow();

    const { params } = await callback(
      { error: "access_denied", state },
      { nonce },
    );

    expect(params.get("tool")).toBe("GOOGLE-SHEETS");
  });

  it("is the one being connected, when OAuth isn't set up for it", async () => {
    const { state, nonce } = await startFlow();
    jest.replaceProperty(process, "env", {
      ...process.env,
      OAUTH_GOOGLE_CLIENT_ID: "",
    });

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("error")).toBe("oauth_not_configured");
    expect(params.get("tool")).toBe("GOOGLE-SHEETS");
  });

  it("isn't given for a state nobody issued, which names no tool", async () => {
    const { params } = await callback({
      code: "the-code",
      state: "nobody-issued",
    });

    expect(params.get("tool")).toBeNull();
  });
});

describe("the provider's own error redirect", () => {
  it("says the provider refused, without a code to exchange", async () => {
    const { state, nonce } = await startFlow();

    const { params } = await callback(
      { error: "access_denied", state },
      { nonce },
    );

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "Google didn't grant access: access_denied",
    );
    expect(exchanges()).toEqual([]);
    expect(await tokenRows()).toEqual([]);
  });

  it("passes on the provider's description", async () => {
    const { state, nonce } = await startFlow();

    const { params } = await callback(
      {
        error: "access_denied",
        error_description: "The user cancelled at the consent screen",
        state,
      },
      { nonce },
    );

    expect(params.get("details")).toBe(
      "Google didn't grant access: The user cancelled at the consent screen (access_denied)",
    );
  });

  it("ends the attempt, so its state can't be used afterwards", async () => {
    const { state, nonce } = await startFlow();

    await callback({ error: "access_denied", state }, { nonce });

    expect(await stateRows()).toEqual([]);
  });

  it("isn't believed from a browser that didn't start the flow", async () => {
    const { state } = await startFlow();

    const { params } = await callback(
      {
        error: "access_denied",
        error_description: "Call this number to fix your account",
        state,
      },
      { nonce: "another-browser" },
    );

    expect(params.get("details")).toBe(
      "OAuth session could not be verified for this browser",
    );
  });

  it("keeps a very long description out of the Location header", async () => {
    const { state, nonce } = await startFlow();

    const { params, location } = await callback(
      {
        error: "server_error",
        // Emoji, so a cut through the middle of one would make encoding throw.
        error_description: "\u{1F525}".repeat(20_000),
        state,
      },
      { nonce },
    );

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toContain("Google didn't grant access:");
    // With the 900 bytes of other headers, this has to stay under nginx's 4 KB.
    expect(location.length).toBeLessThan(3_000);
  });
});

describe("a redirect that doesn't make sense", () => {
  it("refuses one with neither a code nor an error", async () => {
    const { state, nonce } = await startFlow();

    const { params } = await callback({ state }, { nonce });

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "Google's answer had no authorization code",
    );
    expect(exchanges()).toEqual([]);
  });

  it("refuses one with no state", async () => {
    const { params } = await callback({ code: "the-code" });

    expect(params.get("error")).toBe("oauth_callback_failed");
    expect(exchanges()).toEqual([]);
  });

  it("refuses one with a state nobody issued", async () => {
    const { params } = await callback({
      code: "the-code",
      state: "nobody-issued",
    });

    expect(params.get("error")).toBe("invalid_state");
  });

  it("keeps a state Postgres can't read out of the URL", async () => {
    // Postgres refuses a NUL byte, so this is a failed query holding the value.
    const { params, location } = await callback({
      code: "the-code",
      state: "before\0after",
    });

    expect(params.get("error")).toBe("oauth_callback_failed");
    expect(decodeURIComponent(location)).not.toContain("before");
    expect(decodeURIComponent(location)).not.toContain("Failed query");
  });

  it("refuses an attempt that has expired", async () => {
    const { state, nonce } = await startFlow();
    await db
      .update(oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(oauthStates.state, state));

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "This connection attempt has expired or was already used",
    );
    expect(exchanges()).toEqual([]);
  });

  it.each([
    ["no cookie", undefined],
    ["another browser's cookie", "another-browser"],
  ])("refuses a browser with %s", async (_name, nonce) => {
    const { state } = await startFlow();

    const { params } = await callback({ code: "the-code", state }, { nonce });

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "OAuth session could not be verified for this browser",
    );
    expect(exchanges()).toEqual([]);
    expect(await tokenRows()).toEqual([]);
  });
});

describe("a token exchange that fails", () => {
  it("says what the provider said", async () => {
    answer = () =>
      json(
        { error: "invalid_grant", error_description: "Malformed auth code." },
        400,
      );

    const { params } = await connect();

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "Token exchange failed: Malformed auth code. (invalid_grant)",
    );
    expect(await tokenRows()).toEqual([]);
  });

  it("keeps a gateway's error page out of the URL", async () => {
    answer = () =>
      new Response(`<html><body>${"<p>Bad Gateway</p>".repeat(2_000)}`, {
        status: 502,
        headers: { "content-type": "text/html" },
      });

    const { params, location } = await connect();

    expect(params.get("details")).toBe(
      "Token exchange failed: the provider answered 502",
    );
    expect(location.length).toBeLessThan(1_000);
    expect(await tokenRows()).toEqual([]);
  });

  it("says so when the provider can't be reached", async () => {
    jest.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const { params } = await connect();

    expect(params.get("details")).toBe("Failed to exchange code: fetch failed");
    expect(await tokenRows()).toEqual([]);
  });

  it("doesn't report success for a 200 with no token in it", async () => {
    answer = () => json({ error: "invalid_grant" });

    const { params } = await connect();

    expect(params.get("error")).toBe("oauth_failed");
    expect(params.get("details")).toBe(
      "The provider's answer had no access token",
    );
    expect(await tokenRows()).toEqual([]);
  });
});

describe("tokens once they're stored", () => {
  async function expireStoredToken() {
    await db
      .update(oauthTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(oauthTokens.toolId, toolId));
  }

  it("refreshes an expired one and keeps the refresh token", async () => {
    await connect();
    await expireStoredToken();
    // Google leaves refresh_token out of a refresh's answer.
    answer = () =>
      json({
        access_token: "the-refreshed-token",
        expires_in: 3599,
        token_type: "Bearer",
      });

    await expect(manager().getValidAccessToken(owner, toolId)).resolves.toBe(
      "the-refreshed-token",
    );

    const refresh = exchanges().at(-1)!.form;
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("the-refresh-token");
    const tokens = await manager().getTokens(owner, toolId);
    expect(tokens?.accessToken).toBe("the-refreshed-token");
    expect(tokens?.refreshToken).toBe("the-refresh-token");
    expect(tokens!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("drops them when the provider says the refresh token is no good", async () => {
    await connect();
    await expireStoredToken();
    answer = (url) =>
      url === REVOKE_URL ? json({}) : json({ error: "invalid_grant" }, 400);

    await expect(
      manager().getValidAccessToken(owner, toolId),
    ).rejects.toMatchObject({ code: "refresh_failed" });

    expect(await tokenRows()).toEqual([]);
  });

  describe("keeps them through a refresh that fails for any other reason", () => {
    async function expectKeptThrough(failure: () => void) {
      await connect();
      await expireStoredToken();
      failure();

      await expect(
        manager().getValidAccessToken(owner, toolId),
      ).rejects.toMatchObject({ code: "refresh_failed" });

      const tokens = await manager().getTokens(owner, toolId);
      expect(tokens?.refreshToken).toBe("the-refresh-token");

      // So nobody has to connect the account again once it has passed.
      jest
        .mocked(global.fetch)
        .mockImplementation(() =>
          Promise.resolve(
            json({ access_token: "the-refreshed-token", expires_in: 3599 }),
          ),
        );
      await expect(manager().getValidAccessToken(owner, toolId)).resolves.toBe(
        "the-refreshed-token",
      );
    }

    it("the provider being down", async () => {
      await expectKeptThrough(() => {
        answer = () =>
          new Response("<html>Service Unavailable", { status: 503 });
      });
    });

    it("the provider being out of reach", async () => {
      await expectKeptThrough(() => {
        jest
          .mocked(global.fetch)
          .mockRejectedValue(new TypeError("fetch failed"));
      });
    });

    it("the server's own client secret being wrong", async () => {
      await expectKeptThrough(() => {
        answer = () => json({ error: "invalid_client" }, 401);
      });
    });

    it("the new token not saving", async () => {
      await expectKeptThrough(() => {
        jest
          .spyOn(TokenManager.prototype, "storeTokens")
          .mockRejectedValueOnce(new Error("no connection"));
        answer = () => json({ access_token: "lost", expires_in: 3599 });
      });
    });
  });

  it("logs why a refresh failed, without the provider's whole answer", async () => {
    await connect();
    await expireStoredToken();
    answer = () => new Response("<html>Service Unavailable", { status: 503 });

    await expect(
      manager().getValidAccessToken(owner, toolId),
    ).rejects.toMatchObject({ code: "refresh_failed" });

    const logged = jest
      .mocked(console.error)
      .mock.calls.map((call) => call.join(" "))
      .join("\n");
    expect(logged).toContain("the provider answered 503");
    expect(logged).not.toContain("<html>");
  });

  it("revokes and deletes them on disconnect", async () => {
    await connect();

    await manager().deleteTokens(owner, toolId);

    const revoke = requests.find(({ url }) => url === REVOKE_URL);
    expect(revoke?.form.get("token")).toBe("the-access-token");
    expect(await tokenRows()).toEqual([]);
    await expect(manager().hasValidTokens(owner, toolId)).resolves.toBe(false);
  });
});

describe("an attempt nobody finishes", () => {
  const MINUTE = 60_000;

  /** Puts an attempt past its expiry, as waiting out its 10 minutes would. */
  const expire = (state: string) =>
    db
      .update(oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(oauthStates.state, state));

  const storedStates = async () =>
    (await stateRows()).map(({ state }) => state);

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("goes on the worker's next pass when abandoned at the consent screen", async () => {
    const abandoned = await startFlow();
    const inTime = await startFlow();
    await expire(abandoned.state);

    await runRetention();

    expect(await storedStates()).toEqual([inTime.state]);
  });

  it("goes after a late return too, which the callback refuses and leaves behind", async () => {
    const { state, nonce } = await startFlow();
    await expire(state);
    const { params } = await callback({ code: "the-code", state }, { nonce });
    expect(params.get("details")).toBe(
      "This connection attempt has expired or was already used",
    );
    expect(await storedStates()).toEqual([state]);

    await runRetention();

    expect(await storedStates()).toEqual([]);
  });

  it("lasts the 10 minutes it was given, and no longer", async () => {
    await startFlow();

    await runRetention({ now: new Date(Date.now() + 9 * MINUTE) });
    expect(await stateRows()).toHaveLength(1);

    await runRetention({ now: new Date(Date.now() + 11 * MINUTE) });
    expect(await stateRows()).toEqual([]);
  });

  it("isn't touched while it's in time, and can still finish after a pass", async () => {
    const { state, nonce } = await startFlow();

    await runRetention();

    expect(await storedStates()).toEqual([state]);
    const { params } = await callback({ code: "the-code", state }, { nonce });
    expect(params.get("oauth")).toBe("success");
    expect(await tokenRows()).toHaveLength(1);
  });

  it("gets the same words for a return after it has gone, and only loses the tool", async () => {
    const { state, nonce } = await startFlow();
    await expire(state);
    await runRetention();

    const { params } = await callback({ code: "the-code", state }, { nonce });

    // OAuthResultAlert says "expired or was already used" for this code too. With the
    // row gone nothing names the tool, so the page opens without it selected.
    expect(params.get("error")).toBe("invalid_state");
    expect(params.get("tool")).toBeNull();
    expect(exchanges()).toEqual([]);
    expect(await tokenRows()).toEqual([]);
  });
});
