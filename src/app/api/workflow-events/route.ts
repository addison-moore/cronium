import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { workflowNodes } from "@/shared/schema";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all workflow-event relationships for the current user
    const workflowEventRelations = await db
      .select({
        workflowId: workflowNodes.workflowId,
        eventId: workflowNodes.eventId,
      })
      .from(workflowNodes);

    return NextResponse.json(workflowEventRelations);
  } catch (error) {
    console.error("Error fetching workflow events:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflow events" },
      { status: 500 },
    );
  }
}
