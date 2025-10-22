import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";

export async function GET(request: NextRequest) {
  try {
    // Get toolId from query params
    const toolId = request.nextUrl.searchParams.get("toolId");

    // Fetch tools
    const tools = await db.select().from(toolCredentials).limit(5);

    if (tools.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No tools configured",
        },
        { status: 404 },
      );
    }

    // Use specified tool or first active tool
    const testTool = toolId
      ? tools.find((t) => t.id === parseInt(toolId))
      : (tools.find((t) => t.isActive) ?? tools[0]);

    if (!testTool) {
      return NextResponse.json(
        {
          success: false,
          error: "Tool not found",
        },
        { status: 404 },
      );
    }

    // Skip plugin-based action selection on server side
    // TODO: Create server-side action registry
    // For now, we don't support plugin-based actions in test mode
    return NextResponse.json(
      {
        success: false,
        error: `Unsupported tool type: ${testTool.type} - plugin-based actions not supported in test mode`,
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("Test tool action error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
