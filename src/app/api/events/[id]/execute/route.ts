import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateApiRequest } from "@/lib/api-auth";
import { LogStatus } from "@/shared/schema";

// Helper function to execute the event asynchronously
async function executeEventAsync(
  eventId: number,
  logId: number,
  envVars: Record<string, string> = {},
  inputData: Record<string, any> = {},
) {
  try {
    // Get the event with all relations
    const event = await storage.getEventWithRelations(eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    // Add existing logId to event object to prevent duplicate log creation
    const eventWithLogId = {
      ...event,
      existingLogId: logId,
      envVars: { ...event.envVars, ...envVars }, // Merge provided env vars with event's env vars
    };

    // Import and use executeScript function directly to pass input data
    const { executeScript } = await import("@/lib/scheduler/execute-script");
    const result = await executeScript(
      eventWithLogId,
      new Set<number>(), // Empty set for executing events
      async () => {}, // Empty success handler
      async () => {}, // Empty failure handler
      async () => {}, // Empty always handler
      async () => {}, // Empty condition handler
      async () => {}, // Empty execution count handler
      inputData, // Pass the input data here
      undefined, // No workflow ID for direct execution
    );

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

// Helper function to authenticate user via session or API token
async function authenticateUser(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  // First try API token
  const apiAuth = await authenticateApiRequest(request);

  if (apiAuth.authenticated && apiAuth.userId) {
    return { userId: apiAuth.userId };
  }

  // Then try session
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return { userId: session.user.id };
  }

  // No authentication found
  return null;
}

// POST to execute an event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = auth.userId;
    const unwrappedParams = await params;
    const eventId = parseInt(unwrappedParams.id, 10);

    if (isNaN(eventId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid event ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the event exists
    const event = await storage.getEvent(eventId);

    if (!event) {
      return new NextResponse(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the user has permission to execute this event
    const canEdit = await storage.canEditEvent(eventId, userId);
    if (!canEdit) {
      return new NextResponse(
        JSON.stringify({
          error: "Unauthorized. You can only execute events you created.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Parse optional environment variables and input data from request body
    let envVars = {};
    let inputData = {};
    try {
      const body = await request.json().catch(() => ({}));
      envVars = body.envVars || {};
      inputData = body.input || {};
    } catch {
      // Ignore parsing errors for body, use empty vars
    }

    // Create a log entry for this API execution
    const log = await storage.createLog({
      eventId,
      userId,
      output: "API event execution started...",
      status: LogStatus.RUNNING,
      startTime: new Date(),
      eventName: event.name,
      scriptType: event.type,
      retries: 0,
    });

    // Execute the event asynchronously using the scheduler
    executeEventAsync(eventId, log.id, envVars, inputData);

    return NextResponse.json({
      success: true,
      message: "Event execution started",
      eventId: eventId,
      executionId: log.id,
      logId: log.id,
      status: "RUNNING",
    });
  } catch (error) {
    console.error("Error in event execution endpoint:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
