import { storage, type EventWithRelations } from "@/server/storage";
import {
  templateProcessor,
  createTemplateContext,
} from "@/lib/template-processor";
import type { ConditionalAction } from "@/shared/schema";
import { ConditionalActionType, EventType, type Event } from "@/shared/schema";
import {
  executeToolAction,
  type ToolActionConfig,
} from "./tool-action-executor";

interface ExecutionData {
  executionTime?: string;
  duration?: number;
  output?: string;
  error?: string;
}

type ProcessEventCallback = (
  conditional_event: ConditionalAction,
  event: EventWithRelations,
  isSuccess: boolean,
  executionData?: ExecutionData,
) => Promise<void>;

/**
 * Handle conditional actions that should be triggered on successful execution
 */
export async function handleSuccessActions(
  eventId: number,
  processEventCallback: ProcessEventCallback,
) {
  try {
    // Get the event with its success conditional actions
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all success events for this event
    const successEvents = await storage.getSuccessActions(eventId);

    // Get the latest log for execution data
    const latestLog = await storage.getLatestLogForScript(eventId);
    let executionDataFromLog: ExecutionData | undefined;
    if (latestLog) {
      executionDataFromLog = {
        executionTime:
          latestLog.startTime?.toISOString() ?? new Date().toISOString(),
        output: latestLog.output ?? "No output available",
      };

      if (latestLog.duration !== null && latestLog.duration !== undefined) {
        executionDataFromLog.duration = latestLog.duration;
      }

      if (latestLog.error) {
        executionDataFromLog.error = latestLog.error;
      }
    }

    // Process each success event with execution data from latest log
    for (const condEvent of successEvents) {
      await processEventCallback(condEvent, event, true, executionDataFromLog);
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling success events for event ${String(eventId)}:`,
      error,
    );
  }
}

/**
 * Handle conditional actions that should be triggered on failed execution
 */
export async function handleFailureActions(
  eventId: number,
  processEventCallback: ProcessEventCallback,
) {
  try {
    // Get the event with its failure conditional actions
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all failure events for this event
    const failureEvents = await storage.getFailActions(eventId);

    // Get the latest log for execution data
    const latestLog = await storage.getLatestLogForScript(eventId);
    let executionData: ExecutionData | undefined;
    if (latestLog) {
      executionData = {
        executionTime:
          latestLog.startTime?.toISOString() ?? new Date().toISOString(),
        duration: latestLog.duration ?? 0,
        output: latestLog.output ?? "No output available",
        error: latestLog.error ?? "Unknown error",
      };
    }

    // Process each failure event
    for (const condEvent of failureEvents) {
      await processEventCallback(condEvent, event, false, executionData);
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling failure events for event ${String(eventId)}:`,
      error,
    );
  }
}

/**
 * Handle conditional actions that should always be triggered regardless of success or failure
 */
export async function handleAlwaysActions(
  eventId: number,
  processEventCallback: (
    conditional_event: ConditionalAction,
    event: EventWithRelations,
    isSuccess: boolean,
  ) => Promise<void>,
) {
  try {
    // Get the event with its always conditional actions
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all always events for this event
    const alwaysEvents = await storage.getAlwaysActions(eventId);

    // Process each always event
    for (const condEvent of alwaysEvents) {
      await processEventCallback(condEvent, event, true); // Pass true for consistency
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling always events for event ${String(eventId)}:`,
      error,
    );
  }
}

/**
 * Handle condition events for an event based on the condition state
 */
export async function handleConditionActions(
  eventId: number,
  condition: boolean,
  processEventCallback: (
    conditional_event: ConditionalAction,
    event: EventWithRelations,
    isSuccess: boolean,
  ) => Promise<void>,
) {
  try {
    // Get the event with its condition conditional actions
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all condition events for this event
    const conditionEvents = await storage.getConditionActions(eventId);

    console.log(
      `Processing ${conditionEvents.length} condition events for event ${String(eventId)} with condition: ${String(condition)}`,
    );

    // Process each condition event based on the condition state
    for (const condEvent of conditionEvents) {
      // Only trigger condition events if the condition is true
      if (condition) {
        console.log(
          `Triggering condition event ${String(condEvent.id)} for event ${String(eventId)} (condition: true)`,
        );
        await processEventCallback(condEvent, event, true);
      } else {
        console.log(
          `Skipping condition event ${String(condEvent.id)} for event ${String(eventId)} (condition: false)`,
        );
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling condition events for event ${String(eventId)}:`,
      error,
    );
  }
}

/**
 * Process a conditional action based on the trigger type and event outcome
 */
export async function processEvent(
  conditional_event: ConditionalAction,
  event: EventWithRelations,
  isSuccess: boolean,
  executionData?: ExecutionData,
) {
  try {
    console.log(
      `Processing conditional action ${String(conditional_event.id)} for script ${String(event.id)}: ${event.name ?? ""}`,
    );
    console.log(
      `Conditional event type: ${conditional_event.type ?? ""}, isSuccess: ${String(isSuccess)}`,
    );

    // Check for tool message sending (SEND_MESSAGE)
    if (
      conditional_event.type === ConditionalActionType.SEND_MESSAGE &&
      conditional_event.message
    ) {
      console.log(
        `Processing SEND_MESSAGE conditional action for tool ${String(conditional_event.toolId)}`,
      );
      console.log(`Conditional event details:`, {
        type: conditional_event.type,
        toolId: conditional_event.toolId,
        message: conditional_event.message?.substring(0, 50) + "...",
        emailAddresses: conditional_event.emailAddresses,
        emailSubject: conditional_event.emailSubject,
      });

      try {
        // First check if we have a tool ID
        if (!conditional_event.toolId) {
          console.error("No tool ID specified for SEND_MESSAGE event");
          return;
        }

        // Get the tool from database to determine its type
        const { db } = await import("@/server/db");
        const { toolCredentials } = await import("@/shared/schema");
        const { eq } = await import("drizzle-orm");

        const toolResults = await db
          .select()
          .from(toolCredentials)
          .where(eq(toolCredentials.id, conditional_event.toolId));

        const tool = toolResults[0];
        if (!tool) {
          console.error(
            `Tool ${String(conditional_event.toolId)} not found for SEND_MESSAGE event`,
          );
          return;
        }

        // For SEND_MESSAGE actions, we need to determine the action ID
        // Map tool types to their send message action IDs
        const sendMessageActionIds: Record<string, string> = {
          email: "send-email",
          slack: "slack-send-message",
          discord: "discord-send-message",
          teams: "teams-send-message",
        };

        const actionId = sendMessageActionIds[tool.type.toLowerCase()];
        if (!actionId) {
          console.error(
            `Tool type ${tool.type} does not support send message actions`,
          );
          return;
        }

        // Get user variables for template context
        const userVariables = await storage.getUserVariables(event.userId);
        const variablesMap = userVariables.reduce(
          (acc, v) => {
            acc[v.key] = v.value;
            return acc;
          },
          {} as Record<string, unknown>,
        );

        // Create template context with cronium data
        const eventData: Parameters<typeof createTemplateContext>[0] = {
          id: event.id,
          name: event.name,
          status: isSuccess ? "success" : "failure",
          executionTime:
            executionData?.executionTime ?? new Date().toISOString(),
          server:
            typeof event.server === "string"
              ? event.server
              : (event.server?.name ?? "Local"),
        };

        // Only add optional properties if they have defined values
        if (executionData?.duration !== undefined) {
          eventData.duration = executionData.duration;
        }
        if (executionData?.output !== undefined) {
          eventData.output = executionData.output;
        }
        if (executionData?.error !== undefined) {
          eventData.error = executionData.error;
        }

        const templateContext = createTemplateContext(
          eventData,
          variablesMap,
          {},
          {},
        );

        // Process the message with template processor
        const processedMessage = templateProcessor.processTemplate(
          conditional_event.message,
          templateContext,
        );

        // Prepare parameters based on tool type
        const actionParameters: Record<string, unknown> = {};

        // Map based on tool type
        if (tool.type.toLowerCase() === "email") {
          actionParameters.to = conditional_event.emailAddresses || "";
          actionParameters.subject = conditional_event.emailSubject
            ? templateProcessor.processTemplate(
                conditional_event.emailSubject,
                templateContext,
              )
            : `Event ${isSuccess ? "Success" : "Failure"}: ${event.name ?? ""}`;
          actionParameters.body = processedMessage;
          actionParameters.isHtml = true;
        } else if (tool.type.toLowerCase() === "slack") {
          actionParameters.channel = conditional_event.emailAddresses || ""; // Channel stored in emailAddresses field
          actionParameters.text = processedMessage;
        } else if (tool.type.toLowerCase() === "discord") {
          actionParameters.content = processedMessage;
        } else if (tool.type.toLowerCase() === "teams") {
          actionParameters.message = processedMessage;
          actionParameters.title =
            conditional_event.emailSubject || `Event ${event.name ?? ""}`;
        } else {
          // Generic message parameter
          actionParameters.message = processedMessage;
        }

        console.log(
          `Executing conditional action ${actionId} for ${tool.type}`,
        );

        // Create a temporary event object for the tool action executor
        const toolActionEvent = {
          id: event.id,
          userId: event.userId,
          name: `${event.name} - Conditional Action`,
          eventType: EventType.TOOL_ACTION,
          toolActionConfig: JSON.stringify({
            toolType: tool.type,
            actionId: actionId,
            toolId: conditional_event.toolId,
            parameters: actionParameters,
          } as ToolActionConfig),
        };

        // Execute the tool action
        const result = await executeToolAction(
          toolActionEvent as unknown as Event,
          actionParameters,
        );

        if (result.exitCode === 0) {
          console.log(
            `SEND_MESSAGE action executed successfully via ${tool.type}`,
          );
        } else {
          console.error(
            `Failed to execute SEND_MESSAGE action: ${result.stderr}`,
          );
        }
      } catch (err) {
        const error = err as Error;
        console.error(
          `Error processing SEND_MESSAGE conditional action:`,
          error,
        );
      }
    }

    // Check for target script execution
    if (
      conditional_event.type === ConditionalActionType.SCRIPT &&
      conditional_event.targetEventId
    ) {
      const targetScript = await storage.getEventWithRelations(
        conditional_event.targetEventId,
      );

      if (targetScript) {
        console.log(
          `Executing target script ${String(targetScript.id)}: ${targetScript.name ?? ""} (type: ${targetScript.type ?? ""}) as a result of conditional action`,
        );
        console.log(
          `Target script content preview: ${targetScript.content?.substring(0, 100) ?? ""}...`,
        );

        try {
          // Create a completely independent execution by using the scheduler's method
          // This ensures the script runs with its own complete context
          const { ScriptScheduler } = await import("./scheduler");
          const scheduler = new ScriptScheduler();

          // Execute as if it's a standalone script execution
          const result = await scheduler.runScriptImmediately(targetScript.id);

          console.log(
            `Conditional script ${String(targetScript.id)} execution completed with result: ${String(result.success)}`,
          );
        } catch (execErr) {
          const execError = execErr as Error;
          console.error(
            `Failed to execute target script ${String(targetScript.id)}:`,
            execError,
          );
        }
      } else {
        console.error(
          `Target script ${String(conditional_event.targetEventId)} not found`,
        );
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Error processing conditional action:`, error);
  }
}
