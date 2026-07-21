import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  boolean,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums
export enum UserRole {
  USER = "USER",
  ADMIN = "ADMIN",
  // Read-only: may view, but never create, fork, mutate, execute, open a
  // terminal, or use a secret. Enforced centrally in server/security/authorization.ts.
  VIEWER = "VIEWER",
}

export enum EventType {
  NODEJS = "NODEJS",
  PYTHON = "PYTHON",
  BASH = "BASH",
  HTTP_REQUEST = "HTTP_REQUEST",
  TOOL_ACTION = "TOOL_ACTION",
}

export enum EventStatus {
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  DRAFT = "DRAFT",
  ARCHIVED = "ARCHIVED",
}

export enum RunLocation {
  LOCAL = "LOCAL",
  REMOTE = "REMOTE",
  // Runs on the Cronium host AND on the event's remote servers
  LOCAL_AND_REMOTE = "LOCAL_AND_REMOTE",
}

export enum TimeUnit {
  SECONDS = "SECONDS",
  MINUTES = "MINUTES",
  HOURS = "HOURS",
  DAYS = "DAYS",
}

export enum LogStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE",
  RUNNING = "RUNNING",
  TIMEOUT = "TIMEOUT", // Added for timeout handling
  PARTIAL = "PARTIAL", // Added for partial multi-server success
}

export enum WorkflowTriggerType {
  SCHEDULE = "SCHEDULE",
  WEBHOOK = "WEBHOOK",
  MANUAL = "MANUAL",
}

export enum EventTriggerType {
  SCHEDULE = "SCHEDULE",
  MANUAL = "MANUAL",
}

export enum ConnectionType {
  ALWAYS = "ALWAYS",
  ON_SUCCESS = "ON_SUCCESS",
  ON_FAILURE = "ON_FAILURE",
  ON_CONDITION = "ON_CONDITION",
}

export enum WorkflowLogLevel {
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

// Tables
export enum UserStatus {
  ACTIVE = "ACTIVE",
  INVITED = "INVITED",
  DISABLED = "DISABLED",
  PENDING = "PENDING",
}

export enum TokenStatus {
  ACTIVE = "ACTIVE",
  REVOKED = "REVOKED",
}

// ToolType enum removed - now using string type for flexibility

// Job Queue Enums
export enum JobType {
  SCRIPT = "SCRIPT",
  HTTP_REQUEST = "HTTP_REQUEST",
  TOOL_ACTION = "TOOL_ACTION",
}

export enum JobStatus {
  QUEUED = "queued",
  CLAIMED = "claimed",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  TIMED_OUT = "timed_out",
  CANCELLED = "cancelled",
}

export enum JobPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

// Scheduling enums (see _plans/scheduling/PLAN.md)

/** How an event's schedule is expressed. Legacy rows have NULL and derive the
 * kind from customSchedule presence. */
export enum ScheduleKind {
  INTERVAL = "INTERVAL",
  CRON = "CRON",
}

/** What the dispatcher does with ticks that were missed (app down / paused
 * past a tick / dispatcher behind). */
export enum CatchupPolicy {
  SKIP = "SKIP",
  RUN_ONCE = "RUN_ONCE",
  RUN_ALL = "RUN_ALL",
}

/** What a due tick does when a previous run of the same event is still active.
 * QUEUE coalesces: at most one queued job waits behind the running one. */
export enum OverlapPolicy {
  ALLOW = "ALLOW",
  SKIP = "SKIP",
  QUEUE = "QUEUE",
  CANCEL_PREVIOUS = "CANCEL_PREVIOUS",
}

/** What the lease sweeper does when a job's owner stops renewing its lease.
 * RETRY re-queues (at-least-once); FAIL terminates loudly (at-most-once, for
 * non-idempotent work). */
export enum LeaseLossPolicy {
  RETRY = "RETRY",
  FAIL = "FAIL",
}

/** What created a job. */
export enum JobSource {
  EVENT = "EVENT",
  WORKFLOW_STEP = "WORKFLOW_STEP",
  MANUAL = "MANUAL",
  WEBHOOK = "WEBHOOK",
}

/** Step states for the event-sourced workflow engine (PLAN.md §3.5).
 * SKIPPED = branch not taken (no incoming edge satisfied); UNSATISFIABLE =
 * conflicting edges can never all hold (the old engine stalled 30 minutes on
 * these). Both are terminal and visible, not silently absent. */
export enum WorkflowStepStatus {
  PENDING = "PENDING",
  DISPATCHED = "DISPATCHED",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
  UNSATISFIABLE = "UNSATISFIABLE",
}

/** Schedule-level occurrences that produced no job (or a degraded one) —
 * queryable per event so "didn't run" is as visible as "ran and failed". */
export enum ScheduleIncidentKind {
  MISSED = "MISSED",
  SKIPPED_OVERLAP = "SKIPPED_OVERLAP",
  CATCHUP_OVERFLOW = "CATCHUP_OVERFLOW",
  AUTO_PAUSED = "AUTO_PAUSED",
  LEASE_LOST = "LEASE_LOST",
}

export type ScriptType = EventType.NODEJS | EventType.PYTHON | EventType.BASH;

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  email: varchar("email", { length: 255 }).unique(),
  username: varchar("username", { length: 255 }).unique(),
  password: text("password"),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 255 }),
  role: varchar("role", { length: 50 })
    .$type<UserRole>()
    .default(UserRole.USER)
    .notNull(),
  roleId: integer("role_id").references(() => roles.id),
  status: varchar("status", { length: 50 })
    .$type<UserStatus>()
    .default(UserStatus.ACTIVE)
    .notNull(),
  // Monotonic counter embedded in browser sessions and checked on every
  // sensitive request. Bumped transactionally on password/role/status changes
  // so stale JWTs and cached principals fail closed immediately.
  sessionVersion: integer("session_version").default(1).notNull(),
  inviteToken: varchar("invite_token", { length: 255 }),
  inviteExpiry: timestamp("invite_expiry"),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    shared: boolean("shared").default(false).notNull(),
    type: varchar("type", { length: 50 }).$type<EventType>().notNull(),
    content: text("content"),
    // HTTP Request specific fields
    httpMethod: varchar("http_method", { length: 20 }),
    httpUrl: varchar("http_url", { length: 1000 }),
    httpHeaders: jsonb("http_headers"),
    httpBody: text("http_body"),
    // Tool Action specific fields
    toolActionConfig: jsonb("tool_action_config"),
    // Provenance: how this event was created (e.g. "mcp"); null for the UI / normal API.
    source: varchar("source", { length: 50 }),
    // Common fields
    status: varchar("status", { length: 50 })
      .$type<EventStatus>()
      .default(EventStatus.DRAFT)
      .notNull(),
    triggerType: varchar("trigger_type", { length: 50 })
      .$type<EventTriggerType>()
      .default(EventTriggerType.MANUAL)
      .notNull(),
    scheduleNumber: integer("schedule_number").default(1).notNull(),
    scheduleUnit: varchar("schedule_unit", { length: 50 })
      .$type<TimeUnit>()
      .default(TimeUnit.MINUTES)
      .notNull(),
    customSchedule: varchar("custom_schedule", { length: 255 }),
    // NULL on legacy rows: derive from customSchedule (set → CRON, else INTERVAL)
    scheduleKind: varchar("schedule_kind", {
      length: 20,
    }).$type<ScheduleKind>(),
    // IANA zone name; cron schedules are evaluated in this zone
    timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
    catchupPolicy: varchar("catchup_policy", { length: 20 })
      .$type<CatchupPolicy>()
      .default(CatchupPolicy.SKIP)
      .notNull(),
    overlapPolicy: varchar("overlap_policy", { length: 20 })
      .$type<OverlapPolicy>()
      .default(OverlapPolicy.ALLOW)
      .notNull(),
    misfireGraceS: integer("misfire_grace_s").default(60).notNull(),
    leaseLossPolicy: varchar("lease_loss_policy", { length: 10 })
      .$type<LeaseLossPolicy>()
      .default(LeaseLossPolicy.RETRY)
      .notNull(),
    priority: integer("priority")
      .$type<JobPriority>()
      .default(JobPriority.NORMAL)
      .notNull(),
    runLocation: varchar("run_location", { length: 50 })
      .$type<RunLocation>()
      .default(RunLocation.LOCAL)
      .notNull(),
    serverId: integer("server_id").references(() => servers.id),
    timeoutValue: integer("timeout_value").default(30).notNull(),
    timeoutUnit: varchar("timeout_unit", { length: 50 })
      .$type<TimeUnit>()
      .default(TimeUnit.SECONDS)
      .notNull(),
    retries: integer("retries").default(0).notNull(),
    startTime: timestamp("start_time"),
    executionCount: integer("execution_count").default(0).notNull(),
    maxExecutions: integer("max_executions").default(0).notNull(), // 0 means unlimited
    resetCounterOnActive: boolean("reset_counter_on_active")
      .default(false)
      .notNull(),
    payloadVersion: integer("payload_version").default(1).notNull(),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    successCount: integer("success_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    tags: jsonb("tags").default("[]").notNull(), // Array of strings for tags
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("events_dispatch_idx")
      .on(t.nextRunAt)
      .where(sql`${t.status} = 'ACTIVE' AND ${t.triggerType} = 'SCHEDULE'`),
  ],
);

export const envVars = pgTable("env_vars", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .references(() => events.id)
    .notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  value: varchar("value", { length: 255 }).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const servers = pgTable("servers", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 255 }).notNull(),
  sshKey: text("ssh_key"),
  password: text("password"),
  username: varchar("username", { length: 255 }).default("root").notNull(),
  port: integer("port").default(22).notNull(),
  shared: boolean("shared").default(false).notNull(),
  online: boolean("online"),
  lastChecked: timestamp("last_checked"),
  // Archive fields for soft delete
  isArchived: boolean("is_archived").default(false).notNull(),
  archivedAt: timestamp("archived_at"),
  archivedBy: varchar("archived_by", { length: 255 }),
  archiveReason: text("archive_reason"),
  deletionScheduledAt: timestamp("deletion_scheduled_at"),
  // Original sensitive data (before purging)
  sshKeyPurged: boolean("ssh_key_purged").default(false).notNull(),
  passwordPurged: boolean("password_purged").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const serverGroups = pgTable("server_groups", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const serverGroupMembers = pgTable(
  "server_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .references(() => serverGroups.id, { onDelete: "cascade" })
      .notNull(),
    serverId: integer("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueGroupServer: unique("unique_group_server").on(
      table.groupId,
      table.serverId,
    ),
  }),
);

export const logs = pgTable(
  "logs",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .references(() => events.id)
      .notNull(),
    workflowId: integer("workflow_id").references(() => workflows.id),
    jobId: varchar("job_id", { length: 50 }).references(() => jobs.id),
    executionId: varchar("execution_id", { length: 100 }).references(
      () => executions.id,
    ),
    status: varchar("status", { length: 50 })
      .$type<LogStatus>()
      .default(LogStatus.RUNNING)
      .notNull(),
    output: text("output"),
    startTime: timestamp("start_time")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    endTime: timestamp("end_time"),
    duration: integer("duration"), // in milliseconds - total duration
    executionDuration: integer("execution_duration"), // in milliseconds - actual script execution time
    setupDuration: integer("setup_duration"), // in milliseconds - setup time (container/SSH)
    successful: boolean("successful").default(false),
    eventName: varchar("event_name", { length: 255 }),
    eventType: varchar("event_type", { length: 50 }).$type<EventType>(),
    retries: integer("retries").default(0),
    error: text("error"),
    userId: varchar("user_id", { length: 255 }),
    exitCode: integer("exit_code"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("logs_job_id_idx").on(t.jobId),
    index("logs_event_created_idx").on(t.eventId, t.createdAt),
  ],
);

// Job Queue Table
export const jobs = pgTable(
  "jobs",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    eventId: integer("event_id")
      .references(() => events.id)
      .notNull(),
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id)
      .notNull(),
    type: varchar("type", { length: 50 }).$type<JobType>().notNull(),
    status: varchar("status", { length: 50 })
      .$type<JobStatus>()
      .default(JobStatus.QUEUED)
      .notNull(),
    priority: integer("priority")
      .$type<JobPriority>()
      .default(JobPriority.NORMAL)
      .notNull(),
    payload: jsonb("payload").notNull(),
    scheduledFor: timestamp("scheduled_for")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    orchestratorId: varchar("orchestrator_id", { length: 255 }),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    result: jsonb("result"),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    metadata: jsonb("metadata").default("{}").notNull(),
    // Scheduling kernel fields (see _plans/scheduling/PLAN.md §3.2)
    source: varchar("source", { length: 20 }).$type<JobSource>(),
    // Resolved from the event at enqueue; every consumer honors this value
    timeoutMs: integer("timeout_ms"),
    maxAttempts: integer("max_attempts").default(0).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at"),
    leaseLossPolicy: varchar("lease_loss_policy", { length: 10 })
      .$type<LeaseLossPolicy>()
      .default(LeaseLossPolicy.RETRY)
      .notNull(),
    cancelRequested: boolean("cancel_requested").default(false).notNull(),
    // = eventId for SKIP-overlap events while the job is active, else NULL;
    // the partial unique index below is the DB-level overlap backstop
    activeKey: varchar("active_key", { length: 64 }),
    // Dispatched late past the event's misfire grace (RUN_ONCE catch-up)
    scheduledMiss: boolean("scheduled_miss").default(false).notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("jobs_claim_idx")
      .on(t.type, t.priority.desc(), t.scheduledFor)
      .where(sql`${t.status} = 'queued'`),
    index("jobs_lease_idx")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} IN ('claimed', 'running')`),
    index("jobs_event_created_idx").on(t.eventId, t.createdAt),
    uniqueIndex("jobs_active_key_uq")
      .on(t.activeKey)
      .where(
        sql`${t.status} IN ('queued', 'claimed', 'running') AND ${t.activeKey} IS NOT NULL`,
      ),
  ],
);

// Executions Table - tracks individual execution attempts for jobs
export const executions = pgTable(
  "executions",
  {
    id: varchar("id", { length: 100 }).primaryKey(), // Format: exec-{jobId}-{timestamp}
    jobId: varchar("job_id", { length: 50 })
      .references(() => jobs.id)
      .notNull(),
    serverId: integer("server_id").references(() => servers.id), // NULL for local/container executions
    serverName: varchar("server_name", { length: 255 }), // Quick reference for server name
    status: varchar("status", { length: 50 })
      .$type<JobStatus>()
      .default(JobStatus.QUEUED)
      .notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    exitCode: integer("exit_code"),
    output: text("output"), // stdout/stderr combined
    error: text("error"), // Error message if failed
    metadata: jsonb("metadata").default("{}").notNull(), // Additional execution data
    // Phase-based timing fields for separating setup/execution/cleanup
    setupStartedAt: timestamp("setup_started_at"),
    setupCompletedAt: timestamp("setup_completed_at"),
    executionStartedAt: timestamp("execution_started_at"),
    executionCompletedAt: timestamp("execution_completed_at"),
    cleanupStartedAt: timestamp("cleanup_started_at"),
    cleanupCompletedAt: timestamp("cleanup_completed_at"),
    setupDuration: integer("setup_duration"), // milliseconds for setup phase
    executionDuration: integer("execution_duration"), // milliseconds for actual script execution
    cleanupDuration: integer("cleanup_duration"), // milliseconds for cleanup phase
    totalDuration: integer("total_duration"), // total milliseconds (cached calculation)
    executionMetadata: jsonb("execution_metadata"), // Detailed timing breakdown (imagePullTime, connectionTime, etc.)
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [index("executions_job_id_idx").on(t.jobId)],
);

// Per-job status-transition audit + transactional outbox. Written only by
// transitionJob() (src/lib/scheduling/job-transition.ts). `processedAt` is the
// outbox cursor: NULL rows have side effects (conditional actions, broadcasts,
// alerts) still pending; the worker's outbox consumer marks them processed.
export const jobTransitions = pgTable(
  "job_transitions",
  {
    id: serial("id").primaryKey(),
    jobId: varchar("job_id", { length: 50 })
      .references(() => jobs.id)
      .notNull(),
    // NULL = job creation (no prior status)
    fromStatus: varchar("from_status", { length: 50 }).$type<JobStatus>(),
    toStatus: varchar("to_status", { length: 50 }).$type<JobStatus>().notNull(),
    // Who drove the transition: "app", "worker:<id>", "orchestrator:<id>", "user:<id>"
    actor: varchar("actor", { length: 255 }).notNull(),
    reason: text("reason"),
    data: jsonb("data"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("job_transitions_job_idx").on(t.jobId),
    index("job_transitions_outbox_idx")
      .on(t.id)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

// Schedule-level occurrences that produced no job (missed tick, overlap skip,
// catch-up overflow, auto-pause, lease loss) — the "didn't run" record the UI
// surfaces alongside runs. Exactly one of eventId/workflowId is set.
export const scheduleIncidents = pgTable(
  "schedule_incidents",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").references(() => events.id),
    workflowId: integer("workflow_id").references(() => workflows.id),
    kind: varchar("kind", { length: 30 })
      .$type<ScheduleIncidentKind>()
      .notNull(),
    // e.g. { scheduledFor, ticksFolded, jobId }
    details: jsonb("details"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [index("schedule_incidents_event_idx").on(t.eventId, t.createdAt)],
);

export const eventServers = pgTable("event_servers", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .references(() => events.id)
    .notNull(),
  serverId: integer("server_id")
    .references(() => servers.id)
    .notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Server deletion notifications
export const serverDeletionNotifications = pgTable(
  "server_deletion_notifications",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id)
      .notNull(),
    notificationType: varchar("notification_type", { length: 50 }).notNull(), // "7_day_warning", "1_day_warning", "deletion_complete"
    sentAt: timestamp("sent_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    acknowledged: boolean("acknowledged").default(false).notNull(),
    acknowledgedAt: timestamp("acknowledged_at"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
);

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  token: varchar("token", { length: 255 }).unique().notNull(),
  status: varchar("status", { length: 50 })
    .$type<TokenStatus>()
    .default(TokenStatus.ACTIVE)
    .notNull(),
  lastUsed: timestamp("last_used"),
  expiresAt: timestamp("expires_at"),
  // Optional least-privilege scope list. NULL = full user rights (the default,
  // and all pre-existing tokens). A non-null array limits the token to the
  // procedures those scopes permit (see server/token-scopes.ts).
  scopes: jsonb("scopes").$type<string[]>(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).unique().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  permissions: jsonb("permissions").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const toolCredentials = pgTable("tool_credentials", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // Now accepts any string value
  credentials: text("credentials").notNull(), // Encrypted JSON
  isActive: boolean("is_active").default(true).notNull(),
  encrypted: boolean("encrypted").default(false).notNull(),
  encryptionMetadata: jsonb("encryption_metadata"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// OAuth tokens table
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => toolCredentials.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 50 }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    tokenType: varchar("token_type", { length: 50 })
      .notNull()
      .default("Bearer"),
    scope: text("scope"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueUserToolProvider: unique("unique_user_tool_provider").on(
      table.userId,
      table.toolId,
      table.providerId,
    ),
  }),
);

// OAuth state table for CSRF protection
export const oauthStates = pgTable("oauth_states", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 255 }).notNull().unique(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toolId: integer("tool_id")
    .notNull()
    .references(() => toolCredentials.id, { onDelete: "cascade" }),
  providerId: varchar("provider_id", { length: 50 }).notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Tool action templates table for saving reusable tool action configurations
export const toolActionTemplates = pgTable("tool_action_templates", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  toolType: varchar("tool_type", { length: 50 }).notNull(), // DISCORD, SLACK, EMAIL, etc.
  actionId: varchar("action_id", { length: 100 }).notNull(), // send-message, send-email, etc.
  parameters: jsonb("parameters").notNull(), // Stored action parameters
  isSystemTemplate: boolean("is_system_template").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// User variables table for cronium.getVariable() and cronium.setVariable()
export const userVariables = pgTable(
  "user_variables",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserKey: unique("unique_user_key").on(table.userId, table.key),
  }),
);

// User settings table for editor preferences and other user-specific settings
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  editorSettings: text("editor_settings"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Tool audit logs table
export const toolAuditLogs = pgTable("tool_audit_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  toolId: integer("tool_id").references(() => toolCredentials.id, {
    onDelete: "set null",
  }),
  action: varchar("action", { length: 50 }).notNull(), // 'create', 'read', 'update', 'delete', 'execute', 'auth_failure'
  actionDetails: jsonb("action_details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  success: boolean("success").default(true).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Tool rate limits table
export const toolRateLimits = pgTable(
  "tool_rate_limits",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    toolType: varchar("tool_type", { length: 50 }).notNull(),
    windowStart: timestamp("window_start").notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    lastRequest: timestamp("last_request"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueUserToolWindow: unique("unique_user_tool_window").on(
      table.userId,
      table.toolType,
      table.windowStart,
    ),
  }),
);

// User tool quotas table
export const userToolQuotas = pgTable(
  "user_tool_quotas",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    toolType: varchar("tool_type", { length: 50 }),
    dailyLimit: integer("daily_limit"),
    hourlyLimit: integer("hourly_limit"),
    burstLimit: integer("burst_limit"),
    tier: varchar("tier", { length: 20 }).default("free").notNull(), // 'free', 'pro', 'enterprise'
    customLimits: jsonb("custom_limits"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueUserTool: unique("unique_user_tool").on(table.userId, table.toolType),
  }),
);

// Relationships
export const usersRelations = relations(users, ({ one, many }) => ({
  events: many(events),
  servers: many(servers),
  apiTokens: many(apiTokens),
  workflows: many(workflows),
  toolCredentials: many(toolCredentials),
  userVariables: many(userVariables),
  userSettings: one(userSettings),
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  user: one(users, {
    fields: [events.userId],
    references: [users.id],
  }),
  server: one(servers, {
    fields: [events.serverId],
    references: [servers.id],
  }),
  eventServers: many(eventServers),
  envVars: many(envVars),
  logs: many(logs),
}));

export const envVarsRelations = relations(envVars, ({ one }) => ({
  event: one(events, {
    fields: [envVars.eventId],
    references: [events.id],
  }),
}));

export const eventServersRelations = relations(eventServers, ({ one }) => ({
  event: one(events, {
    fields: [eventServers.eventId],
    references: [events.id],
  }),
  server: one(servers, {
    fields: [eventServers.serverId],
    references: [servers.id],
  }),
}));

export const serversRelations = relations(servers, ({ one, many }) => ({
  user: one(users, {
    fields: [servers.userId],
    references: [users.id],
  }),
  events: many(events),
  eventServers: many(eventServers),
  executions: many(executions),
  groupMembers: many(serverGroupMembers),
}));

export const serverGroupsRelations = relations(
  serverGroups,
  ({ one, many }) => ({
    user: one(users, {
      fields: [serverGroups.userId],
      references: [users.id],
    }),
    members: many(serverGroupMembers),
  }),
);

export const serverGroupMembersRelations = relations(
  serverGroupMembers,
  ({ one }) => ({
    group: one(serverGroups, {
      fields: [serverGroupMembers.groupId],
      references: [serverGroups.id],
    }),
    server: one(servers, {
      fields: [serverGroupMembers.serverId],
      references: [servers.id],
    }),
  }),
);

export const logsRelations = relations(logs, ({ one }) => ({
  event: one(events, {
    fields: [logs.eventId],
    references: [events.id],
  }),
  workflow: one(workflows, {
    fields: [logs.workflowId],
    references: [workflows.id],
  }),
  job: one(jobs, {
    fields: [logs.jobId],
    references: [jobs.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  event: one(events, {
    fields: [jobs.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [jobs.userId],
    references: [users.id],
  }),
  logs: many(logs),
  executions: many(executions),
}));

export const executionsRelations = relations(executions, ({ one }) => ({
  job: one(jobs, {
    fields: [executions.jobId],
    references: [jobs.id],
  }),
  server: one(servers, {
    fields: [executions.serverId],
    references: [servers.id],
  }),
}));

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  triggerType: varchar("trigger_type", { length: 50 })
    .$type<WorkflowTriggerType>()
    .default(WorkflowTriggerType.MANUAL)
    .notNull(),
  webhookKey: varchar("webhook_key", { length: 255 }),
  // Provenance: how this workflow was created (e.g. "mcp"); null for the UI / normal API.
  source: varchar("source", { length: 50 }),
  scheduleNumber: integer("schedule_number"),
  scheduleUnit: varchar("schedule_unit", { length: 50 }).$type<TimeUnit>(),
  customSchedule: varchar("custom_schedule", { length: 255 }),
  // Durable schedule materialization for SCHEDULE-triggered workflows —
  // dispatched by the worker's dispatcher loop, same as events (PLAN.md §4.1)
  nextRunAt: timestamp("next_run_at"),
  runLocation: varchar("run_location", { length: 50 })
    .$type<RunLocation>()
    .default(RunLocation.LOCAL)
    .notNull(),
  overrideEventServers: boolean("override_event_servers")
    .default(false)
    .notNull(),
  overrideServerIds: jsonb("override_server_ids"), // Array of server IDs
  status: varchar("status", { length: 50 })
    .$type<EventStatus>()
    .default(EventStatus.DRAFT)
    .notNull(),
  shared: boolean("shared").default(false).notNull(),
  tags: jsonb("tags").default("[]").notNull(), // Array of strings for tags
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowNodes = pgTable("workflow_nodes", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),
  eventId: integer("event_id")
    .references(() => events.id)
    .notNull(),
  position_x: integer("position_x").default(0).notNull(),
  position_y: integer("position_y").default(0).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowConnections = pgTable("workflow_connections", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),
  sourceNodeId: integer("source_node_id")
    .references(() => workflowNodes.id, { onDelete: "cascade" })
    .notNull(),
  targetNodeId: integer("target_node_id")
    .references(() => workflowNodes.id, { onDelete: "cascade" })
    .notNull(),
  connectionType: varchar("connection_type", { length: 50 })
    .$type<ConnectionType>()
    .default(ConnectionType.ALWAYS)
    .notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowLogs = pgTable("workflow_logs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .references(() => workflows.id)
    .notNull(),
  status: varchar("status", { length: 50 })
    .$type<LogStatus>()
    .default(LogStatus.RUNNING)
    .notNull(),
  level: varchar("level", { length: 50 })
    .$type<WorkflowLogLevel>()
    .default(WorkflowLogLevel.INFO)
    .notNull(),
  message: text("message"),
  startTime: timestamp("start_time")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  endTime: timestamp("end_time"),
  output: text("output"),
  error: text("error"),
  timestamp: timestamp("timestamp")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  userId: varchar("user_id", { length: 255 }),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowExecutions = pgTable("workflow_executions", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 })
    .$type<LogStatus>()
    .default(LogStatus.RUNNING)
    .notNull(),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(),
  startedAt: timestamp("started_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  completedAt: timestamp("completed_at"),
  totalDuration: integer("total_duration"), // in milliseconds
  totalEvents: integer("total_events").default(0),
  successfulEvents: integer("successful_events").default(0),
  failedEvents: integer("failed_events").default(0),
  executionData: jsonb("execution_data"), // store execution details, payload, etc.
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowExecutionEvents = pgTable("workflow_execution_events", {
  id: serial("id").primaryKey(),
  workflowExecutionId: integer("workflow_execution_id")
    .references(() => workflowExecutions.id, { onDelete: "cascade" })
    .notNull(),
  eventId: integer("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  nodeId: integer("node_id").notNull(),
  sequenceOrder: integer("sequence_order").notNull(),
  status: varchar("status", { length: 50 })
    .$type<LogStatus>()
    .default(LogStatus.PENDING)
    .notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  duration: integer("duration"), // in milliseconds
  output: text("output"),
  errorMessage: text("error_message"),
  connectionType: varchar("connection_type", { length: 50 }), // how this event was triggered
  branchId: varchar("branch_id", { length: 100 }), // identifies which branch this event belongs to
  parallelGroupId: varchar("parallel_group_id", { length: 100 }), // groups parallel nodes executing together
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Source-of-truth step state for the event-sourced workflow engine
// (src/lib/scheduling/workflow-engine.ts). One row per node per run; the
// engine's advance() reducer is a pure function of these rows plus the jobs
// they reference. workflow_execution_events remains as UI-facing telemetry
// (dual-written by the engine).
export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: serial("id").primaryKey(),
    workflowExecutionId: integer("workflow_execution_id")
      .references(() => workflowExecutions.id, { onDelete: "cascade" })
      .notNull(),
    // Mirrors workflow_execution_events.nodeId: plain integer, no FK — a run's
    // history must survive graph edits
    nodeId: integer("node_id").notNull(),
    eventId: integer("event_id").notNull(),
    status: varchar("status", { length: 20 })
      .$type<WorkflowStepStatus>()
      .default(WorkflowStepStatus.PENDING)
      .notNull(),
    // Plain varchar (no FK): retention deletes old job rows; the run history
    // must not block that
    jobId: varchar("job_id", { length: 50 }),
    // Snapshots read by downstream steps (input resolution + ON_CONDITION)
    output: jsonb("output"),
    condition: boolean("condition"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    // Companion telemetry row in workflow_execution_events (UI graph)
    executionEventId: integer("execution_event_id"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("workflow_step_runs_exec_idx").on(t.workflowExecutionId),
    index("workflow_step_runs_job_idx").on(t.jobId),
  ],
);

export const toolActionLogs = pgTable("tool_action_logs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  toolType: varchar("tool_type", { length: 50 }).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  actionId: varchar("action_id", { length: 100 }).notNull(),
  parameters: jsonb("parameters"),
  result: jsonb("result"),
  status: varchar("status", { length: 20 }).notNull(),
  executionTime: integer("execution_time"), // milliseconds
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  user: one(users, {
    fields: [workflows.userId],
    references: [users.id],
  }),
  nodes: many(workflowNodes),
  connections: many(workflowConnections),
  logs: many(workflowLogs),
  executions: many(workflowExecutions),
}));

export const workflowNodesRelations = relations(
  workflowNodes,
  ({ one, many }) => ({
    workflow: one(workflows, {
      fields: [workflowNodes.workflowId],
      references: [workflows.id],
    }),
    event: one(events, {
      fields: [workflowNodes.eventId],
      references: [events.id],
    }),
    outgoingConnections: many(workflowConnections, {
      relationName: "sourceConnections",
    }),
    incomingConnections: many(workflowConnections, {
      relationName: "targetConnections",
    }),
  }),
);

export const workflowConnectionsRelations = relations(
  workflowConnections,
  ({ one }) => ({
    workflow: one(workflows, {
      fields: [workflowConnections.workflowId],
      references: [workflows.id],
    }),
    sourceNode: one(workflowNodes, {
      fields: [workflowConnections.sourceNodeId],
      references: [workflowNodes.id],
      relationName: "sourceConnections",
    }),
    targetNode: one(workflowNodes, {
      fields: [workflowConnections.targetNodeId],
      references: [workflowNodes.id],
      relationName: "targetConnections",
    }),
  }),
);

export const workflowLogsRelations = relations(workflowLogs, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowLogs.workflowId],
    references: [workflows.id],
  }),
}));

export const workflowExecutionsRelations = relations(
  workflowExecutions,
  ({ one, many }) => ({
    workflow: one(workflows, {
      fields: [workflowExecutions.workflowId],
      references: [workflows.id],
    }),
    events: many(workflowExecutionEvents),
  }),
);

export const workflowExecutionEventsRelations = relations(
  workflowExecutionEvents,
  ({ one }) => ({
    execution: one(workflowExecutions, {
      fields: [workflowExecutionEvents.workflowExecutionId],
      references: [workflowExecutions.id],
    }),
    event: one(events, {
      fields: [workflowExecutionEvents.eventId],
      references: [events.id],
    }),
  }),
);

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, {
    fields: [apiTokens.userId],
    references: [users.id],
  }),
}));

export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetTokens.userId],
      references: [users.id],
    }),
  }),
);

export const toolCredentialsRelations = relations(
  toolCredentials,
  ({ one }) => ({
    user: one(users, {
      fields: [toolCredentials.userId],
      references: [users.id],
    }),
  }),
);

export const toolActionTemplatesRelations = relations(
  toolActionTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [toolActionTemplates.userId],
      references: [users.id],
    }),
  }),
);

export const userVariablesRelations = relations(userVariables, ({ one }) => ({
  user: one(users, {
    fields: [userVariables.userId],
    references: [users.id],
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

export type EnvVar = typeof envVars.$inferSelect;
export type InsertEnvVar = typeof envVars.$inferInsert;

export type Server = typeof servers.$inferSelect;
export type InsertServer = typeof servers.$inferInsert;

export type ServerGroup = typeof serverGroups.$inferSelect;
export type InsertServerGroup = typeof serverGroups.$inferInsert;
export type ServerGroupMember = typeof serverGroupMembers.$inferSelect;

export type Log = typeof logs.$inferSelect;
export type InsertLog = typeof logs.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

export type Execution = typeof executions.$inferSelect;
export type InsertExecution = typeof executions.$inferInsert;

export type JobTransition = typeof jobTransitions.$inferSelect;
export type InsertJobTransition = typeof jobTransitions.$inferInsert;

export type WorkflowStepRun = typeof workflowStepRuns.$inferSelect;
export type InsertWorkflowStepRun = typeof workflowStepRuns.$inferInsert;

export type ScheduleIncident = typeof scheduleIncidents.$inferSelect;
export type InsertScheduleIncident = typeof scheduleIncidents.$inferInsert;

export type Setting = typeof systemSettings.$inferSelect;
export type InsertSetting = typeof systemSettings.$inferInsert;

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = typeof apiTokens.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type Tool = typeof toolCredentials.$inferSelect;
export type InsertTool = typeof toolCredentials.$inferInsert;

export type UserVariable = typeof userVariables.$inferSelect;
export type InsertUserVariable = typeof userVariables.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

export type Workflow = typeof workflows.$inferSelect;
export type InsertWorkflow = typeof workflows.$inferInsert;

export type WorkflowNode = typeof workflowNodes.$inferSelect;
export type InsertWorkflowNode = typeof workflowNodes.$inferInsert;

export type WorkflowConnection = typeof workflowConnections.$inferSelect;
export type InsertWorkflowConnection = typeof workflowConnections.$inferInsert;

export type WorkflowLog = typeof workflowLogs.$inferSelect;
export type InsertWorkflowLog = typeof workflowLogs.$inferInsert;

export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type InsertWorkflowExecution = typeof workflowExecutions.$inferInsert;

export type WorkflowExecutionEvent =
  typeof workflowExecutionEvents.$inferSelect;
export type InsertWorkflowExecutionEvent =
  typeof workflowExecutionEvents.$inferInsert;

export type EventServer = typeof eventServers.$inferSelect;
export type InsertEventServer = typeof eventServers.$inferInsert;

export type ToolActionLog = typeof toolActionLogs.$inferSelect;
export type InsertToolActionLog = typeof toolActionLogs.$inferInsert;

export type ServerDeletionNotification =
  typeof serverDeletionNotifications.$inferSelect;
export type InsertServerDeletionNotification =
  typeof serverDeletionNotifications.$inferInsert;

// Webhook tables
export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url").notNull(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull().default("[]"), // Array of event names
  headers: jsonb("headers").default("{}"), // Custom headers
  active: boolean("active").default(true).notNull(),
  verifyTimestamp: boolean("verify_timestamp").default(true),
  ipWhitelist: jsonb("ip_whitelist"), // Array of allowed IPs
  rateLimit: jsonb("rate_limit"), // { requests: number, window: number }
  retryConfig: jsonb("retry_config"), // { maxRetries: number, retryDelay: number, backoffMultiplier: number }
  transformations: jsonb("transformations"), // Data transformation rules
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 255 }).notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id")
    .references(() => webhooks.id, { onDelete: "cascade" })
    .notNull(),
  webhookEventId: integer("webhook_event_id")
    .references(() => webhookEvents.id, { onDelete: "cascade" })
    .notNull(),
  deliveryId: varchar("delivery_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(), // success, failed
  statusCode: integer("status_code"),
  response: text("response"),
  error: text("error"),
  headers: jsonb("headers"),
  duration: integer("duration"), // milliseconds
  attemptedAt: timestamp("attempted_at").notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id")
    .references(() => webhooks.id, { onDelete: "cascade" })
    .notNull(),
  success: boolean("success").notNull(),
  error: text("error"),
  eventId: integer("event_id"),
  duration: integer("duration"), // milliseconds
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Webhook relationships
export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  user: one(users, {
    fields: [webhooks.userId],
    references: [users.id],
  }),
  deliveries: many(webhookDeliveries),
  logs: many(webhookLogs),
}));

export const webhookEventsRelations = relations(webhookEvents, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhook: one(webhooks, {
      fields: [webhookDeliveries.webhookId],
      references: [webhooks.id],
    }),
    event: one(webhookEvents, {
      fields: [webhookDeliveries.webhookEventId],
      references: [webhookEvents.id],
    }),
  }),
);

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookLogs.webhookId],
    references: [webhooks.id],
  }),
}));

// Export types
export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = typeof webhookLogs.$inferInsert;

// Rate limiting and quota tables
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  subIdentifier: varchar("sub_identifier", { length: 255 }),
  count: integer("count").notNull().default(0),
  limit: integer("limit").notNull(),
  windowMs: integer("window_ms").notNull(),
  resetAt: timestamp("reset_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userQuotas = pgTable("user_quotas", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  quotaConfig: jsonb("quota_config").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const quotaUsage = pgTable("quota_usage", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  resource: varchar("resource", { length: 100 }).notNull(),
  amount: integer("amount").notNull().default(1),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const toolUsageMetrics = pgTable("tool_usage_metrics", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  toolId: varchar("tool_id", { length: 100 }).notNull(),
  actionId: varchar("action_id", { length: 100 }),
  executionTime: integer("execution_time"), // milliseconds
  success: boolean("success").notNull(),
  errorType: varchar("error_type", { length: 100 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rate limiting relationships
export const rateLimitBucketsRelations = relations(
  rateLimitBuckets,
  () => ({}),
);

export const userQuotasRelations = relations(userQuotas, ({ one }) => ({
  user: one(users, {
    fields: [userQuotas.userId],
    references: [users.id],
  }),
}));

export const quotaUsageRelations = relations(quotaUsage, ({ one }) => ({
  user: one(users, {
    fields: [quotaUsage.userId],
    references: [users.id],
  }),
}));

export const toolUsageMetricsRelations = relations(
  toolUsageMetrics,
  ({ one }) => ({
    user: one(users, {
      fields: [toolUsageMetrics.userId],
      references: [users.id],
    }),
  }),
);

// Export types
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type InsertRateLimitBucket = typeof rateLimitBuckets.$inferInsert;

export type UserQuota = typeof userQuotas.$inferSelect;
export type InsertUserQuota = typeof userQuotas.$inferInsert;

export type QuotaUsage = typeof quotaUsage.$inferSelect;
export type InsertQuotaUsage = typeof quotaUsage.$inferInsert;

export type ToolUsageMetric = typeof toolUsageMetrics.$inferSelect;
export type InsertToolUsageMetric = typeof toolUsageMetrics.$inferInsert;

// Runner tables
export const runnerPayloads = pgTable("runner_payloads", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  eventVersion: integer("event_version").notNull(),
  payloadPath: text("payload_path").notNull(),
  checksumPath: text("checksum_path"),
  payloadSize: integer("payload_size").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
});

export const runnerDeployments = pgTable("runner_deployments", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  runnerVersion: text("runner_version").notNull(),
  runnerPath: text("runner_path").notNull(),
  checksum: text("checksum").notNull(),
  deployedAt: timestamp("deployed_at").notNull().defaultNow(),
  lastUsed: timestamp("last_used"),
  status: text("status").notNull().default("active"), // active, failed, updating
});

export type RunnerPayload = typeof runnerPayloads.$inferSelect;
export type InsertRunnerPayload = typeof runnerPayloads.$inferInsert;
export type RunnerDeployment = typeof runnerDeployments.$inferSelect;
export type InsertRunnerDeployment = typeof runnerDeployments.$inferInsert;
