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
} from "drizzle-orm/pg-core";

// Enums
export enum UserRole {
  USER = "USER",
  ADMIN = "ADMIN",
}

export enum EventType {
  NODEJS = "NODEJS",
  PYTHON = "PYTHON",
  BASH = "BASH",
  HTTP_REQUEST = "HTTP_REQUEST",
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
  PAUSED = "PAUSED", // Added for max execution events
  TIMEOUT = "TIMEOUT", // Added for timeout handling
  PARTIAL = "PARTIAL", // Added for partial multi-server success
}

export enum ConditionalActionType {
  NONE = "NONE",
  SCRIPT = "SCRIPT",
  SEND_MESSAGE = "SEND_MESSAGE",
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

export enum ToolType {
  EMAIL = "EMAIL",
  SLACK = "SLACK",
  DISCORD = "DISCORD",
  WEBHOOK = "WEBHOOK",
  HTTP = "HTTP",
}

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

export const events = pgTable("events", {
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
});

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
  sshKey: text("ssh_key").notNull(),
  username: varchar("username", { length: 255 }).default("root").notNull(),
  port: integer("port").default(22).notNull(),
  shared: boolean("shared").default(false).notNull(),
  online: boolean("online"),
  lastChecked: timestamp("last_checked"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .references(() => events.id)
    .notNull(),
  workflowId: integer("workflow_id").references(() => workflows.id),
  status: varchar("status", { length: 50 })
    .$type<LogStatus>()
    .default(LogStatus.RUNNING)
    .notNull(),
  output: text("output"),
  startTime: timestamp("start_time")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // in milliseconds
  successful: boolean("successful").default(false),
  eventName: varchar("script_name", { length: 255 }),
  scriptType: varchar("script_type", { length: 50 }).$type<EventType>(),
  retries: integer("retries").default(0),
  error: text("error"),
  userId: varchar("user_id", { length: 255 }),
});

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

export const conditionalEvents = pgTable("conditional_events", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).$type<ConditionalActionType>().notNull(),
  value: varchar("value", { length: 255 }),
  successEventId: integer("success_event_id").references(() => events.id),
  failEventId: integer("fail_event_id").references(() => events.id),
  alwaysEventId: integer("always_event_id").references(() => events.id),
  conditionEventId: integer("condition_event_id").references(() => events.id),
  targetEventId: integer("target_event_id").references(() => events.id),
  toolId: integer("tool_id").references(() => toolCredentials.id),
  message: text("message"),
  emailAddresses: text("email_addresses"),
  emailSubject: varchar("email_subject", { length: 255 }),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

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
  type: varchar("type", { length: 50 })
    .$type<ToolType>()
    .notNull(),
  credentials: text("credentials").notNull(), // Encrypted JSON
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 })
    .$type<ToolType>()
    .notNull(),
  content: text("content").notNull(),
  subject: varchar("subject", { length: 500 }), // For email templates
  isSystemTemplate: boolean("is_system_template").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// User variables table for cronium.getVariable() and cronium.setVariable()
export const userVariables = pgTable("user_variables", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  value: text("value").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueUserKey: unique("unique_user_key").on(table.userId, table.key),
}));

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

// Relationships
export const usersRelations = relations(users, ({ one, many }) => ({
  events: many(events),
  servers: many(servers),
  apiTokens: many(apiTokens),
  workflows: many(workflows),
  toolCredentials: many(toolCredentials),
  templates: many(templates),
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
  onSuccessEvents: many(conditionalEvents, {
    relationName: "successEventRelations",
  }),
  onFailEvents: many(conditionalEvents, { relationName: "failEventRelations" }),
  onAlwaysEvents: many(conditionalEvents, { relationName: "alwaysEventRelations" }),
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
}));

export const logsRelations = relations(logs, ({ one }) => ({
  event: one(events, {
    fields: [logs.eventId],
    references: [events.id],
  }),
  workflow: one(workflows, {
    fields: [logs.workflowId],
    references: [workflows.id],
  }),
}));

export const conditionalEventsRelations = relations(
  conditionalEvents,
  ({ one }) => ({
    successEvent: one(events, {
      fields: [conditionalEvents.successEventId],
      references: [events.id],
      relationName: "successEventRelations",
    }),
    failEvent: one(events, {
      fields: [conditionalEvents.failEventId],
      references: [events.id],
      relationName: "failEventRelations",
    }),
    alwaysEvent: one(events, {
      fields: [conditionalEvents.alwaysEventId],
      references: [events.id],
      relationName: "alwaysEventRelations",
    }),
    conditionEvent: one(events, {
      fields: [conditionalEvents.conditionEventId],
      references: [events.id],
      relationName: "conditionEventRelations",
    }),
    targetEvent: one(events, {
      fields: [conditionalEvents.targetEventId],
      references: [events.id],
    }),
  }),
);

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
  scheduleNumber: integer("schedule_number"),
  scheduleUnit: varchar("schedule_unit", { length: 50 }).$type<TimeUnit>(),
  customSchedule: varchar("custom_schedule", { length: 255 }),
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

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.userId],
    references: [users.id],
  }),
}));

export const toolCredentialsRelations = relations(toolCredentials, ({ one }) => ({
  user: one(users, {
    fields: [toolCredentials.userId],
    references: [users.id],
  }),
}));

export const templatesRelations = relations(templates, ({ one }) => ({
  user: one(users, {
    fields: [templates.userId],
    references: [users.id],
  }),
}));

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

export type Log = typeof logs.$inferSelect;
export type InsertLog = typeof logs.$inferInsert;

export type ConditionalAction = typeof conditionalEvents.$inferSelect;
export type InsertConditionalAction = typeof conditionalEvents.$inferInsert;

export type Setting = typeof systemSettings.$inferSelect;
export type InsertSetting = typeof systemSettings.$inferInsert;

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = typeof apiTokens.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type Tool = typeof toolCredentials.$inferSelect;
export type InsertTool = typeof toolCredentials.$inferInsert;

export type Template = typeof templates.$inferSelect;
export type InsertTemplate = typeof templates.$inferInsert;

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

// Remap for backwards compatibility during transition
// We can remove these after all code is updated
export type Script = Event;
export type InsertScript = InsertEvent;
