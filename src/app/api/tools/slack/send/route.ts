import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptionService } from "@/lib/encryption-service";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { toolId, message } = body;

    if (!toolId || !message) {
      return NextResponse.json(
        { error: "Tool ID and message are required" },
        { status: 400 },
      );
    }

    // Get the Slack tool configuration
    const toolResults = await db
      .select()
      .from(toolCredentials)
      .where(and(eq(toolCredentials.id, toolId), eq(toolCredentials.userId, session.user.id)));

    const tool = toolResults[0];
    if (!tool) {
      return NextResponse.json(
        { error: "Slack tool not found or access denied" },
        { status: 404 },
      );
    }

    if (tool.type !== "SLACK") {
      return NextResponse.json(
        { error: "Tool is not a Slack tool" },
        { status: 400 },
      );
    }

    // Decrypt credentials
    const credentials = JSON.parse(encryptionService.decrypt(tool.credentials));

    if (!credentials.webhookUrl) {
      return NextResponse.json(
        { error: "Webhook URL not found in credentials" },
        { status: 400 },
      );
    }

    // Prepare payload for webhook
    let payload: any;

    // Check if message is JSON (for Slack blocks/attachments)
    if (message.trim().startsWith("{")) {
      try {
        payload = JSON.parse(message);
      } catch (e) {
        // If JSON parsing fails, treat as plain text
        payload = { text: message };
      }
    } else {
      payload = { text: message };
    }

    // Send message to Slack via webhook
    try {
      const response = await fetch(credentials.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return NextResponse.json({
          success: true,
          message: "Slack message sent successfully",
        });
      } else {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Slack webhook error: ${errorText}` },
          { status: 400 },
        );
      }
    } catch (webhookError: any) {
      console.error("Slack webhook error:", webhookError);
      return NextResponse.json(
        { error: `Failed to send Slack message: ${webhookError.message}` },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Slack send error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
