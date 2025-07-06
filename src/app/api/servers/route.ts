import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sshService } from "@/lib/ssh";
import { z } from "zod";

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const servers = await storage.getAllServers(userId);

    return NextResponse.json(servers);
  } catch (error) {
    console.error("Error fetching servers:", error);
    return NextResponse.json(
      { error: "Failed to fetch servers" },
      { status: 500 },
    );
  }
}

const createServerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().min(1, "Address is required"),
  sshKey: z.string().min(1, "SSH Key is required"),
  username: z.string().default("root"),
  port: z.number().default(22),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body: unknown = await req.json();

    const parsedBody = createServerSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    // Test the SSH connection
    try {
      console.log(
        `Testing SSH connection to ${parsedBody.data.address}:${parsedBody.data.port} as ${parsedBody.data.username}`,
      );

      const connectionResult = await sshService.testConnection(
        parsedBody.data.address,
        parsedBody.data.sshKey,
        parsedBody.data.username,
        parsedBody.data.port,
      );

      console.log("SSH test result:", connectionResult);

      if (!connectionResult.success) {
        return NextResponse.json(
          {
            error: "SSH connection failed",
            message: connectionResult.message,
            details: `Unable to connect to ${parsedBody.data.address}. Please verify your server address, SSH key, username, and port.`,
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

    const server = await storage.createServer({
      ...parsedBody.data,
      userId,
    });

    return NextResponse.json(server, { status: 201 });
  } catch (error) {
    console.error("Error creating server:", error);
    return NextResponse.json(
      { error: "Failed to create server" },
      { status: 500 },
    );
  }
}
