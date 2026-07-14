import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";

// Mark job as completed
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
      status?: string; // Orchestrator sends the status
      output?: string | { stdout: string; stderr: string };
      exitCode?: number;
      metrics?: Record<string, unknown>;
      scriptOutput?: unknown; // Data from cronium.output()
      condition?: boolean; // Condition from cronium.setCondition()
      timestamp: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Determine status based on what orchestrator sends or exit code
    let jobStatus = JobStatus.COMPLETED;
    const exitCode = body.exitCode ?? 0;

    // If orchestrator explicitly sends status, use it
    if (body.status) {
      // Map orchestrator status to our JobStatus enum
      switch (body.status) {
        case "completed":
        case "COMPLETED":
          jobStatus = JobStatus.COMPLETED;
          break;
        case "failed":
        case "FAILED":
          jobStatus = JobStatus.FAILED;
          break;
        case "timeout":
        case "TIMEOUT":
          // Note: JobStatus doesn't have TIMEOUT, so we map to FAILED
          // The timeout will be detected in log status mapping
          jobStatus = JobStatus.FAILED;
          break;
        case "cancelled":
        case "CANCELLED":
          jobStatus = JobStatus.CANCELLED;
          break;
        default:
          // Fallback to exit code check
          jobStatus = exitCode === 0 ? JobStatus.COMPLETED : JobStatus.FAILED;
      }
    } else {
      // No explicit status, determine from exit code
      // Check for timeout exit code (-1)
      if (exitCode === -1) {
        jobStatus = JobStatus.FAILED; // Will be mapped to TIMEOUT in log status
      } else {
        jobStatus = exitCode === 0 ? JobStatus.COMPLETED : JobStatus.FAILED;
      }
    }

    // Handle both formats: string or {stdout, stderr}
    let output: string | undefined;
    let error: string | undefined;
    if (body.output) {
      if (typeof body.output === "string") {
        output = body.output;
      } else {
        // Combine stdout and stderr
        output = body.output.stdout;
        if (body.output.stderr) {
          // Store stderr separately as error if job failed
          if (jobStatus === JobStatus.FAILED) {
            error = body.output.stderr;
            // Add timeout indication to error if detected
            if (
              body.status === "timeout" ||
              body.status === "TIMEOUT" ||
              exitCode === -1
            ) {
              error = "Job execution timed out\n" + (error || "");
            }
          } else {
            // Otherwise combine with stdout
            output += "\n--- STDERR ---\n" + body.output.stderr;
          }
        } else if (
          jobStatus === JobStatus.FAILED &&
          (body.status === "timeout" ||
            body.status === "TIMEOUT" ||
            exitCode === -1)
        ) {
          // No stderr but we have a timeout
          error = "Job execution timed out";
        }
      }
    }

    const updateData: Parameters<typeof jobService.updateJobStatus>[2] = {
      completedAt: new Date(),
      exitCode: exitCode,
    };

    if (output !== undefined) {
      updateData.output = output;
    }

    if (error !== undefined) {
      updateData.error = error;
    }

    if (body.metrics !== undefined) {
      updateData.metrics = body.metrics;
    }

    // Store scriptOutput and condition in the result field
    const result: Record<string, unknown> = {};
    if (body.scriptOutput !== undefined) {
      result.scriptOutput = body.scriptOutput;
    }
    if (body.condition !== undefined) {
      result.condition = body.condition;
    }
    if (exitCode !== undefined) {
      result.exitCode = exitCode;
    }
    if (body.metrics !== undefined) {
      result.metrics = body.metrics;
    }

    // Only add result if we have data to store
    if (Object.keys(result).length > 0) {
      updateData.result = result;
    }

    const updatedJob = await jobService.updateJobStatus(
      jobId,
      jobStatus,
      updateData,
    );

    if (!updatedJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    console.error("Error completing job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
