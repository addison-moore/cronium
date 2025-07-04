import { NextResponse } from "next/server";
import { scheduler } from "@/lib/scheduler";
import { initializeSystemTemplates } from "@/lib/template-seeding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Initialize services when the API route is called
export async function GET() {
  try {
    // Initialize system templates first
    await initializeSystemTemplates();

    // Initialize the scheduler
    await scheduler.initialize();

    return NextResponse.json({
      success: true,
      message: "Services initialized successfully",
    });
  } catch (error) {
    console.error("Failed to initialize services:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to initialize services",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
