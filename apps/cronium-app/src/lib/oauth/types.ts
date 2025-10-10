import { z } from "zod";

// OAuth2 Token Schema
export const oauthTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.date().optional(),
  tokenType: z.string().default("Bearer"),
  scope: z.string().optional(),
});

export type OAuthToken = z.infer<typeof oauthTokenSchema>;

// OAuth2 Provider Configuration
export const oauthProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  revokeUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string(),
  redirectUri: z.string().url(),
  // Provider-specific options
  options: z.record(z.string(), z.unknown()).optional(),
});

export type OAuthProviderConfig = z.infer<typeof oauthProviderConfigSchema>;

// OAuth2 Authorization Request
export const oauthAuthRequestSchema = z.object({
  providerId: z.string(),
  userId: z.string(),
  toolId: z.number(),
  state: z.string(),
  codeVerifier: z.string().optional(), // For PKCE
  redirectUri: z.string().url(),
  scope: z.string().optional(),
});

export type OAuthAuthRequest = z.infer<typeof oauthAuthRequestSchema>;

// OAuth2 Callback Parameters
export const oauthCallbackParamsSchema = z.object({
  code: z.string(),
  state: z.string(),
  error: z.string().optional(),
  errorDescription: z.string().optional(),
});

export type OAuthCallbackParams = z.infer<typeof oauthCallbackParamsSchema>;

// OAuth2 Token Response
export const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;

// OAuth2 Error
export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

// OAuth2 Provider Interface
export interface OAuthProvider {
  id: string;
  name: string;

  // Generate authorization URL
  getAuthorizationUrl(state: string, scope?: string): string;

  // Exchange code for tokens
  exchangeCodeForTokens(
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthToken>;

  // Refresh access token
  refreshAccessToken(refreshToken: string): Promise<OAuthToken>;

  // Revoke tokens
  revokeTokens(token: string): Promise<void>;

  // Get user info (if supported)
  getUserInfo?(accessToken: string): Promise<Record<string, unknown>>;
}
