import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { eq, and } from "drizzle-orm";
import { workflows } from "@/shared/schema";
import { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import { workflowExecutor } from "@/lib/workflow-executor";
import { RateLimitService } from "@/lib/rate-limit-service";

// Cap webhook payloads to keep untrusted input bounded
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
const RATE_LIMIT_PER_MINUTE = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  // Get params
  const { key: webhookKey } = await params;

  try {
    const rateLimit = await RateLimitService.tryCheckLimit(
      webhookKey,
      "workflow-webhook",
      { maxRequests: RATE_LIMIT_PER_MINUTE, windowMs: 60_000 },
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": rateLimit.resetAt.toUTCString() },
        },
      );
    }
    // Find the workflow associated with this webhook key
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.webhookKey, webhookKey),
          eq(workflows.triggerType, WorkflowTriggerType.WEBHOOK),
        ),
      )
      .limit(1);

    if (!workflow) {
      return NextResponse.json(
        {
          success: false,
          message: "No workflow found for this webhook key",
        },
        { status: 404 },
      );
    }

    if (workflow.status !== EventStatus.ACTIVE) {
      return NextResponse.json(
        {
          success: false,
          message: "This workflow is not active",
        },
        { status: 400 },
      );
    }

    // Read the webhook payload; it becomes the workflow's initial input data
    // (available to the first node via cronium.input()).
    const rawBody = await request.text().catch(() => "");
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { success: false, message: "Payload too large (max 1 MB)" },
        { status: 413 },
      );
    }

    let payload: unknown = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        // Non-JSON bodies are passed through under a body key
        payload = { body: rawBody };
      }
    }
    const inputData: Record<string, unknown> =
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { body: payload };

    console.log(
      `Webhook triggered for workflow ${workflow.id} with key ${webhookKey}`,
    );

    // Run the workflow asynchronously
    workflowExecutor
      .runWorkflowImmediately(workflow.id, inputData)
      .then((result) => {
        console.log(
          `Webhook workflow ${workflow.id} execution completed:`,
          result.success ? "SUCCESS" : "FAILURE",
        );
      })
      .catch((error) => {
        console.error(
          `Error running workflow ${workflow.id} via webhook:`,
          error,
        );
      });

    return NextResponse.json({
      success: true,
      message: "Webhook received and workflow execution started",
      workflowId: workflow.id,
    });
  } catch (error) {
    console.error(`Failed to process webhook with key ${webhookKey}:`, error);
    return NextResponse.json(
      { success: false, message: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
