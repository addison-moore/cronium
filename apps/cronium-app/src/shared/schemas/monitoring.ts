import { z } from "zod";

// Base monitoring query schema
export const monitoringQuerySchema = z.object({
  period: z.enum(["hour", "day", "week", "month", "year"]).default("day"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  includeSystemMetrics: z.boolean().default(true),
  includeRecentActivity: z.boolean().default(true),
  includeSettings: z.boolean().default(false),
});

// System metrics schema
export const systemMetricsSchema = z.object({
  includeHistorical: z.boolean().default(false),
  historyPoints: z.number().min(1).max(100).default(24), // Number of historical data points
  interval: z.enum(["minute", "hour", "day"]).default("hour"),
});

// Activity feed schema
export const activityFeedSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  types: z
    .array(z.enum(["execution", "user_action", "system_event", "error"]))
    .optional(),
  userId: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  since: z.string().datetime().optional(),
});

// Dashboard statistics schema
export const dashboardStatsSchema = z.object({
  period: z.enum(["today", "week", "month", "year", "all"]).default("today"),
  userId: z.string().optional(), // For user-specific stats
  includeComparisons: z.boolean().default(true), // Include period-over-period comparisons
});

// Health check schema
export const healthCheckSchema = z.object({
  includeDatabase: z.boolean().default(true),
  includeExternalServices: z.boolean().default(true),
  includeSystemResources: z.boolean().default(true),
  timeout: z.number().min(1).max(30).default(10), // Timeout in seconds
});

// Performance metrics schema
export const performanceMetricsSchema = z.object({
  period: z.enum(["hour", "day", "week", "month"]).default("day"),
  metrics: z
    .array(
      z.enum([
        "response_time",
        "throughput",
        "error_rate",
        "cpu_usage",
        "memory_usage",
        "disk_usage",
        "network_io",
        "database_connections",
      ]),
    )
    .optional(),
  granularity: z.enum(["minute", "hour", "day"]).default("hour"),
});

// Alert configuration schema
export const alertConfigSchema = z.object({
  type: z.enum([
    "cpu",
    "memory",
    "disk",
    "error_rate",
    "execution_failures",
    "system_health",
  ]),
  threshold: z.number().min(0).max(100),
  comparison: z
    .enum(["greater_than", "less_than", "equals"])
    .default("greater_than"),
  enabled: z.boolean().default(true),
  cooldown: z.number().min(1).max(1440).default(30), // Cooldown in minutes
  notifications: z.array(z.enum(["email", "slack", "webhook"])).default([]),
});

// User activity tracking schema
export const userActivitySchema = z.object({
  userId: z.string().optional(),
  period: z.enum(["hour", "day", "week", "month"]).default("day"),
  activities: z
    .array(
      z.enum([
        "login",
        "logout",
        "event_created",
        "event_executed",
        "workflow_created",
        "workflow_executed",
        "server_added",
        "variable_modified",
      ]),
    )
    .optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

// System resource monitoring schema
export const systemResourceSchema = z.object({
  components: z
    .array(
      z.enum([
        "cpu",
        "memory",
        "disk",
        "network",
        "database",
        "cache",
        "queue",
      ]),
    )
    .optional(),
  detailed: z.boolean().default(false),
  historical: z.boolean().default(false),
  points: z.number().min(1).max(100).default(24),
});

// Event execution analytics schema
export const executionAnalyticsSchema = z.object({
  period: z.enum(["day", "week", "month", "quarter", "year"]).default("week"),
  groupBy: z
    .enum(["status", "event", "user", "server", "hour", "day", "week"])
    .default("status"),
  eventId: z.number().int().positive().optional(),
  userId: z.string().optional(),
  serverId: z.number().int().positive().optional(),
  includeFailureReasons: z.boolean().default(true),
  includePerformanceMetrics: z.boolean().default(true),
});

// Workflow execution analytics schema
export const workflowAnalyticsSchema = z.object({
  period: z.enum(["day", "week", "month", "quarter", "year"]).default("week"),
  workflowId: z.number().int().positive().optional(),
  userId: z.string().optional(),
  includeNodeMetrics: z.boolean().default(true),
  includeExecutionPaths: z.boolean().default(false),
  minDuration: z.number().min(0).optional(), // Filter workflows by minimum duration
  maxDuration: z.number().min(0).optional(), // Filter workflows by maximum duration
});

// Error tracking schema
export const errorTrackingSchema = z.object({
  period: z.enum(["hour", "day", "week", "month"]).default("day"),
  severity: z.enum(["error", "warning", "critical"]).optional(),
  component: z
    .enum(["execution", "database", "network", "system", "authentication"])
    .optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  groupBy: z.enum(["message", "component", "user", "hour", "day"]).optional(),
});

// Audit log schema
export const auditLogSchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
  actions: z
    .array(
      z.enum([
        "create",
        "update",
        "delete",
        "execute",
        "login",
        "logout",
        "invite",
        "activate",
        "deactivate",
      ]),
    )
    .optional(),
  entities: z
    .array(
      z.enum(["user", "event", "workflow", "server", "variable", "setting"]),
    )
    .optional(),
  userId: z.string().optional(),
  adminOnly: z.boolean().default(false),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

// Custom dashboard widget schema
export const dashboardWidgetSchema = z.object({
  type: z.enum([
    "metric_card",
    "chart",
    "activity_feed",
    "status_grid",
    "progress_bar",
    "gauge",
  ]),
  title: z.string().min(1).max(100),
  config: z.record(z.string(), z.any()), // Widget-specific configuration
  position: z.object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().min(1).max(12),
    height: z.number().min(1).max(8),
  }),
  refreshInterval: z.number().min(5).max(300).default(30), // Refresh interval in seconds
});

// Type definitions inferred from schemas
export type MonitoringQueryInput = z.infer<typeof monitoringQuerySchema>;
export type SystemMetricsInput = z.infer<typeof systemMetricsSchema>;
export type ActivityFeedInput = z.infer<typeof activityFeedSchema>;
export type DashboardStatsInput = z.infer<typeof dashboardStatsSchema>;
export type HealthCheckInput = z.infer<typeof healthCheckSchema>;
export type PerformanceMetricsInput = z.infer<typeof performanceMetricsSchema>;
export type AlertConfigInput = z.infer<typeof alertConfigSchema>;
export type UserActivityInput = z.infer<typeof userActivitySchema>;
export type SystemResourceInput = z.infer<typeof systemResourceSchema>;
export type ExecutionAnalyticsInput = z.infer<typeof executionAnalyticsSchema>;
export type WorkflowAnalyticsInput = z.infer<typeof workflowAnalyticsSchema>;
export type ErrorTrackingInput = z.infer<typeof errorTrackingSchema>;
export type AuditLogInput = z.infer<typeof auditLogSchema>;
export type DashboardWidgetInput = z.infer<typeof dashboardWidgetSchema>;
