import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/shared/schema";
import { eq } from "drizzle-orm";
import {
  authorizeCapability,
  assertServerScope,
} from "@/lib/security/internal-route-auth";

// Get server details
export async function GET(
  request: NextRequest,
  { params }: { params: { serverId: string } },
) {
  try {
    const { serverId } = params;

    if (!serverId) {
      return NextResponse.json(
        { error: "Server ID required" },
        { status: 400 },
      );
    }

    // Per-job capability (HI-10): only a job scheduled against this server may
    // read its connection details. (No Go service currently calls this route,
    // so requiring the capability also closes an unused credential-leak path.)
    const auth = authorizeCapability(request, "server:read");
    if (!auth.ok) return auth.response;
    const scopeError = assertServerScope(auth.cap, serverId);
    if (scopeError) return scopeError;

    // Get server details
    const server = await db
      .select({
        id: servers.id,
        name: servers.name,
        address: servers.address,
        port: servers.port,
        username: servers.username,
        online: servers.online,
        shared: servers.shared,
        lastChecked: servers.lastChecked,
        createdAt: servers.createdAt,
        updatedAt: servers.updatedAt,
      })
      .from(servers)
      .where(eq(servers.id, parseInt(serverId)))
      .limit(1);

    if (server.length === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({ server: server[0] });
  } catch (error) {
    console.error("Error fetching server:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
