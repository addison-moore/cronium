import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { logs, LogStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";

// Stream job logs
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const body = (await request.json()) as {
      logs: Array<{
        timestamp: string;
        level: "info" | "error" | "warn" | "debug";
        message: string;
        source?: "stdout" | "stderr";
      }>;
      orchestratorId: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    if (!body.logs || !Array.isArray(body.logs)) {
      return NextResponse.json(
        { error: "Logs array required" },
        { status: 400 },
      );
    }

    // Verify job exists
    const job = await jobService.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify the orchestrator owns this job
    if (job.orchestratorId !== body.orchestratorId) {
      return NextResponse.json(
        { error: "Job not owned by this orchestrator" },
        { status: 403 },
      );
    }

    // Insert logs
    if (body.logs.length > 0) {
      const logEntries = body.logs.map((log) => ({
        eventId: job.eventId,
        userId: job.userId,
        jobId: jobId,
        output: log.message,
        error: log.source === "stderr" ? log.message : null,
        startTime: new Date(log.timestamp),
        status: LogStatus.RUNNING,
        successful: log.level !== "error",
      }));

      await db.insert(logs).values(logEntries);
    }

    return NextResponse.json({
      success: true,
      count: body.logs.length,
    });
  } catch (error) {
    console.error("Error streaming job logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Get job logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Get logs for this job
    const jobLogs = await db
      .select()
      .from(logs)
      .where(eq(logs.jobId, jobId))
      .orderBy(logs.startTime);

    return NextResponse.json({ logs: jobLogs });
  } catch (error) {
    console.error("Error fetching job logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
