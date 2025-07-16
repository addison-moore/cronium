import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs, events, users } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { executionId } = await params;

    // Get job details
    const job = await db
      .select({
        id: jobs.id,
        eventId: jobs.eventId,
        userId: jobs.userId,
        metadata: jobs.metadata,
        payload: jobs.payload,
        priority: jobs.priority,
        status: jobs.status,
      })
      .from(jobs)
      .where(eq(jobs.id, executionId))
      .limit(1);

    if (!job || job.length === 0) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }

    const jobData = job[0];

    // Get event details if available
    let eventData = null;
    if (jobData.eventId) {
      const event = await db
        .select({
          id: events.id,
          name: events.name,
          type: events.type,
          content: events.content,
          runLocation: events.runLocation,
          serverId: events.serverId,
        })
        .from(events)
        .where(eq(events.id, jobData.eventId))
        .limit(1);

      if (event && event.length > 0) {
        eventData = event[0];
      }
    }

    // Get user details if available
    let userData: {
      id: string;
      email: string | null;
      name: string | null;
    } | null = null;
    if (jobData.userId) {
      const user = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, jobData.userId))
        .limit(1);

      if (user && user.length > 0) {
        userData = user[0];
      }
    }

    // Build execution context
    const metadata: Record<string, unknown> = {};

    // Safely merge metadata
    if (jobData.metadata && typeof jobData.metadata === "object") {
      Object.assign(metadata, jobData.metadata);
    }

    // Safely merge payload
    if (jobData.payload && typeof jobData.payload === "object") {
      Object.assign(metadata, jobData.payload);
    }

    const executionContext = {
      executionId,
      jobId: jobData.id,
      eventId: jobData.eventId,
      userId: jobData.userId,
      metadata,
      event: eventData
        ? {
            id: eventData.id,
            name: eventData.name,
            type: eventData.type,
            content: eventData.content,
            runLocation: eventData.runLocation,
            serverId: eventData.serverId,
          }
        : null,
      user: userData
        ? {
            id: userData.id,
            email: userData.email ?? null,
            name: userData.name ?? null,
          }
        : null,
    };

    return NextResponse.json(executionContext);
  } catch (error) {
    console.error("Error fetching execution context:", error);
    console.error(
      "Stack trace:",
      error instanceof Error ? error.stack : "No stack trace",
    );
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
