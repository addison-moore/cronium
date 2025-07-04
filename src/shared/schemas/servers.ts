import { z } from "zod";

// Base server query schema
export const serverQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  online: z.boolean().optional(),
  shared: z.boolean().optional(),
});

// Create server schema
export const createServerSchema = z.object({
  name: z
    .string()
    .min(1, "Server name is required")
    .max(100, "Server name must be less than 100 characters"),
  address: z
    .string()
    .min(1, "Server address is required")
    .max(255, "Address must be less than 255 characters")
    .refine((addr) => {
      // Basic validation for IP address or hostname
      const ipv4Regex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      const hostnameRegex =
        /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return ipv4Regex.test(addr) || hostnameRegex.test(addr);
    }, "Please enter a valid IP address or hostname"),
  sshKey: z
    .string()
    .min(1, "SSH key is required")
    .refine((key) => {
      // Basic SSH key format validation
      return (
        key.includes("BEGIN") &&
        key.includes("END") &&
        key.includes("PRIVATE KEY")
      );
    }, "SSH key must be in valid PEM format"),
  username: z
    .string()
    .min(1, "Username is required")
    .max(50, "Username must be less than 50 characters")
    .default("root"),
  port: z
    .number()
    .int()
    .min(1, "Port must be at least 1")
    .max(65535, "Port must be less than 65536")
    .default(22),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional(),
  tags: z.array(z.string()).default([]),
  shared: z.boolean().default(false),
  maxConcurrentJobs: z
    .number()
    .int()
    .min(1, "Must allow at least 1 concurrent job")
    .max(100, "Cannot exceed 100 concurrent jobs")
    .default(5),
});

// Update server schema
export const updateServerSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
  name: z.string().min(1).max(100).optional(),
  address: z
    .string()
    .min(1)
    .max(255)
    .refine((addr) => {
      const ipv4Regex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      const hostnameRegex =
        /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return ipv4Regex.test(addr) || hostnameRegex.test(addr);
    }, "Please enter a valid IP address or hostname")
    .optional(),
  sshKey: z
    .string()
    .refine((key) => {
      // Allow empty string to keep existing key, or validate if provided
      if (!key || key.length === 0) return true;
      return (
        key.includes("BEGIN") &&
        key.includes("END") &&
        key.includes("PRIVATE KEY")
      );
    }, "SSH key must be in valid PEM format")
    .optional(),
  username: z.string().min(1).max(50).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  shared: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(100).optional(),
});

// Server ID parameter schema
export const serverIdSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
});

// Server health check schema
export const serverHealthCheckSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
  timeout: z.number().int().min(1).max(60).default(10), // timeout in seconds
});

// Server events query schema
export const serverEventsSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  status: z
    .enum(["ACTIVE", "DRAFT", "ARCHIVED", "ERROR", "RUNNING"])
    .optional(),
});

// Bulk server operations schema
export const bulkServerOperationSchema = z.object({
  serverIds: z
    .array(z.number().int().positive())
    .min(1, "At least one server must be selected"),
  operation: z.enum(["delete", "check_health", "share", "unshare"]),
});

// Server connection test schema
export const testServerConnectionSchema = z.object({
  address: z
    .string()
    .min(1, "Server address is required")
    .refine((addr) => {
      const ipv4Regex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      const hostnameRegex =
        /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return ipv4Regex.test(addr) || hostnameRegex.test(addr);
    }, "Please enter a valid IP address or hostname"),
  sshKey: z
    .string()
    .min(1, "SSH key is required")
    .refine((key) => {
      return (
        key.includes("BEGIN") &&
        key.includes("END") &&
        key.includes("PRIVATE KEY")
      );
    }, "SSH key must be in valid PEM format"),
  username: z.string().min(1, "Username is required").default("root"),
  port: z.number().int().min(1).max(65535).default(22),
  timeout: z.number().int().min(1).max(60).default(10),
});

// Server usage stats schema
export const serverUsageStatsSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
  period: z.enum(["day", "week", "month", "year"]).default("week"),
});

// Server logs schema
export const serverLogsSchema = z.object({
  id: z.number().int().positive("Server ID must be a positive integer"),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  level: z.enum(["ERROR", "WARN", "INFO", "DEBUG"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// Type definitions inferred from schemas
export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type ServerQueryInput = z.infer<typeof serverQuerySchema>;
export type ServerHealthCheckInput = z.infer<typeof serverHealthCheckSchema>;
export type ServerEventsInput = z.infer<typeof serverEventsSchema>;
export type BulkServerOperationInput = z.infer<
  typeof bulkServerOperationSchema
>;
export type TestServerConnectionInput = z.infer<
  typeof testServerConnectionSchema
>;
export type ServerUsageStatsInput = z.infer<typeof serverUsageStatsSchema>;
export type ServerLogsInput = z.infer<typeof serverLogsSchema>;
