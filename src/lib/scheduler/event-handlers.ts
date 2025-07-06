import { storage, type EventWithRelations } from "@/server/storage";
import { sendEmail } from "@/lib/email";
import {
  templateProcessor,
  createTemplateContext,
} from "@/lib/template-processor";
import type { ConditionalAction } from "@/shared/schema";

interface ExecutionData {
  executionTime?: string;
  duration?: number;
  output?: string;
  error?: string;
}

interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
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
      conditional_event.type === "SEND_MESSAGE" &&
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
        let credentials: SmtpCredentials | Record<string, unknown>;
        let toolType: string;

        if (conditional_event.toolId === null) {
          // Use system SMTP settings
          const { getSmtpSettings } = await import("@/lib/email");
          const systemSmtp = await getSmtpSettings();

          if (!systemSmtp.enabled) {
            console.error("System SMTP is not enabled for SEND_MESSAGE event");
            return;
          }

          credentials = {
            host: systemSmtp.host,
            port: systemSmtp.port,
            user: systemSmtp.user,
            password: systemSmtp.password,
            fromEmail: systemSmtp.fromEmail,
            fromName: systemSmtp.fromName,
          };
          toolType = "EMAIL";
        } else {
          // Get the tool credentials using direct database query
          const { db } = await import("@/server/db");
          const { toolCredentials } = await import("@/shared/schema");
          const { eq } = await import("drizzle-orm");
          const { encryptionService } = await import(
            "@/lib/encryption-service"
          );

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

          // Decrypt credentials
          credentials = JSON.parse(
            encryptionService.decrypt(tool.credentials),
          ) as Record<string, unknown>;
          toolType = tool.type;
        }

        // Handle email sending directly without plugin system
        if (toolType === "EMAIL") {
          const recipients = conditional_event.emailAddresses ?? "";
          const subject =
            conditional_event.emailSubject ??
            `Event ${isSuccess ? "Success" : "Failure"}: ${event.name ?? ""}`;
          const message = conditional_event.message ?? "";

          if (!recipients) {
            console.error(
              "No recipients specified for email SEND_MESSAGE event",
            );
            return;
          }

          console.log(
            `Sending email directly via SMTP to: ${recipients ?? ""}`,
          );
          console.log(`Subject: ${subject ?? ""}`);

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
          const templateContext = createTemplateContext(
            {
              id: event.id,
              name: event.name,
              status: isSuccess ? "success" : "failure",
              duration: executionData?.duration,
              executionTime:
                executionData?.executionTime ?? new Date().toISOString(),
              server: event.server ?? "Local",
              output: executionData?.output,
              error: executionData?.error,
            },
            variablesMap,
            {},
            {},
          );

          // Process the message content and subject with Handlebars templating
          const processedSubject = templateProcessor.processTemplate(
            subject,
            templateContext,
          );
          const processedMessage = templateProcessor.processHtmlTemplate(
            message,
            templateContext,
          );

          // Use processed content directly as HTML
          const htmlContent = processedMessage;

          // Prepare email message
          const emailMessage = {
            to: recipients,
            subject: processedSubject,
            text: processedMessage.replace(/<[^>]*>/g, ""), // Strip HTML for plain text
            html: htmlContent,
          };

          // Prepare SMTP credentials in the format expected by sendEmail
          const smtpCredentials = {
            host: String(credentials.host ?? ""),
            port: Number(credentials.port ?? 587),
            user: String(credentials.user ?? ""),
            password: String(credentials.password ?? ""),
            fromEmail: String(credentials.fromEmail ?? ""),
            fromName: String(credentials.fromName ?? ""),
          };

          // Send the email
          const emailSent = await sendEmail(emailMessage, smtpCredentials);

          if (emailSent) {
            console.log(
              `SEND_MESSAGE email sent successfully to ${recipients ?? ""}`,
            );
          } else {
            console.error(
              `Failed to send SEND_MESSAGE email to ${recipients ?? ""}`,
            );
          }
        } else if (toolType === "SLACK" || toolType === "DISCORD") {
          // Get user variables for template context
          const userVariables = await storage.getUserVariables(event.userId);
          const variablesMap = userVariables.reduce(
            (acc, v) => {
              acc[v.key] = v.value;
              return acc;
            },
            {} as Record<string, unknown>,
          );

          // Ensure duration is a valid number for template processing
          const validDuration =
            executionData?.duration &&
            typeof executionData.duration === "number" &&
            !isNaN(executionData.duration)
              ? executionData.duration
              : 0;

          // Create template context with cronium data
          const templateContext = createTemplateContext(
            {
              id: event.id,
              name: event.name,
              status: isSuccess ? "success" : "failure",
              duration: validDuration,
              executionTime:
                executionData?.executionTime ?? new Date().toISOString(),
              server: event.server ?? "Local",
              output: executionData?.output,
              error: executionData?.error,
            },
            variablesMap,
            {},
            {},
          );

          // Process message with template processor
          const processedMessage = templateProcessor.processJsonTemplate(
            conditional_event.message,
            templateContext,
          );

          console.log(
            `Sending ${toolType ?? ""} message with processed template`,
          );
          console.log(
            `Message content: ${processedMessage.substring(0, 100)}...`,
          );

          // Send message using direct webhook calls (bypass API authentication)
          if (toolType === "SLACK") {
            try {
              if (!credentials.webhookUrl) {
                console.error("Webhook URL not found in Slack credentials");
                return;
              }

              // Prepare payload for webhook
              let payload: { text: string } | Record<string, unknown>;

              // Check if message is JSON (for Slack blocks/attachments)
              if (processedMessage.trim().startsWith("{")) {
                try {
                  payload = JSON.parse(processedMessage) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  // If JSON parsing fails, treat as plain text
                  payload = { text: processedMessage };
                }
              } else {
                payload = { text: processedMessage };
              }

              // Send message directly to Slack webhook
              const slackResponse = await fetch(
                String(credentials.webhookUrl ?? ""),
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(payload),
                },
              );

              if (slackResponse.ok) {
                console.log(
                  `SEND_MESSAGE Slack message sent successfully via webhook`,
                );
              } else {
                const errorText = await slackResponse.text();
                console.error(
                  `Failed to send Slack message: ${errorText ?? ""}`,
                );
              }
            } catch (error) {
              console.error(`Error sending Slack message:`, error);
            }
          } else if (toolType === "DISCORD") {
            try {
              if (!credentials.webhookUrl) {
                console.error("Webhook URL not found in Discord credentials");
                return;
              }

              // Prepare payload for Discord webhook
              let payload: { content: string } | Record<string, unknown>;

              // Check if message is JSON (for Discord embeds/components)
              if (processedMessage.trim().startsWith("{")) {
                try {
                  payload = JSON.parse(processedMessage) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  // If JSON parsing fails, treat as plain text
                  payload = { content: processedMessage };
                }
              } else {
                payload = { content: processedMessage };
              }

              // Send message directly to Discord webhook
              const discordResponse = await fetch(
                String(credentials.webhookUrl ?? ""),
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(payload),
                },
              );

              if (discordResponse.ok) {
                console.log(
                  `SEND_MESSAGE Discord message sent successfully via webhook`,
                );
              } else {
                const errorText = await discordResponse.text();
                console.error(
                  `Failed to send Discord message: ${errorText ?? ""}`,
                );
              }
            } catch (error) {
              console.error(`Error sending Discord message:`, error);
            }
          }
        } else {
          console.error(
            `Unsupported tool type for SEND_MESSAGE: ${toolType ?? ""}`,
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
      conditional_event.type === "SCRIPT" &&
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
