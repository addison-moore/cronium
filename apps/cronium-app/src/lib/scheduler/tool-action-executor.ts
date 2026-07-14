import { type Event } from "@/shared/schema";
import { storage } from "@/server/storage";
import { isToolActionsExecutionEnabled } from "@/lib/featureFlags";
import { toolActionHealthMonitor } from "./tool-action-health-monitor";
import { db } from "@/server/db";
import { toolActionLogs } from "@/shared/schema";
import { redactSecrets } from "@/lib/tools/redact";
import { credentialCache } from "@/lib/tools/credential-cache";
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
import { ToolActionError, isFailureResult } from "@/lib/tools/action-result";
import { parseToolActionConfig } from "@/lib/tools/tool-action-config";

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
  console.log(
    `[ToolAction] Input data:`,
    JSON.stringify(redactSecrets(input), null, 2),
  );

  // Check if tool action execution is enabled
  if (!isToolActionsExecutionEnabled()) {
    throw new Error("Tool action execution is disabled via feature flags");
  }

  try {
    // Parse tool action configuration
    try {
      console.log(
        `[ToolAction] Raw config:`,
        redactSecrets(event.toolActionConfig),
      );
      toolActionConfig = parseToolActionConfig(
        event.toolActionConfig,
      ) as ToolActionConfig | null;
      console.log(
        `[ToolAction] Parsed config:`,
        JSON.stringify(redactSecrets(toolActionConfig), null, 2),
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
      const { credentialEncryption } =
        await import("@/lib/security/credential-encryption");

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

    // Inject a fresh OAuth access token for plugins that require it
    // (e.g. Google Sheets reads credentials.oauthToken)
    {
      const { injectOAuthToken } =
        await import("@/lib/oauth/credential-bridge");
      credentials = await injectOAuthToken(credentials ?? {}, {
        userId,
        toolId: toolActionConfig.toolId,
        toolType: cachedTool.type,
      });
    }

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
      // Tool actions read/write variables via runtime helpers, not this
      // in-process context. No registered action uses context.variables;
      // these are intentional no-ops rather than a wired variable store.
      variables: {
        get: () => null,
        set: () => undefined,
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
        console.log(`[PARTIAL] ${JSON.stringify(redactSecrets(result))}`);
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
      JSON.stringify(redactSecrets(mergedParameters), null, 2),
    );
    context.onProgress?.({ step: "Initializing action", percentage: 10 });

    // Determine retry strategy based on action features
    const baseConfig = action.features?.webhookSupport
      ? defaultRetryConfigs.aggressive
      : defaultRetryConfigs.standard;

    // Create a mutable copy of the config.
    // Tool actions are predominantly non-idempotent sends, so we do NOT retry
    // in-process: retrying after a send that already reached the provider would
    // double-deliver. Safe retry needs idempotency keys (a later phase). The
    // circuit breaker still trips after repeated failures across calls, and
    // genuine failures are now surfaced honestly (see the throw wrapper below).
    const retryConfig: RetryConfig = {
      maxAttempts: 1,
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
        async () => {
          const actionResult: unknown = await action.execute(
            credentials,
            mergedParameters,
            context,
          );
          // Actions report failure by returning {success:false}/{ok:false}
          // instead of throwing. Convert that to a throw so the breaker records
          // it and the executor's catch surfaces it as a failed job.
          if (isFailureResult(actionResult)) {
            const errMsg = (actionResult as { error?: unknown }).error;
            throw new ToolActionError(
              typeof errMsg === "string" && errMsg
                ? errMsg
                : `${action.name} reported failure`,
              actionResult,
            );
          }
          return actionResult;
        },
        { actionId: action.id, toolId },
      );
    });
    const executionTime = Date.now() - actionStartTime;

    context.onProgress?.({ step: "Action completed", percentage: 100 });
    context.logger.info(`Action completed in ${executionTime}ms`);
    console.log(`[ToolAction] Execution successful in ${executionTime}ms`);
    console.log(
      `[ToolAction] Result:`,
      JSON.stringify(redactSecrets(result), null, 2),
    );

    // Format the result for the execution engine. Parameters are redacted here
    // so neither the returned stdout nor the persisted log leaks secrets (e.g.
    // a Teams webhook URL passed as a parameter).
    const formattedOutput = {
      actionId: action.id,
      actionName: action.name,
      executionTime,
      result,
      parameters: redactSecrets(mergedParameters),
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
        parameters: redactSecrets(mergedParameters),
        result: redactSecrets(formattedOutput),
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
      toolActionConfig ?? parseToolActionConfig(event.toolActionConfig) ?? {};
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
        parameters: redactSecrets(parsedConfig.parameters) ?? {},
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
