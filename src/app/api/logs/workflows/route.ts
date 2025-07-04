import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get distinct workflows from logs for the current user
    const workflows = await storage.getDistinctWorkflowsFromLogs(
      session.user.id,
    );

    return NextResponse.json(workflows);
  } catch (error) {
    console.error("Error fetching workflows from logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflows from logs" },
      { status: 500 },
    );
  }
}
