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
      handler: async ({ ctx }) => {
        // Dynamic import: this file is shared with the client bundle, but
        // handlers only run server-side via the plugin router. The OAuth
        // credential bridge injects credentials.oauthToken before this runs.
        const { testToolConnection } =
          await import("@/server/api/routers/tools/connection-tests");
        const result = await testToolConnection(
          "google-sheets",
          ctx.tool.credentials,
        );
        return {
          success: result.success,
          message: result.message,
        };
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
