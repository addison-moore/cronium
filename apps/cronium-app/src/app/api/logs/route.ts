import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage, type LogFilters } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { LogStatus } from "@/shared/schema";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const status = searchParams.get("status");
    const date = searchParams.get("date");
    const workflowId = searchParams.get("workflowId");
    const ownEventsOnly = searchParams.get("ownEventsOnly") === "true";
    const sharedOnly = searchParams.get("sharedOnly") === "true";
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = parseInt(searchParams.get("pageSize") ?? "20");

    // Build filter object for database query
    const filters: LogFilters = {};

    // Add eventId filter if provided
    if (eventId) {
      // Check if the user has access to this script
      const script = await storage.getEvent(parseInt(eventId));

      if (!script) {
        return NextResponse.json(
          { error: "Script not found" },
          { status: 404 },
        );
      }

      if (script.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Unauthorized access to script" },
          { status: 403 },
        );
      }

      filters.eventId = eventId;
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
        filters.workflowId = parseInt(workflowId);
      }
    }

    // Always filter by current user
    filters.userId = session.user.id;
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
      console.error("Error filtering logs:", error);
      return NextResponse.json(
        { error: "Failed to filter logs" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error fetching logs:", error);
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
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    if (script.userId !== session.user.id) {
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
    console.error("Error creating log:", error);
    return NextResponse.json(
      { error: "Failed to create log" },
      { status: 500 },
    );
  }
}
