import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { enhancedTransformJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import type { JobType } from "@shared/schema";

// This is an internal API endpoint for the orchestrator to poll jobs
export async function GET(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get orchestrator ID from headers
    const orchestratorId = request.headers.get("x-orchestrator-id");
    if (!orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get("batchSize") ?? "10");
    const jobTypesParam = searchParams.get("jobTypes");
    const jobTypes = jobTypesParam
      ? (jobTypesParam.split(",") as JobType[])
      : undefined;

    // Claim jobs for this orchestrator
    const jobs = await jobService.claimJobs(
      orchestratorId,
      batchSize,
      jobTypes,
    );

    // Transform jobs to the format expected by the orchestrator
    const transformedJobs = await enhancedTransformJobsForOrchestrator(jobs);

    // Log job types for debugging
    transformedJobs.forEach((job) => {
      console.log(
        `[Job Queue API] Job ${job.id} - Type: ${job.type}, Target:`,
        job.execution?.target,
      );
    });

    return NextResponse.json({
      jobs: transformedJobs,
      count: transformedJobs.length,
    });
  } catch (error) {
    console.error("Error fetching job queue:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Acknowledge job receipt
export async function POST(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      jobId: string;
      status: string;
      result?: {
        exitCode?: number;
        output?: string;
        error?: string;
        metrics?: Record<string, unknown>;
      };
      error?: string;
    };
    const { jobId, status } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    let updatedJob;
    if (status === "started") {
      updatedJob = await jobService.startJob(jobId);
    } else if (status === "completed") {
      updatedJob = await jobService.completeJob(jobId, body.result);
    } else if (status === "failed") {
      updatedJob = await jobService.failJob(
        jobId,
        body.error ?? "Unknown error",
      );
    } else {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (!updatedJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: updatedJob });
  } catch (error) {
    console.error("Error updating job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
