import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for Discord manage roles action parameters
export const manageRolesSchema = z.object({
  user_id: z.string().describe("Discord user ID"),
  guild_id: z.string().describe("Discord server (guild) ID"),
  action: z.enum(["add", "remove"]).describe("Whether to add or remove roles"),
  role_ids: z
    .array(z.string())
    .min(1)
    .describe("Array of role IDs to add/remove"),
  reason: z
    .string()
    .max(512)
    .optional()
    .describe("Audit log reason for the role change"),
});

export type ManageRolesParams = z.infer<typeof manageRolesSchema>;

export const manageRolesAction: ToolAction = {
  id: "manage-roles",
  name: "Manage Roles",
  description: "Add or remove roles from Discord users (requires OAuth)",
  category: "User Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: manageRolesSchema,
  parameters: zodToParameters(manageRolesSchema),
  outputSchema: z.object({
    success: z.boolean(),
    updated_roles: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  helpText:
    "This action requires OAuth authentication with the 'Manage Roles' permission. The bot must have a role higher than the roles being managed.",
  examples: [
    {
      name: "Add Verified Role",
      description: "Add verified role to a user",
      input: {
        user_id: "123456789012345678",
        guild_id: "987654321098765432",
        action: "add",
        role_ids: ["111111111111111111"],
        reason: "User completed verification",
      },
      output: {
        success: true,
        updated_roles: ["111111111111111111"],
      },
    },
    {
      name: "Remove Multiple Roles",
      description: "Remove temporary roles from a user",
      input: {
        user_id: "123456789012345678",
        guild_id: "987654321098765432",
        action: "remove",
        role_ids: ["222222222222222222", "333333333333333333"],
        reason: "Temporary access expired",
      },
      output: {
        success: true,
        updated_roles: ["222222222222222222", "333333333333333333"],
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as ManageRolesParams;
    const { logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing role management...", percentage: 10 });
      }

      // Check for OAuth token
      const oauthToken = (credentials as { oauthToken?: string }).oauthToken;
      if (!oauthToken) {
        throw new Error(
          "OAuth authentication required. This action requires Discord OAuth with 'Manage Roles' permission.",
        );
      }

      if (isTest) {
        // Test mode - simulate success
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating role update...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate delay

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          updated_roles: typedParams.role_ids,
        };
      }

      // TODO: Implement actual Discord API calls for role management
      // This requires:
      // 1. OAuth token validation
      // 2. Permission checking
      // 3. Discord API v10 calls to add/remove roles
      // 4. Error handling for rate limits and permissions

      throw new Error(
        "OAuth-based role management not yet implemented. Use webhook-based actions for now.",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Discord role management error: ${errorMessage}`);
      if (onProgress) {
        onProgress({ step: `Failed: ${errorMessage}`, percentage: 100 });
      }
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
};
