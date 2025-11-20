import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { logs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";

// GET details for a specific log
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = session.user.id;
    // For Next.js 15, we need to await params
    const unwrappedParams = await params;
    const logId = parseInt(unwrappedParams.id, 10);

    if (isNaN(logId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid log ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the log
    const [log] = await db.select().from(logs).where(eq(logs.id, logId));

    if (!log) {
      return new NextResponse(JSON.stringify({ error: "Log not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the event belongs to this user
    const event = await storage.getEvent(log.eventId);

    if (!event) {
      return new NextResponse(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.userId !== userId) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return log with additional event info that the UI needs
    return NextResponse.json({
      ...log,
      eventName: String(event.name ?? ""),
      scriptContent: String(event.content ?? ""),
      eventType: event.type,
    });
  } catch (error) {
    console.error(`Error fetching log ${(await params).id}:`, error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
