import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { verifyInternalKey } from "@/lib/internal-auth";

// Report orchestrator metrics
export async function POST(request: NextRequest) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
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

    // Persist the latest metrics snapshot (system_settings row). A full
    // time-series store is future work; this powers a current-state view.
    await storage.upsertSetting(
      `orchestrator:${body.orchestratorId}:metrics`,
      JSON.stringify({
        orchestratorId: body.orchestratorId,
        reportedAt: new Date().toISOString(),
        period: body.period,
        metrics: body.metrics,
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing metrics:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
