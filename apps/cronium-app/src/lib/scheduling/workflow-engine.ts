/**
 * Event-sourced workflow engine (PLAN.md §4.4) — the durable replacement for
 * the in-memory promise-tree executor.
 *
 * State lives in workflow_step_runs (one row per node per run); advance() is a
 * reducer over those rows plus the jobs they reference. It is safe to call at
 * any time, any number of times, from any process — which is exactly how it is
 * driven: once at start, on every job_changed notification, by a periodic
 * reconciliation sweep, and by a boot pass after restarts. A worker crash
 * loses nothing: the next advance() picks the run up from its rows (fixes
 * review H1).
 *
 * Edge semantics match the old executor (all incoming edges must hold —
 * ON_SUCCESS / ON_FAILURE / ON_CONDITION / ALWAYS) with one improvement: an
 * edge that can never be satisfied resolves the step immediately as SKIPPED
 * (no incoming edge held) or UNSATISFIABLE (conflicting edges), instead of
 * blocking the run for a 30-minute wait (fixes review H9).
 *
 * workflow_executions remains the run record the UI reads;
 * workflow_execution_events is dual-written as per-node telemetry for the
 * execution graph view.
 */

import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  ConnectionType,
  JobStatus,
  LogStatus,
  WorkflowLogLevel,
  WorkflowStepStatus,
  jobs as jobsTable,
  workflowExecutionEvents,
  workflowExecutions,
  workflowStepRuns,
  type Job,
  type WorkflowConnection,
  type WorkflowExecution,
  type WorkflowNode,
  type WorkflowTriggerType,
  type WorkflowStepRun,
} from "@/shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveWorkflowInput } from "@/lib/unified-io/resolve-input";
import { dispatchEventJob } from "./dispatch";
import { assertWorkflowGraphCapability } from "@/server/security/resource-access";

const TERMINAL_RUN_STATUSES: LogStatus[] = [
  LogStatus.SUCCESS,
  LogStatus.FAILURE,
  LogStatus.TIMEOUT,
];

const TERMINAL_STEP_STATUSES: WorkflowStepStatus[] = [
  WorkflowStepStatus.SUCCEEDED,
  WorkflowStepStatus.FAILED,
  WorkflowStepStatus.SKIPPED,
  WorkflowStepStatus.UNSATISFIABLE,
];

/** A claimed-but-not-yet-dispatched step older than this is recovered by the
 * sweep: its job is re-attached by metadata, or it is failed loudly. */
const DISPATCH_STALL_MS = 2 * 60_000;

const STEP_NOT_STARTED_BEFORE_TIMEOUT =
  "Workflow run timed out before this step started";
const NO_JOB_BEFORE_TIMEOUT =
  "Workflow run timed out before this step's job was created";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EdgeState = "satisfied" | "pending" | "unsatisfiable";

/** Pure edge evaluation, exported for tests. */
export function evaluateEdge(
  connectionType: ConnectionType,
  source: Pick<WorkflowStepRun, "status" | "condition">,
): EdgeState {
  switch (source.status) {
    case WorkflowStepStatus.PENDING:
    case WorkflowStepStatus.DISPATCHED:
      return "pending";
    case WorkflowStepStatus.SUCCEEDED:
      switch (connectionType) {
        case ConnectionType.ON_SUCCESS:
        case ConnectionType.ALWAYS:
          return "satisfied";
        case ConnectionType.ON_FAILURE:
          return "unsatisfiable";
        case ConnectionType.ON_CONDITION:
          return source.condition === true ? "satisfied" : "unsatisfiable";
      }
      break;
    case WorkflowStepStatus.FAILED:
      switch (connectionType) {
        case ConnectionType.ON_FAILURE:
        case ConnectionType.ALWAYS:
          return "satisfied";
        default:
          return "unsatisfiable";
      }
    case WorkflowStepStatus.SKIPPED:
    case WorkflowStepStatus.UNSATISFIABLE:
      // The source never ran; nothing downstream of it fires (incl. ALWAYS)
      return "unsatisfiable";
  }
  return "pending";
}

/** Pure readiness resolution over a step's incoming edges. */
export function resolveReadiness(
  edges: EdgeState[],
): "ready" | "waiting" | "skipped" | "unsatisfiable" {
  if (edges.length === 0) return "ready";
  const unsat = edges.filter((e) => e === "unsatisfiable").length;
  if (unsat === 0) {
    return edges.every((e) => e === "satisfied") ? "ready" : "waiting";
  }
  // At least one edge can never hold: the step is terminal NOW.
  return unsat === edges.length ? "skipped" : "unsatisfiable";
}

export interface StartWorkflowResult {
  success: boolean;
  executionId?: number;
  status?: string;
  output?: string;
}

/** Create a run + its step rows and kick the first advance. */
export async function startWorkflowRun(
  workflowId: number,
  opts: {
    userId?: string | undefined;
    triggerType: WorkflowTriggerType;
    input?: Record<string, unknown> | undefined;
  },
): Promise<StartWorkflowResult> {
  try {
    const workflow = await storage.getWorkflow(workflowId);
    if (!workflow) {
      return { success: false, output: `Workflow ${workflowId} not found` };
    }

    const nodes = await storage.getWorkflowNodes(workflowId);
    const connections = await storage.getWorkflowConnections(workflowId);
    if (nodes.length === 0) {
      return { success: false, output: "Workflow has no nodes" };
    }
    const hasStart = nodes.some(
      (n) => !connections.some((c) => c.targetNodeId === n.id),
    );
    if (!hasStart) {
      return {
        success: false,
        output: "Workflow has no starting nodes (fully cyclic graph)",
      };
    }

    const userId = opts.userId ?? workflow.userId;
    await assertWorkflowGraphCapability(workflowId, userId, "execute");
    const startedAt = new Date();

    const run = await storage.createWorkflowExecution({
      workflowId,
      userId,
      status: LogStatus.RUNNING,
      triggerType: opts.triggerType,
      startedAt,
      totalEvents: nodes.length,
      executionData: {
        triggerType: opts.triggerType,
        triggeredAt: startedAt.toISOString(),
        inputData: opts.input ?? {},
      },
    });

    await db.insert(workflowStepRuns).values(
      nodes.map((node) => ({
        workflowExecutionId: run.id,
        nodeId: node.id,
        eventId: node.eventId,
        status: WorkflowStepStatus.PENDING,
      })),
    );

    await storage
      .createWorkflowLog({
        workflowId,
        userId,
        level: WorkflowLogLevel.INFO,
        status: LogStatus.RUNNING,
        message: `Workflow execution ${run.id} started (${opts.triggerType})`,
        timestamp: startedAt,
        startTime: startedAt,
      })
      .catch(() => undefined);

    await advanceWorkflowRun(run.id);

    return { success: true, executionId: run.id, status: "RUNNING" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[WorkflowEngine] Failed to start workflow ${workflowId}:`,
      message,
    );
    return { success: false, output: message };
  }
}

interface ClaimedStep {
  step: WorkflowStepRun;
  node: WorkflowNode;
}

/**
 * The reducer. Serialized per run via FOR UPDATE SKIP LOCKED on the run row —
 * a concurrent advance simply skips (the in-flight one sees current state,
 * and every state change re-notifies).
 */
export async function advanceWorkflowRun(runId: number): Promise<void> {
  const claimed: ClaimedStep[] = [];
  let initialInput: Record<string, unknown> = {};
  let connections: WorkflowConnection[] = [];
  let stepsSnapshot: WorkflowStepRun[] = [];
  let runUserId = "";
  const pendingTelemetry: PendingTelemetry[] = [];

  // The workflow graph is read BEFORE the transaction opens. storage.* runs on
  // the global pool, so reading it inside would mean holding one pool
  // connection (the transaction) while waiting for a second — with pool
  // max 5 in dev / 20 in prod, enough concurrent advances deadlock each other
  // until connectionTimeoutMillis fires. The graph is immutable for the
  // duration of a run's advance; a mid-flight edit is already handled by the
  // dangling-edge and missing-node branches below.
  const [runHeader] = await db
    .select({ workflowId: workflowExecutions.workflowId })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, runId));
  if (!runHeader) return;
  const nodes = await storage.getWorkflowNodes(runHeader.workflowId);
  const graphConnections = await storage.getWorkflowConnections(
    runHeader.workflowId,
  );

  const advanced = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.id, runId))
      .for("update", { skipLocked: true });
    if (!run) return false; // busy elsewhere (or gone)
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      // A run that finished on its own has no open steps. A timeout ends it
      // from outside this reducer, so it can leave some, and they settle here.
      if (run.status === LogStatus.TIMEOUT) {
        await settleTimedOutSteps(tx, run);
      }
      return true;
    }
    runUserId = run.userId;

    const executionData = run.executionData as {
      inputData?: Record<string, unknown>;
    } | null;
    initialInput = executionData?.inputData ?? {};

    connections = graphConnections;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    let steps = await tx
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowExecutionId, runId));

    // --- Phase A: settle DISPATCHED steps from their jobs -------------------
    const dispatched = steps.filter(
      (s) => s.status === WorkflowStepStatus.DISPATCHED && s.jobId,
    );
    if (dispatched.length > 0) {
      await settleStepsFromJobs(tx, dispatched, pendingTelemetry);
      steps = await tx
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.workflowExecutionId, runId));
    }

    // --- Phase A2: recover claimed-but-never-dispatched steps ---------------
    const stalled = steps.filter(
      (s) =>
        s.status === WorkflowStepStatus.DISPATCHED &&
        !s.jobId &&
        s.startedAt &&
        Date.now() - s.startedAt.getTime() > DISPATCH_STALL_MS,
    );
    for (const step of stalled) {
      const orphanJob = await findOrphanJob(tx, step);
      if (orphanJob) {
        await tx
          .update(workflowStepRuns)
          .set({ jobId: orphanJob.id, updatedAt: new Date() })
          .where(eq(workflowStepRuns.id, step.id));
      } else {
        await settleStep(
          tx,
          step,
          {
            status: WorkflowStepStatus.FAILED,
            error: "Dispatch was interrupted before a job was created",
          },
          pendingTelemetry,
        );
      }
    }
    if (stalled.length > 0) {
      steps = await tx
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.workflowExecutionId, runId));
    }

    // --- Phase B: resolve PENDING steps to fixpoint -------------------------
    const stepByNode = new Map(steps.map((s) => [s.nodeId, s]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of steps) {
        if (step.status !== WorkflowStepStatus.PENDING) continue;
        const incoming = connections.filter(
          (c) => c.targetNodeId === step.nodeId,
        );
        const edges = incoming.map((conn) => {
          const source = stepByNode.get(conn.sourceNodeId);
          if (!source) return "unsatisfiable" as const; // dangling edge
          return evaluateEdge(conn.connectionType, source);
        });
        const readiness = resolveReadiness(edges);
        if (readiness === "skipped" || readiness === "unsatisfiable") {
          const status =
            readiness === "skipped"
              ? WorkflowStepStatus.SKIPPED
              : WorkflowStepStatus.UNSATISFIABLE;
          await settleStep(
            tx,
            step,
            {
              status,
              error:
                readiness === "skipped"
                  ? "Branch not taken (no incoming connection satisfied)"
                  : "Prerequisite connections can never all be satisfied",
            },
            pendingTelemetry,
          );
          step.status = status;
          changed = true;
        } else if (readiness === "ready") {
          // Claim inside the transaction; the actual job dispatch happens
          // after commit (dispatchEventJob is not transaction-aware).
          const now = new Date();
          await tx
            .update(workflowStepRuns)
            .set({
              status: WorkflowStepStatus.DISPATCHED,
              startedAt: now,
              updatedAt: now,
            })
            .where(eq(workflowStepRuns.id, step.id));
          step.status = WorkflowStepStatus.DISPATCHED;
          step.startedAt = now;
          const node = nodeById.get(step.nodeId);
          if (node) {
            claimed.push({ step, node });
          } else {
            await settleStep(
              tx,
              step,
              {
                status: WorkflowStepStatus.FAILED,
                error: `Node ${step.nodeId} no longer exists in the workflow`,
              },
              pendingTelemetry,
            );
            step.status = WorkflowStepStatus.FAILED;
          }
          changed = true;
        }
      }
    }
    stepsSnapshot = steps;

    // --- Phase D: finalize when nothing is left in flight -------------------
    const inFlight = steps.some(
      (s) => !TERMINAL_STEP_STATUSES.includes(s.status),
    );
    if (!inFlight && claimed.length === 0) {
      const failed = steps.filter(
        (s) => s.status === WorkflowStepStatus.FAILED,
      ).length;
      const succeeded = steps.filter(
        (s) => s.status === WorkflowStepStatus.SUCCEEDED,
      ).length;
      const unsatisfiable = steps.filter(
        (s) => s.status === WorkflowStepStatus.UNSATISFIABLE,
      ).length;
      const skipped = steps.length - succeeded - failed - unsatisfiable;
      const now = new Date();
      // UNSATISFIABLE means conflicting edges — a graph misconfiguration, not
      // a branch legitimately not taken. A run containing one did not fully
      // succeed, so it finalizes as FAILURE (SKIPPED alone stays SUCCESS).
      const finalStatus =
        failed > 0 || unsatisfiable > 0 ? LogStatus.FAILURE : LogStatus.SUCCESS;
      await tx
        .update(workflowExecutions)
        .set({
          status: finalStatus,
          completedAt: now,
          totalDuration: now.getTime() - run.startedAt.getTime(),
          totalEvents: steps.length,
          successfulEvents: succeeded,
          failedEvents: failed,
          updatedAt: now,
        })
        .where(eq(workflowExecutions.id, runId));
      // Deferred for the same reason as the telemetry writes: no second pool
      // connection while this transaction holds one.
      const summary = `Workflow execution ${runId} finished: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped${unsatisfiable > 0 ? `, ${unsatisfiable} unsatisfiable` : ""}`;
      const { workflowId, userId, startedAt } = run;
      pendingTelemetry.push(() =>
        storage
          .createWorkflowLog({
            workflowId,
            userId,
            level:
              finalStatus === LogStatus.SUCCESS
                ? WorkflowLogLevel.INFO
                : WorkflowLogLevel.ERROR,
            status: finalStatus,
            message: summary,
            timestamp: now,
            startTime: startedAt,
            endTime: now,
          })
          .then(() => undefined)
          .catch(() => undefined),
      );
    }

    return true;
  });

  // Flush the writes deferred out of the transaction. All best-effort; a
  // failure here never changes run state.
  for (const write of pendingTelemetry) {
    await write().catch(() => undefined);
  }

  if (!advanced) return;

  // --- Phase C (post-commit): dispatch the claimed steps --------------------
  if (claimed.length > 0) {
    const [run] = await db
      .select({ workflowId: workflowExecutions.workflowId })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.id, runId));
    if (run?.workflowId) {
      try {
        await assertWorkflowGraphCapability(
          run.workflowId,
          runUserId,
          "execute",
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Authorization changed";
        await Promise.all(
          claimed.map(({ step }) =>
            failClaimedStep(
              step,
              `Workflow authorization changed before dispatch: ${message}`,
            ),
          ),
        );
        return;
      }
    }
    for (const { step } of claimed) {
      await dispatchClaimedStep(
        step,
        run?.workflowId,
        runUserId,
        connections,
        stepsSnapshot,
        initialInput,
      );
    }
  }
}

/** Closest honest LogStatus for a settled step's telemetry row. The enum has
 * no SKIPPED; the UI graph renders PENDING as "never ran", which is exactly
 * what SKIPPED means, so that is the mapping. UNSATISFIABLE (conflicting
 * edges) is a graph misconfiguration and honestly reads as FAILURE. */
function logStatusForStep(status: WorkflowStepStatus): LogStatus {
  switch (status) {
    case WorkflowStepStatus.SUCCEEDED:
      return LogStatus.SUCCESS;
    case WorkflowStepStatus.SKIPPED:
      return LogStatus.PENDING;
    default:
      return LogStatus.FAILURE;
  }
}

/** A telemetry row update queued during the transaction and flushed after it
 * commits (see settleStep). */
type PendingTelemetry = () => Promise<void>;

/** The job this step dispatched, if its id never reached the step. dispatch
 * stamps the step id into job metadata for exactly this recovery path (crash
 * between claim and jobId write). */
async function findOrphanJob(
  tx: Tx,
  step: WorkflowStepRun,
): Promise<Job | undefined> {
  const candidates = await tx
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.eventId, step.eventId));
  return candidates.find((j) => {
    const meta = j.metadata as { workflowStepRunId?: number } | null;
    return meta?.workflowStepRunId === step.id;
  });
}

/** Settle dispatched steps whose job has finished. A step whose job is still in
 * flight stays DISPATCHED. `at` overrides the settle time. */
async function settleStepsFromJobs(
  tx: Tx,
  dispatched: WorkflowStepRun[],
  pendingTelemetry: PendingTelemetry[],
  at?: Date,
): Promise<void> {
  const jobRows = await tx
    .select()
    .from(jobsTable)
    .where(
      inArray(
        jobsTable.id,
        dispatched.map((s) => s.jobId!),
      ),
    );
  const jobById = new Map<string, Job>(jobRows.map((j) => [j.id, j]));
  for (const step of dispatched) {
    const job = step.jobId ? jobById.get(step.jobId) : undefined;
    if (!job) {
      // Retention or manual deletion removed the job mid-run
      await settleStep(
        tx,
        step,
        {
          status: WorkflowStepStatus.FAILED,
          error: "Job record disappeared",
          at,
        },
        pendingTelemetry,
      );
      continue;
    }
    const result = job.result as {
      scriptOutput?: unknown;
      condition?: boolean;
    } | null;
    switch (job.status) {
      case JobStatus.COMPLETED:
        await settleStep(
          tx,
          step,
          {
            status: WorkflowStepStatus.SUCCEEDED,
            output: result?.scriptOutput,
            condition: result?.condition,
            at,
          },
          pendingTelemetry,
        );
        break;
      case JobStatus.FAILED:
      case JobStatus.TIMED_OUT:
      case JobStatus.CANCELLED:
        await settleStep(
          tx,
          step,
          {
            status: WorkflowStepStatus.FAILED,
            condition: result?.condition,
            error:
              job.lastError ??
              (job.status === JobStatus.TIMED_OUT
                ? "Job timed out"
                : job.status === JobStatus.CANCELLED
                  ? "Job cancelled"
                  : "Job failed"),
            at,
          },
          pendingTelemetry,
        );
        break;
      default:
        break; // still in flight
    }
  }
}

/**
 * Settle what a timed-out run left open: finished jobs give their steps a real
 * result, and whatever never ran is closed out. Nothing is dispatched. A step
 * whose job is still in flight stays open until that job is timed out, which is
 * the cleanup service's job, so call this again afterwards.
 *
 * Steps close at the moment the run timed out, however much later this runs.
 * Telemetry is written here on the transaction, so a settled step can't leave
 * its row RUNNING, and it goes by node rather than by the step's
 * executionEventId, which a crash during dispatch can leave unset. Safe to
 * repeat: with nothing open it writes nothing.
 */
async function settleTimedOutSteps(
  tx: Tx,
  run: WorkflowExecution,
): Promise<void> {
  const at = run.completedAt ?? new Date();
  // settleStep queues its own telemetry write for after commit; the pass below
  // covers those rows and more, in this transaction.
  const superseded: PendingTelemetry[] = [];

  const steps = await tx
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.workflowExecutionId, run.id));
  const open = steps.filter((s) => !TERMINAL_STEP_STATUSES.includes(s.status));

  const withJob: WorkflowStepRun[] = [];
  for (const step of open) {
    if (step.status === WorkflowStepStatus.PENDING) {
      await settleStep(
        tx,
        step,
        {
          status: WorkflowStepStatus.SKIPPED,
          error: STEP_NOT_STARTED_BEFORE_TIMEOUT,
          at,
        },
        superseded,
      );
      continue;
    }
    if (step.jobId) {
      withJob.push(step);
      continue;
    }
    const orphanJob = await findOrphanJob(tx, step);
    if (orphanJob) {
      await tx
        .update(workflowStepRuns)
        .set({ jobId: orphanJob.id, updatedAt: new Date() })
        .where(eq(workflowStepRuns.id, step.id));
      withJob.push({ ...step, jobId: orphanJob.id });
    } else {
      await settleStep(
        tx,
        step,
        {
          status: WorkflowStepStatus.FAILED,
          error: NO_JOB_BEFORE_TIMEOUT,
          at,
        },
        superseded,
      );
    }
  }
  if (withJob.length > 0) {
    await settleStepsFromJobs(tx, withJob, superseded, at);
  }

  let settled = steps;
  if (open.length > 0) {
    settled = await tx
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowExecutionId, run.id));
    await tx
      .update(workflowExecutions)
      .set({
        successfulEvents: settled.filter(
          (s) => s.status === WorkflowStepStatus.SUCCEEDED,
        ).length,
        failedEvents: settled.filter(
          (s) => s.status === WorkflowStepStatus.FAILED,
        ).length,
        updatedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, run.id));
  }

  const stepByNode = new Map(settled.map((s) => [s.nodeId, s]));
  const runningTelemetry = await tx
    .select()
    .from(workflowExecutionEvents)
    .where(
      and(
        eq(workflowExecutionEvents.workflowExecutionId, run.id),
        eq(workflowExecutionEvents.status, LogStatus.RUNNING),
      ),
    );
  for (const row of runningTelemetry) {
    const step = stepByNode.get(row.nodeId);
    if (step && !TERMINAL_STEP_STATUSES.includes(step.status)) continue;
    const completedAt = step?.completedAt ?? at;
    await tx
      .update(workflowExecutionEvents)
      .set({
        status: step ? logStatusForStep(step.status) : LogStatus.FAILURE,
        completedAt,
        duration: durationBetween(row.startedAt, completedAt),
        output:
          step?.output !== undefined && step.output !== null
            ? JSON.stringify(step.output)
            : null,
        errorMessage: step ? step.error : "Workflow run timed out",
      })
      .where(eq(workflowExecutionEvents.id, row.id));
  }
}

/**
 * Settle a timed-out run's steps and telemetry. Unlike advanceWorkflowRun this
 * waits for the run's lock: an advance holding it may have read the jobs before
 * the caller timed them out, so skipping could leave a step open.
 */
export async function settleTimedOutRunSteps(runId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.id, runId))
      .for("update");
    if (run?.status === LogStatus.TIMEOUT) {
      await settleTimedOutSteps(tx, run);
    }
  });
}

/** Clocks can differ between processes, so a duration never goes negative. */
function durationBetween(from: Date | null, to: Date): number | null {
  return from ? Math.max(0, to.getTime() - from.getTime()) : null;
}

async function settleStep(
  tx: Tx,
  step: WorkflowStepRun,
  data: {
    status: WorkflowStepStatus;
    output?: unknown;
    condition?: boolean | undefined;
    error?: string;
    at?: Date | undefined;
  },
  pendingTelemetry: PendingTelemetry[],
): Promise<void> {
  const now = new Date();
  const completedAt = data.at ?? now;
  await tx
    .update(workflowStepRuns)
    .set({
      status: data.status,
      output: data.output ?? null,
      condition: data.condition ?? null,
      error: data.error ?? null,
      completedAt,
      updatedAt: now,
    })
    .where(eq(workflowStepRuns.id, step.id));

  // Telemetry dual-write for the UI execution graph. Queued rather than awaited
  // here: storage.* runs on the global pool, and issuing it while this
  // transaction holds a connection makes every advance need two connections at
  // once — the pool-starvation deadlock described in advanceWorkflowRun. It is
  // best-effort either way, so running it after commit costs nothing.
  const executionEventId = step.executionEventId;
  if (executionEventId) {
    pendingTelemetry.push(() =>
      storage
        .updateWorkflowExecutionEvent(executionEventId, {
          status: logStatusForStep(data.status),
          completedAt,
          duration: durationBetween(step.startedAt, completedAt),
          output:
            data.output !== undefined ? JSON.stringify(data.output) : null,
          errorMessage: data.error ?? null,
        })
        .then(() => undefined)
        .catch(() => undefined),
    );
  }
}

async function dispatchClaimedStep(
  step: WorkflowStepRun,
  workflowId: number | undefined,
  authorizedUserId: string,
  connections: WorkflowConnection[],
  steps: WorkflowStepRun[],
  initialInput: Record<string, unknown>,
): Promise<void> {
  // Hoisted out of the try so the catch can finalize the telemetry row when
  // dispatch throws after the row was created (otherwise the UI graph would
  // render this step RUNNING forever).
  let executionEventId: number | undefined;
  try {
    // Claimed before the run timed out, but dispatched after: no job at all.
    if (await runHasTimedOut(step.workflowExecutionId)) {
      await failClaimedStep(step, NO_JOB_BEFORE_TIMEOUT);
      return;
    }

    const event = await storage.getEventWithRelations(step.eventId);
    if (!event) {
      await failClaimedStep(step, `Event ${step.eventId} no longer exists`);
      return;
    }

    // Input resolution — same semantics as the old executor: latest
    // successful predecessor's output, or the trigger input for start nodes.
    const incoming = connections.filter((c) => c.targetNodeId === step.nodeId);
    const predecessorResults = new Map(
      steps.map((s) => [
        s.nodeId,
        {
          success: s.status === WorkflowStepStatus.SUCCEEDED,
          scriptOutput: s.output ?? undefined,
        },
      ]),
    );
    const input = resolveWorkflowInput(
      incoming,
      predecessorResults,
      initialInput,
    );

    // Telemetry row for the UI graph (best-effort)
    try {
      const telemetry = await storage.createWorkflowExecutionEvent({
        workflowExecutionId: step.workflowExecutionId,
        eventId: step.eventId,
        nodeId: step.nodeId,
        sequenceOrder: step.id,
        status: LogStatus.RUNNING,
        startedAt: step.startedAt ?? new Date(),
        // Every incoming edge had to be satisfied for this step to be
        // claimed, so any of them describes how it was triggered; record the
        // first. Start nodes have no incoming edge — they are triggered by
        // the run itself, not a connection, so they record null.
        connectionType: incoming[0]?.connectionType ?? null,
      });
      executionEventId = telemetry.id;
    } catch {
      // telemetry only
    }

    const result = await dispatchEventJob(event, {
      triggeredBy: "workflow",
      input,
      workflowId,
      workflowExecutionId: step.workflowExecutionId,
      workflowStepRunId: step.id,
      actor: `workflow-engine:${step.workflowExecutionId}`,
      authorizedUserId,
    });

    if (result.skipped) {
      await failClaimedStep(
        step,
        `Run skipped (${result.skipped})`,
        executionEventId,
      );
      return;
    }

    await db
      .update(workflowStepRuns)
      .set({
        jobId: result.job.id,
        executionEventId: executionEventId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, step.id));

    await cleanUpIfRunTimedOut(step.workflowExecutionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[WorkflowEngine] Failed to dispatch step ${step.id}:`,
      message,
    );
    await failClaimedStep(
      step,
      `Dispatch failed: ${message}`,
      executionEventId,
    );
  }
}

async function runHasTimedOut(runId: number): Promise<boolean> {
  const [run] = await db
    .select({ status: workflowExecutions.status })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, runId));
  return run?.status === LogStatus.TIMEOUT;
}

/**
 * The run may have timed out while this step's job was being created, too late
 * for the timeout path to have found it. That path writes the run and then reads
 * its jobs. This writes the job and then reads the run. So at least one of the
 * two sees the other, and no job can slip between them.
 *
 * The job already exists by now, so a failure here must not fail its step. The
 * cleanup sweep retries anything still open under a timed-out run.
 */
async function cleanUpIfRunTimedOut(runId: number): Promise<void> {
  try {
    if (await runHasTimedOut(runId)) {
      // Dynamic import: the cleanup service imports this module.
      const { getCleanupService } =
        await import("@/lib/services/workflow-cleanup-service");
      await getCleanupService().settleTimedOutRun(runId);
    }
  } catch (error) {
    console.error(
      `[WorkflowEngine] Failed to check run ${runId} for a timeout after dispatch:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function failClaimedStep(
  step: WorkflowStepRun,
  error: string,
  executionEventId?: number,
): Promise<void> {
  const now = new Date();
  const telemetryId = executionEventId ?? step.executionEventId;
  await db
    .update(workflowStepRuns)
    .set({
      status: WorkflowStepStatus.FAILED,
      error,
      completedAt: now,
      executionEventId: telemetryId,
      updatedAt: now,
    })
    .where(eq(workflowStepRuns.id, step.id));
  // Finalize the telemetry row too: it was created RUNNING before dispatch,
  // and a step that fails without a job outcome never passes through
  // settleStep — without this the UI graph shows it RUNNING forever.
  if (telemetryId) {
    await storage
      .updateWorkflowExecutionEvent(telemetryId, {
        status: LogStatus.FAILURE,
        completedAt: now,
        duration: step.startedAt
          ? now.getTime() - step.startedAt.getTime()
          : null,
        errorMessage: error,
      })
      .catch(() => undefined);
  }
  // The run needs another advance to observe this terminal step
  await advanceWorkflowRun(step.workflowExecutionId).catch(() => undefined);
}

/** Advance every run that has a step attached to this job (job_changed). */
export async function advanceRunsForJob(jobId: string): Promise<void> {
  const rows = await db
    .select({ runId: workflowStepRuns.workflowExecutionId })
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.jobId, jobId));
  for (const row of rows) {
    await advanceWorkflowRun(row.runId).catch((error) => {
      console.error(
        `[WorkflowEngine] advance failed for run ${row.runId}:`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}

/**
 * Reconciliation sweep (boot + periodic): advance every non-terminal run.
 * This is the "slower, never stuck" guarantee — even with every notification
 * lost, runs converge (PLAN.md §4.4).
 */
export async function reconcileWorkflowRuns(limit = 100): Promise<number> {
  const runs = await db
    .select({ id: workflowExecutions.id })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.status, LogStatus.RUNNING))
    .limit(limit);
  for (const run of runs) {
    await advanceWorkflowRun(run.id).catch((error) => {
      console.error(
        `[WorkflowEngine] reconcile failed for run ${run.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }
  return runs.length;
}
