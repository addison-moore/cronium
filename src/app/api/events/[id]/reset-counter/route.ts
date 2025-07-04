import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { events } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const eventId = parseInt(resolvedParams.id);

    if (isNaN(eventId)) {
      return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    }

    // Reset the execution count to 0
    await db
      .update(events)
      .set({ executionCount: 0 })
      .where(eq(events.id, eventId));

    return NextResponse.json(
      { success: true, message: "Execution counter reset successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error resetting counter:", error);
    return NextResponse.json(
      { error: "Failed to reset execution counter" },
      { status: 500 },
    );
  }
}
