/**
 * Seed helpers for the storage suites.
 *
 * Rows are inserted DIRECTLY through the real drizzle `db` (not storage.createX)
 * so seeding never depends on the encryption/socket side-effects of the create
 * paths — we want to exercise the DELETE / CLAIM / TRANSITION paths, and give
 * them a maximally-connected graph to tear through. The delete methods under
 * test are storage's own.
 *
 * Secrets are seeded as short plaintext (field-secret's legacy-decrypt passes
 * sub-50-char values through unchanged), so getServer()/decrypt during a delete
 * works without pre-encrypting.
 */
import { db } from "@/server/db";
import {
  users,
  events,
  envVars,
  servers,
  serverGroups,
  serverGroupMembers,
  logs,
  jobs,
  jobTransitions,
  executions,
  eventServers,
  serverDeletionNotifications,
  toolActionLogs,
  workflows,
  workflowNodes,
  workflowConnections,
  workflowLogs,
  workflowExecutions,
  workflowExecutionEvents,
  workflowStepRuns,
  apiTokens,
  toolCredentials,
  userVariables,
  webhooks,
  webhookEvents,
  webhookDeliveries,
  scheduleIncidents,
  EventType,
  JobType,
  JobStatus,
  ConnectionType,
  LogStatus,
  ScheduleIncidentKind,
  WorkflowStepStatus,
} from "@/shared/schema";

let counter = 0;
/** Monotonic suffix so unique columns (email, token, webhook key) never clash
 * within a test even across multiple seeded users. */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export async function seedUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const suffix = uniq();
  const id = overrides.id ?? `user-${suffix}`;
  await db.insert(users).values({
    id,
    email: `${suffix}@example.test`,
    username: `user-${suffix}`,
    ...overrides,
  });
  return id;
}

export async function seedServer(
  userId: string,
  overrides: Partial<typeof servers.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(servers)
    .values({
      userId,
      name: `server-${uniq()}`,
      address: "10.0.0.1",
      sshKey: "short-plaintext-key",
      password: "short-pass",
      ...overrides,
    })
    .returning({ id: servers.id });
  return row!.id;
}

export async function seedServerGroup(
  userId: string,
  serverIds: number[],
): Promise<number> {
  const [group] = await db
    .insert(serverGroups)
    .values({ userId, name: `group-${uniq()}` })
    .returning({ id: serverGroups.id });
  if (serverIds.length > 0) {
    await db
      .insert(serverGroupMembers)
      .values(serverIds.map((serverId) => ({ groupId: group!.id, serverId })));
  }
  return group!.id;
}

export async function seedEvent(
  userId: string,
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({
      userId,
      name: `event-${uniq()}`,
      type: EventType.BASH,
      content: "echo hi",
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

let jobSeq = 0;
export async function seedJob(
  eventId: number,
  userId: string,
  overrides: Partial<typeof jobs.$inferInsert> = {},
): Promise<string> {
  jobSeq += 1;
  const id = overrides.id ?? `job_seed_${jobSeq}_${uniq()}`;
  await db.insert(jobs).values({
    id,
    eventId,
    userId,
    type: JobType.SCRIPT,
    status: JobStatus.QUEUED,
    payload: { script: { type: EventType.BASH, content: "echo hi" } },
    ...overrides,
  });
  return id;
}

export async function seedExecution(
  jobId: string,
  overrides: Partial<typeof executions.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? `exec-${jobId}-${uniq()}`;
  await db.insert(executions).values({
    id,
    jobId,
    status: JobStatus.COMPLETED,
    ...overrides,
  });
  return id;
}

/**
 * The maximally-connected graph the FK-delete tests tear down. Everything below
 * hangs off one user: an event with env_vars / logs / jobs→executions /
 * event_servers / tool_action_logs / workflow_nodes, servers (in a group,
 * bound to the event, with a deletion notification), a workflow with
 * nodes/connections/logs/executions/step-runs, plus the user's tool_credentials
 * / webhooks (+events/deliveries) / api tokens / variables and a
 * schedule_incident.
 */
export interface SeededGraph {
  userId: string;
  serverId: number;
  serverGroupId: number;
  eventId: number;
  jobId: string;
  executionId: string;
  workflowId: number;
  sourceNodeId: number;
  targetNodeId: number;
  workflowExecutionId: number;
  webhookId: number;
}

export async function seedFullGraph(userId?: string): Promise<SeededGraph> {
  const uid = userId ?? (await seedUser());

  const serverId = await seedServer(uid);
  const serverGroupId = await seedServerGroup(uid, [serverId]);

  const eventId = await seedEvent(uid, { serverId });

  await db
    .insert(envVars)
    .values({ eventId, key: "API_KEY", value: "secret-value" });

  const jobId = await seedJob(eventId, uid, { status: JobStatus.COMPLETED });
  const executionId = await seedExecution(jobId);

  // Every real job has transition audit rows (written by transitionJob); the
  // FK has no cascade, so deleteScript must clear them (the live bug this
  // guards was a 23503 on exactly this table).
  await db.insert(jobTransitions).values({
    jobId,
    fromStatus: null,
    toStatus: JobStatus.QUEUED,
    actor: "app",
  });

  await db.insert(logs).values({
    eventId,
    jobId,
    executionId,
    workflowId: null,
    status: LogStatus.SUCCESS,
    userId: uid,
  });

  await db.insert(eventServers).values({ eventId, serverId });

  await db.insert(serverDeletionNotifications).values({
    serverId,
    userId: uid,
    notificationType: "7_day_warning",
  });

  await db.insert(toolActionLogs).values({
    eventId,
    toolType: "slack",
    actionType: "send_message",
    actionId: "act-1",
    status: "success",
  });

  await db.insert(scheduleIncidents).values({
    eventId,
    kind: ScheduleIncidentKind.MISSED,
    details: { note: "seeded" },
  });

  // Workflow graph
  const [wf] = await db
    .insert(workflows)
    .values({ userId: uid, name: `wf-${uniq()}` })
    .returning({ id: workflows.id });
  const workflowId = wf!.id;

  const [srcNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId })
    .returning({ id: workflowNodes.id });
  const [tgtNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId })
    .returning({ id: workflowNodes.id });
  const sourceNodeId = srcNode!.id;
  const targetNodeId = tgtNode!.id;

  await db.insert(workflowConnections).values({
    workflowId,
    sourceNodeId,
    targetNodeId,
    connectionType: ConnectionType.ON_CONDITION,
  });

  await db
    .insert(workflowLogs)
    .values({ workflowId, status: LogStatus.SUCCESS, userId: uid });

  // Workflow-scoped execution log + schedule incident. Both carry a
  // workflow_id FK with no ON DELETE cascade, so deleteWorkflow must remove
  // them explicitly or the workflow row cannot be deleted.
  await db.insert(logs).values({ eventId, workflowId });
  await db.insert(scheduleIncidents).values({
    workflowId,
    kind: ScheduleIncidentKind.MISSED,
    details: { note: "seeded-workflow" },
  });

  const [wfExec] = await db
    .insert(workflowExecutions)
    .values({ workflowId, userId: uid, triggerType: "MANUAL" })
    .returning({ id: workflowExecutions.id });
  const workflowExecutionId = wfExec!.id;

  await db.insert(workflowExecutionEvents).values({
    workflowExecutionId,
    eventId,
    nodeId: sourceNodeId,
    sequenceOrder: 1,
    status: LogStatus.SUCCESS,
  });

  await db.insert(workflowStepRuns).values({
    workflowExecutionId,
    nodeId: sourceNodeId,
    eventId,
    jobId,
    status: WorkflowStepStatus.SUCCEEDED,
  });

  // User-owned resources
  await db
    .insert(apiTokens)
    .values({ userId: uid, name: "tok", token: `token-${uniq()}` });

  await db.insert(toolCredentials).values({
    userId: uid,
    name: "slack-cred",
    type: "slack",
    credentials: "encrypted-blob",
  });

  await db
    .insert(userVariables)
    .values({ userId: uid, key: `VAR_${uniq()}`, value: "v" });

  const [wh] = await db
    .insert(webhooks)
    .values({
      userId: uid,
      name: "hook",
      url: "https://example.test/hook",
      key: `whk-${uniq()}`,
      secret: "whsecret",
    })
    .returning({ id: webhooks.id });
  const webhookId = wh!.id;

  const [whEvent] = await db
    .insert(webhookEvents)
    .values({
      event: "ping",
      payload: {},
      userId: uid,
      sourceWebhookId: webhookId,
    })
    .returning({ id: webhookEvents.id });

  await db.insert(webhookDeliveries).values({
    webhookId,
    webhookEventId: whEvent!.id,
    deliveryId: `dlv-${uniq()}`,
    status: "success",
    attemptedAt: new Date(),
  });

  return {
    userId: uid,
    serverId,
    serverGroupId,
    eventId,
    jobId,
    executionId,
    workflowId,
    sourceNodeId,
    targetNodeId,
    workflowExecutionId,
    webhookId,
  };
}
