import {
  mintAccessToken,
  mintRefreshToken,
  verifyRefreshToken,
  pkceMatches,
  randomId,
} from "@/lib/mcp-oauth/tokens";
import {
  takeAuthCode,
  allowRefresh,
  consumeRefresh,
} from "@/lib/mcp-oauth/store";
import { jsonResponse, oauthError, corsPreflight } from "@/lib/mcp-oauth/http";

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

export async function POST(req: Request): Promise<Response> {
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

    const data = await takeAuthCode(code); // single use
    if (!data) return oauthError("invalid_grant", "Invalid or expired code");
    if (data.cid !== clientId) {
      return oauthError("invalid_grant", "client_id mismatch");
    }
    if (data.redirectUri !== redirectUri) {
      return oauthError("invalid_grant", "redirect_uri mismatch");
    }
    if (!pkceMatches(codeVerifier, data.codeChallenge)) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }

    const access = mintAccessToken({
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.resource,
    });
    const jti = randomId(16);
    const refresh = mintRefreshToken({
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.resource,
      jti,
    });
    await allowRefresh(jti, {
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.resource,
    });
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
    const data = await consumeRefresh(payload.jti);
    if (!data) {
      return oauthError(
        "invalid_grant",
        "Refresh token already used or revoked",
      );
    }

    const access = mintAccessToken({
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.aud,
    });
    const newJti = randomId(16);
    const refresh = mintRefreshToken({
      sub: data.sub,
      cid: data.cid,
      scope: data.scope,
      aud: data.aud,
      jti: newJti,
    });
    await allowRefresh(newJti, data);
    return tokenResponse(access, refresh, data.scope);
  }

  return oauthError(
    "unsupported_grant_type",
    `Unsupported grant_type: ${String(grantType)}`,
  );
}

export function OPTIONS(): Response {
  return corsPreflight();
}
