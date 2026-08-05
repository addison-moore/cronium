import type { Session } from "next-auth";
import { getBearerToken } from "@/lib/api-auth";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";
import { verifyAccessToken } from "./tokens";

/**
 * Resource-server side: turn a valid OAuth access token (Bearer) into a Session
 * for the token's user, so /api/mcp accepts OAuth-issued tokens alongside raw
 * API tokens. Returns null when there is no valid access token.
 */
export async function sessionFromOAuthToken(
  headers: Headers,
): Promise<{ session: Session; scopes: string[] | null } | null> {
  const token = getBearerToken(headers);
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  const user = await storage.getUser(payload.sub);
  // Bearer principals must be live: a disabled owner's OAuth tokens stop
  // working immediately, not at token expiry.
  if (user?.status !== UserStatus.ACTIVE) return null;

  const name =
    user.firstName || user.lastName
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
      : (user.email ?? "User");

  const session = {
    user: {
      id: user.id,
      email: user.email ?? "",
      name,
      role: user.role,
      status: user.status,
      sessionVersion: user.sessionVersion,
      image: null,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } as Session;

  // OAuth access tokens are always scoped to what the grant approved.
  const scopes = payload.scope ? payload.scope.split(" ").filter(Boolean) : [];
  return { session, scopes };
}
