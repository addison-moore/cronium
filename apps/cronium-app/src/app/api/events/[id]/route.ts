import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import {
  RunLocation,
  EventStatus,
  TimeUnit,
  type InsertEvent,
} from "@/shared/schema";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import { NO_SERVERS_MESSAGE, saveStrandsEvent } from "@/shared/event-servers";
import { legacyEventPatchSchema } from "@/shared/schemas/events";
import {
  assertEventCapability,
  assertEventRelations,
  assertProposedEventServers,
  resourceAccessHttpStatus,
} from "@/server/security/resource-access";
import { toEventApiDto } from "@/server/security/api-dto";
import { canReadEnvVarValues } from "@/server/token-scopes";
import { scheduler } from "@/lib/scheduler";
import { touchesEventSchedule } from "@/lib/scheduling/materialize";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";
import { readEventSaveBody } from "@/lib/request-body";

// GET a specific script
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRestPrincipal(
      request,
      "view",
      "events.getById",
    );

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
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

    return NextResponse.json(
      toEventApiDto(script, userId, {
        revealEnvVarValues: canReadEnvVarValues(auth.scopes),
      }),
    );
  } catch (error) {
    console.error("Error fetching script:", describeFailure(error));
    const accessStatus = resourceAccessHttpStatus(error);
    return new NextResponse(
      JSON.stringify({
        error: accessStatus ? "Access denied" : "Internal server error",
      }),
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
  try {
    const auth = await authenticateRestPrincipal(
      request,
      "edit",
      "events.update",
    );

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
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

    const read = await readEventSaveBody(request);
    if (!read.ok) return read.response;

    const requestBody = read.body;
    if (
      typeof requestBody !== "object" ||
      requestBody === null ||
      Array.isArray(requestBody)
    ) {
      return NextResponse.json(
        { error: "Request body must be a JSON object under 10 MB" },
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
          describeFailure(parseError),
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

    const current = await storage.getEventWithRelations(eventId);
    if (
      current &&
      saveStrandsEvent(current, { ...allowedFields, selectedServerIds })
    ) {
      return NextResponse.json({ error: NO_SERVERS_MESSAGE }, { status: 400 });
    }

    // Explicit allowed-field mapping is provided by the strict schema above;
    // owner, source, counters and every unknown security field are rejected.
    const filteredAllowedFields = Object.fromEntries(
      Object.entries(allowedFields).filter(([, value]) => value !== undefined),
    ) as Partial<InsertEvent>;
    await storage.updateScript(
      eventId,
      {
        ...filteredAllowedFields,
        ...(startTime !== undefined && {
          startTime: startTime ? new Date(startTime) : null,
        }),
      },
      { envVars, serverIds: selectedServerIds, userId },
    );

    // Without this, pausing over REST kept firing and a new schedule never applied.
    if (touchesEventSchedule(parsed.data)) {
      await scheduler.updateScript(eventId);
    }

    // Get the full updated script with all relations
    const fullScript = await storage.getEventWithRelations(eventId);

    return NextResponse.json(
      fullScript
        ? toEventApiDto(fullScript, userId, {
            revealEnvVarValues: canReadEnvVarValues(auth.scopes),
          })
        : null,
    );
  } catch (error) {
    console.error("Error updating script:", describeFailure(error));
    const accessStatus = resourceAccessHttpStatus(error);
    return new NextResponse(
      JSON.stringify({
        error: accessStatus ? "Access denied" : "Internal server error",
      }),
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
    const auth = await authenticateRestPrincipal(
      request,
      "edit",
      "events.delete",
    );

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
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
    console.error("Error deleting script:", failureWithStack(error));
    const accessStatus = resourceAccessHttpStatus(error);
    return new NextResponse(
      JSON.stringify({
        error: accessStatus ? "Access denied" : "Internal server error",
      }),
      {
        status: accessStatus ?? 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
