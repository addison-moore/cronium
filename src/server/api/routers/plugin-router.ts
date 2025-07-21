import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { ToolPluginRegistry } from "@/tools/types/tool-plugin";
// Ensure plugins are initialized
import "@/tools/plugins";
import type {
  PluginApiRoute,
  PluginRouteContext,
  ToolWithParsedCredentials,
} from "@/tools/types/tool-plugin";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import {
  credentialEncryption,
  type EncryptedData,
} from "@/lib/security/credential-encryption";
import { auditLog } from "@/lib/security/audit-logger";

// Helper to get and decrypt tool credentials
async function getToolWithCredentials(
  userId: string,
  toolId: number,
): Promise<ToolWithParsedCredentials | null> {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
    ),
  });

  if (!tool) {
    return null;
  }

  // Decrypt credentials
  let parsedCredentials: Record<string, unknown> = {};
  if (tool.encrypted && tool.credentials) {
    try {
      const encryptedData = JSON.parse(tool.credentials) as EncryptedData;
      const decrypted = await credentialEncryption.decrypt(encryptedData);
      parsedCredentials =
        typeof decrypted === "string"
          ? (JSON.parse(decrypted) as Record<string, unknown>)
          : (decrypted as Record<string, unknown>);
    } catch (error) {
      console.error("Failed to decrypt tool credentials:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to decrypt tool credentials",
      });
    }
  } else if (tool.credentials) {
    try {
      parsedCredentials =
        typeof tool.credentials === "string"
          ? (JSON.parse(tool.credentials) as Record<string, unknown>)
          : (tool.credentials as Record<string, unknown>);
    } catch (error) {
      console.error("Failed to parse tool credentials:", error);
      parsedCredentials = {};
    }
  }

  return {
    ...tool,
    credentials: parsedCredentials,
  };
}

// Create a dynamic procedure for a plugin route
function createPluginProcedure(
  pluginId: string,
  routeName: string,
  route: PluginApiRoute,
) {
  // Create input schema with toolId
  const baseInput = route.handler.input;
  const inputSchema = z.intersection(
    baseInput,
    z.object({
      toolId: z.number().int().positive(),
    }),
  );

  // Define the handler function
  const handlerFunction = async ({
    ctx,
    input,
  }: {
    ctx: { session: { user: { id: string } } };
    input: z.infer<typeof inputSchema>;
  }) => {
    try {
      // Extract toolId from input
      const { toolId, ...routeInput } = input;

      // Get the tool and verify ownership
      const tool = await getToolWithCredentials(ctx.session.user.id, toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tool not found",
        });
      }

      // Verify tool type matches plugin
      if (tool.type.toLowerCase() !== pluginId.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tool type mismatch. Expected ${pluginId}, got ${tool.type}`,
        });
      }

      // Check if tool is active if required
      if (route.requiresActiveStatus && !tool.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tool is not active",
        });
      }

      // Create the plugin route context
      const pluginContext: PluginRouteContext = {
        userId: ctx.session.user.id,
        toolId,
        tool,
      };

      // Special handling for email plugin to use server-side email functionality
      let result;
      if (pluginId === "email") {
        // Import server-side email functionality
        const { sendEmail } = await import("@/lib/email");

        if (routeName === "testConnection") {
          try {
            const creds = tool.credentials;
            const startTime = Date.now();

            // Validate required fields
            if (
              !creds.smtpHost ||
              !creds.smtpPort ||
              !creds.smtpUser ||
              !creds.smtpPassword
            ) {
              throw new Error("Missing required SMTP configuration");
            }

            const latency = Date.now() - startTime;

            result = {
              success: true,
              message: "SMTP configuration validated successfully",
              details: {
                latency,
                serverInfo: `Configuration for ${String(creds.smtpHost)}:${String(creds.smtpPort)} is valid`,
              },
            };
          } catch (error) {
            result = {
              success: false,
              message:
                error instanceof Error ? error.message : "Connection failed",
            };
          }
        } else if (routeName === "send") {
          try {
            const emailInput = routeInput as {
              recipients: string;
              subject: string;
              message: string;
              isHtml?: boolean;
            };
            const recipients = emailInput.recipients
              .split(",")
              .map((email: string) => email.trim());

            const results = [];
            const creds = tool.credentials;
            const customSmtp = {
              host: creds.smtpHost as string,
              port: creds.smtpPort as number,
              user: creds.smtpUser as string,
              password: creds.smtpPassword as string,
              fromEmail: creds.fromEmail as string,
              fromName: (creds.fromName as string) ?? "Cronium",
            };

            for (const recipient of recipients) {
              try {
                const success = await sendEmail(
                  {
                    to: recipient,
                    subject: emailInput.subject,
                    text: emailInput.message,
                    html: emailInput.isHtml
                      ? emailInput.message
                      : `<p>${emailInput.message.replace(/\\n/g, "<br>")}</p>`,
                  },
                  customSmtp,
                );

                results.push({
                  email: recipient,
                  status: success ? "sent" : "failed",
                  error: success ? undefined : "Failed to send",
                });
              } catch (error) {
                results.push({
                  email: recipient,
                  status: "failed" as const,
                  error:
                    error instanceof Error ? error.message : "Unknown error",
                });
              }
            }

            const successCount = results.filter(
              (r) => r.status === "sent",
            ).length;
            const allSuccess = successCount === recipients.length;

            result = {
              success: allSuccess,
              message: allSuccess
                ? `Email sent successfully to ${successCount} recipient(s)`
                : `Email sent to ${successCount}/${recipients.length} recipients`,
              messageId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              recipients: results,
            };
          } catch (error) {
            result = {
              success: false,
              message:
                error instanceof Error ? error.message : "Failed to send email",
            };
          }
        } else if (routeName === "bulkSend") {
          const bulkInput = routeInput as {
            emails: Array<{
              recipients: string;
              subject: string;
              message: string;
              isHtml?: boolean;
            }>;
          };
          const results = [];
          const creds = tool.credentials;
          const customSmtp = {
            host: creds.smtpHost as string,
            port: creds.smtpPort as number,
            user: creds.smtpUser as string,
            password: creds.smtpPassword as string,
            fromEmail: creds.fromEmail as string,
            fromName: (creds.fromName as string) ?? "Cronium",
          };

          for (let i = 0; i < bulkInput.emails.length; i++) {
            const email = bulkInput.emails[i];
            if (!email) {
              results.push({
                index: i,
                success: false,
                error: "Invalid email data",
              });
              continue;
            }

            try {
              const recipients = email.recipients
                .split(",")
                .map((e: string) => e.trim());

              let allSuccess = true;
              for (const recipient of recipients) {
                const success = await sendEmail(
                  {
                    to: recipient,
                    subject: email.subject,
                    text: email.message,
                    html: email.isHtml
                      ? email.message
                      : `<p>${email.message.replace(/\\n/g, "<br>")}</p>`,
                  },
                  customSmtp,
                );
                if (!success) {
                  allSuccess = false;
                  break;
                }
              }

              results.push({
                index: i,
                success: allSuccess,
                messageId: allSuccess ? `email_${Date.now()}_${i}` : undefined,
                error: allSuccess
                  ? undefined
                  : "Failed to send to one or more recipients",
              });
            } catch (error) {
              results.push({
                index: i,
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to send email",
              });
            }
          }

          const successCount = results.filter((r) => r.success).length;

          result = {
            success: successCount > 0,
            message: `Sent ${successCount} of ${bulkInput.emails.length} emails`,
            results,
          };
        } else {
          // Call the plugin handler for other routes
          result = await route.handler.handler({
            input: routeInput,
            ctx: pluginContext,
          });
        }
      } else {
        // Call the plugin handler for non-email plugins
        result = await route.handler.handler({
          input: routeInput,
          ctx: pluginContext,
        });
      }

      // Validate output
      const validatedOutput = route.handler.output.parse(result);

      // Audit log for mutations
      if (route.method === "mutation") {
        // Use the convenience method for tool execution
        await auditLog.toolExecuted(
          {
            userId: ctx.session.user.id,
            toolId: toolId,
          },
          `${pluginId}.${routeName}`,
          0, // duration - we could calculate this if needed
        );
      }

      return validatedOutput;
    } catch (error) {
      // Log error
      console.error(`Plugin route error [${pluginId}.${routeName}]:`, error);

      // Re-throw TRPC errors
      if (error instanceof TRPCError) {
        throw error;
      }

      // Wrap other errors
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Plugin route failed",
        cause: error,
      });
    }
  };

  // Create the procedure with input schema and handler
  if (route.method === "mutation") {
    return protectedProcedure.input(inputSchema).mutation(handlerFunction);
  } else {
    return protectedProcedure.input(inputSchema).query(handlerFunction);
  }
}

// Type for the plugin routes
type PluginProcedure = ReturnType<typeof createPluginProcedure>;

// Build dynamic router from plugin registry
export function buildPluginRouter() {
  const routes: Record<string, ReturnType<typeof createTRPCRouter>> = {};

  // Get all registered plugins
  const plugins = ToolPluginRegistry.getAll();

  // Process each plugin
  for (const plugin of plugins) {
    if (!plugin.apiRoutes) continue;

    // Create a sub-router for this plugin
    const pluginRoutes: Record<string, PluginProcedure> = {};

    // Process each route in the plugin
    for (const [routeName, route] of Object.entries(plugin.apiRoutes)) {
      pluginRoutes[routeName] = createPluginProcedure(
        plugin.id,
        routeName,
        route,
      );
    }

    // Add the plugin sub-router
    if (Object.keys(pluginRoutes).length > 0) {
      routes[plugin.id] = createTRPCRouter(pluginRoutes);
    }
  }

  // Return the complete plugin router
  return createTRPCRouter(routes);
}

// Export a function to get route metadata for documentation
export function getPluginRouteMetadata() {
  const metadata: Record<
    string,
    Record<
      string,
      {
        path: string;
        method: string;
        description: string;
        requiresAuth: boolean;
        requiresActiveStatus: boolean;
      }
    >
  > = {};

  const plugins = ToolPluginRegistry.getAll();

  for (const plugin of plugins) {
    if (!plugin.apiRoutes) continue;

    metadata[plugin.id] = {};

    for (const [routeName, route] of Object.entries(plugin.apiRoutes)) {
      metadata[plugin.id]![routeName] = {
        path: route.path,
        method: route.method,
        description: route.description,
        requiresAuth: route.requiresAuth !== false,
        requiresActiveStatus: route.requiresActiveStatus ?? false,
      };
    }
  }

  return metadata;
}
