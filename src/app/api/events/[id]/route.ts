import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RunLocation } from "@/shared/schema";
import { authenticateApiRequest } from "@/lib/api-auth";

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

  // For session authentication, we need to properly handle cookies
  // Create a Request object with proper headers for getServerSession
  const headers = new Headers();
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  try {
    // Try to get session with proper request context
    const session = await getServerSession({
      ...authOptions,
      callbacks: {
        ...authOptions.callbacks,
        // Simplified session callback for API routes
        session: async ({ session, token }) => {
          if (token?.id && session?.user) {
            session.user.id = token.id as string;
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
  // API requests should fail with 401 if no valid auth is provided
  if (!isApiRequest) {
    try {
      const allUsers = await storage.getAllUsers();
      if (allUsers.length > 0) {
        // Use the first admin user for development browser sessions
        const adminUser =
          allUsers.find((u) => u.role === "ADMIN") || allUsers[0];
        if (!adminUser) {
          throw new Error("No admin user found for development session");
        }
        return { userId: adminUser.id };
      }
    } catch (error) {
      console.error("Fallback user lookup failed:", error);
    }
  }

  // No authentication found
  return null;
}

// GET a specific script
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  console.log("PATCH request received for event ID:", id);
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = auth.userId;
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

    // Update the script
    const updatedScript = await storage.updateScript(eventId, body);

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

    // Handle conditional events
    if (Array.isArray(body.conditionalEvents)) {
      // Delete existing conditional events for this script
      await storage.deleteSuccessEventsByScriptId(eventId);
      await storage.deleteFailEventsByScriptId(eventId);
      await storage.deleteAlwaysEventsByScriptId(eventId);
      await storage.deleteConditionEventsByScriptId(eventId);

      // Add new conditional events
      for (const condEvent of body.conditionalEvents) {
        const eventData: any = {
          type: condEvent.action,
          value: condEvent.details.emailAddresses || "",
          targetEventId: condEvent.details.targetEventId || null,
          toolId: condEvent.details.toolId || null,
          message: condEvent.details.message || null,
          emailAddresses: condEvent.details.emailAddresses || null,
          emailSubject: condEvent.details.emailSubject || null,
        };

        if (condEvent.type === "ON_SUCCESS") {
          eventData.successEventId = eventId;
          await storage.createEvent(eventData);
        } else if (condEvent.type === "ON_FAILURE") {
          eventData.failEventId = eventId;
          await storage.createEvent(eventData);
        } else if (condEvent.type === "ALWAYS") {
          eventData.alwaysEventId = eventId;
          await storage.createEvent(eventData);
        } else if (condEvent.type === "ON_CONDITION") {
          eventData.conditionEventId = eventId;
          await storage.createEvent(eventData);
        }
      }
    }

    // If success events are provided, handle them (legacy support)
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

        await storage.createEvent(sanitizedEvent);
      }
    }

    // If fail events are provided, handle them (legacy support)
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

        await storage.createEvent(sanitizedEvent);
      }
    }

    // Handle multiple server selection for remote events
    if (body.selectedServerIds !== undefined) {
      await storage.setEventServers(eventId, body.selectedServerIds || []);
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
  { params }: { params: Promise<{ id: string }> },
) {
  return PATCH(request, { params });
}

// DELETE a script
export async function DELETE(
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
  } catch (error: any) {
    console.error("Error deleting script:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
    });
    return new NextResponse(
      JSON.stringify({
        error: "Internal server error",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
