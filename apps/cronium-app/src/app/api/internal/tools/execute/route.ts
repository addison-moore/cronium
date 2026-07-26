import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import type { Event } from "@/shared/schema";
import { executionService } from "@/lib/services/execution-service";
import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import {
  authorizeCapability,
  assertJobScope,
  assertUserScope,
} from "@/lib/security/internal-route-auth";

/**
 * POST /api/internal/tools/execute — run a tool action on behalf of a running
 * script (`cronium.toolAction()` and the slack/discord/email wrappers).
 *
 * This is the app-side counterpart the runtime relay has always targeted; until
 * now it did not exist, so scripts got a 501 (FINDINGS #28). The runtime posts
 * `{ executionId, userId, tool, action, params }` with the job's per-job
 * capability token in `X-Job-Capability` (HI-10). We:
 *   1. require the `tool:execute` capability and bind it to the job (via the
 *      execution) and the owning user — the body's `userId` is never trusted;
 *   2. resolve the caller's tool CREDENTIAL of the requested type (the SDK only
 *      knows the type, e.g. "slack"); with several of a type, the most recently
 *      created active one wins (deterministic — documented limitation);
 *   3. execute through the same hardened engine the scheduler uses
 *      (`executeToolAction`) so SSRF guarding, the circuit breaker, rate
 *      limits/quota, secret redaction, and `tool_action_logs` auditing all
 *      apply identically — no second, weaker code path.
 *
 * The response mirrors the Go `types.ToolActionResult` the runtime decodes:
 * `{ success, data, error? }`. An action that RAN but failed returns
 * `success:false` with a message (the runtime turns that into a script-visible
 * error); request problems (bad body, unknown tool/action, no connection) are
 * 4xx so the script sees "couldn't run" distinctly.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authorizeCapability(request, "tool:execute");
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as {
      executionId?: unknown;
      userId?: unknown;
      tool?: unknown;
      action?: unknown;
      params?: unknown;
    } | null;

    if (
      !body ||
      typeof body.executionId !== "string" ||
      typeof body.tool !== "string" ||
      typeof body.action !== "string" ||
      body.tool.length === 0 ||
      body.action.length === 0
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid tool-action request" },
        { status: 400 },
      );
    }
    // Parameters are optional (a no-arg action is valid); default to {}.
    const parameters =
      body.params && typeof body.params === "object"
        ? (body.params as Record<string, unknown>)
        : {};

    // Bind the capability to the job behind this execution.
    const execution = await executionService.getExecution(body.executionId);
    if (!execution) {
      return NextResponse.json(
        { success: false, error: "Execution not found" },
        { status: 404 },
      );
    }
    const scopeError = assertJobScope(auth.cap, execution.jobId);
    if (scopeError) return scopeError;

    // The owning tenant is the capability's, never the body's.
    const job = await jobService.getJob(execution.jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found" },
        { status: 404 },
      );
    }
    const userScopeError = assertUserScope(auth.cap, job.userId);
    if (userScopeError) return userScopeError;
    const ownerId = auth.cap.userId;

    // Resolve the tool credential by TYPE for this user (the SDK only carries a
    // type). Newest active connection wins when there is more than one.
    const [credential] = await db
      .select({ id: toolCredentials.id })
      .from(toolCredentials)
      .where(
        and(
          eq(toolCredentials.userId, ownerId),
          eq(toolCredentials.type, body.tool),
          eq(toolCredentials.isActive, true),
        ),
      )
      .orderBy(desc(toolCredentials.createdAt))
      .limit(1);

    if (!credential) {
      return NextResponse.json(
        {
          success: false,
          error: `No active "${body.tool}" connection found for this user`,
        },
        { status: 404 },
      );
    }

    // Run through the scheduler's hardened engine. It re-fetches + decrypts the
    // credential (credentialCache), validates params, enforces rate limit/quota,
    // guards SSRF, redacts secrets, and writes the tool_action_logs audit row.
    // We drive it with a faithful copy of the real running event (valid
    // event_id FK for the audit row, the user's real timeout) whose
    // toolActionConfig is overridden with the requested action.
    const runningEvent =
      job.eventId != null ? await storage.getEvent(job.eventId) : undefined;
    const eventForExecution = {
      ...(runningEvent as Event | undefined),
      id: job.eventId ?? undefined,
      userId: ownerId,
      toolActionConfig: {
        toolType: body.tool,
        actionId: body.action,
        toolId: credential.id,
        parameters,
      },
    } as Event;

    const result = await executeToolAction(eventForExecution, parameters);

    if (result.exitCode === 0) {
      return NextResponse.json({ success: true, data: result.data });
    }
    return NextResponse.json({
      success: false,
      data: result.data,
      error: result.stderr || "Tool action failed",
    });
  } catch (error) {
    console.error("[tools/execute] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
