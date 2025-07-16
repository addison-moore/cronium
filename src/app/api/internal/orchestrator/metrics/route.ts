import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Report orchestrator metrics
export async function POST(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId: string;
      timestamp: string;
      metrics: {
        jobsProcessed: number;
        jobsSucceeded: number;
        jobsFailed: number;
        averageExecutionTime: number;
        cpuUsage: number;
        memoryUsage: number;
        diskUsage: number;
        activeContainers: number;
        queueDepth: number;
      };
      period: "minute" | "hour" | "day";
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    if (!body.metrics) {
      return NextResponse.json({ error: "Metrics required" }, { status: 400 });
    }

    // TODO: Store metrics in time-series database or aggregate in cache
    // For now, just log them
    console.log("Orchestrator metrics:", body);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing metrics:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
