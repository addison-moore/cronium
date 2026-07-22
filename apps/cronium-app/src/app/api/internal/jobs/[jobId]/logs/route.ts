import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { logs, LogStatus } from "@/shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";
import {
  authorizeCapability,
  assertJobScope,
} from "@/lib/security/internal-route-auth";

// Stream job logs
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;

    // Per-job capability (HI-10) replaces the shared internal key here.
    const auth = authorizeCapability(request, "job:logs");
    if (!auth.ok) return auth.response;
    const scopeError = assertJobScope(auth.cap, jobId);
    if (scopeError) return scopeError;

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
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Per-job capability (HI-10): reading a job's logs now requires a token
    // scoped to that job — closes the previously unauthenticated GET.
    const auth = authorizeCapability(request, "job:logs");
    if (!auth.ok) return auth.response;
    const scopeError = assertJobScope(auth.cap, jobId);
    if (scopeError) return scopeError;

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
