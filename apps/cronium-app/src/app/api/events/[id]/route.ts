import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  RunLocation,
  UserRole,
  EventStatus,
  TimeUnit,
  type InsertEvent,
} from "@/shared/schema";
import { authenticateApiRequest } from "@/lib/api-auth";
import { legacyEventPatchSchema } from "@/shared/schemas/events";
import {
  assertEventCapability,
  assertEventRelations,
  assertProposedEventServers,
  resourceAccessHttpStatus,
} from "@/server/security/resource-access";
import { toEventApiDto } from "@/server/security/api-dto";

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

    await assertEventRelations(eventId, userId, "view");

    return NextResponse.json(toEventApiDto(script, userId));
  } catch (error) {
    console.error(
      "Error fetching script:",
      error instanceof Error ? error.message : String(error),
    );
    const accessStatus = resourceAccessHttpStatus(error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: accessStatus ?? 500,
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

    await assertEventCapability(eventId, userId, "edit");

    const requestBody: unknown = await request.json();
    if (
      typeof requestBody !== "object" ||
      requestBody === null ||
      Array.isArray(requestBody)
    ) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const body: Record<string, unknown> = { ...requestBody };

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
          headers?: Array<{ key: string; value: string }>;
          body?: string;
        };
        if (httpRequestData.method !== undefined) {
          body.httpMethod = httpRequestData.method;
        }
        if (httpRequestData.url !== undefined) {
          body.httpUrl = httpRequestData.url;
        }
        if (httpRequestData.headers !== undefined) {
          body.httpHeaders = httpRequestData.headers;
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
    if (typeof body.scheduleUnit === "string") {
      // Normalize the scheduleUnit value to uppercase enum format
      const normalizedUnit = String(body.scheduleUnit).toUpperCase();
      if (["SECONDS", "MINUTES", "HOURS", "DAYS"].includes(normalizedUnit)) {
        body.scheduleUnit = normalizedUnit;
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
    if (typeof body.status === "string") {
      // Normalize the status value to uppercase enum format
      const normalizedStatus = String(body.status).toUpperCase();
      if (["ACTIVE", "PAUSED", "DRAFT"].includes(normalizedStatus)) {
        body.status = normalizedStatus;
      } else if (normalizedStatus.includes("ACTIVE")) {
        body.status = EventStatus.ACTIVE;
      } else if (normalizedStatus.includes("PAUSE")) {
        body.status = EventStatus.PAUSED;
      } else if (normalizedStatus.includes("DRAFT")) {
        body.status = EventStatus.DRAFT;
      }
    }

    // Fix boolean fields handling to ensure they are processed as true booleans
    const parsed = legacyEventPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const {
      envVars,
      selectedServerIds,
      httpRequest: _httpRequest,
      startTime,
      ...allowedFields
    } = parsed.data;
    void _httpRequest;
    await assertProposedEventServers(
      userId,
      allowedFields.serverId,
      selectedServerIds,
    );

    // Explicit allowed-field mapping is provided by the strict schema above;
    // owner, source, counters and every unknown security field are rejected.
    const filteredAllowedFields = Object.fromEntries(
      Object.entries(allowedFields).filter(([, value]) => value !== undefined),
    ) as Partial<InsertEvent>;
    await storage.updateScript(eventId, {
      ...filteredAllowedFields,
      ...(startTime !== undefined && {
        startTime: startTime ? new Date(startTime) : null,
      }),
    });

    // If env vars are provided, handle them
    if (envVars !== undefined) {
      // Delete existing env vars
      await storage.deleteEnvVarsByEventId(eventId);

      // Add new env vars
      for (const envVar of envVars) {
        await storage.createEnvVar({
          eventId,
          key: envVar.key,
          value: envVar.value,
        });
      }
    }

    // Handle multiple server selection for remote events
    if (selectedServerIds !== undefined) {
      await storage.setEventServers(eventId, selectedServerIds, userId);
    }

    // Get the full updated script with all relations
    const fullScript = await storage.getEventWithRelations(eventId);

    return NextResponse.json(
      fullScript ? toEventApiDto(fullScript, userId) : null,
    );
  } catch (error) {
    console.error(
      "Error updating script:",
      error instanceof Error ? error.message : String(error),
    );
    const accessStatus = resourceAccessHttpStatus(error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: accessStatus ?? 500,
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

    await assertEventCapability(eventId, userId, "edit");

    // Delete the script and all related entities (cascade)
    await storage.deleteScript(eventId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting script:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const accessStatus = resourceAccessHttpStatus(error);
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
        status: accessStatus ?? 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
