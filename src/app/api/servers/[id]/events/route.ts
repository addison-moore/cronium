import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";

export async function GET(
  request: NextRequest,
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

    // Fetch events that are configured to run on this server
    const events = await storage.getEventsByServerId(serverId, session.user.id);

    return NextResponse.json(events);
  } catch (error) {
    console.error("Error fetching server events:", error);
    return NextResponse.json(
      { error: "Failed to fetch server events" },
      { status: 500 },
    );
  }
}
