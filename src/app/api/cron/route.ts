import { scheduler } from "@/lib/scheduler";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Initialize the scheduler when the API route is called
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Only allow authenticated users to initialize the scheduler
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    await scheduler.initialize();
    return NextResponse.json({
      success: true,
      message: "Scheduler initialized successfully",
    });
  } catch (error) {
    console.error("Failed to initialize scheduler:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to initialize scheduler",
        error: String(error),
      },
      { status: 500 },
    );
  }
}

// Run a script immediately
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    // Only allow authenticated users to run scripts
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await req.json()) as { eventId?: unknown };
    const { eventId } = body;

    if (!eventId) {
      return NextResponse.json(
        { success: false, message: "Script ID is required" },
        { status: 400 },
      );
    }

    const result = await scheduler.runScriptImmediately(Number(eventId));

    return NextResponse.json({
      success: true,
      message: result.success
        ? "Script executed successfully"
        : "Script execution failed",
      result,
    });
  } catch (error) {
    console.error("Failed to run script:", error);
    return NextResponse.json(
      { success: false, message: "Failed to run script", error: String(error) },
      { status: 500 },
    );
  }
}
