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
      handler: async ({ ctx }) => {
        // Dynamic import: this file is shared with the client bundle, but
        // handlers only run server-side via the plugin router.
        const { testToolConnection } =
          await import("@/server/api/routers/tools/connection-tests");
        const result = await testToolConnection("notion", ctx.tool.credentials);
        return {
          success: result.success,
          message: result.message,
          details: result.success
            ? { workspaceName: (result.details?.workspace as string) ?? "" }
            : undefined,
        };
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
        credentials: z.record(z.string(), z.unknown()),
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
