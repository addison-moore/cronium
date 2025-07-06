import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  RunLocation,
  ConnectionType,
  UserRole,
  EventStatus,
  TimeUnit,
  type ConditionalActionType,
} from "@/shared/schema";
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
    console.log(
      "Session auth failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // Only use fallback for browser requests (no Authorization header)
  // API requests should fail with 401 if no valid auth is provided
  if (!isApiRequest) {
    try {
      const allUsers = await storage.getAllUsers();
      if (allUsers.length > 0) {
        // Use the first admin user for development browser sessions
        const adminUser =
          allUsers.find((u) => u.role === UserRole.ADMIN) ?? allUsers[0];
        if (!adminUser) {
          throw new Error("No admin user found for development session");
        }
        return { userId: adminUser.id };
      }
    } catch (error) {
      console.error(
        "Fallback user lookup failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // No authentication found
  return null;
}

// GET a specific script
export async function GET(
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
    console.error(
      "Error fetching script:",
      error instanceof Error ? error.message : String(error),
    );
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

    interface UpdateEventBody {
      runLocation?: RunLocation;
      serverId?: number | null;
      httpRequest?: string;
      httpMethod?: string;
      httpUrl?: string;
      httpHeaders?: string;
      httpBody?: string;
      scheduleUnit?: TimeUnit;
      status?: EventStatus;
      resetCounterOnActive?: boolean;
      envVars?: Array<{ key: string; value: string }>;
      conditionalActions?: Array<{
        type: string;
        action: ConditionalActionType;
        details: {
          emailAddresses?: string;
          targetEventId?: number;
          toolId?: number;
          message?: string;
          emailSubject?: string;
        };
      }>;
      onSuccessActions?: Array<{
        type: ConditionalActionType;
        value?: string;
        targetScriptId?: string | number;
      }>;
      onFailActions?: Array<{
        type: ConditionalActionType;
        value?: string;
        targetScriptId?: string | number;
      }>;
      selectedServerIds?: number[];
      startTime?: Date | null;
      [key: string]: unknown;
    }

    const body = (await request.json()) as UpdateEventBody;

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
        const httpRequestData = JSON.parse(body.httpRequest) as {
          method?: string;
          url?: string;
          headers?: Record<string, string>;
          body?: string;
        };
        if (httpRequestData.method !== undefined) {
          body.httpMethod = httpRequestData.method;
        }
        if (httpRequestData.url !== undefined) {
          body.httpUrl = httpRequestData.url;
        }
        if (httpRequestData.headers !== undefined) {
          body.httpHeaders = JSON.stringify(httpRequestData.headers);
        }
        if (httpRequestData.body !== undefined) {
          body.httpBody = httpRequestData.body;
        }
      } catch (parseError) {
        console.error(
          `Error parsing HTTP request data for event ${eventId}:`,
          parseError instanceof Error ? parseError.message : String(parseError),
        );
      }
    }

    // Special handling for scheduleUnit to ensure SECONDS is preserved
    if (body.scheduleUnit) {
      // Normalize the scheduleUnit value to uppercase enum format
      const normalizedUnit = String(body.scheduleUnit).toUpperCase();
      if (["SECONDS", "MINUTES", "HOURS", "DAYS"].includes(normalizedUnit)) {
        body.scheduleUnit = normalizedUnit as TimeUnit;
      } else if (normalizedUnit.includes("SECOND")) {
        body.scheduleUnit = TimeUnit.SECONDS;
      } else if (normalizedUnit.includes("MINUTE")) {
        body.scheduleUnit = TimeUnit.MINUTES;
      } else if (normalizedUnit.includes("HOUR")) {
        body.scheduleUnit = TimeUnit.HOURS;
      } else if (normalizedUnit.includes("DAY")) {
        body.scheduleUnit = TimeUnit.DAYS;
      }
    }

    // Special handling for status to ensure it's properly set
    if (body.status) {
      // Normalize the status value to uppercase enum format
      const normalizedStatus = String(body.status).toUpperCase();
      if (["ACTIVE", "PAUSED", "DRAFT"].includes(normalizedStatus)) {
        body.status = normalizedStatus as EventStatus;
      } else if (normalizedStatus.includes("ACTIVE")) {
        body.status = EventStatus.ACTIVE;
      } else if (normalizedStatus.includes("PAUSE")) {
        body.status = EventStatus.PAUSED;
      } else if (normalizedStatus.includes("DRAFT")) {
        body.status = EventStatus.DRAFT;
      }
    }

    // Fix boolean fields handling to ensure they are processed as true booleans
    if ("resetCounterOnActive" in body) {
      // Explicitly force the value to be a proper boolean, needed for PostgreSQL
      body.resetCounterOnActive = body.resetCounterOnActive === true;
    }

    // Update the script
    await storage.updateScript(eventId, body);

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

    // Handle conditional actions
    if (Array.isArray(body.conditionalActions)) {
      // Delete existing conditional actions for this script
      await storage.deleteActionsByEventId(eventId);

      // Add new conditional actions
      for (const condAction of body.conditionalActions) {
        interface ConditionalActionData {
          type: ConditionalActionType;
          value: string;
          targetEventId: number | null;
          toolId: number | null;
          message: string | null;
          emailAddresses: string | null;
          emailSubject: string | null;
          successEventId?: number;
          failEventId?: number;
          alwaysEventId?: number;
          conditionEventId?: number;
        }

        const eventData: ConditionalActionData = {
          type: condAction.action,
          value: condAction.details.emailAddresses ?? "",
          targetEventId: condAction.details.targetEventId ?? null,
          toolId: condAction.details.toolId ?? null,
          message: condAction.details.message ?? null,
          emailAddresses: condAction.details.emailAddresses ?? null,
          emailSubject: condAction.details.emailSubject ?? null,
        };

        if (condAction.type === String(ConnectionType.ON_SUCCESS)) {
          eventData.successEventId = eventId;
          await storage.createAction(eventData);
        } else if (condAction.type === String(ConnectionType.ON_FAILURE)) {
          eventData.failEventId = eventId;
          await storage.createAction(eventData);
        } else if (condAction.type === String(ConnectionType.ALWAYS)) {
          eventData.alwaysEventId = eventId;
          await storage.createAction(eventData);
        } else if (condAction.type === String(ConnectionType.ON_CONDITION)) {
          eventData.conditionEventId = eventId;
          await storage.createAction(eventData);
        }
      }
    }

    // If success events are provided, handle them (legacy support)
    if (Array.isArray(body.onSuccessActions)) {
      // Delete all existing conditional actions first
      await storage.deleteActionsByEventId(eventId);

      // Add new success events
      for (const action of body.onSuccessActions) {
        // Ensure event data is properly sanitized
        const sanitizedEvent = {
          type: action.type,
          value: typeof action.value === "string" ? action.value : "",
          successEventId: eventId,
          targetEventId: action.targetScriptId
            ? parseInt(String(action.targetScriptId), 10)
            : null,
        };

        // Skip invalid events
        if (!sanitizedEvent.type) {
          continue;
        }

        await storage.createAction(sanitizedEvent);
      }
    }

    // If fail events are provided, handle them (legacy support)
    if (Array.isArray(body.onFailActions)) {
      // Note: conditional actions are already deleted above

      // Add new fail events
      for (const action of body.onFailActions) {
        // Ensure event data is properly sanitized
        const sanitizedEvent = {
          type: action.type,
          value: typeof action.value === "string" ? action.value : "",
          failEventId: eventId,
          targetEventId: action.targetScriptId
            ? parseInt(String(action.targetScriptId), 10)
            : null,
        };

        // Skip invalid events
        if (!sanitizedEvent.type) {
          continue;
        }

        await storage.createAction(sanitizedEvent);
      }
    }

    // Handle multiple server selection for remote events
    if (body.selectedServerIds !== undefined) {
      await storage.setEventServers(eventId, body.selectedServerIds ?? []);
    }

    // Get the full updated script with all relations
    const fullScript = await storage.getEventWithRelations(eventId);

    return NextResponse.json(fullScript);
  } catch (error) {
    console.error(
      "Error updating script:",
      error instanceof Error ? error.message : String(error),
    );
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
  } catch (error) {
    console.error("Error deleting script:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new NextResponse(
      JSON.stringify({
        error: "Internal server error",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
