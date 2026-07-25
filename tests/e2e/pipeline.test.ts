/**
 * End-to-end pipeline tests (testing PLAN.md Phase 5) against the full
 * disposable stack booted by infra/scripts/run-e2e-tests.sh:
 *
 *   Next.js app (next start) + scheduling worker + socket server on the host,
 *   orchestrator / Postgres / Valkey in containers, jobs executing in REAL
 *   Docker containers with per-job runtime sidecars.
 *
 * Scenario 1 — the product's core promise: a *scheduled* event is dispatched
 * by the worker, claimed by the real orchestrator, executed in a container,
 * and its output lands in the executions/logs tables.
 *
 * Scenario 2 — Unified I/O: a two-step workflow where step A publishes via
 * `cronium_output` and step B receives it via `cronium_input` (runtime
 * sidecar + workflow engine + orchestrator together).
 */
import {
  APP_URL,
  FatalPollError,
  poll,
  pool,
  seedPrincipal,
  trpc,
} from "./helpers";

let token: string;

interface EventDto {
  id: number;
}
interface WorkflowDto {
  id: number;
}

beforeAll(async () => {
  // The harness already waited for /api/health; this is a cheap re-assert so
  // a half-booted stack fails with a clear message instead of poll timeouts.
  const health = (await (await fetch(`${APP_URL}/api/health`)).json()) as {
    status: string;
    scheduler: { healthy: boolean };
  };
  expect(health.status).toBe("ok");
  expect(health.scheduler.healthy).toBe(true);

  ({ token } = await seedPrincipal());
});

afterAll(async () => {
  await pool.end();
});

/** Rows we assert on, straight from SQL (snake_case columns). */
interface JobRow {
  id: string;
  status: string;
  orchestrator_id: string | null;
  result: { scriptOutput?: unknown } | null;
}

function failFastOnTerminalFailure(rows: JobRow[]): void {
  const bad = rows.find((r) =>
    ["failed", "timed_out", "cancelled"].includes(r.status),
  );
  if (bad) {
    throw new FatalPollError(
      `job ${bad.id} reached terminal status "${bad.status}": ${JSON.stringify(bad)}`,
    );
  }
}

describe("scenario 1 — scheduled script event executes end-to-end", () => {
  it("dispatches on schedule, executes in a container, and lands execution + log output", async () => {
    const marker = `E2E_MARKER_${Date.now().toString(36)}`;

    const created = await trpc<EventDto>(token, "events.create", {
      name: `e2e-scheduled-${marker}`,
      type: "BASH",
      content: `echo "${marker}"`,
      triggerType: "SCHEDULE",
      scheduleNumber: 1,
      scheduleUnit: "MINUTES",
    });
    expect(created.id).toBeGreaterThan(0);
    const eventId = created.id;

    await trpc(token, "events.activate", { id: eventId });

    // Activation materializes next_run_at ≈ one minute out (possibly a beat
    // after the mutation returns). Wait for it, then pull it into the past so
    // the worker's next dispatch tick (1s in this harness) picks it up — the
    // due-row selection, enqueue, claim, and execution paths all still run
    // for real; we only skip the dead wait.
    await poll(
      `event ${eventId} schedule materialized (next_run_at set)`,
      async () => {
        const { rows } = await pool.query<{ next_run_at: Date | null }>(
          `SELECT next_run_at FROM events WHERE id = $1`,
          [eventId],
        );
        return rows[0]?.next_run_at ? true : undefined;
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    );
    const nudged = await pool.query(
      `UPDATE events SET next_run_at = NOW() - interval '1 second' WHERE id = $1`,
      [eventId],
    );
    expect(nudged.rowCount).toBe(1);

    const job = await poll<JobRow>(
      `job for event ${eventId} to complete`,
      async () => {
        const { rows } = await pool.query<JobRow>(
          `SELECT id, status, orchestrator_id, result FROM jobs WHERE event_id = $1`,
          [eventId],
        );
        failFastOnTerminalFailure(rows);
        return rows.find((r) => r.status === "completed");
      },
      { timeoutMs: 150_000 },
    );

    // The REAL orchestrator claimed and executed it — not some in-process path.
    expect(job.orchestrator_id).toBe("e2e-orchestrator");

    const executions = await pool.query(
      `SELECT id, status FROM executions WHERE job_id = $1`,
      [job.id],
    );
    expect(executions.rows.length).toBeGreaterThanOrEqual(1);

    const log = await poll(
      `SUCCESS log with script output for event ${eventId}`,
      async () => {
        const { rows } = await pool.query<{
          status: string;
          output: string | null;
          exit_code: number | null;
        }>(`SELECT status, output, exit_code FROM logs WHERE event_id = $1`, [
          eventId,
        ]);
        return rows.find(
          (r) => r.status === "SUCCESS" && (r.output ?? "").includes(marker),
        );
      },
      { timeoutMs: 60_000 },
    );
    // exit_code may be null on the log row (the code lives on job.result);
    // SUCCESS status + marker output above are the meaningful assertions.
    expect(log.status).toBe("SUCCESS");
  });
});

describe("scenario 2 — two-step workflow passes data via Unified I/O", () => {
  it("cronium_output from step A arrives as cronium_input in step B", async () => {
    const runMarker = `e2e-io-${Date.now().toString(36)}`;

    const eventA = await trpc<EventDto>(token, "events.create", {
      name: `e2e-wf-producer-${runMarker}`,
      type: "BASH",
      content: `cronium_output '{"msg":"${runMarker}"}'`,
      triggerType: "MANUAL",
      status: "ACTIVE",
    });
    const eventB = await trpc<EventDto>(token, "events.create", {
      name: `e2e-wf-consumer-${runMarker}`,
      type: "BASH",
      content: `data="$(cronium_input)"\necho "B_GOT:$data"`,
      triggerType: "MANUAL",
      status: "ACTIVE",
    });

    const nodeData = (id: number, label: string) => ({
      eventId: id,
      label,
      type: "BASH",
      eventTypeIcon: "bash",
    });
    // workflows.create wraps its DTO in mutationResponse ({success, data}).
    const createRes = await trpc<{ success: boolean; data: WorkflowDto }>(
      token,
      "workflows.create",
      {
        name: `e2e-workflow-${runMarker}`,
        triggerType: "MANUAL",
        status: "ACTIVE",
        nodes: [
          {
            id: "n1",
            type: "eventNode",
            position: { x: 0, y: 0 },
            data: nodeData(eventA.id, "producer"),
          },
          {
            id: "n2",
            type: "eventNode",
            position: { x: 300, y: 0 },
            data: nodeData(eventB.id, "consumer"),
          },
        ],
        edges: [
          {
            id: "e1",
            source: "n1",
            target: "n2",
            type: "connectionEdge",
            animated: true,
            data: { connectionType: "ON_SUCCESS" },
          },
        ],
      },
    );
    const workflow = createRes.data;
    expect(workflow.id).toBeGreaterThan(0);

    await trpc(token, "workflows.execute", { id: workflow.id, manual: true });

    // Both step runs must SUCCEED (engine advanced A → B on success).
    await poll(
      `both workflow steps SUCCEEDED for workflow ${workflow.id}`,
      async () => {
        const { rows } = await pool.query<{ status: string; event_id: number }>(
          `SELECT sr.status, sr.event_id
             FROM workflow_step_runs sr
             JOIN workflow_executions we ON we.id = sr.workflow_execution_id
            WHERE we.workflow_id = $1`,
          [workflow.id],
        );
        if (rows.some((r) => ["FAILED", "UNSATISFIABLE"].includes(r.status))) {
          throw new FatalPollError(
            `workflow step failed: ${JSON.stringify(rows)}`,
          );
        }
        return rows.length === 2 && rows.every((r) => r.status === "SUCCEEDED")
          ? rows
          : undefined;
      },
      { timeoutMs: 150_000 },
    );

    // The proof of data passing: step B's stdout contains what A published.
    const logB = await poll(
      `step B log containing step A's output`,
      async () => {
        const { rows } = await pool.query<{ output: string | null }>(
          `SELECT output FROM logs WHERE event_id = $1 AND status = 'SUCCESS'`,
          [eventB.id],
        );
        return rows.find(
          (r) =>
            (r.output ?? "").includes("B_GOT:") &&
            (r.output ?? "").includes(runMarker),
        );
      },
      { timeoutMs: 60_000 },
    );
    expect(logB.output).toContain(runMarker);
  });
});
