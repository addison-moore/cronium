import {
  EventType,
  RunLocation,
  EventStatus,
  LogStatus,
} from "@/shared/schema";
import { storage } from "@/server/storage";
import { executeHttpRequest } from "./http-executor";
import { executeLocalScript } from "./local-executor";
import { scriptExecutorSSHService } from "@/lib/ssh/script-executor";

interface ScriptExecutionResult {
  success: boolean;
  output: string;
  scriptOutput?: any;
  condition?: boolean;
}

/**
 * Execute a script on multiple servers if configured
 */
export async function executeScript(
  event: any,
  executingEvents: Set<number>,
  handleSuccessActions: (eventId: number) => Promise<void>,
  handleFailureActions: (eventId: number) => Promise<void>,
  handleAlwaysActions: (eventId: number) => Promise<void>,
  handleConditionActions: (
    eventId: number,
    condition: boolean,
  ) => Promise<void>,
  handleExecutionCount: (eventId: number) => Promise<void>,
  input: Record<string, any> = {},
  workflowId?: number,
): Promise<ScriptExecutionResult> {
  // Check if this event has multiple servers configured
  if (
    event.runLocation === RunLocation.REMOTE &&
    event.servers &&
    event.servers.length > 0
  ) {
    return await executeOnMultipleServers(
      event,
      executingEvents,
      handleSuccessActions,
      handleFailureActions,
      handleAlwaysActions,
      handleConditionActions,
      handleExecutionCount,
      input,
      workflowId,
    );
  }

  // Fall back to single server execution (legacy mode)
  return await executeSingleScript(
    event,
    executingEvents,
    handleSuccessActions,
    handleFailureActions,
    handleAlwaysActions,
    handleConditionActions,
    handleExecutionCount,
    input,
    workflowId,
  );
}

/**
 * Execute a script on multiple servers
 */
async function executeOnMultipleServers(
  event: any,
  executingEvents: Set<number>,
  handleSuccessActions: (eventId: number) => Promise<void>,
  handleFailureActions: (eventId: number) => Promise<void>,
  handleAlwaysActions: (eventId: number) => Promise<void>,
  handleConditionActions: (
    eventId: number,
    conditionValue: boolean,
  ) => Promise<void>,
  handleExecutionCount: (eventId: number) => Promise<void>,
  input: Record<string, any> = {},
  workflowId?: number,
): Promise<ScriptExecutionResult> {
  const execId = Date.now();
  console.log(
    `[EXEC-${execId}] STARTING MULTI-SERVER EXECUTION for event ${event.id} on ${event.servers.length} servers`,
  );

  const startTime = new Date();
  const results: Array<{
    serverId: number;
    serverName: string;
    success: boolean;
    output: string;
    scriptOutput?: any;
    error?: string;
    condition?: boolean;
  }> = [];

  // Execute on each server with staggered timing and enhanced error handling
  const serverPromises = event.servers.map(
    async (server: any, index: number) => {
      try {
        // Add progressive staggered delay to prevent connection conflicts
        const delayMs = 750 + index * 250; // 750ms, 1000ms, 1250ms, etc.
        if (index > 0) {
          console.log(
            `[EXEC-${execId}] Staggering server ${server.name} execution by ${delayMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        console.log(
          `[EXEC-${execId}] Starting execution on server ${server.name} (${server.address}) - ${index + 1}/${event.servers.length}`,
        );

        // Create a copy of the event with this specific server
        const serverEvent = {
          ...event,
          server: server,
          serverId: server.id,
          isMultiServerExecution: true,
          executionId: `${execId}-${server.id}-${Date.now()}`, // Unique timestamped ID
          cleanupRequired: true,
        };

        // Enhanced retry logic with different strategies for different error types
        let lastError;
        let result;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(
              `[EXEC-${execId}] Server ${server.name} - Attempt ${attempt}/3`,
            );

            result = await executeSingleScript(
              serverEvent,
              executingEvents,
              () => Promise.resolve(),
              () => Promise.resolve(),
              () => Promise.resolve(),
              () => Promise.resolve(),
              () => Promise.resolve(),
              input,
              workflowId,
            );

            console.log(
              `[EXEC-${execId}] Server ${server.name} - Attempt ${attempt} SUCCESS`,
            );
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error;
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.log(
              `[EXEC-${execId}] Server ${server.name} - Attempt ${attempt} FAILED: ${errorMessage}`,
            );

            if (attempt < 3) {
              // Different backoff strategies based on error type
              let backoffTime;
              if (
                errorMessage.includes("No response from server") ||
                errorMessage.includes("not reachable")
              ) {
                backoffTime = 2000 + attempt * 1000; // Longer backoff for connection issues
              } else {
                backoffTime = 500 + attempt * 500; // Shorter backoff for other errors
              }

              console.log(
                `[EXEC-${execId}] Server ${server.name} - Retrying in ${backoffTime}ms...`,
              );
              await new Promise((resolve) => setTimeout(resolve, backoffTime));
            }
          }
        }

        if (!result) {
          throw lastError ?? new Error("Unknown execution failure");
        }

        console.log(`Multi-server: Server ${server.name} execution result:`, {
          success: result.success,
          scriptOutput: result.scriptOutput,
        });

        return {
          serverId: server.id,
          serverName: server.name,
          success: result.success,
          output: result.output,
          scriptOutput: result.scriptOutput, // Include scriptOutput for workflow data flow
          error: result.success ? undefined : result.output,
          condition: result.condition,
        };
      } catch (error) {
        console.error(
          `[EXEC-${execId}] Error executing on server ${server.name}:`,
          error,
        );
        return {
          serverId: server.id,
          serverName: server.name,
          success: false,
          output: "",
          scriptOutput: undefined,
          error: error instanceof Error ? error.message : "Unknown error",
          condition: false,
        };
      }
    },
  );

  // Wait for all server executions to complete concurrently
  const serverResults = await Promise.all(serverPromises);
  results.push(...serverResults);

  // Determine overall success and partial status
  const successfulServers = results.filter((r) => r.success).length;
  const totalServers = results.length;
  const overallSuccess = successfulServers === totalServers; // All servers must succeed for true success
  const isPartialSuccess =
    successfulServers > 0 && successfulServers < totalServers;

  // Get condition value from the first successful server execution
  const firstSuccessfulResult = results.find((r) => r.success);
  const conditionValue = firstSuccessfulResult?.condition ?? false;

  // Create combined output
  const combinedOutput = results
    .map(
      (r) =>
        `Server: ${r.serverName}\n` +
        `Status: ${r.success ? "SUCCESS" : "FAILED"}\n` +
        `Output: ${r.output ?? r.error ?? "No output"}\n` +
        `${"=".repeat(50)}`,
    )
    .join("\n\n");

  // Update or create log entry for multi-server execution
  const endTime = new Date();
  const executionDuration = endTime.getTime() - startTime.getTime();

  // Determine the appropriate log status
  let logStatus: LogStatus;
  if (overallSuccess) {
    logStatus = LogStatus.SUCCESS;
  } else if (isPartialSuccess) {
    logStatus = LogStatus.PARTIAL;
  } else {
    logStatus = LogStatus.FAILURE;
  }

  try {
    if (event.existingLogId) {
      // Update the existing log created by the API route
      await storage.updateLog(event.existingLogId, {
        output: combinedOutput,
        status: logStatus,
        endTime: endTime,
        duration: executionDuration,
        successful: overallSuccess,
      });
      console.log(
        `Updated existing log ${event.existingLogId} for multi-server execution of event ${event.id} with status: ${logStatus}`,
      );
    } else {
      // Create new log only if no existing log ID was provided (scheduled execution)
      await storage.createLog({
        eventId: event.id,
        workflowId: workflowId,
        output: combinedOutput,
        status: logStatus,
        startTime: startTime,
        endTime: endTime,
        duration: executionDuration,
        successful: overallSuccess,
        eventName: event.name,
        scriptType: event.type,
        userId: event.userId,
      });
      console.log(
        `Created new log for multi-server execution of event ${event.id} with status: ${logStatus}`,
      );
    }
  } catch (error) {
    console.error(
      `Error updating/creating multi-server log for event ${event.id}:`,
      error,
    );
  }

  // Update event statistics - partial successes count as failures
  await storage.updateScript(event.id, {
    lastRunAt: startTime,
    successCount: overallSuccess
      ? (event.successCount ?? 0) + 1
      : event.successCount,
    failureCount: overallSuccess
      ? event.failureCount
      : (event.failureCount ?? 0) + 1,
  });

  // Handle success/failure events - partial successes trigger failure events
  if (overallSuccess) {
    await handleSuccessActions(event.id);
  } else {
    // Both complete failures and partial successes trigger failure events
    await handleFailureActions(event.id);
  }

  // Always run "always" events regardless of success or failure
  await handleAlwaysActions(event.id);

  // Handle condition events if any condition was set
  await handleConditionActions(event.id, conditionValue);

  await handleExecutionCount(event.id);

  console.log(
    `[EXEC-${execId}] Multi-server execution completed: ${successfulServers}/${totalServers} servers succeeded`,
  );

  // Get the scriptOutput from the last successful execution for workflow data flow
  let scriptOutput: any = undefined;
  for (const result of results) {
    if (result.success && result.scriptOutput !== undefined) {
      scriptOutput = result.scriptOutput;
      console.log(
        `Multi-server: Found scriptOutput from server ${result.serverName}:`,
        scriptOutput,
      );
    }
  }
  console.log(`Multi-server: Final scriptOutput being returned:`, scriptOutput);

  return {
    success: overallSuccess,
    output: combinedOutput,
    scriptOutput: scriptOutput,
    condition: conditionValue,
  };
}

/**
 * Execute a script on a single server (legacy mode)
 */
async function executeSingleScript(
  event: any,
  executingEvents: Set<number>,
  handleSuccessActions: (eventId: number) => Promise<void>,
  handleFailureActions: (eventId: number) => Promise<void>,
  handleAlwaysActions: (eventId: number) => Promise<void>,
  handleConditionActions: (
    eventId: number,
    condition: boolean,
  ) => Promise<void>,
  handleExecutionCount: (eventId: number) => Promise<void>,
  input: Record<string, any> = {},
  workflowId?: number,
): Promise<ScriptExecutionResult> {
  // Add unique execution ID to help track this specific execution
  const execId = Date.now();
  console.log(
    `[EXEC-${execId}] STARTING SCRIPT EXECUTION for event ${event.id} - ${event.name}`,
  );

  // We're now successfully starting this script execution
  // Note: The executingEvents.add() is now handled in scheduler.ts to avoid race conditions

  // Create a start time for this execution - use the same one throughout
  const startTime = new Date();
  // Use a definite assignment instead of null to avoid TypeScript errors
  let logId = 0;

  try {
    // Update lastRunAt timestamp in the database
    await storage.updateScript(event.id, {
      lastRunAt: startTime,
    });

    // Skip log creation if this is part of a multi-server execution
    if (!event.isMultiServerExecution) {
      // Check if we have an existing log ID (used in the Run Now API)
      if (event.existingLogId) {
        // Since we know this is being passed from the API route, we can be certain it's a number
        const existingLogId = Number(event.existingLogId);
        console.log(
          `Using existing log ID ${existingLogId} for script execution`,
        );
        logId = existingLogId;

        // Update the existing log to ensure it's in RUNNING state
        try {
          await storage.updateLog(existingLogId, {
            output: "Execution in progress...",
            status: LogStatus.RUNNING,
            startTime: startTime, // Update the start time to now
            endTime: null, // Clear any previous end time
            successful: null, // Clear any previous success/failure state
          });
        } catch (error) {
          console.error(
            `Error updating existing log ${existingLogId} for script ${event.id}:`,
            error,
          );
        }
      } else {
        // Create a new log entry for this execution
        try {
          const newLog = await storage.createLog({
            eventId: event.id,
            workflowId: workflowId,
            output: "",
            status: LogStatus.RUNNING,
            startTime: startTime,
            endTime: null, // Will be updated when completed
            successful: null, // Will be updated when completed
            eventName: event.name,
            scriptType: event.type,
            userId: event.userId,
          });
          logId = newLog.id;
          console.log(
            `Created new log entry with ID ${logId} for script execution`,
          );
        } catch (error) {
          console.error(
            `Error creating new log for script ${event.id}:`,
            error,
          );
          // Even if log creation fails, we should continue with execution
        }
      }
    }

    let result: { stdout: string; stderr: string; output?: any } = {
      stdout: "",
      stderr: "",
    };
    const scriptContent = event.content ?? "";
    let envVars: Record<string, string> = {};

    // Check if there are environment variables
    if (event.envVars) {
      try {
        if (typeof event.envVars === "string") {
          // Handle empty string case that causes JSON parse errors
          if (event.envVars.trim() === "") {
            envVars = {};
          } else {
            envVars = JSON.parse(event.envVars);
          }
        } else if (Array.isArray(event.envVars)) {
          // Convert array of {key, value} objects to Record<string, string>
          envVars = event.envVars.reduce(
            (acc: Record<string, string>, envVar: any) => {
              if (envVar.key && envVar.value) {
                acc[envVar.key] = envVar.value;
              }
              return acc;
            },
            {},
          );
        } else if (typeof event.envVars === "object") {
          // If it's already an object, use it directly
          envVars = event.envVars;
        }

        console.log(
          `Environment variables for script ${event.id}:`,
          Object.keys(envVars),
        );
      } catch (err) {
        const error = err as Error;
        console.error(
          `Failed to parse environment variables for script ${event.id}:`,
          error,
        );
        // Continue with empty env vars rather than failing
        envVars = {};
      }
    }

    // Calculate timeout in milliseconds from event settings
    let timeoutMs = 30000; // Default 30 seconds
    if (event.timeoutValue && event.timeoutUnit) {
      if (event.timeoutUnit === "MINUTES") {
        timeoutMs = event.timeoutValue * 60 * 1000;
      } else if (event.timeoutUnit === "SECONDS") {
        timeoutMs = event.timeoutValue * 1000;
      }
    }

    // Execute script based on runLocation
    if (event.runLocation === RunLocation.REMOTE) {
      if (event.server) {
        // Execute remotely via SSH
        console.log(
          `Executing script ${event.id}: ${event.name} on remote server: ${event.server.name} with timeout: ${timeoutMs}ms`,
        );
        try {
          // Pre-check: Test server connectivity before script execution
          const connectionTest = await scriptExecutorSSHService.testConnection(
            event.server.address,
            event.server.sshKey,
            event.server.username,
            event.server.port,
          );

          if (!connectionTest.success) {
            throw new Error(
              `Server ${event.server.name} is not reachable: ${connectionTest.message}`,
            );
          }

          console.log(
            `Server ${event.server.name} connectivity verified. Proceeding with script execution.`,
          );

          // Fetch user variables for remote execution
          let userVariables: Record<string, string> = {};
          if (event.userId) {
            try {
              const { storage } = await import("@/server/storage");
              const variables = await storage.getUserVariables(event.userId);
              userVariables = variables.reduce(
                (acc: Record<string, string>, variable: any) => {
                  acc[variable.key] = variable.value;
                  return acc;
                },
                {} as Record<string, string>,
              );
            } catch (error) {
              console.error(
                `Failed to fetch user variables for remote execution on user ${event.userId}:`,
                error,
              );
            }
          }

          // Prepare event metadata for the script
          const eventMetadata = {
            id: event.id,
            name: event.name,
            description: event.description || "",
            type: event.type,
            runLocation: event.runLocation,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            userId: event.userId,
            server: event.server
              ? {
                  id: event.server.id,
                  name: event.server.name,
                  address: event.server.address,
                }
              : null,
            successCount: event.successCount ?? 0,
            failureCount: event.failureCount ?? 0,
            lastRunAt: event.lastRunAt,
          };

          // SSH execution through the SSH service with server details and timeout
          result = await scriptExecutorSSHService.executeScript(
            event.type,
            scriptContent,
            envVars,
            {
              address: event.server.address,
              sshKey: event.server.sshKey,
              username: event.server.username,
              port: event.server.port,
            },
            timeoutMs,
            input,
            eventMetadata,
            userVariables,
          );
        } catch (err) {
          const error = err as Error;
          console.error(
            `Error executing script ${event.id} on remote server:`,
            error,
          );
          throw error;
        }
      }
    } else if (event.type === EventType.HTTP_REQUEST) {
      // Execute HTTP request
      try {
        const httpSettings = JSON.parse(event.content ?? "{}");
        const httpResult = await executeHttpRequest(
          httpSettings.method,
          httpSettings.url,
          httpSettings.headers,
          httpSettings.body,
        );
        result = {
          stdout: JSON.stringify(httpResult.data ?? {}, null, 2),
          stderr: httpResult.error ?? "",
        };
      } catch (err) {
        const error = err as Error;
        console.error(
          `Error executing HTTP request for script ${event.id}:`,
          error,
        );
        throw error;
      }
    } else {
      // Execute locally
      console.log(
        `Executing script ${event.id}: ${event.name} locally with timeout: ${timeoutMs}ms`,
      );

      // Prepare event metadata for the script
      const eventMetadata = {
        id: event.id,
        name: event.name,
        description: event.description || "",
        type: event.type,
        runLocation: event.runLocation,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        userId: event.userId,
        server: event.server
          ? {
              id: event.server.id,
              name: event.server.name,
              address: event.server.address,
            }
          : null,
        successCount: event.successCount ?? 0,
        failureCount: event.failureCount ?? 0,
        lastRunAt: event.lastRunAt,
      };

      result = await executeLocalScript(
        event.type,
        scriptContent,
        envVars,
        timeoutMs,
        input,
        eventMetadata,
      );
    }

    // Process execution results
    const isTimeout = (result as any).isTimeout === true;
    const success = !result.stderr || result.stderr.length === 0;
    const output = result.stdout || "No output";
    const endTime = new Date();
    const executionDuration = endTime.getTime() - startTime.getTime();

    if (success && !isTimeout) {
      // Handle successful execution
      // Update the database
      await storage.updateScript(event.id, {
        successCount: (event.successCount ?? 0) + 1,
      });

      // Update the existing log with success information if we have a log ID and not multi-server
      if (logId !== null && !event.isMultiServerExecution) {
        const numericLogId: number = logId;
        try {
          await storage.updateLog(numericLogId, {
            output: output,
            status: LogStatus.SUCCESS,
            endTime: endTime,
            duration: executionDuration,
            successful: true,
          });
        } catch (error) {
          console.error(
            `Error updating success log ${logId} for event ${event.id}:`,
            error,
          );
        }
      }

      // Pass execution data to success events
      const executionData = {
        executionTime: startTime.toISOString(),
        duration: executionDuration,
        output: output,
        error: undefined,
      };

      // Handle success events
      await handleSuccessActions(event.id);
    } else {
      // Handle failed execution (including timeouts)
      const errorOutput = result.stderr || "Unknown error";

      // Update the database - timeouts are counted as failures
      await storage.updateScript(event.id, {
        failureCount: (event.failureCount ?? 0) + 1,
      });

      // Determine the appropriate log status
      const logStatus = isTimeout ? LogStatus.TIMEOUT : LogStatus.FAILURE;

      // Update the existing log with failure/timeout information if we have a log ID and not multi-server
      if (logId !== null && !event.isMultiServerExecution) {
        const numericLogId: number = logId;
        try {
          await storage.updateLog(numericLogId, {
            error: errorOutput,
            status: logStatus,
            endTime: endTime,
            duration: executionDuration,
            successful: false,
          });
        } catch (error) {
          console.error(
            `Error updating failure log ${logId} for event ${event.id}:`,
            error,
          );
        }
      }

      if (event.maxFailures && event.failureCount + 1 >= event.maxFailures) {
        console.log(
          `Script ${event.id}: ${event.name} reached maximum failure count (${event.maxFailures}). Disabling.`,
        );
        await storage.updateScript(event.id, {
          status: EventStatus.PAUSED,
        });

        // Add a log with the pause reason
        await storage.createLog({
          eventId: event.id,
          output: `Automatically paused after reaching max failures (${event.maxFailures})`,
          status: LogStatus.RUNNING,
          startTime: new Date(),
          endTime: new Date(),
          successful: false,
          eventName: event.name,
          scriptType: event.type,
          userId: event.userId,
        });
      }

      // Both timeouts and failures should trigger "On failure" events
      await handleFailureActions(event.id);
    }

    // Always run "always" events regardless of success or failure
    await handleAlwaysActions(event.id);

    // Check for condition events - read condition.json file if it exists
    let conditionValue: boolean | undefined = undefined;
    try {
      // Check if condition was returned directly from the script execution
      if (
        result &&
        "condition" in result &&
        typeof result.condition !== "undefined"
      ) {
        conditionValue = Boolean((result as any).condition);
        console.log(
          `Found condition from script execution for event ${event.id}, condition: ${conditionValue}`,
        );
        await handleConditionActions(event.id, conditionValue);
      }
    } catch (conditionError) {
      console.log(
        `Error processing condition for event ${event.id}:`,
        conditionError,
      );
    }

    // Update execution count after processing
    await handleExecutionCount(event.id);

    const returnValue: ScriptExecutionResult = {
      success,
      output: success ? output : result.stderr,
    };

    if ((result as any).scriptOutput !== undefined) {
      returnValue.scriptOutput = (result as any).scriptOutput;
    }

    if (conditionValue !== undefined) {
      returnValue.condition = conditionValue;
    }

    return returnValue;
  } catch (err) {
    const error = err as Error;
    console.error(`Unexpected error executing script ${event.id}:`, error);

    // Handle exceptions during execution
    // Update failure count
    await storage.updateScript(event.id, {
      failureCount: (event.failureCount ?? 0) + 1,
    });

    const endTime = new Date();
    const executionDuration = endTime.getTime() - startTime.getTime();

    // Update the existing log with the error information if we have a log ID
    if (logId !== null) {
      const numericLogId: number = logId;
      try {
        await storage.updateLog(numericLogId, {
          error: error.toString(),
          status: LogStatus.FAILURE,
          endTime: endTime,
          duration: executionDuration,
          successful: false,
        });
      } catch (updateError) {
        console.error(
          `Error updating error log ${logId} for event ${event.id}:`,
          updateError,
        );
      }
    }

    if (event.maxFailures && event.failureCount + 1 >= event.maxFailures) {
      console.log(
        `Script ${event.id}: ${event.name} reached maximum failure count (${event.maxFailures}) due to exception. Disabling.`,
      );

      // Pause the script
      await storage.updateScript(event.id, {
        status: EventStatus.PAUSED,
      });

      // Add a log with the pause reason
      await storage.createLog({
        eventId: event.id,
        output: `Automatically paused after reaching max failures (${event.maxFailures})`,
        status: LogStatus.RUNNING,
        startTime: new Date(),
        endTime: new Date(),
        successful: false,
        eventName: event.name,
        scriptType: event.type,
        userId: event.userId,
      });
    }

    await handleFailureActions(event.id);
    await handleAlwaysActions(event.id);

    return { success: false, output: error.toString(), condition: false };
  } finally {
    // CRITICAL: Always clean up the executing events flag,
    // even if any part of the execution process fails
    executingEvents.delete(event.id);
    console.log(
      `[exec-${startTime.getTime()}-${Math.floor(Math.random() * 10000)}] Cleared executing state for script ${event.id}, remaining: ${Array.from(executingEvents)}`,
    );
  }
}
