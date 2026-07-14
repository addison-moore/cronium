/**
 * OAuth credential bridge.
 *
 * Plugins that declare `requiresOAuth` read `credentials.oauthToken` in their
 * actions. Tokens live in the oauth_tokens table (keyed userId+toolId), not in
 * the tool's stored credentials — this bridge fetches a fresh access token
 * (auto-refreshing via TokenManager) and injects it before execution.
 *
 * Server-only: called from the scheduler executor, the manual tRPC execution
 * path, and the plugin route dispatcher.
 */

import { TokenManager } from "./TokenManager";
import { createProviderFromEnv } from "./providers";
import { getOAuthConfig } from "@/lib/tools/tool-registry";

export interface OAuthBridgeTarget {
  userId: string;
  toolId: number;
  toolType: string;
}

/**
 * Return a copy of `credentials` with `oauthToken` injected when the tool's
 * plugin requires OAuth and the user has a connected account. On any failure
 * the token is left unset (with a logged warning) — actions then surface
 * their own clear "OAuth authentication required" error. Never injects a
 * stale token.
 */
export async function injectOAuthToken(
  credentials: Record<string, unknown>,
  target: OAuthBridgeTarget,
): Promise<Record<string, unknown>> {
  const oauthConfig = getOAuthConfig(target.toolType);
  if (!oauthConfig) {
    return credentials;
  }

  const provider = createProviderFromEnv(
    oauthConfig.providerId,
    oauthConfig.scope,
  );
  if (!provider) {
    console.warn(
      `OAuth not configured for ${oauthConfig.providerId} (missing OAUTH_${oauthConfig.providerId.toUpperCase()}_CLIENT_ID/SECRET); ` +
        `${target.toolType} actions will fail until it is set up`,
    );
    return credentials;
  }

  try {
    const tokenManager = new TokenManager(provider);
    const accessToken = await tokenManager.getValidAccessToken(
      target.userId,
      target.toolId,
    );
    return { ...credentials, oauthToken: accessToken };
  } catch (error) {
    console.warn(
      `Failed to obtain OAuth access token for tool ${target.toolId} (${target.toolType}):`,
      error instanceof Error ? error.message : error,
    );
    return credentials;
  }
}
