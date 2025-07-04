import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { sshService } from "@/lib/ssh";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const serverId = parseInt(resolvedParams.id);

    if (isNaN(serverId)) {
      return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
    }

    // Get server details
    const server = await storage.getServer(serverId);

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Check if user owns this server
    if (server.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check server health using SSH
    console.log(
      `Checking health for server: ${server.name} at ${server.address}:${server.port}`,
    );
    console.log(`Username: ${server.username}`);
    console.log(
      `SSH key length: ${server.sshKey ? server.sshKey.length : 0} characters`,
    );

    const healthCheck = await sshService.checkServerHealth(server);

    console.log("Health check result:", {
      online: healthCheck.online,
      error: healthCheck.error,
      systemInfo: healthCheck.systemInfo,
    });

    // Update server status in database
    const lastChecked = new Date();
    await storage.updateServerStatus(serverId, healthCheck.online, lastChecked);

    return NextResponse.json({
      online: healthCheck.online,
      systemInfo: healthCheck.systemInfo,
      error: healthCheck.error,
      lastChecked: lastChecked.toISOString(),
    });
  } catch (error) {
    console.error("Error checking server status:", error);
    return NextResponse.json(
      {
        error: "Failed to check server status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
