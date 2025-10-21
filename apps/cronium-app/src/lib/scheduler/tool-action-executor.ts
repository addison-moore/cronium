import { type Event } from "@/shared/schema";
import { storage } from "@/server/storage";
import { isToolActionsExecutionEnabled } from "@/lib/featureFlags";
import { toolActionHealthMonitor } from "./tool-action-health-monitor";
import { db } from "@/server/db";
import { toolActionLogs } from "@/shared/schema";
import { credentialCache } from "@/lib/tools/credential-cache";
import { connectionPool } from "@/lib/tools/connection-pool";
import {
  createRetryExecutor,
  defaultRetryConfigs,
  type RetryConfig,
} from "@/lib/tools/retry-strategies";
import { circuitBreakerManager } from "@/lib/tools/circuit-breaker";
import { ErrorCategorizer } from "@/lib/tools/error-categorization";
import { rateLimiter } from "@/lib/security/rate-limiter";
import { auditLog } from "@/lib/security/audit-logger";
import { processToolActionTemplate } from "@/lib/tool-action-template-processor";
import { createTemplateContext } from "@/lib/template-processor";
import { type EncryptedData } from "@/lib/security/credential-encryption";
import {
  getServerActionById,
  getAllServerActionIds,
} from "@/lib/tools/server-action-executor";

export interface ToolActionConfig {
  toolType: string;
  actionId: string;
  toolId: number;
  parameters: Record<string, unknown>;
  outputMapping?: Record<string, string>;
}

export interface ToolActionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: unknown;
  healthStatus?: ToolActionHealthStatus;
}

export interface ToolActionHealthStatus {
  toolId: number;
  actionId: string;
  status: "healthy" | "degraded" | "failing";
  latency: number;
  timestamp: Date;
  details?: {
    errorRate?: number;
    successRate?: number;
    averageExecutionTime?: number;
    lastError?: string;
    consecutiveFailures?: number;
  };
}

export interface ToolActionExecutionContext {
  variables: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
  onProgress?: (progress: { step: string; percentage: number }) => void;
  onPartialResult?: (result: unknown) => void;
  isTest?: boolean;
  mockData?: unknown;
}

/**
 * Execute a tool action based on the event configuration
 */
export async function executeToolAction(
  event: Event,
  input: Record<string, unknown> = {},
): Promise<ToolActionResult> {
  const startTime = Date.now();
  let toolActionConfig: ToolActionConfig | null = null;

  console.log(`[ToolAction] Starting execution for event ${event.id}`);
  console.log(`[ToolAction] Event type: ${event.type}, User: ${event.userId}`);
  console.log(`[ToolAction] Input data:`, JSON.stringify(input, null, 2));

  // Check if tool action execution is enabled
  if (!isToolActionsExecutionEnabled()) {
    throw new Error("Tool action execution is disabled via feature flags");
  }

  try {
    // Parse tool action configuration
    try {
      console.log(`[ToolAction] Raw config:`, event.toolActionConfig);
      if (typeof event.toolActionConfig === "string") {
        toolActionConfig = JSON.parse(
          event.toolActionConfig,
        ) as ToolActionConfig;
      } else if (
        event.toolActionConfig &&
        typeof event.toolActionConfig === "object"
      ) {
        toolActionConfig = event.toolActionConfig as ToolActionConfig;
      } else {
        toolActionConfig = null;
      }
      console.log(
        `[ToolAction] Parsed config:`,
        JSON.stringify(toolActionConfig, null, 2),
      );
    } catch (error) {
      console.error(`[ToolAction] Failed to parse config:`, error);
      throw new Error(
        `Invalid tool action configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    if (
      !toolActionConfig?.toolType ||
      !toolActionConfig.actionId ||
      !toolActionConfig.toolId
    ) {
      throw new Error("Incomplete tool action configuration");
    }

    // Get tool credentials from cache or database
    const userId = event.userId; // Assuming event has userId
    const cachedTool = await credentialCache.get(
      toolActionConfig.toolId,
      userId,
    );

    if (!cachedTool) {
      throw new Error(`Tool not found: ${toolActionConfig.toolId}`);
    }

    // Check if tool is active
    if (!cachedTool.isActive) {
      throw new Error(`Tool is not active: ${cachedTool.name}`);
    }

    // Check rate limit
    const rateLimitResult = await rateLimiter.checkRateLimit(
      userId,
      cachedTool.type,
    );

    if (!rateLimitResult.allowed) {
      await auditLog.rateLimitExceeded(
        {
          userId,
          toolId: toolActionConfig.toolId,
        },
        rateLimitResult.limit,
        "1 minute",
      );

      throw new Error(
        `Rate limit exceeded. Try again in ${rateLimitResult.retryAfter ?? 60} seconds`,
      );
    }

    // Check quota
    const quotaResult = await rateLimiter.checkQuota(userId, cachedTool.type);

    if (!quotaResult.allowed) {
      const limitType =
        quotaResult.hourly.used >= quotaResult.hourly.limit
          ? "hourly"
          : "daily";
      throw new Error(
        `${limitType} quota exceeded. Used ${quotaResult[limitType].used}/${quotaResult[limitType].limit}`,
      );
    }

    // Decrypt credentials if needed
    let credentials: Record<string, unknown>;

    // Handle credential decryption based on encryption status
    if (cachedTool.encrypted) {
      // Tool has encrypted credentials
      const { credentialEncryption } = await import(
        "@/lib/security/credential-encryption"
      );

      if (!credentialEncryption.isAvailable()) {
        throw new Error("Encryption key not configured");
      }

      try {
        // Parse the encrypted data
        let encryptedData: unknown;
        if (typeof cachedTool.credentials === "string") {
          encryptedData = JSON.parse(cachedTool.credentials);
        } else {
          encryptedData = cachedTool.credentials;
        }

        console.log(`[ToolAction] Decrypting credentials...`);
        // Decrypt using the credential encryption service
        const decrypted = credentialEncryption.decrypt(
          encryptedData as EncryptedData,
        );

        // The decrypted value should be the credentials object
        if (typeof decrypted === "string") {
          credentials = JSON.parse(decrypted) as Record<string, unknown>;
        } else {
          credentials = decrypted as Record<string, unknown>;
        }
        console.log(`[ToolAction] Credentials decrypted successfully`);
      } catch (err) {
        console.error(`[ToolAction] Failed to decrypt credentials:`, err);
        throw new Error(
          `Failed to decrypt tool credentials: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    } else {
      // Tool has unencrypted credentials
      if (typeof cachedTool.credentials === "string") {
        try {
          credentials = JSON.parse(cachedTool.credentials) as Record<
            string,
            unknown
          >;
        } catch (err) {
          console.error(
            `[ToolAction] Failed to parse unencrypted credentials:`,
            err,
          );
          throw new Error(`Invalid credential format`);
        }
      } else {
        credentials = cachedTool.credentials as Record<string, unknown>;
      }
    }

    console.log(
      `[ToolAction] Tool found: ${cachedTool.name} (${cachedTool.type})`,
    );
    console.log(
      `[ToolAction] Tool ID: ${cachedTool.id}, Active: ${cachedTool.isActive}`,
    );
    console.log(`[ToolAction] Credentials loaded:`, credentials ? "Yes" : "No");

    // Check for pooled connection
    const pooledConnection = connectionPool.getConnection(
      toolActionConfig.toolId,
      cachedTool.type,
      userId,
    );
    console.log(
      `[ToolAction] Pooled connection:`,
      pooledConnection ? "Found" : "Not found",
    );

    // Get the action definition
    console.log(
      `[ToolAction] Looking for action: ${toolActionConfig.actionId}`,
    );
    console.log(
      `[ToolAction] Available actions before lookup:`,
      getAllServerActionIds(),
    );
    const action = getServerActionById(toolActionConfig.actionId);
    if (!action) {
      console.error(
        `[ToolAction] Action not found in server registry: ${toolActionConfig.actionId}`,
      );
      console.log(
        `[ToolAction] Available server actions after lookup attempt:`,
        getAllServerActionIds(),
      );
      throw new Error(`Action not found: ${toolActionConfig.actionId}`);
    }
    console.log(`[ToolAction] Action found: ${action.name} (${action.id})`);

    // Create execution context
    const context: ToolActionExecutionContext = {
      variables: {
        get: (key: string) => {
          // TODO: Implement proper variable access
          console.log(`Getting variable: ${key}`);
          return null;
        },
        set: (key: string, value: unknown) => {
          // TODO: Implement proper variable setting
          console.log(`Setting variable: ${key} = ${JSON.stringify(value)}`);
        },
      },
      logger: {
        info: (message: string) => console.log(`[INFO] ${message}`),
        warn: (message: string) => console.warn(`[WARN] ${message}`),
        error: (message: string) => console.error(`[ERROR] ${message}`),
        debug: (message: string) => console.debug(`[DEBUG] ${message}`),
      },
      onProgress: (progress) => {
        console.log(`[PROGRESS] ${progress.step}: ${progress.percentage}%`);
      },
      onPartialResult: (result) => {
        console.log(`[PARTIAL] ${JSON.stringify(result)}`);
      },
      isTest: false,
    };

    // Get user variables for template context
    const userVariables = await storage.getUserVariables(event.userId);
    const variablesMap: Record<string, unknown> = {};
    userVariables.forEach((variable) => {
      variablesMap[variable.key] = variable.value;
    });

    // Create template context from event data and input
    const templateContext = createTemplateContext(
      {
        id: event.id,
        name: event.name,
        status: "running", // Current execution status
        duration: 0, // Will be updated after execution
        executionTime: new Date().toISOString(),
        server: event.serverId ? `server-${event.serverId}` : "local",
        output: "", // Will be populated during execution
      },
      {
        ...variablesMap, // User-defined variables
        ...input, // Include all input data as variables (can override user variables)
      },
      input, // Pass input data for cronium.input.* access
      {}, // Empty conditions object (can be populated from workflow context later)
    );

    // Process template parameters
    const processedTemplateData = processToolActionTemplate(
      { parameters: toolActionConfig.parameters },
      templateContext,
    );

    // Merge processed parameters with input data (input can still override)
    const mergedParameters = {
      ...processedTemplateData.parameters,
      ...input, // Input from workflow can override configured parameters
    };

    // Validate parameters against action schema
    try {
      action.inputSchema.parse(mergedParameters);
    } catch (validationError) {
      if (validationError instanceof Error && "errors" in validationError) {
        const zodError = validationError as {
          errors: Array<{ path: string[]; message: string }>;
        };
        const errors = zodError.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );
        throw new Error(`Parameter validation failed: ${errors.join(", ")}`);
      }
      throw new Error(
        `Parameter validation failed: ${validationError instanceof Error ? validationError.message : "Unknown error"}`,
      );
    }

    // Execute the action with retry logic
    context.logger.info(`Executing action: ${action.name} (${action.id})`);
    console.log(
      `[ToolAction] Executing with parameters:`,
      JSON.stringify(mergedParameters, null, 2),
    );
    context.onProgress?.({ step: "Initializing action", percentage: 10 });

    // Determine retry strategy based on action features
    const baseConfig = action.features?.webhookSupport
      ? defaultRetryConfigs.aggressive
      : defaultRetryConfigs.standard;

    // Create a mutable copy of the config
    const retryConfig: RetryConfig = {
      maxAttempts: baseConfig.maxAttempts,
      initialDelay: baseConfig.initialDelay,
      maxDelay: baseConfig.maxDelay,
      backoffMultiplier: baseConfig.backoffMultiplier,
      jitter: baseConfig.jitter,
      ...(baseConfig.retryableErrors && {
        retryableErrors: [...baseConfig.retryableErrors],
      }),
      ...("nonRetryableErrors" in baseConfig &&
        baseConfig.nonRetryableErrors && {
          nonRetryableErrors: [...baseConfig.nonRetryableErrors],
        }),
    };

    const retryExecutor = createRetryExecutor(
      "exponential",
      retryConfig,
      (retryContext) => {
        context.logger.warn(
          `Retry attempt ${retryContext.attempt} for action ${action.id} after ${retryContext.lastDelay}ms`,
        );
        context.onProgress?.({
          step: `Retrying action (attempt ${retryContext.attempt})`,
          percentage: 10 + retryContext.attempt * 20,
        });
      },
    );

    // Get circuit breaker for this tool
    const circuitBreaker = circuitBreakerManager.getBreaker(
      toolActionConfig.toolId,
      toolActionConfig.toolType,
    );

    const actionStartTime = Date.now();
    const toolId = toolActionConfig.toolId; // Capture toolId before async callback
    const result = await circuitBreaker.execute(async () => {
      return retryExecutor.execute(
        () => action.execute(credentials, mergedParameters, context),
        { actionId: action.id, toolId },
      );
    });
    const executionTime = Date.now() - actionStartTime;

    context.onProgress?.({ step: "Action completed", percentage: 100 });
    context.logger.info(`Action completed in ${executionTime}ms`);
    console.log(`[ToolAction] Execution successful in ${executionTime}ms`);
    console.log(`[ToolAction] Result:`, JSON.stringify(result, null, 2));

    // Format the result for the execution engine
    const formattedOutput = {
      actionId: action.id,
      actionName: action.name,
      executionTime,
      result,
      parameters: mergedParameters,
      timestamp: new Date().toISOString(),
    };

    // Generate health status
    const healthStatus: ToolActionHealthStatus = {
      toolId: toolActionConfig.toolId,
      actionId: action.id,
      status: "healthy",
      latency: executionTime,
      timestamp: new Date(),
      details: {
        successRate: 100,
        averageExecutionTime: executionTime,
      },
    };

    // Check if execution time indicates degraded performance
    if (executionTime > 5000) {
      healthStatus.status = "degraded";
      context.logger.warn(
        `Tool action execution took ${executionTime}ms, which is above threshold`,
      );
    }

    // Record health metrics
    await toolActionHealthMonitor.recordExecution(healthStatus);

    // Audit successful execution
    await auditLog.toolExecuted(
      {
        userId,
        toolId: toolActionConfig.toolId,
      },
      action.id,
      executionTime,
    );

    // Log to tool action logs table
    try {
      await db.insert(toolActionLogs).values({
        eventId: event.id,
        toolType: toolActionConfig.toolType,
        actionType: action.actionType,
        actionId: action.id,
        parameters: mergedParameters,
        result: formattedOutput,
        status: "SUCCESS",
        executionTime,
        errorMessage: null,
      });
    } catch (logError) {
      console.warn(
        `Failed to log tool action execution: ${logError instanceof Error ? logError.message : "Unknown error"}`,
      );
    }

    return {
      stdout: JSON.stringify(formattedOutput, null, 2),
      stderr: "",
      exitCode: 0,
      data: result,
      healthStatus,
    };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const errorMessage = errorObj.message;
    console.error(`[ToolAction] Execution failed:`, errorMessage);
    console.error(`[ToolAction] Error stack:`, errorObj.stack);
    console.error(`[ToolAction] Config at failure:`, toolActionConfig);

    // Categorize the error
    const parsedConfig: Partial<ToolActionConfig> =
      toolActionConfig ??
      (() => {
        if (typeof event.toolActionConfig === "string") {
          try {
            return JSON.parse(event.toolActionConfig) as ToolActionConfig;
          } catch {
            return {} as Partial<ToolActionConfig>;
          }
        } else if (
          event.toolActionConfig &&
          typeof event.toolActionConfig === "object"
        ) {
          return event.toolActionConfig as ToolActionConfig;
        }
        return {} as Partial<ToolActionConfig>;
      })();
    const categorizedError = ErrorCategorizer.categorize(
      errorObj,
      parsedConfig.toolType ?? "unknown",
      {
        toolId: parsedConfig.toolId ?? 0,
        actionId: parsedConfig.actionId ?? "unknown",
        userId: event.userId,
      },
    );

    // Generate failing health status
    const healthStatus: ToolActionHealthStatus = {
      toolId: parsedConfig.toolId ?? 0,
      actionId: parsedConfig.actionId ?? "unknown",
      status: "failing",
      latency: Date.now() - startTime,
      timestamp: new Date(),
      details: {
        errorRate: 100,
        successRate: 0,
        lastError: categorizedError.userMessage,
        consecutiveFailures: 1,
      },
    };

    // Record health metrics for failure
    await toolActionHealthMonitor.recordExecution(healthStatus);

    // Audit failed execution
    await auditLog.toolExecutionFailed(
      {
        userId: event.userId,
        toolId: parsedConfig.toolId ?? 0,
      },
      parsedConfig.actionId ?? "unknown",
      errorMessage,
    );

    // Log failure to database
    try {
      await db.insert(toolActionLogs).values({
        eventId: event.id,
        toolType: parsedConfig.toolType ?? "unknown",
        actionType: "unknown",
        actionId: parsedConfig.actionId ?? "unknown",
        parameters: parsedConfig.parameters ?? {},
        result: null,
        status: "FAILURE",
        executionTime: Date.now() - startTime,
        errorMessage: categorizedError.technicalMessage,
      });
    } catch (logError) {
      console.warn(
        `Failed to log tool action error: ${logError instanceof Error ? logError.message : "Unknown error"}`,
      );
    }

    return {
      stdout: "",
      stderr: `${categorizedError.userMessage}\n\nDetails: ${errorMessage}`,
      exitCode: 1,
      data: {
        error: categorizedError,
        suggestions: ErrorCategorizer.getRecoverySuggestions(
          categorizedError,
          parsedConfig.toolType ?? "unknown",
        ),
      },
      healthStatus,
    };
  }
}
