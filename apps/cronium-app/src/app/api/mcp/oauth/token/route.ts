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
  peekRefresh,
  consumeRefresh,
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

/**
 * Takes a single-use code or refresh token, and says whether its grant is still good.
 * Null means there was nothing to take: it's unknown, expired or already used.
 *
 * The grant is read first because a failed read says nothing about it, so the client must be
 * able to use the same token once the database is back. Nothing is taken in that case, which
 * is why a failure has nothing to put back, and no moment when a retry finds the token gone.
 *
 * `take` is what makes it single use. Any number of requests can get past the read together,
 * and GETDEL gives the token to one of them. It runs whatever the read said, so a token that
 * gets refused is used up, as is one refused for its client, redirect or PKCE afterwards.
 *
 * A revocation that lands just after the read doesn't get through. What's minted carries this
 * grant's session version, and every use compares that with the live row, so those tokens are
 * refused the first time they're used. There's deliberately no second read after `take`: one
 * that failed would lose the token, which is what this order is here to prevent.
 */
async function takeAfterChecking<T extends { sub: string; sv: number }>(
  req: Request,
  peek: () => Promise<T | null>,
  take: () => Promise<T | null>,
): Promise<{ data: T; stillValid: boolean } | null> {
  const seen = await peek();
  if (!seen) return null;
  const stillValid = await grantStillValid(seen);
  // A frozen database can hold this read for longer than the client will wait. Nobody would
  // receive what replaces the token, so it stays for the client's next try.
  if (req.signal.aborted) throw new CredentialCheckFailedError();
  const data = await take();
  return data && { data, stillValid };
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

    const taken = await takeAfterChecking(
      req,
      () => peekAuthCode(code),
      () => takeAuthCode(code), // single use
    );
    if (!taken) return oauthError("invalid_grant", "Invalid or expired code");
    const { data, stillValid } = taken;
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
      return oauthError("invalid_grant", "The authorizing user was revoked");
    }

    const grant = {
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.resource,
      sv: data.sv,
    };
    const access = mintAccessToken(grant);
    const jti = randomId(16);
    const refresh = mintRefreshToken({ ...grant, jti });
    await allowRefresh(jti, grant);
    return tokenResponse(access, refresh, data.scope);
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
    const taken = await takeAfterChecking(
      req,
      () => peekRefresh(jti),
      () => consumeRefresh(jti),
    );
    if (!taken) {
      return oauthError(
        "invalid_grant",
        "Refresh token already used or revoked",
      );
    }
    const { data, stillValid } = taken;

    // Refresh tokens rotate for 30 days at a time, so without this a grant would
    // outlive a password reset or "revoke sessions" indefinitely.
    if (!stillValid) {
      return oauthError("invalid_grant", "Refresh token has been revoked");
    }

    const access = mintAccessToken(data);
    const newJti = randomId(16);
    const refresh = mintRefreshToken({ ...data, jti: newJti });
    await allowRefresh(newJti, data);
    return tokenResponse(access, refresh, data.scope);
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
