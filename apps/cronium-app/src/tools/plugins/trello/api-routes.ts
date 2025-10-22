import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      memberName: z.string().optional(),
      memberId: z.string().optional(),
    })
    .optional(),
});

export const trelloApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Trello API connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async () => {
        // Mock implementation for now
        // TODO: Implement actual Trello API test
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            message: "Successfully connected to Trello",
            details: {
              memberName: "Test User",
              memberId: "member123",
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
    description: "Validate Trello credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.string(), z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const { trelloCredentialsSchema } = await import("./schemas");
        const result = trelloCredentialsSchema.safeParse(
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
