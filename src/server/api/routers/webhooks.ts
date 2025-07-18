import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  withTiming,
  withRateLimit,
} from "../trpc";
import {
  webhookQuerySchema,
  createWebhookSchema,
  updateWebhookSchema,
  webhookKeySchema,
  testWebhookSchema,
  executeWebhookSchema,
  webhookExecutionHistorySchema,
  webhookStatsSchema,
  bulkWebhookOperationSchema,
  webhookSecuritySchema,
  generateWebhookUrlSchema,
  webhookMonitoringSchema,
  webhookPayloadValidationSchema,
  webhookResponseSchema,
} from "@shared/schemas/webhooks";
import { withErrorHandling, notFoundError } from "@/server/utils/error-utils";
import {
  listResponse,
  resourceResponse,
  mutationResponse,
  statsResponse,
} from "@/server/utils/api-patterns";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";

// Use standardized procedure with timing and rate limiting
const webhookProcedure = protectedProcedure
  .use(withTiming)
  .use(withRateLimit(100, 60000)); // 100 webhook operations per minute

// Public procedure for webhook execution (no auth required)
const publicWebhookProcedure = publicProcedure
  .use(withTiming)
  .use(withRateLimit(200, 60000)); // 200 webhook executions per minute

// Helper function to get user webhooks (mock implementation)
async function getUserWebhooks(userId: string): Promise<
  Array<{
    id: number;
    userId: string;
    workflowId: number;
    key: string;
    url: string;
    description: string;
    isActive: boolean;
    allowedMethods: string[];
    allowedIps: string[];
    rateLimitPerMinute: number;
    requireAuth: boolean;
    authToken: string | null;
    customHeaders: Record<string, string>;
    responseFormat: "json" | "text" | "xml";
    triggerCount: number;
    lastTriggered: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  // Mock webhook data - in real implementation, this would query the database
  const mockWebhooks = [
    {
      id: 1,
      userId,
      workflowId: 1,
      key: "deploy-pipeline-webhook",
      url: `/api/workflows/webhook/deploy-pipeline-webhook`,
      description: "Webhook for deployment pipeline workflow",
      isActive: true,
      allowedMethods: ["POST", "PUT"],
      allowedIps: [],
      rateLimitPerMinute: 60,
      requireAuth: false,
      authToken: null,
      customHeaders: {},
      responseFormat: "json" as const,
      triggerCount: 145,
      lastTriggered: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      userId,
      workflowId: 2,
      key: "alert-notifications",
      url: `/api/workflows/webhook/alert-notifications`,
      description: "Webhook for alert notification workflow",
      isActive: true,
      allowedMethods: ["POST"],
      allowedIps: ["192.168.1.0/24"],
      rateLimitPerMinute: 100,
      requireAuth: true,
      authToken: "secure-token-123",
      customHeaders: { "X-Custom-Header": "required-value" },
      responseFormat: "json" as const,
      triggerCount: 89,
      lastTriggered: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  return mockWebhooks;
}

// Helper function to get webhook by key
async function getWebhookByKey(key: string) {
  // Mock implementation - would query database in real app
  const mockWebhooks = await getUserWebhooks("mock-user");
  return mockWebhooks.find((w) => w.key === key);
}

// Helper function to get webhook execution history (mock implementation)
async function getWebhookExecutions(
  key?: string,
  _filters?: Record<string, unknown>,
) {
  const mockExecutions = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    webhookKey: key ?? `webhook-${Math.floor(Math.random() * 3) + 1}`,
    workflowId: Math.floor(Math.random() * 3) + 1,
    status: (["success", "failure", "timeout", "rate_limited"] as const)[
      Math.floor(Math.random() * 4)
    ],
    method: (["GET", "POST", "PUT", "PATCH"] as const)[
      Math.floor(Math.random() * 4)
    ],
    sourceIp: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
    userAgent: "Mozilla/5.0 (compatible; WebhookBot/1.0)",
    payload: {
      message: `Test payload ${i + 1}`,
      timestamp: new Date().toISOString(),
    },
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "WebhookBot/1.0",
    },
    responseCode: [200, 400, 500, 429][Math.floor(Math.random() * 4)],
    responseTime: Math.floor(Math.random() * 2000) + 100,
    timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
    error: Math.random() > 0.7 ? "Mock error for testing" : null,
  }));

  return mockExecutions;
}

export const webhooksRouter = createTRPCRouter({
  // Get all user webhooks
  getAll: webhookProcedure
    .input(webhookQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const webhooks = await getUserWebhooks(ctx.session.user.id);

          // Apply filters
          let filteredWebhooks = webhooks;

          if (input.workflowId) {
            filteredWebhooks = filteredWebhooks.filter(
              (w) => w.workflowId === input.workflowId,
            );
          }

          if (!input.includeInactive) {
            filteredWebhooks = filteredWebhooks.filter((w) => w.isActive);
          }

          if (input.search) {
            const searchLower = input.search.toLowerCase();
            filteredWebhooks = filteredWebhooks.filter(
              (webhook) =>
                webhook.key.toLowerCase().includes(searchLower) ||
                webhook.description?.toLowerCase().includes(searchLower),
            );
          }

          // Apply sorting
          filteredWebhooks.sort((a, b) => {
            let aValue: string | Date | number, bValue: string | Date | number;

            switch (input.sortBy) {
              case "name":
                aValue = a.key;
                bValue = b.key;
                break;
              case "createdAt":
                aValue = a.createdAt;
                bValue = b.createdAt;
                break;
              case "lastTriggered":
                aValue = a.lastTriggered ?? new Date(0);
                bValue = b.lastTriggered ?? new Date(0);
                break;
              case "triggerCount":
                aValue = a.triggerCount;
                bValue = b.triggerCount;
                break;
              default:
                aValue = a.key;
                bValue = b.key;
            }

            if (input.sortOrder === "desc") {
              return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            } else {
              return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            }
          });

          // Apply pagination
          const pagination = normalizePagination(input);
          const paginatedWebhooks = filteredWebhooks.slice(
            pagination.offset,
            pagination.offset + pagination.limit,
          );

          const result = createPaginatedResult(
            paginatedWebhooks,
            filteredWebhooks.length,
            pagination,
          );
          const filters: {
            [key: string]: unknown;
            search?: string;
            status?: string;
            type?: string;
          } = {};
          if (input.workflowId !== undefined) {
            filters.workflowId = input.workflowId;
          }
          if (input.search !== undefined) {
            filters.search = input.search;
          }
          return listResponse(result, filters);
        },
        {
          component: "webhooksRouter",
          operationName: "getAll",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get single webhook by key
  getByKey: webhookProcedure
    .input(webhookKeySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const webhooks = await getUserWebhooks(ctx.session.user.id);
          const webhook = webhooks.find((w) => w.key === input.key);

          if (!webhook) {
            throw notFoundError("Webhook");
          }

          return resourceResponse(webhook);
        },
        {
          component: "webhooksRouter",
          operationName: "getByKey",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Create new webhook
  create: webhookProcedure
    .input(createWebhookSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const existingWebhooks = await getUserWebhooks(ctx.session.user.id);

          // Generate key if not provided
          const key =
            input.key ??
            `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Check if key already exists
          if (existingWebhooks.some((w) => w.key === key)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A webhook with this key already exists",
            });
          }

          // Mock creating webhook
          const newWebhook = {
            id: Math.max(...existingWebhooks.map((w) => w.id), 0) + 1,
            userId: ctx.session.user.id,
            workflowId: input.workflowId,
            key,
            url: `/api/workflows/webhook/${key}`,
            description: input.description,
            isActive: input.isActive,
            allowedMethods: input.allowedMethods,
            allowedIps: input.allowedIps ?? [],
            rateLimitPerMinute: input.rateLimitPerMinute,
            requireAuth: input.requireAuth,
            authToken: input.authToken,
            customHeaders: input.customHeaders ?? {},
            responseFormat: input.responseFormat,
            triggerCount: 0,
            lastTriggered: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          console.log(
            `Created webhook "${key}" for workflow ${String(input.workflowId)} by user ${ctx.session.user.id}`,
          );

          return mutationResponse(newWebhook, "Webhook created successfully");
        },
        {
          component: "webhooksRouter",
          operationName: "create",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Update existing webhook
  update: webhookProcedure
    .input(updateWebhookSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const { key, ...updateData } = input;

          const webhooks = await getUserWebhooks(ctx.session.user.id);
          const existingWebhook = webhooks.find((w) => w.key === key);

          if (!existingWebhook) {
            throw notFoundError("Webhook");
          }

          // Mock updating webhook
          const updatedWebhook = {
            ...existingWebhook,
            ...updateData,
            updatedAt: new Date(),
          };

          console.log(`Updated webhook ${key} for user ${ctx.session.user.id}`);

          return mutationResponse(
            updatedWebhook,
            "Webhook updated successfully",
          );
        },
        {
          component: "webhooksRouter",
          operationName: "update",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Delete webhook
  delete: webhookProcedure
    .input(webhookKeySchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const webhooks = await getUserWebhooks(ctx.session.user.id);
          const webhook = webhooks.find((w) => w.key === input.key);

          if (!webhook) {
            throw notFoundError("Webhook");
          }

          // Mock deleting webhook
          console.log(
            `Deleted webhook ${input.key} for user ${ctx.session.user.id}`,
          );

          return mutationResponse(
            { key: input.key },
            "Webhook deleted successfully",
          );
        },
        {
          component: "webhooksRouter",
          operationName: "delete",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Execute webhook (public endpoint)
  execute: publicWebhookProcedure
    .input(executeWebhookSchema)
    .mutation(async ({ input }) => {
      return withErrorHandling(
        async () => {
          const webhook = await getWebhookByKey(input.key);

          if (!webhook) {
            throw notFoundError("Webhook");
          }

          if (!webhook.isActive) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Webhook is inactive",
            });
          }

          // Check allowed methods
          if (!webhook.allowedMethods.includes(input.method)) {
            throw new TRPCError({
              code: "METHOD_NOT_SUPPORTED",
              message: `Method ${input.method} not allowed for this webhook`,
            });
          }

          // Check IP whitelist if configured
          if (webhook.allowedIps.length > 0 && input.sourceIp) {
            const isAllowed = webhook.allowedIps.some((allowedIp) => {
              // Simple IP matching - in real implementation, would handle CIDR notation
              return input.sourceIp === allowedIp || allowedIp.includes("/");
            });

            if (!isAllowed) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "IP address not allowed",
              });
            }
          }

          // Check authentication if required
          if (webhook.requireAuth && webhook.authToken) {
            const authHeader =
              input.headers?.authorization ?? input.headers?.Authorization;
            if (!authHeader?.includes(webhook.authToken)) {
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Invalid authentication",
              });
            }
          }

          // Check custom headers if required
          if (webhook.customHeaders) {
            for (const [headerName, expectedValue] of Object.entries(
              webhook.customHeaders,
            )) {
              const actualValue =
                input.headers?.[headerName] ??
                input.headers?.[headerName.toLowerCase()];
              if (actualValue !== expectedValue) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Missing or invalid header: ${headerName}`,
                });
              }
            }
          }

          // Mock webhook execution
          const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          console.log(
            `Executing webhook ${input.key} for workflow ${webhook.workflowId}:`,
            {
              method: input.method,
              payload: input.payload,
              sourceIp: input.sourceIp,
              executionId,
            },
          );

          // Simulate processing delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 1000 + 100),
          );

          const response = {
            success: true,
            executionId,
            message: "Webhook executed successfully",
            timestamp: new Date().toISOString(),
          };

          // Format response based on webhook configuration
          switch (webhook.responseFormat) {
            case "json":
              return mutationResponse(
                response,
                "Webhook executed successfully",
              );
            case "text":
              return {
                text: `Webhook executed successfully. Execution ID: ${executionId}`,
              };
            case "xml":
              return {
                xml: `<?xml version="1.0"?><response><success>true</success><executionId>${executionId}</executionId></response>`,
              };
            default:
              return mutationResponse(
                response,
                "Webhook executed successfully",
              );
          }
        },
        {
          component: "webhooksRouter",
          operationName: "execute",
        },
      );
    }),

  // Test webhook
  test: webhookProcedure
    .input(testWebhookSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const webhooks = await getUserWebhooks(ctx.session.user.id);
          const webhook = webhooks.find((w) => w.key === input.key);

          if (!webhook) {
            throw notFoundError("Webhook");
          }

          // Mock webhook test
          console.log(`Testing webhook ${input.key}:`, {
            method: input.method,
            payload: input.payload,
            headers: input.headers,
          });

          // Simulate test delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 500 + 100),
          );

          return mutationResponse(
            {
              webhookKey: input.key,
              workflowId: webhook.workflowId,
              method: input.method,
              responseTime: Math.floor(Math.random() * 500) + 100,
              timestamp: new Date().toISOString(),
            },
            "Webhook test completed successfully",
          );
        },
        {
          component: "webhooksRouter",
          operationName: "test",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get webhook execution history
  getExecutionHistory: webhookProcedure
    .input(webhookExecutionHistorySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const executions = await getWebhookExecutions(input.key, input);

          // Apply filters
          let filteredExecutions = executions;

          if (input.status) {
            filteredExecutions = filteredExecutions.filter(
              (e) => e.status === input.status,
            );
          }

          if (input.sourceIp) {
            filteredExecutions = filteredExecutions.filter(
              (e) => e.sourceIp === input.sourceIp,
            );
          }

          if (input.startDate) {
            const startDate = new Date(input.startDate);
            filteredExecutions = filteredExecutions.filter(
              (e) => e.timestamp >= startDate,
            );
          }

          if (input.endDate) {
            const endDate = new Date(input.endDate);
            filteredExecutions = filteredExecutions.filter(
              (e) => e.timestamp <= endDate,
            );
          }

          // Apply sorting
          filteredExecutions.sort((a, b) => {
            let aValue: string | Date | number, bValue: string | Date | number;

            switch (input.sortBy) {
              case "timestamp":
                aValue = a.timestamp;
                bValue = b.timestamp;
                break;
              case "duration":
                aValue = a.responseTime;
                bValue = b.responseTime;
                break;
              case "status":
                aValue = a.status ?? "";
                bValue = b.status ?? "";
                break;
              default:
                aValue = a.timestamp;
                bValue = b.timestamp;
            }

            if (input.sortOrder === "desc") {
              return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            } else {
              return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            }
          });

          // Apply pagination
          const pagination = normalizePagination(input);
          const paginatedExecutions = filteredExecutions.slice(
            pagination.offset,
            pagination.offset + pagination.limit,
          );

          const result = createPaginatedResult(
            paginatedExecutions,
            filteredExecutions.length,
            pagination,
          );
          return listResponse(result);
        },
        {
          component: "webhooksRouter",
          operationName: "getExecutionHistory",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get webhook statistics
  getStats: webhookProcedure
    .input(webhookStatsSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Mock webhook statistics
          const stats = {
            period: input.period,
            groupBy: input.groupBy,
            totalExecutions: Math.floor(Math.random() * 1000) + 100,
            successfulExecutions: Math.floor(Math.random() * 900) + 90,
            failedExecutions: Math.floor(Math.random() * 50) + 5,
            timeoutExecutions: Math.floor(Math.random() * 20) + 2,
            rateLimitedExecutions: Math.floor(Math.random() * 10) + 1,
            averageResponseTime: Math.floor(Math.random() * 1000) + 200,
            byStatus: {
              success: Math.floor(Math.random() * 800) + 80,
              failure: Math.floor(Math.random() * 50) + 5,
              timeout: Math.floor(Math.random() * 20) + 2,
              rate_limited: Math.floor(Math.random() * 10) + 1,
            },
            byMethod: {
              GET: Math.floor(Math.random() * 200) + 20,
              POST: Math.floor(Math.random() * 600) + 60,
              PUT: Math.floor(Math.random() * 100) + 10,
              PATCH: Math.floor(Math.random() * 50) + 5,
            },
            topSourceIps: [
              {
                ip: "192.168.1.100",
                count: Math.floor(Math.random() * 100) + 10,
              },
              { ip: "10.0.0.50", count: Math.floor(Math.random() * 80) + 8 },
              { ip: "172.16.0.25", count: Math.floor(Math.random() * 60) + 6 },
            ],
          };

          const metrics: Record<string, string | number> = {
            period: stats.period,
            groupBy: stats.groupBy,
            totalExecutions: stats.totalExecutions,
            successfulExecutions: stats.successfulExecutions,
            failedExecutions: stats.failedExecutions,
            timeoutExecutions: stats.timeoutExecutions,
            rateLimitedExecutions: stats.rateLimitedExecutions,
            averageResponseTime: stats.averageResponseTime,
          };

          return statsResponse(
            {
              start: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            metrics,
          );
        },
        {
          component: "webhooksRouter",
          operationName: "getStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Bulk webhook operations
  bulkOperation: webhookProcedure
    .input(bulkWebhookOperationSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const results = [];
          const webhooks = await getUserWebhooks(ctx.session.user.id);

          for (const key of input.keys) {
            try {
              const webhook = webhooks.find((w) => w.key === key);
              if (!webhook) {
                results.push({
                  key,
                  success: false,
                  error: "Webhook not found",
                });
                continue;
              }

              switch (input.operation) {
                case "delete":
                  results.push({ key, success: true });
                  break;
                case "activate":
                  results.push({ key, success: true });
                  break;
                case "deactivate":
                  results.push({ key, success: true });
                  break;
                case "regenerate_key":
                  const newKey = `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                  results.push({ key, success: true, newKey });
                  break;
                case "reset_stats":
                  results.push({ key, success: true });
                  break;
              }
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              results.push({ key, success: false, error: errorMessage });
            }
          }

          return mutationResponse(
            { results },
            `Bulk ${input.operation} completed for ${input.keys.length} webhooks`,
          );
        },
        {
          component: "webhooksRouter",
          operationName: "bulkOperation",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Configure webhook security
  configureSecurity: webhookProcedure
    .input(webhookSecuritySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const webhooks = await getUserWebhooks(ctx.session.user.id);
        const webhook = webhooks.find((w) => w.key === input.key);

        if (!webhook) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Webhook not found",
          });
        }

        // Mock updating security settings
        const updatedSecurity = {
          ipWhitelist: input.enableIpWhitelist ? (input.allowedIps ?? []) : [],
          rateLimit: input.enableRateLimit ? input.rateLimitPerMinute : 0,
          authentication: input.enableAuth
            ? {
                type: input.authType,
                token: input.authToken,
                customHeader: input.customAuthHeader,
              }
            : null,
          signatureVerification: input.enableSignatureVerification
            ? {
                secret: input.signatureSecret,
                header: input.signatureHeader,
              }
            : null,
        };

        console.log(`Updated security settings for webhook ${input.key}`);

        return {
          success: true,
          message: "Security settings updated successfully",
          settings: updatedSecurity,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to configure webhook security",
          cause: error,
        });
      }
    }),

  // Generate webhook URL
  generateUrl: webhookProcedure
    .input(generateWebhookUrlSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const baseUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5001";
          const key =
            input.customKey ??
            `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          let url = `${baseUrl}/api/workflows/webhook/${key}`;

          // Add query parameters if specified
          if (
            input.includeQuery &&
            Object.keys(input.includeQuery).length > 0
          ) {
            const queryString = new URLSearchParams(
              input.includeQuery,
            ).toString();
            url += `?${queryString}`;
          }

          return mutationResponse(
            {
              key,
              url,
              workflowId: input.workflowId,
              includeAuth: input.includeAuth,
              generatedAt: new Date().toISOString(),
            },
            "Webhook URL generated successfully",
          );
        },
        {
          component: "webhooksRouter",
          operationName: "generateUrl",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get webhook monitoring data
  getMonitoring: webhookProcedure
    .input(webhookMonitoringSchema)
    .query(async ({ input }) => {
      try {
        // Mock monitoring data
        const monitoring = {
          webhookKey: input.key,
          metricsWindow: input.metricsWindow,
          realtime: input.includeRealtime,
          metrics: {
            totalRequests: Math.floor(Math.random() * 1000) + 100,
            successRate: Math.round((Math.random() * 20 + 80) * 100) / 100, // 80-100%
            errorRate: Math.round(Math.random() * 10 * 100) / 100, // 0-10%
            averageResponseTime: Math.floor(Math.random() * 500) + 100,
            rateLimitHits: Math.floor(Math.random() * 50),
            uniqueIps: Math.floor(Math.random() * 20) + 5,
          },
          alerts: input.alertThresholds
            ? [
                {
                  type: "error_rate",
                  threshold: input.alertThresholds.errorRate,
                  currentValue: Math.round(Math.random() * 15 * 100) / 100,
                  triggered: Math.random() > 0.8,
                },
                {
                  type: "rate_limit",
                  threshold: input.alertThresholds.rateLimitHits,
                  currentValue: Math.floor(Math.random() * 120),
                  triggered: Math.random() > 0.9,
                },
              ]
            : [],
          recentActivity: Array.from({ length: 10 }, (_, i) => ({
            timestamp: new Date(Date.now() - i * 60000).toISOString(),
            status: (["success", "failure", "timeout"] as const)[
              Math.floor(Math.random() * 3)
            ],
            responseTime: Math.floor(Math.random() * 1000) + 100,
            sourceIp: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
          })),
        };

        return monitoring;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch webhook monitoring data",
          cause: error,
        });
      }
    }),

  // Configure payload validation
  configureValidation: webhookProcedure
    .input(webhookPayloadValidationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const webhooks = await getUserWebhooks(ctx.session.user.id);
        const webhook = webhooks.find((w) => w.key === input.key);

        if (!webhook) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Webhook not found",
          });
        }

        // Mock updating validation settings
        const validationConfig = {
          payloadSchema: input.payloadSchema,
          contentType: input.requireContentType,
          maxSize: input.maxPayloadSize,
          signatureValidation: input.validateSignature,
          fieldWhitelist: input.allowedFields,
          requiredFields: input.requiredFields,
        };

        console.log(`Updated payload validation for webhook ${input.key}`);

        return {
          success: true,
          message: "Payload validation configured successfully",
          config: validationConfig,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to configure payload validation",
          cause: error,
        });
      }
    }),

  // Configure webhook response
  configureResponse: webhookProcedure
    .input(webhookResponseSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const webhooks = await getUserWebhooks(ctx.session.user.id);
        const webhook = webhooks.find((w) => w.key === input.key);

        if (!webhook) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Webhook not found",
          });
        }

        // Mock updating response settings
        const responseConfig = {
          format: input.responseFormat,
          successResponse: input.successResponse,
          errorResponse: input.errorResponse,
          includeExecutionId: input.includeExecutionId,
          includeTimestamp: input.includeTimestamp,
        };

        console.log(`Updated response configuration for webhook ${input.key}`);

        return {
          success: true,
          message: "Response configuration updated successfully",
          config: responseConfig,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to configure webhook response",
          cause: error,
        });
      }
    }),
});
