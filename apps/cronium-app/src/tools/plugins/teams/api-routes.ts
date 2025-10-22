import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      tenantName: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    })
    .optional(),
});

export const teamsApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Microsoft Teams connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async () => {
        // Mock implementation for now
        // TODO: Implement actual Teams API test
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            message: "Successfully connected to Microsoft Teams",
            details: {
              tenantName: "Mock Organization",
              permissions: ["Chat.ReadWrite", "ChannelMessage.Send"],
            },
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Connection failed",
          };
        }
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  validateCredentials: {
    path: "validateCredentials",
    method: "query",
    description: "Validate Teams credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.string(), z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const { teamsCredentialsSchema } = await import("./schemas");
        const result = teamsCredentialsSchema.safeParse(
          (input as { credentials: Record<string, unknown> }).credentials,
        );

        if (result.success) {
          return { valid: true };
        }

        const zodErrors = result.error.issues;
        const errorMessages = zodErrors.map((err) => {
          const path = err.path.join(".");
          return `${path}: ${err.message}`;
        });

        return {
          valid: false,
          errors: errorMessages,
        };
      },
    },
    requiresAuth: true,
  },
};
