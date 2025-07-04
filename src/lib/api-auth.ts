import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { TokenStatus } from "@/shared/schema";

/**
 * Middleware to authenticate API requests using API tokens
 * This allows API access without a session
 */
export async function authenticateApiRequest(request: NextRequest): Promise<{
  userId: string;
  authenticated: boolean;
  tokenId?: number;
}> {
  // Check for authorization header
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { authenticated: false, userId: "" };
  }

  // Extract the token
  const token = authHeader.substring(7);

  if (!token) {
    return { authenticated: false, userId: "" };
  }

  // Verify the token
  try {
    const apiToken = await storage.getApiTokenByToken(token);

    if (!apiToken || apiToken.status !== TokenStatus.ACTIVE) {
      return { authenticated: false, userId: "" };
    }

    // Update last used time
    await storage.updateApiToken(apiToken.id, { lastUsed: new Date() });

    return {
      authenticated: true,
      userId: apiToken.userId,
      tokenId: apiToken.id,
    };
  } catch (error) {
    console.error("Error validating API token:", error);
    return { authenticated: false, userId: "" };
  }
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
