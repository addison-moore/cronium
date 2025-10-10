import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      permissions: z.array(z.string()).optional(),
      quotaUsage: z.number().optional(),
    })
    .optional(),
});

export const googleSheetsApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Google Sheets API connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async () => {
        // Mock implementation for now
        // TODO: Implement actual Google Sheets API test
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            message: "Successfully connected to Google Sheets",
            details: {
              permissions: ["spreadsheets.read", "spreadsheets.write"],
              quotaUsage: 0.15,
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
    description: "Validate Google Sheets credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.string(), z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const typedInput = input as { credentials: Record<string, unknown> };
        const { googleSheetsCredentialsSchema } = await import("./schemas");
        const result = googleSheetsCredentialsSchema.safeParse(
          typedInput.credentials,
        );

        if (result.success) {
          return { valid: true };
        }

        const zodErrors = result.error.issues as z.ZodIssue[];
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
