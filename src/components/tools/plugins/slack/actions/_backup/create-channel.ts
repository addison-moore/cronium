import { z } from "zod";
import type {
  ToolAction,
  ToolActionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for create-channel action parameters
export const createChannelSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(
      /^[a-z0-9-_]+$/,
      "Channel names can only contain lowercase letters, numbers, hyphens, and underscores",
    )
    .describe("Name of the channel to create (21 characters max, lowercase)"),
  is_private: z
    .boolean()
    .optional()
    .default(false)
    .describe("Create a private channel instead of public"),
  description: z
    .string()
    .optional()
    .describe("Description of the channel's purpose"),
  team_id: z
    .string()
    .optional()
    .describe("The workspace to create the channel in (for Enterprise Grid)"),
});

export type CreateChannelParams = z.infer<typeof createChannelSchema>;

// Note: This action requires Slack Web API access, not just webhooks
// It's included here as a placeholder for when OAuth2 is implemented in Phase 2
export const createChannelAction: ToolAction<CreateChannelParams> = {
  id: "create-channel",
  name: "Create Channel",
  description:
    "Create a new public or private channel in Slack (requires OAuth token)",
  category: "create",
  inputSchema: createChannelSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    channel: z
      .object({
        id: z.string(),
        name: z.string(),
        is_channel: z.boolean(),
        is_private: z.boolean(),
        created: z.number(),
        creator: z.string(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Create Public Channel",
      input: {
        name: "project-alpha",
        description: "Discussion channel for Project Alpha team",
      },
      output: {
        ok: true,
        channel: {
          id: "C1234567890",
          name: "project-alpha",
          is_channel: true,
          is_private: false,
          created: 1234567890,
          creator: "U1234567890",
        },
      },
    },
    {
      name: "Create Private Channel",
      input: {
        name: "leadership-team",
        is_private: true,
        description: "Private channel for leadership discussions",
      },
      output: {
        ok: true,
        channel: {
          id: "C0987654321",
          name: "leadership-team",
          is_channel: true,
          is_private: true,
          created: 1234567890,
          creator: "U1234567890",
        },
      },
    },
  ],
  async execute(params: CreateChannelParams, context: ToolActionContext) {
    const { updateProgress, credentials } = context;

    try {
      await updateProgress(10, "Preparing to create channel...");

      // Check if we have an OAuth token (Phase 2 feature)
      const accessToken = credentials.accessToken as string | undefined;
      if (!accessToken) {
        throw new Error(
          "This action requires Slack OAuth authentication. Currently only webhook-based actions are supported.",
        );
      }

      await updateProgress(30, "Validating channel name...");

      // Validate channel name length (Slack limit is 21 chars)
      if (params.name.length > 21) {
        throw new Error("Channel name must be 21 characters or less");
      }

      await updateProgress(50, "Creating channel via Slack API...");

      // Make API request to create channel
      const response = await fetch(
        "https://slack.com/api/conversations.create",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: params.name,
            is_private: params.is_private,
            ...(params.description && { description: params.description }),
            ...(params.team_id && { team_id: params.team_id }),
          }),
        },
      );

      const data = await response.json();

      await updateProgress(90, "Processing response...");

      if (!data.ok) {
        throw new Error(data.error || "Failed to create channel");
      }

      await updateProgress(100, "Channel created successfully!");

      return {
        ok: true,
        channel: data.channel,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      await updateProgress(100, `Failed: ${errorMessage}`);
      return {
        ok: false,
        error: errorMessage,
      };
    }
  },
  // Mark as requiring OAuth
  requiresOAuth: true,
};
