import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for Discord create channel action parameters
export const createChannelSchema = z.object({
  guild_id: z.string().describe("Discord server (guild) ID"),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/)
    .describe("Channel name (alphanumeric, hyphens, underscores only)"),
  type: z
    .enum(["text", "voice", "category", "announcement", "forum", "stage"])
    .describe("Type of channel to create"),
  topic: z.string().max(1024).optional().describe("Channel topic/description"),
  parent_id: z.string().optional().describe("Parent category ID"),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Position in the channel list"),
  nsfw: z.boolean().optional().describe("Whether the channel is NSFW"),
  bitrate: z
    .number()
    .int()
    .min(8000)
    .max(384000)
    .optional()
    .describe("Bitrate for voice channels (8-384 kbps)"),
  user_limit: z
    .number()
    .int()
    .min(0)
    .max(99)
    .optional()
    .describe("User limit for voice channels (0-99, 0 = unlimited)"),
  rate_limit_per_user: z
    .number()
    .int()
    .min(0)
    .max(21600)
    .optional()
    .describe("Slowmode in seconds (0-21600)"),
  permission_overwrites: z
    .array(
      z.object({
        id: z.string().describe("Role or user ID"),
        type: z.enum(["role", "member"]).describe("Permission type"),
        allow: z.array(z.string()).optional().describe("Allowed permissions"),
        deny: z.array(z.string()).optional().describe("Denied permissions"),
      }),
    )
    .optional()
    .describe("Permission overwrites for the channel"),
});

export type CreateChannelParams = z.infer<typeof createChannelSchema>;

export const createChannelAction: ToolAction = {
  id: "create-channel",
  name: "Create Channel",
  description: "Create a new channel in a Discord server (requires OAuth)",
  category: "Server Management",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: createChannelSchema,
  parameters: zodToParameters(createChannelSchema),
  outputSchema: z.object({
    success: z.boolean(),
    channel_id: z.string().optional(),
    channel_name: z.string().optional(),
    error: z.string().optional(),
  }),
  helpText:
    "This action requires OAuth authentication with the 'Manage Channels' permission. The bot must have permission to create channels in the target server.",
  examples: [
    {
      name: "Create Text Channel",
      description: "Create a basic text channel",
      input: {
        guild_id: "987654321098765432",
        name: "general-chat",
        type: "text",
        topic: "General discussion channel",
        position: 1,
      },
      output: {
        success: true,
        channel_id: "123456789012345678",
        channel_name: "general-chat",
      },
    },
    {
      name: "Create Voice Channel",
      description: "Create a voice channel with limits",
      input: {
        guild_id: "987654321098765432",
        name: "voice-lobby",
        type: "voice",
        bitrate: 64000,
        user_limit: 10,
        parent_id: "111111111111111111",
      },
      output: {
        success: true,
        channel_id: "234567890123456789",
        channel_name: "voice-lobby",
      },
    },
    {
      name: "Create Private Channel",
      description: "Create a channel with custom permissions",
      input: {
        guild_id: "987654321098765432",
        name: "staff-only",
        type: "text",
        topic: "Staff discussion",
        permission_overwrites: [
          {
            id: "987654321098765432", // @everyone role
            type: "role",
            deny: ["VIEW_CHANNEL"],
          },
          {
            id: "222222222222222222", // Staff role
            type: "role",
            allow: ["VIEW_CHANNEL", "SEND_MESSAGES"],
          },
        ],
      },
      output: {
        success: true,
        channel_id: "345678901234567890",
        channel_name: "staff-only",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as CreateChannelParams;
    const { logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing channel creation...", percentage: 10 });
      }

      // Check for OAuth token
      const oauthToken = (credentials as { oauthToken?: string }).oauthToken;
      if (!oauthToken) {
        throw new Error(
          "OAuth authentication required. This action requires Discord OAuth with 'Manage Channels' permission.",
        );
      }

      // Validate channel name
      if (!/^[a-zA-Z0-9-_]+$/.exec(typedParams.name)) {
        throw new Error(
          "Invalid channel name. Use only letters, numbers, hyphens, and underscores.",
        );
      }

      if (isTest) {
        // Test mode - simulate success
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating channel creation...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate delay

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          channel_id: "test-" + Date.now(),
          channel_name: typedParams.name,
        };
      }

      // TODO: Implement actual Discord API calls for channel creation
      // This requires:
      // 1. OAuth token validation
      // 2. Permission checking in the guild
      // 3. Discord API v10 call to create channel
      // 4. Handling of permission overwrites
      // 5. Error handling for rate limits and permissions

      throw new Error(
        "OAuth-based channel creation not yet implemented. Use webhook-based actions for now.",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Discord channel creation error: ${errorMessage}`);
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
