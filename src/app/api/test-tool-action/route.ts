import { NextRequest, NextResponse } from "next/server";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import {
  Event,
  EventType,
  EventStatus,
  EventTriggerType,
  ToolType,
} from "@/shared/schema";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq } from "drizzle-orm";

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
      : tools.find((t) => t.isActive) || tools[0];

    if (!testTool) {
      return NextResponse.json(
        {
          success: false,
          error: "Tool not found",
        },
        { status: 404 },
      );
    }

    // Create mock event
    const mockEvent: Event = {
      id: 99999,
      userId: testTool.userId,
      name: "Test Tool Action Event",
      description: "Testing tool action execution",
      type: EventType.TOOL_ACTION,
      schedule: "{}",
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.MANUAL,
      runLocation: "LOCAL" as any,
      serverId: null,
      timeoutValue: 30,
      timeoutUnit: "SECONDS" as any,
      retries: 0,
      maxExecutions: 1,
      executionCount: 0,
      envVars: "[]",
      conditionalEvents: "[]",
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      code: "",
      httpMethod: null,
      httpUrl: null,
      httpHeaders: null,
      httpBody: null,
      pythonVersion: null,
      selectedServerIds: [],
      resetCounterOnActive: false,
      toolActionConfig: null,
    } as Event;

    // Configure based on tool type
    let toolActionConfig: any = {
      toolType: testTool.type,
      toolId: testTool.id,
      actionId: "",
      parameters: {},
    };

    switch (testTool.type) {
      case ToolType.SLACK:
        toolActionConfig.actionId = "slack.send-message";
        toolActionConfig.parameters = {
          channel: "#test",
          message: "Test message from Cronium Tool Action test API",
        };
        break;

      case ToolType.DISCORD:
        toolActionConfig.actionId = "discord.send-message";
        toolActionConfig.parameters = {
          content: "Test message from Cronium Tool Action test API",
        };
        break;

      case ToolType.EMAIL:
        toolActionConfig.actionId = "email.send";
        toolActionConfig.parameters = {
          to: "test@example.com",
          subject: "Test from Cronium",
          body: "This is a test email from the Tool Action test API",
        };
        break;

      default:
        return NextResponse.json(
          {
            success: false,
            error: `Unsupported tool type: ${testTool.type}`,
          },
          { status: 400 },
        );
    }

    mockEvent.toolActionConfig = JSON.stringify(toolActionConfig);

    // Execute the tool action
    const result = await executeToolAction(mockEvent);

    return NextResponse.json({
      success: result.exitCode === 0,
      tool: {
        id: testTool.id,
        name: testTool.name,
        type: testTool.type,
      },
      config: toolActionConfig,
      result: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        data: result.data,
        healthStatus: result.healthStatus,
      },
    });
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
