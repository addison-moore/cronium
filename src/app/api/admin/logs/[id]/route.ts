import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, LogStatus } from "@/shared/schema";
import { z } from "zod";
import { storage } from "@/server/storage";

// Validation schema for updating log status
const UpdateLogSchema = z.object({
  status: z.nativeEnum(LogStatus),
  endTime: z
    .string()
    .datetime()
    .nullable()
    .transform((str) => (str ? new Date(str) : null)),
  successful: z.boolean().optional(),
  error: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Safely unwrap params in Next.js 15
    const unwrappedParams = await params;
    const logId = parseInt(unwrappedParams.id, 10);

    if (isNaN(logId)) {
      return NextResponse.json({ message: "Invalid log ID" }, { status: 400 });
    }

    // Get the log details
    const log = await storage.getLog(logId);

    if (!log) {
      return NextResponse.json({ message: "Log not found" }, { status: 404 });
    }

    // Get script name if available
    let eventName = log.eventName || "";
    let scriptType = "";
    let username = "";

    // If script name isn't in the log, try to get it from the script record
    if (!eventName && log.eventId) {
      const script = await storage.getEvent(log.eventId);
      if (script) {
        eventName = script.name;
        scriptType = script.type;
      }
    }

    // Get username if userId is available
    if (log.userId) {
      const user = await storage.getUser(log.userId);
      if (user) {
        username = user.username || user.email || `User ID: ${user.id}`;
      }
    }

    return NextResponse.json({
      log,
      eventName,
      scriptType,
      username,
    });
  } catch (error) {
    console.error("Error fetching log details:", error);
    return NextResponse.json(
      { message: "An error occurred while fetching log details" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Safely unwrap params in Next.js 15
    const unwrappedParams = await params;
    const logId = parseInt(unwrappedParams.id, 10);

    if (isNaN(logId)) {
      return NextResponse.json({ message: "Invalid log ID" }, { status: 400 });
    }

    // Get the existing log to make sure it exists
    const existingLog = await storage.getLog(logId);

    if (!existingLog) {
      return NextResponse.json({ message: "Log not found" }, { status: 404 });
    }

    // Parse and validate the request body
    const body = await req.json();
    const validatedData = UpdateLogSchema.parse(body);

    // Calculate duration if we're changing the status from RUNNING to something else
    const updateData: Partial<typeof existingLog> = {
      status: validatedData.status,
      endTime: validatedData.endTime ? new Date(validatedData.endTime) : null,
      ...(validatedData.successful !== undefined && {
        successful: validatedData.successful,
      }),
      ...(validatedData.error !== undefined && { error: validatedData.error }),
      ...(validatedData.output !== undefined && {
        output: validatedData.output,
      }),
    };

    if (
      existingLog.status === LogStatus.RUNNING &&
      (validatedData.status === LogStatus.SUCCESS ||
        validatedData.status === LogStatus.FAILURE) &&
      validatedData.endTime &&
      existingLog.startTime
    ) {
      const endTime = new Date(validatedData.endTime);
      const startTime = new Date(existingLog.startTime);
      updateData.duration = endTime.getTime() - startTime.getTime();
    }

    // Update the log
    const updatedLog = await storage.updateLog(logId, updateData);

    return NextResponse.json(updatedLog);
  } catch (error) {
    console.error("Error updating log:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid update data", errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "An error occurred while updating the log" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Safely unwrap params in Next.js 15
    const unwrappedParams = await params;
    const logId = parseInt(unwrappedParams.id, 10);

    if (isNaN(logId)) {
      return NextResponse.json({ message: "Invalid log ID" }, { status: 400 });
    }

    // Check if the log exists
    const existingLog = await storage.getLog(logId);

    if (!existingLog) {
      return NextResponse.json({ message: "Log not found" }, { status: 404 });
    }

    // Delete the log
    await storage.deleteLog(logId);

    return NextResponse.json({ message: "Log deleted successfully" });
  } catch (error) {
    console.error("Error deleting log:", error);
    return NextResponse.json(
      { message: "An error occurred while deleting the log" },
      { status: 500 },
    );
  }
}
