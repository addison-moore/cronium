import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { eq, and } from "drizzle-orm";
import { workflows } from "@/shared/schema";
import { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { RateLimitService } from "@/lib/rate-limit-service";
import { hashWorkflowWebhookKey } from "@/lib/workflow-webhook-key";

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
    // Find the workflow by the HASH of the presented key (only the hash is
    // stored). Constant-work lookup on an indexed hash column (HI-12).
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.webhookKeyHash, hashWorkflowWebhookKey(webhookKey)),
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
    // Measure bytes, not UTF-16 code units — multi-byte characters would
    // otherwise let payloads up to 4x the cap through.
    if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
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

    // Do not log the presented key: it is a bearer credential (only its hash
    // is stored server-side, HI-12) and must not leak into logs.
    console.log(`Webhook triggered for workflow ${workflow.id}`);

    // Start the run asynchronously; the scheduling worker advances it.
    startWorkflowRun(workflow.id, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: inputData,
    })
      .then((result) => {
        console.log(
          `Webhook workflow ${workflow.id} run started:`,
          result.success
            ? `execution ${String(result.executionId)}`
            : result.output,
        );
      })
      .catch((error) => {
        console.error(
          `Error starting workflow ${workflow.id} via webhook:`,
          error,
        );
      });

    return NextResponse.json({
      success: true,
      message: "Webhook received and workflow execution started",
      workflowId: workflow.id,
    });
  } catch (error) {
    // Key deliberately omitted from the log (bearer credential, HI-12).
    console.error("Failed to process workflow webhook:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
