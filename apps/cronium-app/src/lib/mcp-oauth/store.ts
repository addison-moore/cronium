import { cacheService } from "@/lib/cache/cache-service";
import { AUTH_CODE_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from "./tokens";

/**
 * Valkey-backed state for the MCP OAuth server: registered clients (DCR), single-
 * use authorization codes, and the refresh-token rotation allowlist. Using the
 * cache (not Postgres) keeps this self-contained with no schema migration; codes
 * are short-lived and clients re-register via DCR if evicted.
 */
const CLIENT_PREFIX = "mcpoauth:client:";
const CODE_PREFIX = "mcpoauth:code:";
const REFRESH_PREFIX = "mcpoauth:rt:";

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
}

export interface RefreshData {
  sub: string;
  cid: string;
  scope: string;
  aud: string;
}

export async function registerClient(client: OAuthClient): Promise<void> {
  // ttl: 0 → persistent (clients are long-lived; re-register via DCR if evicted).
  await cacheService.set(`${CLIENT_PREFIX}${client.client_id}`, client, {
    ttl: 0,
  });
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  return cacheService.get<OAuthClient>(`${CLIENT_PREFIX}${clientId}`);
}

export async function putAuthCode(
  code: string,
  data: AuthCodeData,
): Promise<void> {
  await cacheService.set(`${CODE_PREFIX}${code}`, data, {
    ttl: AUTH_CODE_TTL_SEC,
  });
}

/** Fetch + delete an auth code (single use). Returns null if unknown/expired/used. */
export async function takeAuthCode(code: string): Promise<AuthCodeData | null> {
  const key = `${CODE_PREFIX}${code}`;
  const data = await cacheService.get<AuthCodeData>(key);
  if (!data) return null;
  await cacheService.delete(key);
  return data;
}

export async function allowRefresh(
  jti: string,
  data: RefreshData,
): Promise<void> {
  await cacheService.set(`${REFRESH_PREFIX}${jti}`, data, {
    ttl: REFRESH_TOKEN_TTL_SEC,
  });
}

/** Consume a refresh jti (rotation): valid only if still in the allowlist. */
export async function consumeRefresh(jti: string): Promise<RefreshData | null> {
  const key = `${REFRESH_PREFIX}${jti}`;
  const data = await cacheService.get<RefreshData>(key);
  if (!data) return null;
  await cacheService.delete(key);
  return data;
}
