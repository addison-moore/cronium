import {
  mintAccessToken,
  mintRefreshToken,
  verifyRefreshToken,
  pkceMatches,
  randomId,
} from "@/lib/mcp-oauth/tokens";
import {
  peekAuthCode,
  takeAuthCode,
  allowRefresh,
  disallowRefresh,
  peekRefresh,
  consumeRefresh,
  type RefreshData,
} from "@/lib/mcp-oauth/store";
import { jsonResponse, oauthError, corsPreflight } from "@/lib/mcp-oauth/http";
import {
  checkingCredentials,
  CREDENTIAL_CHECK_FAILED_MESSAGE,
  CredentialCheckFailedError,
} from "@/server/security/credential-check";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

// OAuth 2.1 token endpoint (public client + PKCE). Supports authorization_code
// and refresh_token grants.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readParams(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json()) as Record<string, unknown>;
    return new URLSearchParams(
      Object.entries(j).map(([k, v]) => [k, String(v)]),
    );
  }
  return new URLSearchParams(await req.text());
}

function tokenResponse(
  access: { token: string; expiresIn: number },
  refresh: string,
  scope: string,
): Response {
  return jsonResponse({
    access_token: access.token,
    token_type: "Bearer",
    expires_in: access.expiresIn,
    refresh_token: refresh,
    scope,
  });
}

/** A grant is good only while its user is active and has not been revoked. */
async function grantStillValid(data: {
  sub: string;
  sv: number;
}): Promise<boolean> {
  const user = await checkingCredentials(
    "Error reading an OAuth grant's owner",
    () => storage.getUser(data.sub),
  );
  return user?.status === UserStatus.ACTIVE && user.sessionVersion === data.sv;
}

/** A single-use code or refresh token, and what its grant type decides about it. */
interface Redeemable<T> {
  /** What it is, for the log. */
  kind: string;
  peek: () => Promise<T | null>;
  take: () => Promise<T | null>;
  /** The answer when there's nothing to take: it's unknown, expired or already used. */
  unknown: () => Response;
  /** Why this request gets nothing for it, or null if it can have tokens. */
  refusal: (data: T, stillValid: boolean) => Response | null;
  /** What the new tokens are for. */
  grant: (data: T) => RefreshData;
}

/**
 * Exchanges a single-use code or refresh token for new tokens.
 *
 * The grant is read first because a failed read says nothing about it, so the client must be
 * able to use the same token once the database is back. Nothing is taken in that case, which
 * is why a failure has nothing to put back, and no moment when a retry finds the token gone.
 * A Valkey that can't be asked is the same: a 503 rather than the invalid_grant of a token
 * that isn't there, which tells a client to throw its token away.
 *
 * `take` is what makes it single use. Any number of requests can get past the read together,
 * and GETDEL gives the token to one of them. It runs whatever the read said, so a token that
 * gets refused is used up, as is a code refused for its client, redirect or PKCE.
 *
 * The new refresh token is on the list before the old one is taken, so a write Valkey refuses,
 * as it does at `maxmemory` under `noeviction`, leaves the client the token it has. The other
 * way round, the old one was gone and the new one never stored. A request that then loses the
 * take, or can't make it, takes its new entry off again. If that fails too, nothing holds a
 * token for it.
 *
 * A revocation that lands just after the read doesn't get through. What's minted carries this
 * grant's session version, and every use compares that with the live row, so those tokens are
 * refused the first time they're used. There's deliberately no second read after `take`: one
 * that failed would lose the token, which is what this order is here to prevent.
 */
async function redeem<T extends { sub: string; sv: number }>(
  req: Request,
  credential: Redeemable<T>,
): Promise<Response> {
  const seen = await checkingCredentials(
    `Error reading ${credential.kind}`,
    credential.peek,
  );
  if (!seen) return credential.unknown();
  const refusal = credential.refusal(seen, await grantStillValid(seen));
  if (refusal) {
    const taken = await takeUnlessAbandoned(req, credential);
    return taken ? refusal : credential.unknown();
  }

  // Anything that can fail by itself comes before the take, so a failure leaves the token.
  const grant = credential.grant(seen);
  const jti = randomId(16);
  const access = mintAccessToken(grant);
  const refresh = mintRefreshToken({ ...grant, jti });
  await checkingCredentials("Error storing an OAuth refresh token", () =>
    allowRefresh(jti, grant),
  );
  let taken: T | null = null;
  try {
    taken = await takeUnlessAbandoned(req, credential);
  } finally {
    if (!taken) await disallowRefresh(jti);
  }
  return taken
    ? tokenResponse(access, refresh, grant.scope)
    : credential.unknown();
}

/** The one step that uses a token up. */
async function takeUnlessAbandoned<T>(
  req: Request,
  { kind, take }: Redeemable<T>,
): Promise<T | null> {
  // A frozen database or Valkey can hold a request for longer than the client will wait.
  // Nobody would receive what replaces the token, so it stays for the client's next try.
  if (req.signal.aborted) throw new CredentialCheckFailedError();
  return checkingCredentials(`Error taking ${kind}`, take);
}

async function answerTokenRequest(req: Request): Promise<Response> {
  let params: URLSearchParams;
  try {
    params = await readParams(req);
  } catch {
    return oauthError("invalid_request", "Malformed request body");
  }

  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code");
    const redirectUri = params.get("redirect_uri");
    const clientId = params.get("client_id");
    const codeVerifier = params.get("code_verifier");

    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return oauthError(
        "invalid_request",
        "code, redirect_uri, client_id and code_verifier are required",
      );
    }

    return redeem(req, {
      kind: "an OAuth authorization code",
      peek: () => peekAuthCode(code),
      take: () => takeAuthCode(code), // single use
      unknown: () => oauthError("invalid_grant", "Invalid or expired code"),
      refusal: (data, stillValid) => {
        if (data.cid !== clientId) {
          return oauthError("invalid_grant", "client_id mismatch");
        }
        if (data.redirectUri !== redirectUri) {
          return oauthError("invalid_grant", "redirect_uri mismatch");
        }
        if (!pkceMatches(codeVerifier, data.codeChallenge)) {
          return oauthError("invalid_grant", "PKCE verification failed");
        }
        if (!stillValid) {
          return oauthError(
            "invalid_grant",
            "The authorizing user was revoked",
          );
        }
        return null;
      },
      grant: (data) => ({
        sub: data.sub,
        cid: data.cid,
        scope: data.scope,
        aud: data.resource,
        sv: data.sv,
      }),
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token");
    const clientId = params.get("client_id");
    if (!refreshToken) {
      return oauthError("invalid_request", "refresh_token is required");
    }

    const payload = verifyRefreshToken(refreshToken);
    if (payload?.jti == null) {
      return oauthError("invalid_grant", "Invalid refresh token");
    }
    if (clientId && clientId !== payload.cid) {
      return oauthError("invalid_grant", "client_id mismatch");
    }

    // Rotation: the jti is single-use. A replay (already consumed) is rejected.
    const { jti } = payload;
    return redeem(req, {
      kind: "an OAuth refresh token",
      peek: () => peekRefresh(jti),
      take: () => consumeRefresh(jti),
      unknown: () =>
        oauthError("invalid_grant", "Refresh token already used or revoked"),
      // Refresh tokens rotate for 30 days at a time, so without this a grant would
      // outlive a password reset or "revoke sessions" indefinitely.
      refusal: (_data, stillValid) =>
        stillValid
          ? null
          : oauthError("invalid_grant", "Refresh token has been revoked"),
      grant: (data) => data,
    });
  }

  return oauthError(
    "unsupported_grant_type",
    `Unsupported grant_type: ${String(grantType)}`,
  );
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await answerTokenRequest(req);
  } catch (error) {
    if (error instanceof CredentialCheckFailedError) {
      // Not invalid_grant, which tells a client to throw its token away. RFC 6749 only lists
      // this code for the authorize endpoint, but it's the one the MCP SDK passes on to its
      // caller with the token kept, where server_error or an empty 500 start a new consent.
      return oauthError(
        "temporarily_unavailable",
        CREDENTIAL_CHECK_FAILED_MESSAGE,
        503,
      );
    }
    throw error;
  }
}

export function OPTIONS(): Response {
  return corsPreflight();
}
