import { z } from "zod";

/**
 * Schemas for the admin-only system-health monitoring endpoints.
 * (Event logs / activity analytics are NOT part of monitoring — see the
 * Logs page and the dashboard router.)
 */

// System metrics schema
export const systemMetricsSchema = z.object({
  includeHistorical: z.boolean().default(false),
  historyPoints: z.number().min(1).max(100).default(24), // Number of historical data points
  interval: z.enum(["minute", "hour", "day"]).default("hour"),
});

// Health check schema
export const healthCheckSchema = z.object({
  includeDatabase: z.boolean().default(true),
  includeExternalServices: z.boolean().default(true),
  includeSystemResources: z.boolean().default(true),
  timeout: z.number().min(1).max(30).default(10), // Timeout in seconds
});
