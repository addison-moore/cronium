import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { encryptionService } from "@/lib/encryption-service";

// Get server SSH credentials
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

    // Get orchestrator ID to log access
    const orchestratorId = request.headers.get("x-orchestrator-id");
    if (!orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    const { serverId } = params;

    if (!serverId) {
      return NextResponse.json(
        { error: "Server ID required" },
        { status: 400 },
      );
    }

    // Get server with credentials
    const server = await db
      .select({
        id: servers.id,
        address: servers.address,
        port: servers.port,
        username: servers.username,
        sshKey: servers.sshKey,
      })
      .from(servers)
      .where(eq(servers.id, parseInt(serverId)))
      .limit(1);

    if (server.length === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const serverData = server[0];

    // Log credential access
    console.log(
      `Orchestrator ${orchestratorId} accessed credentials for server ${serverId}`,
    );

    // Prepare credentials for SSH access
    interface ServerCredentials {
      host: string;
      port: number;
      username: string;
      privateKey?: string;
    }

    const credentials: ServerCredentials = {
      host: serverData.address,
      port: serverData.port,
      username: serverData.username,
    };

    // Decrypt SSH key if present
    if (serverData.sshKey) {
      try {
        credentials.privateKey = encryptionService.decrypt(serverData.sshKey);
      } catch {
        // If decryption fails, assume key is not encrypted
        credentials.privateKey = serverData.sshKey;
      }
    }

    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("Error fetching server credentials:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
