/**
 * Startup endpoint - called once when the application starts
 * Initializes background services and performs startup tasks
 */

import { NextResponse } from "next/server";
import { initializeCleanupService } from "@/lib/services/workflow-cleanup-service";
import { scheduler } from "@/lib/scheduler";

// Track initialization state
let isInitialized = false;

export async function GET() {
  if (isInitialized) {
    return NextResponse.json({
      status: "already_initialized",
      message: "Application services already initialized",
    });
  }

  try {
    console.log("[Startup] Initializing application services...");

    // 1. Initialize the scheduler
    console.log("[Startup] Initializing scheduler...");
    await scheduler.initialize();

    // 2. Initialize workflow cleanup service
    console.log("[Startup] Starting workflow cleanup service...");
    initializeCleanupService({
      maxWorkflowAge: 30 * 60 * 1000, // 30 minutes max for workflows
      maxJobAge: 15 * 60 * 1000, // 15 minutes max for jobs
      checkInterval: 5 * 60 * 1000, // Check every 5 minutes
    });

    // Mark as initialized
    isInitialized = true;

    console.log("[Startup] All services initialized successfully");

    return NextResponse.json({
      status: "success",
      message: "Application services initialized",
      services: {
        scheduler: true,
        workflowCleanup: true,
      },
    });
  } catch (error) {
    console.error("[Startup] Initialization failed:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "Failed to initialize services",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// Also handle POST for flexibility
export async function POST() {
  return GET();
}
