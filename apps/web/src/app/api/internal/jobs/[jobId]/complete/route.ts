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
      output?: string | { stdout: string; stderr: string };
      exitCode?: number;
      metrics?: Record<string, unknown>;
      timestamp: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Handle both formats: string or {stdout, stderr}
    let output: string | undefined;
    if (body.output) {
      if (typeof body.output === "string") {
        output = body.output;
      } else {
        // Combine stdout and stderr
        output = body.output.stdout;
        if (body.output.stderr) {
          output += "\n--- STDERR ---\n" + body.output.stderr;
        }
      }
    }

    const updateData: Parameters<typeof jobService.updateJobStatus>[2] = {
      completedAt: new Date(),
      exitCode: body.exitCode ?? 0,
    };

    if (output !== undefined) {
      updateData.output = output;
    }

    if (body.metrics !== undefined) {
      updateData.metrics = body.metrics;
    }

    const updatedJob = await jobService.updateJobStatus(
      jobId,
      JobStatus.COMPLETED,
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
