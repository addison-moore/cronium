import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/shared/schema";
import { eq } from "drizzle-orm";

// Get server details
export async function GET(
  request: NextRequest,
  { params }: { params: { serverId: string } },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { serverId } = params;

    if (!serverId) {
      return NextResponse.json(
        { error: "Server ID required" },
        { status: 400 },
      );
    }

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
