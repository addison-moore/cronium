/**
 * Initialization endpoint for starting background services
 * This endpoint is called when the app starts
 */

import { NextResponse } from "next/server";
import { initializeCleanupService } from "@/lib/services/workflow-cleanup-service";
import { serverCleanupService } from "@/lib/services/server-cleanup-service";

// Track if services have been initialized
let servicesInitialized = false;

export async function GET() {
  if (servicesInitialized) {
    return NextResponse.json({
      message: "Services already initialized",
      initialized: true,
    });
  }

  try {
    // Initialize workflow cleanup service
    console.log("[Init] Starting workflow cleanup service...");
    initializeCleanupService({
      maxWorkflowAge: 30 * 60 * 1000, // 30 minutes
      maxJobAge: 15 * 60 * 1000, // 15 minutes
      checkInterval: 5 * 60 * 1000, // Check every 5 minutes
    });

    // Initialize server cleanup service
    if (process.env.SERVER_CLEANUP_ENABLED === "true") {
      console.log("[Init] Starting server cleanup service...");
      serverCleanupService.start();
    } else {
      console.log("[Init] Server cleanup service is disabled");
    }

    servicesInitialized = true;

    console.log("[Init] All services initialized successfully");
    return NextResponse.json({
      message: "Services initialized successfully",
      initialized: true,
      services: {
        workflowCleanup: true,
        serverCleanup: process.env.SERVER_CLEANUP_ENABLED === "true",
      },
    });
  } catch (error) {
    console.error("[Init] Failed to initialize services:", error);
    return NextResponse.json(
      {
        error: "Failed to initialize services",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
