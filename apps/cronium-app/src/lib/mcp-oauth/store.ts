import { cacheService } from "@/lib/cache/cache-service";
import { AUTH_CODE_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from "./tokens";

/**
 * Valkey-backed state for the MCP OAuth server: registered clients (DCR), single-
 * use authorization codes, and the refresh-token rotation allowlist. Using the
 * cache (not Postgres) keeps this self-contained with no schema migration; codes
 * are short-lived and clients re-register via DCR if evicted.
 *
 * Here a missing key is a verdict: an unknown client, a used code, a revoked token. So
 * these use the cache's strict methods, and a Valkey that couldn't be asked throws
 * CacheUnavailableError rather than answering as a missing key would, and a write that
 * didn't happen throws rather than going unnoticed.
 */
const CLIENT_PREFIX = "mcpoauth:client:";
const CODE_PREFIX = "mcpoauth:code:";
const REFRESH_PREFIX = "mcpoauth:rt:";

// Registrations expire if unused (Phase 4.1) so open DCR cannot grow the store
// without bound. The TTL is refreshed whenever a client is looked up during an
// OAuth flow, so actively-used clients persist while abandoned ones age out.
const CLIENT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name?: string | undefined;
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
  created_at: number;
}

export interface AuthCodeData {
  sub: string; // user id
  cid: string; // client id
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  sv: number; // the user's sessionVersion when consent was given
}

export interface RefreshData {
  sub: string;
  cid: string;
  scope: string;
  aud: string;
  sv: number;
}

export async function registerClient(client: OAuthClient): Promise<void> {
  await cacheService.setStrict(`${CLIENT_PREFIX}${client.client_id}`, client, {
    ttl: CLIENT_TTL_SEC,
  });
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const client = await cacheService.getStrict<OAuthClient>(
    `${CLIENT_PREFIX}${clientId}`,
  );
  // Sliding expiry: touch the TTL so an in-use client does not age out. If Valkey
  // refuses the write, the client still has the rest of its 30 days.
  if (client) {
    await cacheService.set(`${CLIENT_PREFIX}${clientId}`, client, {
      ttl: CLIENT_TTL_SEC,
    });
  }
  return client;
}

export async function putAuthCode(
  code: string,
  data: AuthCodeData,
): Promise<void> {
  await cacheService.setStrict(`${CODE_PREFIX}${code}`, data, {
    ttl: AUTH_CODE_TTL_SEC,
  });
}

/**
 * Look at an auth code without using it up, or renewing its minute. This can't let anyone
 * use it, because another request can take it straight after: only takeAuthCode can.
 */
export async function peekAuthCode(code: string): Promise<AuthCodeData | null> {
  return cacheService.getStrict<AuthCodeData>(`${CODE_PREFIX}${code}`);
}

/** Fetch + delete an auth code (single use). Returns null if unknown/expired/used. */
export async function takeAuthCode(code: string): Promise<AuthCodeData | null> {
  // Atomic GETDEL: two concurrent token requests with the same code cannot both
  // consume it (ME-03).
  return cacheService.getdelStrict<AuthCodeData>(`${CODE_PREFIX}${code}`);
}

export async function allowRefresh(
  jti: string,
  data: RefreshData,
): Promise<void> {
  await cacheService.setStrict(`${REFRESH_PREFIX}${jti}`, data, {
    ttl: REFRESH_TOKEN_TTL_SEC,
  });
}

/**
 * Takes a jti back off the list, for one allowed before its token was handed out that now
 * won't be. Best effort: if this fails the entry stays until it expires, and that's harmless,
 * because no token carrying that jti was ever minted.
 */
export async function disallowRefresh(jti: string): Promise<void> {
  await cacheService.delete(`${REFRESH_PREFIX}${jti}`);
}

/**
 * Look at a refresh jti without using it up, or renewing it. This can't let anyone rotate
 * it, because another request can take it straight after: only consumeRefresh can.
 */
export async function peekRefresh(jti: string): Promise<RefreshData | null> {
  return cacheService.getStrict<RefreshData>(`${REFRESH_PREFIX}${jti}`);
}

/** Consume a refresh jti (rotation): valid only if still in the allowlist. */
export async function consumeRefresh(jti: string): Promise<RefreshData | null> {
  // Atomic GETDEL so a replayed refresh token cannot be rotated twice (ME-03).
  return cacheService.getdelStrict<RefreshData>(`${REFRESH_PREFIX}${jti}`);
}
