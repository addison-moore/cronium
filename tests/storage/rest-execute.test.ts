/**
 * The REST run routes against real Postgres and Valkey: real token rows, real
 * ownership checks, and a job the orchestrator can actually claim. The mocked
 * suite (apps/cronium-app/src/app/api/__tests__/execute-routes.test.ts) cannot
 * show that a 202 means something was queued, or that someone else's event is
 * refused by the checks themselves.
 */
// Only tokens are under test, and the rejected ones fall through to a session
// lookup. The real NextAuth stack needs a request scope this suite does not have.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as executeEvent } from "@/app/api/events/[id]/execute/route";
import { POST as executeWorkflow } from "@/app/api/workflows/[id]/execute/route";
import { cacheService } from "@/lib/cache/cache-service";
import { RateLimitService } from "@/lib/rate-limit-service";
import { jobService } from "@/lib/services/job-service";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  ConnectionType,
  JobSource,
  JobStatus,
  JobType,
  LogStatus,
  OverlapPolicy,
  RunLocation,
  ScheduleIncidentKind,
  TokenStatus,
  UserRole,
  WorkflowStepStatus,
  WorkflowTriggerType,
  events,
  jobTransitions,
  jobs,
  logs,
  scheduleIncidents,
  workflowConnections,
  workflowExecutions,
  workflowNodes,
  workflowStepRuns,
  workflows,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedServer, seedUser } from "./helpers/seed";

async function seedToken(
  userId: string,
  scopes: string[] | null = ["full"],
  overrides: { status?: TokenStatus; expiresAt?: Date } = {},
): Promise<string> {
  const token = `test-token-${randomUUID()}`;
  await storage.createApiToken({
    userId,
    name: "ci",
    token,
    scopes,
    ...overrides,
  } as never);
  return token;
}

async function seedWorkflow(
  userId: string,
  eventIds: number[],
  overrides: Partial<typeof workflows.$inferInsert> = {},
): Promise<number> {
  const [workflow] = await db
    .insert(workflows)
    .values({ userId, name: `wf-${randomUUID()}`, ...overrides })
    .returning({ id: workflows.id });
  const workflowId = workflow!.id;

  let previousNodeId: number | undefined;
  for (const eventId of eventIds) {
    const [node] = await db
      .insert(workflowNodes)
      .values({ workflowId, eventId })
      .returning({ id: workflowNodes.id });
    if (previousNodeId !== undefined) {
      await db.insert(workflowConnections).values({
        workflowId,
        sourceNodeId: previousNodeId,
        targetNodeId: node!.id,
        connectionType: ConnectionType.ALWAYS,
      });
    }
    previousNodeId = node!.id;
  }
  return workflowId;
}

function post(
  handler: typeof executeEvent,
  path: "events" | "workflows",
  id: number | string,
  token: string | null,
  body?: unknown,
) {
  return handler(
    new NextRequest(`http://localhost:5001/api/${path}/${String(id)}/execute`, {
      method: "POST",
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      ...(body !== undefined && {
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

const runEvent = (id: number | string, token: string | null, body?: unknown) =>
  post(executeEvent, "events", id, token, body);
const runWorkflow = (
  id: number | string,
  token: string | null,
  body?: unknown,
) => post(executeWorkflow, "workflows", id, token, body);

async function jobCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(jobs);
  return row!.n;
}
async function logCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(logs);
  return row!.n;
}
async function runCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(workflowExecutions);
  return row!.n;
}

async function waitForCache(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!cacheService.isAvailable()) {
    if (Date.now() > deadline) throw new Error("Valkey never became available");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("POST /api/events/{id}/execute", () => {
  describe("enqueue", () => {
    it("queues a job the orchestrator can claim, with the input on its payload", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner);
      const token = await seedToken(owner);

      const res = await runEvent(eventId, token, {
        input: { commit: "abc123" },
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as {
        success: boolean;
        logId: number;
        jobId: string;
      };
      expect(body.success).toBe(true);

      const [job] = await db.select().from(jobs).where(eq(jobs.id, body.jobId));
      expect(job).toMatchObject({
        eventId,
        userId: owner,
        type: JobType.SCRIPT,
        status: JobStatus.QUEUED,
        source: JobSource.MANUAL,
      });
      expect(job!.payload).toMatchObject({ input: { commit: "abc123" } });
      expect(job!.metadata).toMatchObject({
        triggeredBy: "manual",
        logId: body.logId,
      });

      const [log] = await db.select().from(logs).where(eq(logs.id, body.logId));
      expect(log).toMatchObject({
        eventId,
        userId: owner,
        jobId: body.jobId,
        status: LogStatus.PENDING,
      });

      const transitions = await db
        .select()
        .from(jobTransitions)
        .where(eq(jobTransitions.jobId, body.jobId));
      expect(transitions).toEqual([
        expect.objectContaining({
          toStatus: JobStatus.QUEUED,
          actor: `user:${owner}`,
        }),
      ]);

      const claimed = await jobService.claimJobs("orch-rest-test", 10);
      expect(claimed.map((j) => j.id)).toEqual([body.jobId]);
    });

    it("needs no body, and gives the script empty input", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner);
      const token = await seedToken(owner);

      const res = await runEvent(eventId, token);

      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      expect(job!.payload).toMatchObject({ input: {} });
    });

    it("runs an event in any status and does not count against its cap", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner, {
        status: "DRAFT" as never,
        maxExecutions: 1,
        executionCount: 1,
      });
      const token = await seedToken(owner);

      const res = await runEvent(eventId, token);

      expect(res.status).toBe(202);
      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, eventId));
      expect(event).toMatchObject({ executionCount: 1, status: "DRAFT" });
    });

    it("answers 409 for an overlap-SKIP event already running, and records it", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner, {
        overlapPolicy: OverlapPolicy.SKIP,
      });
      const token = await seedToken(owner);

      expect((await runEvent(eventId, token)).status).toBe(202);
      expect((await runEvent(eventId, token)).status).toBe(409);

      expect(await jobCount()).toBe(1);
      const incidents = await db
        .select()
        .from(scheduleIncidents)
        .where(eq(scheduleIncidents.eventId, eventId));
      expect(incidents.map((i) => i.kind)).toEqual([
        ScheduleIncidentKind.SKIPPED_OVERLAP,
      ]);
    });
  });

  describe("token scopes", () => {
    it.each([
      ["full", ["full"], 202],
      ["mcp", ["mcp"], 202],
      ["an empty list", [], 403],
      ["no list at all", null, 403],
      ["an unknown scope", ["execute"], 403],
    ])(
      "a token with %s gets the right answer",
      async (_label, scopes, status) => {
        const owner = await seedUser();
        const eventId = await seedEvent(owner);
        const token = await seedToken(owner, scopes);

        const res = await runEvent(eventId, token);

        expect(res.status).toBe(status);
        expect(await jobCount()).toBe(status === 202 ? 1 : 0);
      },
    );

    it.each([
      ["revoked", { status: TokenStatus.REVOKED }],
      ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ])("refuses a %s token", async (_label, overrides) => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner);
      const token = await seedToken(owner, ["full"], overrides);

      expect((await runEvent(eventId, token)).status).toBe(401);
      expect(await jobCount()).toBe(0);
    });

    it("refuses a request with no token, or one it has never seen", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner);

      expect((await runEvent(eventId, null)).status).toBe(401);
      expect((await runEvent(eventId, "never-issued")).status).toBe(401);
      expect(await jobCount()).toBe(0);
    });

    it("refuses a read-only account's full token", async () => {
      const viewer = await seedUser({ role: UserRole.VIEWER });
      const eventId = await seedEvent(viewer);
      const token = await seedToken(viewer);

      expect((await runEvent(eventId, token)).status).toBe(403);
      expect(await jobCount()).toBe(0);
    });
  });

  describe("ownership", () => {
    it("refuses another user's event, shared or not", async () => {
      const owner = await seedUser();
      const other = await seedUser();
      const token = await seedToken(other);
      const privateEvent = await seedEvent(owner);
      const sharedEvent = await seedEvent(owner, { shared: true });

      for (const eventId of [privateEvent, sharedEvent]) {
        const res = await runEvent(eventId, token);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Access denied" });
      }
      expect(await jobCount()).toBe(0);
      expect(await logCount()).toBe(0);
    });

    it("refuses an event bound to a server its owner cannot use", async () => {
      const owner = await seedUser();
      const other = await seedUser();
      const token = await seedToken(owner);
      const theirServer = await seedServer(other);
      const archivedServer = await seedServer(owner, { isArchived: true });

      for (const serverId of [theirServer, archivedServer]) {
        const eventId = await seedEvent(owner, {
          runLocation: RunLocation.REMOTE,
          serverId,
        });
        expect((await runEvent(eventId, token)).status).toBe(403);
      }
      expect(await jobCount()).toBe(0);
    });

    it("answers 404 for an event that does not exist", async () => {
      const owner = await seedUser();
      const token = await seedToken(owner);

      expect((await runEvent(999_999, token)).status).toBe(404);
    });
  });

  describe("rate limit", () => {
    it("shares one budget with tRPC's events.execute", async () => {
      await waitForCache();
      const owner = await seedUser();
      const eventId = await seedEvent(owner);
      const token = await seedToken(owner);
      const budget = { maxRequests: 50, windowMs: 60_000 };

      // tRPC's withRateLimit(50, 60000) calls checkLimit with these arguments.
      for (let i = 0; i < budget.maxRequests; i++) {
        await RateLimitService.checkLimit(owner, "events.execute", budget);
      }

      const res = await runEvent(eventId, token);

      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
      expect(await jobCount()).toBe(0);
    });
  });
});

describe("POST /api/workflows/{id}/execute", () => {
  describe("enqueue", () => {
    it("starts a run and queues only the starting node, with the input", async () => {
      const owner = await seedUser();
      const first = await seedEvent(owner);
      const second = await seedEvent(owner);
      const workflowId = await seedWorkflow(owner, [first, second]);
      const token = await seedToken(owner);

      const res = await runWorkflow(workflowId, token, {
        input: { commit: "abc123" },
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as {
        success: boolean;
        executionId: number;
        status: string;
      };
      expect(body).toMatchObject({ success: true, status: LogStatus.RUNNING });

      const [run] = await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, body.executionId));
      expect(run).toMatchObject({
        workflowId,
        userId: owner,
        status: LogStatus.RUNNING,
        triggerType: WorkflowTriggerType.MANUAL,
      });
      expect(run!.executionData).toMatchObject({
        inputData: { commit: "abc123" },
      });

      const steps = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.workflowExecutionId, body.executionId));
      expect(steps).toHaveLength(2);
      expect(steps.find((step) => step.eventId === second)?.status).toBe(
        WorkflowStepStatus.PENDING,
      );

      const queued = await db.select().from(jobs);
      expect(queued).toEqual([
        expect.objectContaining({
          eventId: first,
          userId: owner,
          status: JobStatus.QUEUED,
          source: JobSource.WORKFLOW_STEP,
        }),
      ]);
      expect(queued[0]!.payload).toMatchObject({
        input: { commit: "abc123" },
        workflowExecutionId: body.executionId,
      });

      const claimed = await jobService.claimJobs("orch-rest-test", 10);
      expect(claimed.map((j) => j.id)).toEqual([queued[0]!.id]);
    });

    it("answers 409 with the reason when the workflow has no nodes", async () => {
      const owner = await seedUser();
      const workflowId = await seedWorkflow(owner, []);
      const token = await seedToken(owner);

      const res = await runWorkflow(workflowId, token);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Workflow has no nodes" });
      expect(await runCount()).toBe(0);
    });

    it("answers 409 when every node has an incoming edge, so none can start", async () => {
      const owner = await seedUser();
      const eventId = await seedEvent(owner);
      const workflowId = await seedWorkflow(owner, [eventId, eventId]);
      const nodes = await db
        .select({ id: workflowNodes.id })
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, workflowId));
      await db.insert(workflowConnections).values({
        workflowId,
        sourceNodeId: nodes[1]!.id,
        targetNodeId: nodes[0]!.id,
        connectionType: ConnectionType.ALWAYS,
      });
      const token = await seedToken(owner);

      const res = await runWorkflow(workflowId, token);

      expect(res.status).toBe(409);
      expect(await runCount()).toBe(0);
    });
  });

  describe("token scopes", () => {
    it.each([
      ["full", ["full"], 202],
      ["mcp", ["mcp"], 202],
      ["an empty list", [], 403],
      ["no list at all", null, 403],
    ])(
      "a token with %s gets the right answer",
      async (_label, scopes, status) => {
        const owner = await seedUser();
        const eventId = await seedEvent(owner);
        const workflowId = await seedWorkflow(owner, [eventId]);
        const token = await seedToken(owner, scopes);

        expect((await runWorkflow(workflowId, token)).status).toBe(status);
        expect(await runCount()).toBe(status === 202 ? 1 : 0);
      },
    );
  });

  describe("ownership", () => {
    it("refuses another user's workflow, shared or not", async () => {
      const owner = await seedUser();
      const other = await seedUser();
      const token = await seedToken(other);
      const eventId = await seedEvent(owner);
      const privateWorkflow = await seedWorkflow(owner, [eventId]);
      const sharedWorkflow = await seedWorkflow(owner, [eventId], {
        shared: true,
      });

      for (const workflowId of [privateWorkflow, sharedWorkflow]) {
        expect((await runWorkflow(workflowId, token)).status).toBe(403);
      }
      expect(await runCount()).toBe(0);
      expect(await jobCount()).toBe(0);
    });

    it("refuses the owner's workflow when it runs someone else's event", async () => {
      const owner = await seedUser();
      const other = await seedUser();
      const theirEvent = await seedEvent(other, { shared: true });
      const workflowId = await seedWorkflow(owner, [theirEvent]);
      const token = await seedToken(owner);

      expect((await runWorkflow(workflowId, token)).status).toBe(403);
      expect(await runCount()).toBe(0);
      expect(await jobCount()).toBe(0);
    });

    it("answers 404 for a workflow that does not exist", async () => {
      const owner = await seedUser();
      const token = await seedToken(owner);

      expect((await runWorkflow(999_999, token)).status).toBe(404);
    });
  });
});
