import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { verifyInternalKey } from "@/lib/internal-auth";

// Orchestrator heartbeat
export async function POST(request: NextRequest) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId: string;
      timestamp: string;
      runningJobs?: string[];
      capacity?: {
        maxJobs: number;
        currentJobs: number;
        availableSlots: number;
      };
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    // Persist the latest heartbeat so offline orchestrators can be detected.
    // Stored as a system_settings row (no dedicated table needed).
    await storage.upsertSetting(
      `orchestrator:${body.orchestratorId}:heartbeat`,
      JSON.stringify({
        orchestratorId: body.orchestratorId,
        lastSeenAt: new Date().toISOString(),
        runningJobs: body.runningJobs ?? [],
        capacity: body.capacity ?? null,
      }),
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error processing heartbeat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
