import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage, type LogFilters } from "@/server/storage";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import { z } from "zod";
import { LogStatus } from "@/shared/schema";
import { failureWithStack } from "@/lib/pg-errors";

const MAX_PAGE_SIZE = 100;

function positiveInt(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRestPrincipal(req, "view");

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const status = searchParams.get("status");
    const date = searchParams.get("date");
    const workflowId = searchParams.get("workflowId");
    const ownEventsOnly = searchParams.get("ownEventsOnly") === "true";
    const sharedOnly = searchParams.get("sharedOnly") === "true";
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(
      positiveInt(searchParams.get("pageSize"), 20),
      MAX_PAGE_SIZE,
    );

    // Build filter object for database query
    const filters: LogFilters = {};

    // Add eventId filter if provided
    if (eventId) {
      const parsedEventId = positiveInt(eventId, 0);
      if (!parsedEventId) {
        return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
      }

      // Check if the user has access to this script
      const script = await storage.getEvent(parsedEventId);

      if (!script) {
        return NextResponse.json(
          { error: "Script not found" },
          { status: 404 },
        );
      }

      if (script.userId !== auth.userId) {
        return NextResponse.json(
          { error: "Unauthorized access to script" },
          { status: 403 },
        );
      }

      filters.eventId = String(parsedEventId);
    }

    // Add status filter if provided
    if (status && Object.values(LogStatus).includes(status as LogStatus)) {
      filters.status = status as LogStatus;
    }

    // Add date filter if provided
    if (date) {
      filters.date = date;
    }

    // Add workflow filter if provided
    if (workflowId && workflowId !== "all") {
      if (workflowId === "none") {
        filters.workflowId = null;
      } else {
        const parsedWorkflowId = positiveInt(workflowId, 0);
        if (!parsedWorkflowId) {
          return NextResponse.json(
            { error: "Invalid workflowId" },
            { status: 400 },
          );
        }
        filters.workflowId = parsedWorkflowId;
      }
    }

    // Always filter by current user
    filters.userId = auth.userId;
    filters.ownEventsOnly = ownEventsOnly;
    filters.sharedOnly = sharedOnly;

    try {
      // Use the new filters in the storage method
      const { logs, total } = await storage.getFilteredLogs(
        filters,
        pageSize,
        page,
      );

      return NextResponse.json({
        logs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error("Error filtering logs:", failureWithStack(error));
      return NextResponse.json(
        { error: "Failed to filter logs" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error fetching logs:", failureWithStack(error));
    return NextResponse.json(
      { error: "Failed to fetch logs" },
      { status: 500 },
    );
  }
}

const createLogSchema = z.object({
  eventId: z.number(),
  status: z.nativeEnum(LogStatus),
  output: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRestPrincipal(req, "edit");

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }

    const body: unknown = await req.json();

    const parsedBody = createLogSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    // Check if the user has access to this script
    const script = await storage.getEvent(parsedBody.data.eventId);

    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    if (script.userId !== auth.userId) {
      return NextResponse.json(
        { error: "Unauthorized access to script" },
        { status: 403 },
      );
    }

    // Create the log with validated data
    const log = await storage.createLog({
      ...parsedBody.data,
      startTime: parsedBody.data.startTime
        ? new Date(parsedBody.data.startTime)
        : new Date(),
      endTime: parsedBody.data.endTime
        ? new Date(parsedBody.data.endTime)
        : undefined,
    });

    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    console.error("Error creating log:", failureWithStack(error));
    return NextResponse.json(
      { error: "Failed to create log" },
      { status: 500 },
    );
  }
}
