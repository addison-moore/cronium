/**
 * A job running across an orchestrator restart, on the real stack: real job
 * containers and sidecars, and the real image restarted through Docker the way
 * `docker compose up -d` and a crash would. The promise under test is that such a
 * job either finishes and reports, or is clearly failed, and that nothing it ran in
 * is left behind.
 *
 * These stop the shared orchestrator, so they stay in one file, in sequence, and
 * always leave it running for whatever comes next.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { APP_URL, poll, pool, seedPrincipal, trpc } from "./helpers";

const ORCHESTRATOR = "cronium-e2e-orchestrator";

let token: string;

beforeAll(async () => {
  ({ token } = await seedPrincipal());
});

afterEach(() => {
  // A no-op if it's running; a failed test mustn't take later ones down with it.
  docker("start", ORCHESTRATOR);
});

afterAll(async () => {
  await pool.end();
});

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function orchestratorLogs(): string {
  const { stdout, stderr } = spawnSync("docker", ["logs", ORCHESTRATOR], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout + stderr;
}

/** A container's state as Docker sees it, or null if there's no such container. */
function containerState(name: string): string | null {
  try {
    return docker("inspect", "--format", "{{.State.Status}}", name);
  } catch {
    return null;
  }
}

function networkExists(name: string): boolean {
  try {
    docker("network", "inspect", name);
    return true;
  } catch {
    return false;
  }
}

async function runEvent(
  content: string,
  options: { retries?: number } = {},
): Promise<{ jobId: string; logId: number }> {
  const { id } = await trpc<{ id: number }>(token, "events.create", {
    name: `e2e-restart-${Date.now().toString(36)}`,
    type: "BASH",
    content,
    triggerType: "MANUAL",
    status: "DRAFT",
    ...options,
  });
  const res = await fetch(`${APP_URL}/api/events/${id}/execute`, {
    method: "POST",
    redirect: "manual",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(202);
  return (await res.json()) as { jobId: string; logId: number };
}

const jobContainer = (jobId: string) => `cronium-job-${jobId}`;
const sidecar = (jobId: string) => `cronium-runtime-${jobId}`;

async function waitForScriptToStart(jobId: string): Promise<void> {
  await poll(
    `the script of job ${jobId} to start`,
    async () =>
      containerState(jobContainer(jobId)) === "running" ? true : undefined,
    { timeoutMs: 60_000, intervalMs: 250 },
  );
}

interface JobRow {
  status: string;
  attempts: number;
  last_error: string | null;
  result: { scriptOutput?: unknown; exitCode?: number } | null;
}

async function jobRow(jobId: string): Promise<JobRow> {
  const { rows } = await pool.query<JobRow>(
    `SELECT status, attempts, last_error, result FROM jobs WHERE id = $1`,
    [jobId],
  );
  return rows[0]!;
}

async function waitForJobStatus(
  jobId: string,
  status: string,
  timeoutMs = 120_000,
): Promise<JobRow> {
  return poll(
    `job ${jobId} to be ${status}`,
    async () => {
      const row = await jobRow(jobId);
      return row.status === status ? row : undefined;
    },
    { timeoutMs },
  );
}

async function logRow(logId: number) {
  const { rows } = await pool.query<{
    status: string;
    output: string | null;
  }>(`SELECT status, output FROM logs WHERE id = $1`, [logId]);
  return rows[0]!;
}

/** Nothing the job ran in may be left: not the script, its sidecar, or its network. */
async function expectNothingLeftBehind(jobId: string): Promise<void> {
  await poll(
    `the containers and network of job ${jobId} to be removed`,
    async () =>
      containerState(jobContainer(jobId)) === null &&
      containerState(sidecar(jobId)) === null &&
      !networkExists(jobContainer(jobId))
        ? true
        : undefined,
    { timeoutMs: 30_000 },
  );
}

/** Put a job past its lease without the dead wait; the sweeper still does the rest. */
async function expireLease(jobId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE jobs SET lease_expires_at = NOW() - interval '1 second' WHERE id = $1`,
    [jobId],
  );
  expect(rowCount).toBe(1);
}

describe("a job running when the orchestrator restarts", () => {
  it("finishes and reports, with its output and helpers intact", async () => {
    const { jobId, logId } = await runEvent(
      `echo before\nsleep 20\ncronium_output '{"survived":true}'\necho after`,
    );
    await waitForScriptToStart(jobId);

    docker("restart", ORCHESTRATOR);

    expect(containerState(jobContainer(jobId))).toBe("running");

    const job = await waitForJobStatus(jobId, "completed");
    expect(job.attempts).toBe(0);
    expect(job.result?.scriptOutput).toEqual({ survived: true });

    const log = await logRow(logId);
    expect(log.status).toBe("SUCCESS");
    expect(log.output).toContain("before");
    expect(log.output).toContain("after");

    const { rows: transitions } = await pool.query<{ actor: string }>(
      `SELECT actor FROM job_transitions WHERE job_id = $1`,
      [jobId],
    );
    expect(transitions.map((t) => t.actor)).not.toContain("sweeper");

    // It left the job running rather than waiting for it, which on a recreate would
    // hold up the whole stack, and its next process is what finished it.
    const logs = orchestratorLogs();
    expect(logs).toContain(
      "Leaving running jobs for the next orchestrator process to pick up",
    );
    expect(
      logs
        .split("\n")
        .some(
          (line) =>
            line.includes(jobId) &&
            line.includes("Picking up a job left running"),
        ),
    ).toBe(true);

    await expectNothingLeftBehind(jobId);
  });

  it("is reported from its stopped container when it ended with no orchestrator running", async () => {
    const { jobId, logId } = await runEvent(
      `echo before\nsleep 5\necho after\nexit 3`,
    );
    await waitForScriptToStart(jobId);

    docker("kill", ORCHESTRATOR);
    await poll(
      `the script of job ${jobId} to end`,
      async () =>
        containerState(jobContainer(jobId)) === "exited" ? true : undefined,
      { timeoutMs: 30_000, intervalMs: 250 },
    );
    expect((await jobRow(jobId)).status).toBe("running");

    docker("start", ORCHESTRATOR);

    const job = await waitForJobStatus(jobId, "failed");
    expect(job.attempts).toBe(0);
    expect(job.result?.exitCode).toBe(3);
    expect((await logRow(logId)).output).toContain("after");

    await expectNothingLeftBehind(jobId);
  });

  it("is clearly failed and removed once its lease is gone", async () => {
    const { jobId } = await runEvent(`echo before\nsleep 300`);
    await waitForScriptToStart(jobId);

    docker("stop", ORCHESTRATOR);
    await expireLease(jobId);
    const job = await waitForJobStatus(jobId, "failed");
    expect(job.last_error).toContain("Lease expired");

    // Nothing else can clean up the script yet.
    expect(containerState(jobContainer(jobId))).toBe("running");

    docker("start", ORCHESTRATOR);
    await expectNothingLeftBehind(jobId);
    expect((await jobRow(jobId)).status).toBe("failed");
  });

  it("runs again in a fresh container if its lease is gone and it has retries", async () => {
    const { jobId, logId } = await runEvent(
      `echo attempt\nsleep 40\necho finished`,
      { retries: 1 },
    );
    await waitForScriptToStart(jobId);
    const firstAttempt = docker(
      "inspect",
      "--format",
      "{{.Id}}",
      jobContainer(jobId),
    );

    docker("stop", ORCHESTRATOR);
    await expireLease(jobId);
    const requeued = await waitForJobStatus(jobId, "queued");
    expect(requeued.attempts).toBe(1);
    // It's still there, under the name the next attempt needs.
    expect(containerState(jobContainer(jobId))).not.toBeNull();

    docker("start", ORCHESTRATOR);

    const job = await waitForJobStatus(jobId, "completed");
    expect(job.attempts).toBe(1);
    expect((await logRow(logId)).output).toContain("finished");

    await expectNothingLeftBehind(jobId);
    expect(containerState(firstAttempt)).toBeNull();
  });
});
