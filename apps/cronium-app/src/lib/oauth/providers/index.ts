import { GoogleOAuthProvider } from "./google";
import { MicrosoftOAuthProvider } from "./microsoft";
import { SlackOAuthProvider } from "./slack";
import type { OAuthProvider } from "../types";

export { GoogleOAuthProvider, createGoogleProvider } from "./google";
export { MicrosoftOAuthProvider, createMicrosoftProvider } from "./microsoft";
export { SlackOAuthProvider, createSlackProvider } from "./slack";

// Re-export types
export type { OAuthProvider } from "../types";

export type OAuthProviderId = "google" | "microsoft" | "slack";

/**
 * Build an OAuth provider from OAUTH_<PROVIDER>_CLIENT_ID/SECRET env vars.
 * Returns null when the provider is not configured. Single source of truth
 * for provider construction (authorize/callback routes, tRPC, token bridge).
 */
export function createProviderFromEnv(
  providerId: OAuthProviderId,
  scope?: string,
): OAuthProvider | null {
  const clientId = process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_ID`];
  const clientSecret =
    process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    return null;
  }

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:5001";
  const redirectUri = `${baseUrl}/api/oauth/callback`;

  switch (providerId) {
    case "google":
      return new GoogleOAuthProvider({
        clientId,
        clientSecret,
        redirectUri,
        scope: scope ?? "openid email profile",
      });
    case "microsoft": {
      const tenantId = process.env.OAUTH_MICROSOFT_TENANT_ID;
      return new MicrosoftOAuthProvider({
        clientId,
        clientSecret,
        redirectUri,
        scope: scope ?? "offline_access User.Read",
        ...(tenantId && { tenantId }),
      });
    }
    case "slack":
      return new SlackOAuthProvider({
        clientId,
        clientSecret,
        redirectUri,
        scope: scope ?? "channels:read,chat:write",
      });
  }
}
