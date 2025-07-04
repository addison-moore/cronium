import { storage } from "@/server/storage";
import { sendEmail } from "@/lib/email";
import {
  templateProcessor,
  createTemplateContext,
} from "@/lib/template-processor";

/**
 * Handle conditional events that should be triggered on successful execution
 */
export async function handleSuccessEvents(
  eventId: number,
  processEventCallback: (
    conditional_event: any,
    event: any,
    isSuccess: boolean,
    executionData?: {
      executionTime?: string;
      duration?: number;
      output?: string;
      error?: string;
    },
  ) => Promise<void>,
) {
  try {
    // Get the event with its success conditional events
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all success events for this event
    const successEvents = await storage.getSuccessEvents(eventId);

    // Get the latest log for execution data
    const latestLog = await storage.getLatestLogForScript(eventId);
    let executionDataFromLog;
    if (latestLog) {
      executionDataFromLog = {
        executionTime:
          latestLog.startTime?.toISOString() || new Date().toISOString(),
        duration: latestLog.duration || undefined,
        output: latestLog.output || "No output available",
        error: latestLog.error || undefined,
      };
    }

    // Process each success event with execution data from latest log
    for (const condEvent of successEvents) {
      await processEventCallback(condEvent, event, true, executionDataFromLog);
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Error handling success events for event ${eventId}:`, error);
  }
}

/**
 * Handle conditional events that should be triggered on failed execution
 */
export async function handleFailureEvents(
  eventId: number,
  processEventCallback: (
    conditional_event: any,
    event: any,
    isSuccess: boolean,
    executionData?: {
      executionTime?: string;
      duration?: number;
      output?: string;
      error?: string;
    },
  ) => Promise<void>,
) {
  try {
    // Get the event with its failure conditional events
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all failure events for this event
    const failureEvents = await storage.getFailEvents(eventId);

    // Get the latest log for execution data
    const latestLog = await storage.getLatestLogForScript(eventId);
    let executionData;
    if (latestLog) {
      executionData = {
        executionTime:
          latestLog.startTime?.toISOString() || new Date().toISOString(),
        duration: latestLog.duration || 0,
        output: latestLog.output || "No output available",
        error: latestLog.error || "Unknown error",
      };
    }

    // Process each failure event
    for (const condEvent of failureEvents) {
      await processEventCallback(condEvent, event, false, executionData);
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Error handling failure events for event ${eventId}:`, error);
  }
}

/**
 * Handle conditional events that should always be triggered regardless of success or failure
 */
export async function handleAlwaysEvents(
  eventId: number,
  processEventCallback: (
    conditional_event: any,
    event: any,
    isSuccess: boolean,
  ) => Promise<void>,
) {
  try {
    // Get the event with its always conditional events
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all always events for this event
    const alwaysEvents = await storage.getAlwaysEvents(eventId);

    // Process each always event
    for (const condEvent of alwaysEvents) {
      await processEventCallback(condEvent, event, true); // Pass true for consistency
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Error handling always events for event ${eventId}:`, error);
  }
}

/**
 * Handle condition events for an event based on the condition state
 */
export async function handleConditionEvents(
  eventId: number,
  condition: boolean,
  processEventCallback: (
    conditional_event: any,
    event: any,
    isSuccess: boolean,
  ) => Promise<void>,
) {
  try {
    // Get the event with its condition conditional events
    const event = await storage.getEventWithRelations(eventId);
    if (!event) return;

    // Get all condition events for this event
    const conditionEvents = await storage.getConditionEvents(eventId);

    console.log(
      `Processing ${conditionEvents.length} condition events for event ${eventId} with condition: ${condition}`,
    );

    // Process each condition event based on the condition state
    for (const condEvent of conditionEvents) {
      // Only trigger condition events if the condition is true
      if (condition) {
        console.log(
          `Triggering condition event ${condEvent.id} for event ${eventId} (condition: true)`,
        );
        await processEventCallback(condEvent, event, true);
      } else {
        console.log(
          `Skipping condition event ${condEvent.id} for event ${eventId} (condition: false)`,
        );
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling condition events for event ${eventId}:`,
      error,
    );
  }
}

/**
 * Process a conditional event based on the trigger type and event outcome
 */
export async function processEvent(
  conditional_event: any,
  event: any,
  isSuccess: boolean,
  executionData?: {
    executionTime?: string;
    duration?: number;
    output?: string;
    error?: string;
  },
) {
  try {
    console.log(
      `Processing conditional event ${conditional_event.id} for script ${event.id}: ${event.name}`,
    );
    console.log(
      `Conditional event type: ${conditional_event.type}, isSuccess: ${isSuccess}`,
    );

    // Check for tool message sending (SEND_MESSAGE)
    if (
      conditional_event.type === "SEND_MESSAGE" &&
      conditional_event.message
    ) {
      console.log(
        `Processing SEND_MESSAGE conditional event for tool ${conditional_event.toolId}`,
      );
      console.log(`Conditional event details:`, {
        type: conditional_event.type,
        toolId: conditional_event.toolId,
        message: conditional_event.message?.substring(0, 50) + "...",
        emailAddresses: conditional_event.emailAddresses,
        emailSubject: conditional_event.emailSubject,
      });

      try {
        let credentials;
        let toolType;

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
              `Tool ${conditional_event.toolId} not found for SEND_MESSAGE event`,
            );
            return;
          }

          // Decrypt credentials
          credentials = JSON.parse(encryptionService.decrypt(tool.credentials));
          toolType = tool.type;
        }

        // Handle email sending directly without plugin system
        if (toolType === "EMAIL") {
          const recipients = conditional_event.emailAddresses || "";
          const subject =
            conditional_event.emailSubject ||
            `Event ${isSuccess ? "Success" : "Failure"}: ${event.name}`;
          const message = conditional_event.message;

          if (!recipients) {
            console.error(
              "No recipients specified for email SEND_MESSAGE event",
            );
            return;
          }

          console.log(`Sending email directly via SMTP to: ${recipients}`);
          console.log(`Subject: ${subject}`);

          // Get user variables for template context
          const userVariables = await storage.getUserVariables(event.userId);
          const variablesMap = userVariables.reduce(
            (acc, v) => {
              acc[v.key] = v.value;
              return acc;
            },
            {} as Record<string, any>,
          );

          // Create template context with cronium data
          const templateContext = createTemplateContext(
            {
              id: event.id,
              name: event.name,
              status: isSuccess ? "success" : "failure",
              duration: executionData?.duration,
              executionTime:
                executionData?.executionTime || new Date().toISOString(),
              server: event.server || "Local",
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
            host: credentials.host,
            port: credentials.port,
            user: credentials.user,
            password: credentials.password,
            fromEmail: credentials.fromEmail,
            fromName: credentials.fromName,
          };

          // Send the email
          const emailSent = await sendEmail(emailMessage, smtpCredentials);

          if (emailSent) {
            console.log(
              `SEND_MESSAGE email sent successfully to ${recipients}`,
            );
          } else {
            console.error(`Failed to send SEND_MESSAGE email to ${recipients}`);
          }
        } else if (toolType === "SLACK" || toolType === "DISCORD") {
          // Get user variables for template context
          const userVariables = await storage.getUserVariables(event.userId);
          const variablesMap = userVariables.reduce(
            (acc, v) => {
              acc[v.key] = v.value;
              return acc;
            },
            {} as Record<string, any>,
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
                executionData?.executionTime || new Date().toISOString(),
              server: event.server || "Local",
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

          console.log(`Sending ${toolType} message with processed template`);
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
              let payload: any;

              // Check if message is JSON (for Slack blocks/attachments)
              if (processedMessage.trim().startsWith("{")) {
                try {
                  payload = JSON.parse(processedMessage);
                } catch (e) {
                  // If JSON parsing fails, treat as plain text
                  payload = { text: processedMessage };
                }
              } else {
                payload = { text: processedMessage };
              }

              // Send message directly to Slack webhook
              const slackResponse = await fetch(credentials.webhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
              });

              if (slackResponse.ok) {
                console.log(
                  `SEND_MESSAGE Slack message sent successfully via webhook`,
                );
              } else {
                const errorText = await slackResponse.text();
                console.error(`Failed to send Slack message: ${errorText}`);
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
              let payload: any;

              // Check if message is JSON (for Discord embeds/components)
              if (processedMessage.trim().startsWith("{")) {
                try {
                  payload = JSON.parse(processedMessage);
                } catch (e) {
                  // If JSON parsing fails, treat as plain text
                  payload = { content: processedMessage };
                }
              } else {
                payload = { content: processedMessage };
              }

              // Send message directly to Discord webhook
              const discordResponse = await fetch(credentials.webhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
              });

              if (discordResponse.ok) {
                console.log(
                  `SEND_MESSAGE Discord message sent successfully via webhook`,
                );
              } else {
                const errorText = await discordResponse.text();
                console.error(`Failed to send Discord message: ${errorText}`);
              }
            } catch (error) {
              console.error(`Error sending Discord message:`, error);
            }
          }
        } else {
          console.error(`Unsupported tool type for SEND_MESSAGE: ${toolType}`);
        }
      } catch (err) {
        const error = err as Error;
        console.error(
          `Error processing SEND_MESSAGE conditional event:`,
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
          `Executing target script ${targetScript.id}: ${targetScript.name} (type: ${targetScript.type}) as a result of conditional event`,
        );
        console.log(
          `Target script content preview: ${targetScript.content?.substring(0, 100)}...`,
        );

        try {
          // Create a completely independent execution by using the scheduler's method
          // This ensures the script runs with its own complete context
          const { ScriptScheduler } = await import("./scheduler");
          const scheduler = new ScriptScheduler();

          // Execute as if it's a standalone script execution
          const result = await scheduler.runScriptImmediately(targetScript.id);

          console.log(
            `Conditional script ${targetScript.id} execution completed with result: ${result.success}`,
          );
        } catch (execErr) {
          const execError = execErr as Error;
          console.error(
            `Failed to execute target script ${targetScript.id}:`,
            execError,
          );
        }
      } else {
        console.error(
          `Target script ${conditional_event.targetEventId} not found`,
        );
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Error processing conditional event:`, error);
  }
}
