import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import { LogStatus } from "@/shared/schema";

// Run an event immediately
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
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
    // Unwrap params since it's a Promise in Next.js 15
    const unwrappedParams = await params;
    const eventId = parseInt(unwrappedParams.id, 10);

    if (isNaN(eventId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid event ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the event exists and belongs to this user
    const event = await storage.getEvent(eventId);

    if (!event) {
      return new NextResponse(JSON.stringify({ error: "Script not found" }), {
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

    // Create a log entry for this manual execution
    const log = await storage.createLog({
      eventId,
      userId,
      output: "Manual event execution started...",
      status: LogStatus.RUNNING,
      startTime: new Date(),
      eventName: event.name,
      scriptType: event.type,
      retries: 0,
    });

    // Execute the event asynchronously
    executeScriptAsync(eventId, log.id);

    return NextResponse.json({
      message: "Script execution started",
      logId: log.id,
    });
  } catch (error) {
    console.error(`Error running event:`, error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}

// Helper function to execute the event asynchronously
async function executeScriptAsync(eventId: number, logId: number) {
  try {
    // Get the event with all relations
    const event = await storage.getEventWithRelations(eventId);
    if (!event) {
      throw new Error("Script not found");
    }

    // Add existing logId to event object to prevent duplicate log creation
    const eventWithLogId = {
      ...event,
      existingLogId: logId,
    };

    // Run the event using the scheduler with the existing log ID
    const result = await scheduler.executeScript(eventWithLogId);

    return result;
  } catch (error) {
    console.error(`Error executing event ${eventId}:`, error);

    // Update the log with the error
    await storage.updateLog(logId, {
      status: LogStatus.FAILURE,
      output: error instanceof Error ? error.message : "Unknown error occurred",
      endTime: new Date(),
      successful: false,
    });

    throw error;
  }
}
