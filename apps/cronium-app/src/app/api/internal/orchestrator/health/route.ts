import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { storage } from "@/server/storage";
import { verifyOrchestratorKey } from "@/lib/internal-auth";

// Health check endpoint
export async function GET(request: NextRequest) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyOrchestratorKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check database connectivity
    await db.execute(sql`SELECT 1`);

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: "Database connection failed",
      },
      { status: 503 },
    );
  }
}

// Report orchestrator health
export async function POST(request: NextRequest) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyOrchestratorKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId: string;
      status: "healthy" | "degraded" | "unhealthy";
      timestamp: string;
      metrics?: {
        cpuUsage?: number;
        memoryUsage?: number;
        activeJobs?: number;
        queuedJobs?: number;
      };
      errors?: string[];
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    // Persist the latest health report (system_settings row)
    await storage.upsertSetting(
      `orchestrator:${body.orchestratorId}:health`,
      JSON.stringify({
        orchestratorId: body.orchestratorId,
        status: body.status,
        reportedAt: new Date().toISOString(),
        metrics: body.metrics ?? null,
        errors: body.errors ?? [],
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing health report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
