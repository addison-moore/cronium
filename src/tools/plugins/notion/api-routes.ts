import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      workspaceName: z.string().optional(),
      botId: z.string().optional(),
    })
    .optional(),
});

export const notionApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Notion API connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async () => {
        // Mock implementation for now
        // TODO: Implement actual Notion API test
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            message: "Successfully connected to Notion",
            details: {
              workspaceName: "Mock Workspace",
              botId: "bot_123456",
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
    description: "Validate Notion credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const { notionCredentialsSchema } = await import("./schemas");
        const result = notionCredentialsSchema.safeParse(
          (input as { credentials: Record<string, unknown> }).credentials,
        );

        if (result.success) {
          return { valid: true };
        }

        return {
          valid: false,
          errors: result.error.errors.map(
            (err) => `${err.path.join(".")}: ${err.message}`,
          ),
        };
      },
    },
    requiresAuth: true,
  },
};
