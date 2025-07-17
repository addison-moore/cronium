import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sshService } from "@/lib/ssh";
import { z } from "zod";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;
    const serverId = parseInt(id, 10);

    if (isNaN(serverId)) {
      return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
    }

    const server = await storage.getServer(serverId);

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Verify the user can access this server (owns it or it's shared)
    const canAccess = await storage.canUserAccessServer(serverId, userId);
    if (!canAccess) {
      return NextResponse.json(
        { error: "You do not have permission to access this server" },
        { status: 403 },
      );
    }

    return NextResponse.json(server);
  } catch (error) {
    console.error("Error fetching server:", error);
    return NextResponse.json(
      { error: "Failed to fetch server" },
      { status: 500 },
    );
  }
}

const updateServerSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  address: z.string().min(1, "Address is required").optional(),
  sshKey: z.string().optional(), // Allow empty string to keep existing key
  username: z.string().optional(),
  port: z.number().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;
    const serverId = parseInt(id, 10);

    if (isNaN(serverId)) {
      return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
    }

    const existingServer = await storage.getServer(serverId);

    if (!existingServer) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Verify the server belongs to the current user
    if (existingServer.userId !== userId) {
      return NextResponse.json(
        { error: "You do not have permission to modify this server" },
        { status: 403 },
      );
    }

    const body: unknown = await req.json();
    const parsedBody = updateServerSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    // If SSH key is provided, test the connection
    if (parsedBody.data.sshKey) {
      try {
        const connectionResult = await sshService.testConnection(
          parsedBody.data.address ?? existingServer.address,
          parsedBody.data.sshKey,
          parsedBody.data.username ?? existingServer.username,
          parsedBody.data.port ?? existingServer.port,
        );

        if (!connectionResult.success) {
          return NextResponse.json(
            {
              error: "SSH connection failed",
              message: connectionResult.message,
              details: `Unable to connect to the server. Please verify your server address, SSH key, username, and port.`,
            },
            { status: 400 },
          );
        }
      } catch (error) {
        console.error("SSH connection test error:", error);

        // Provide a detailed error message
        const errorMessage =
          error instanceof Error
            ? error.message
            : "SSH key validation failed - please check the format";

        // Additional help for common SSH key issues
        let helperText = "";
        if (errorMessage.includes("format")) {
          helperText =
            "Make sure your SSH key includes the BEGIN and END markers with proper line breaks.";
        } else if (errorMessage.includes("connect")) {
          helperText =
            "Please check that the server address is correct and the server is running.";
        } else if (errorMessage.includes("authentication")) {
          helperText =
            "Authentication failed. Make sure you are using the correct private key for this server.";
        }

        return NextResponse.json(
          {
            error: "SSH connection failed",
            message: errorMessage,
            details: helperText,
          },
          { status: 400 },
        );
      }
    }

    // Filter out undefined values to satisfy exactOptionalPropertyTypes
    const updateData = Object.fromEntries(
      Object.entries(parsedBody.data).filter(
        ([_, value]) => value !== undefined,
      ),
    );
    const updatedServer = await storage.updateServer(serverId, updateData);

    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error("Error updating server:", error);
    return NextResponse.json(
      { error: "Failed to update server" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;
    const serverId = parseInt(id, 10);

    if (isNaN(serverId)) {
      return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
    }

    const existingServer = await storage.getServer(serverId);

    if (!existingServer) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Verify the server belongs to the current user
    if (existingServer.userId !== userId) {
      return NextResponse.json(
        { error: "You do not have permission to delete this server" },
        { status: 403 },
      );
    }

    await storage.deleteServer(serverId);

    return NextResponse.json(
      { message: "Server deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting server:", error);
    return NextResponse.json(
      { error: "Failed to delete server" },
      { status: 500 },
    );
  }
}
