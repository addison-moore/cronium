import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateApiRequest } from "@/lib/api-auth";
import archiver from "archiver";
import { UserRole } from "@/shared/schema";

// Helper function to authenticate user via session or API token
async function authenticateUser(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  // First try API token
  const apiAuth = await authenticateApiRequest(request);

  if (apiAuth.authenticated && apiAuth.userId) {
    return { userId: apiAuth.userId };
  }

  // Check if this is an API request (has Authorization header or is accessing /api/ endpoints)
  const authHeader = request.headers.get("Authorization");
  const isApiRequest = authHeader !== null || request.url.includes("/api/");

  try {
    // Try to get session with proper request context
    const session = await getServerSession({
      ...authOptions,
      callbacks: {
        ...authOptions.callbacks,
        session: async ({ session, token }) => {
          if (token?.id && session?.user) {
            session.user.id = token.id;
          }
          return session;
        },
      },
    });

    if (session?.user?.id) {
      return { userId: session.user.id };
    }
  } catch (error) {
    console.log("Session auth failed:", error);
  }

  // Only use fallback for browser requests (no Authorization header)
  if (!isApiRequest) {
    try {
      const allUsers = await storage.getAllUsers();
      if (allUsers.length > 0) {
        const adminUser =
          allUsers.find((u) => u.role === UserRole.ADMIN) || allUsers[0];
        if (!adminUser) {
          throw new Error("No admin user found for development session");
        }
        return { userId: adminUser.id };
      }
    } catch (error) {
      console.error("Fallback user lookup failed:", error);
    }
  }

  return null;
}

// Create a ZIP buffer using archiver
async function createZipBuffer(
  files: { name: string; content: string }[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level
    });

    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });

    // Add files to archive
    files.forEach((file) => {
      archive.append(file.content, { name: file.name });
    });

    // Finalize the archive
    archive.finalize();
  });
}

// POST to download events
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { eventIds } = body;

    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return new NextResponse(
        JSON.stringify({ error: "Event IDs are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Fetch all requested events with their relations
    const events = [];
    for (const eventId of eventIds) {
      try {
        const event = await storage.getEventWithRelations(eventId);
        if (event && event.userId === auth.userId) {
          events.push(event);
        }
      } catch (error) {
        console.error(`Error fetching event ${eventId}:`, error);
      }
    }

    if (events.length === 0) {
      return new NextResponse(
        JSON.stringify({ error: "No events found or access denied" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // If only one event, return it as a single JSON file
    if (events.length === 1) {
      const event = events[0];
      const filename = `${event.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${event.id}.json`;

      return new NextResponse(JSON.stringify(event, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Multiple events - create a ZIP file using archiver
    const files = events.map((event) => ({
      name: `${event.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${event.id}.json`,
      content: JSON.stringify(event, null, 2),
    }));

    const zipBuffer = await createZipBuffer(files);
    const timestamp = new Date().toISOString().slice(0, 10);
    const zipFilename = `cronium_events_${timestamp}.zip`;

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
      },
    });
  } catch (error) {
    console.error("Error downloading events:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
