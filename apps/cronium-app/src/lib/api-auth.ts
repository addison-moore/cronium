import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { TokenStatus } from "@/shared/schema";

/** Extract a bearer token from an `Authorization` header, if present. */
export function getBearerToken(headers: Headers): string | null {
  const authHeader =
    headers.get("authorization") ?? headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate a raw API token string. Returns the owning user id + token id when
 * the token is active and unexpired, otherwise null. Bumps `lastUsed`.
 * Header-agnostic so both REST (NextRequest) and tRPC (Headers) paths reuse it.
 */
export async function authenticateApiToken(token: string): Promise<{
  userId: string;
  tokenId: number;
  scopes: string[] | null;
} | null> {
  try {
    const apiToken = await storage.getApiTokenByToken(token);

    if (apiToken?.status !== TokenStatus.ACTIVE) {
      return null;
    }
    if (apiToken.expiresAt && apiToken.expiresAt.getTime() < Date.now()) {
      return null;
    }

    // Update last used time
    await storage.updateApiToken(apiToken.id, { lastUsed: new Date() });

    return {
      userId: apiToken.userId,
      tokenId: apiToken.id,
      scopes: apiToken.scopes ?? null,
    };
  } catch (error) {
    console.error("Error validating API token:", error);
    return null;
  }
}

/**
 * Middleware to authenticate API requests using API tokens
 * This allows API access without a session
 */
export async function authenticateApiRequest(request: NextRequest): Promise<{
  userId: string;
  authenticated: boolean;
  tokenId?: number;
}> {
  const token = getBearerToken(request.headers);
  if (!token) {
    return { authenticated: false, userId: "" };
  }

  const result = await authenticateApiToken(token);
  if (!result) {
    return { authenticated: false, userId: "" };
  }

  return {
    authenticated: true,
    userId: result.userId,
    tokenId: result.tokenId,
  };
}

/**
 * Helper function to create an error response for API authentication failures
 */
export function createApiAuthErrorResponse(error: string): NextResponse {
  return NextResponse.json(
    { error },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}
