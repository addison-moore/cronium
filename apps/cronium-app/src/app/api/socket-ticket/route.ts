import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isSocketTicketAudience, mintSocketTicket } from "@/lib/socket-ticket";
import { hasServerPermission } from "@/server/permissions";
import { roleAllowsCapability } from "@/server/security/authorization";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return noStoreJson({ error: "Authentication required" }, { status: 401 });
  }

  let audience: unknown;
  try {
    ({ audience } = (await request.json()) as { audience?: unknown });
  } catch {
    return noStoreJson({ error: "Invalid request" }, { status: 400 });
  }

  if (!isSocketTicketAudience(audience)) {
    return noStoreJson({ error: "Invalid audience" }, { status: 400 });
  }

  // Re-check the database instead of trusting a potentially stale JWT session.
  const user = await storage.getUser(userId);
  if (user?.status !== UserStatus.ACTIVE) {
    return noStoreJson({ error: "Authentication required" }, { status: 401 });
  }

  // A terminal is command execution: read-only roles are denied regardless of
  // their granular console permission.
  if (
    audience === "terminal" &&
    (!roleAllowsCapability(user.role, "execute") ||
      !(await hasServerPermission(userId, "console")))
  ) {
    return noStoreJson({ error: "Access denied" }, { status: 403 });
  }

  return noStoreJson(mintSocketTicket(userId, audience));
}
