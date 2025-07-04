import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RunLocation } from "@/shared/schema";

// GET a specific script
export async function GET(
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
      return new NextResponse(JSON.stringify({ error: "Invalid script ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the script with all its relations
    const script = await storage.getEventWithRelations(eventId);

    if (!script) {
      return new NextResponse(JSON.stringify({ error: "Script not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the user can view this event (they created it or it's shared)
    const canView = await storage.canViewEvent(eventId, userId);
    if (!canView) {
      return new NextResponse(
        JSON.stringify({
          error: "Unauthorized. This event is not shared with you.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return NextResponse.json(script);
  } catch (error) {
    console.error("Error fetching script:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// PATCH to update a script
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  console.log("PATCH request received for event ID:", params.id);
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
      return new NextResponse(JSON.stringify({ error: "Invalid script ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the script exists
    const existingScript = await storage.getEvent(eventId);

    if (!existingScript) {
      return new NextResponse(JSON.stringify({ error: "Script not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the user has permission to edit this event
    const canEdit = await storage.canEditEvent(eventId, userId);
    if (!canEdit) {
      return new NextResponse(
        JSON.stringify({
          error: "Unauthorized. You can only edit events you created.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const body = await request.json();

    // Handle date/time values
    if (body.startTime && typeof body.startTime === "string") {
      body.startTime = new Date(body.startTime);
    }

    // Handle serverId based on runLocation
    // If runLocation is LOCAL, explicitly set serverId to null
    if (body.runLocation === RunLocation.LOCAL) {
      body.serverId = null;
    }

    // Handle HTTP request data if provided
    if (body.httpRequest && typeof body.httpRequest === "string") {
      try {
        const httpRequestData = JSON.parse(body.httpRequest);
        body.httpMethod = httpRequestData.method;
        body.httpUrl = httpRequestData.url;
        body.httpHeaders = JSON.stringify(httpRequestData.headers);
        body.httpBody = httpRequestData.body;
      } catch (parseError) {
        console.error(
          `Error parsing HTTP request data for event ${eventId}:`,
          parseError,
        );
      }
    }

    // Special handling for scheduleUnit to ensure SECONDS is preserved
    if (body.scheduleUnit) {
      // Normalize the scheduleUnit value to uppercase enum format
      const normalizedUnit = String(body.scheduleUnit).toUpperCase();
      if (["SECONDS", "MINUTES", "HOURS", "DAYS"].includes(normalizedUnit)) {
        body.scheduleUnit = normalizedUnit;
      } else if (normalizedUnit.includes("SECOND")) {
        body.scheduleUnit = "SECONDS";
      } else if (normalizedUnit.includes("MINUTE")) {
        body.scheduleUnit = "MINUTES";
      } else if (normalizedUnit.includes("HOUR")) {
        body.scheduleUnit = "HOURS";
      } else if (normalizedUnit.includes("DAY")) {
        body.scheduleUnit = "DAYS";
      }
    }

    // Special handling for status to ensure it's properly set
    if (body.status) {
      // Normalize the status value to uppercase enum format
      const normalizedStatus = String(body.status).toUpperCase();
      if (["ACTIVE", "PAUSED", "DRAFT"].includes(normalizedStatus)) {
        body.status = normalizedStatus;
      } else if (normalizedStatus.includes("ACTIVE")) {
        body.status = "ACTIVE";
      } else if (normalizedStatus.includes("PAUSE")) {
        body.status = "PAUSED";
      } else if (normalizedStatus.includes("DRAFT")) {
        body.status = "DRAFT";
      }
    }

    // Fix boolean fields handling to ensure they are processed as true booleans
    if ("resetCounterOnActive" in body) {
      // Explicitly force the value to be a proper boolean, needed for PostgreSQL
      body.resetCounterOnActive = body.resetCounterOnActive === true;
    }

    // If env vars are provided, handle them
    if (Array.isArray(body.envVars)) {
      // Delete existing env vars
      await storage.deleteEnvVarsByEventId(eventId);

      // Add new env vars
      for (const envVar of body.envVars) {
        await storage.createEnvVar({
          eventId,
          key: envVar.key,
          value: envVar.value,
        });
      }
    }

    // If success events are provided, handle them
    if (Array.isArray(body.onSuccessEvents)) {
      // Delete only existing success events
      await storage.deleteSuccessEventsByScriptId(eventId);

      // Add new success events
      for (const event of body.onSuccessEvents) {
        // Ensure event data is properly sanitized
        const sanitizedEvent = {
          type: event.type,
          value: typeof event.value === "string" ? event.value : "",
          successEventId: eventId,
          targetEventId: event.targetScriptId
            ? parseInt(String(event.targetScriptId), 10)
            : null,
        };

        // Skip invalid events
        if (!sanitizedEvent.type) {
          continue;
        }

        await storage.createAction(sanitizedEvent);
      }
    }

    // If fail events are provided, handle them
    if (Array.isArray(body.onFailEvents)) {
      // Delete only existing fail events for this script
      await storage.deleteFailEventsByScriptId(eventId);

      // Add new fail events
      for (const event of body.onFailEvents) {
        // Ensure event data is properly sanitized
        const sanitizedEvent = {
          type: event.type,
          value: typeof event.value === "string" ? event.value : "",
          failEventId: eventId,
          targetEventId: event.targetScriptId
            ? parseInt(String(event.targetScriptId), 10)
            : null,
        };

        // Skip invalid events
        if (!sanitizedEvent.type) {
          continue;
        }

        await storage.createAction(sanitizedEvent);
      }
    }

    // Get the full updated script with all relations
    const fullScript = await storage.getEventWithRelations(eventId);

    return NextResponse.json(fullScript);
  } catch (error) {
    console.error("Error updating script:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// PUT method to support legacy clients - identical to PATCH
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return PATCH(request, { params });
}

// DELETE a script
export async function DELETE(
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
    const { id } = await params;
    const eventId = parseInt(id, 10);

    if (isNaN(eventId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid script ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the script exists
    const existingScript = await storage.getEvent(eventId);

    if (!existingScript) {
      return new NextResponse(JSON.stringify({ error: "Script not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the user has permission to delete this event
    const canEdit = await storage.canEditEvent(eventId, userId);
    if (!canEdit) {
      return new NextResponse(
        JSON.stringify({
          error: "Unauthorized. You can only delete events you created.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Delete the script and all related entities (cascade)
    await storage.deleteScript(eventId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting script:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
