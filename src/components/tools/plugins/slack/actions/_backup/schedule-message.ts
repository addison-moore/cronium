import { z } from "zod";
import type {
  ToolAction,
  ToolActionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for schedule-message action parameters
export const scheduleMessageSchema = z.object({
  channel: z.string().describe("Channel ID or name to post to"),
  text: z.string().describe("Message text"),
  post_at: z
    .number()
    .or(z.string().transform((val) => new Date(val).getTime() / 1000))
    .describe(
      "Unix timestamp or ISO date string when message should be posted",
    ),
  blocks: z
    .array(z.any())
    .optional()
    .describe("Rich message blocks for advanced formatting"),
  attachments: z.array(z.any()).optional().describe("Legacy attachments"),
  thread_ts: z
    .string()
    .optional()
    .describe("Thread timestamp to reply in a thread"),
  unfurl_links: z.boolean().optional().describe("Enable link unfurling"),
  unfurl_media: z.boolean().optional().describe("Enable media unfurling"),
  link_names: z
    .boolean()
    .optional()
    .describe("Find and link channel names and usernames"),
  metadata: z
    .object({
      event_type: z.string(),
      event_payload: z.record(z.string(), z.any()),
    })
    .optional()
    .describe("Message metadata for workflow triggers"),
});

export type ScheduleMessageParams = z.infer<typeof scheduleMessageSchema>;

export const scheduleMessageAction: ToolAction<ScheduleMessageParams> = {
  id: "schedule-message",
  name: "Schedule Message",
  description:
    "Schedule a message to be sent at a future time (requires OAuth token)",
  category: "create",
  inputSchema: scheduleMessageSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    scheduled_message_id: z
      .string()
      .optional()
      .describe("ID of the scheduled message"),
    post_at: z
      .number()
      .optional()
      .describe("Unix timestamp when message will be posted"),
    channel: z
      .string()
      .optional()
      .describe("Channel where message will be posted"),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Schedule Reminder",
      input: {
        channel: "#team-standup",
        text: "⏰ Daily standup starting in 10 minutes! Please prepare your updates.",
        post_at: "2024-01-20T09:20:00Z",
      },
      output: {
        ok: true,
        scheduled_message_id: "Q1234567890",
        post_at: 1705743600,
        channel: "C1234567890",
      },
    },
    {
      name: "Schedule Weekly Report",
      input: {
        channel: "#reports",
        text: "Weekly Summary Report",
        post_at: 1705708800, // Unix timestamp
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "📊 Weekly Summary - Week 3",
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: "*Tasks Completed:* 45",
              },
              {
                type: "mrkdwn",
                text: "*In Progress:* 12",
              },
            ],
          },
        ],
      },
      output: {
        ok: true,
        scheduled_message_id: "Q0987654321",
        post_at: 1705708800,
        channel: "C0987654321",
      },
    },
  ],
  async execute(params: ScheduleMessageParams, context: ToolActionContext) {
    const { updateProgress, getVariable, credentials } = context;

    try {
      await updateProgress(10, "Preparing scheduled message...");

      // Check if we have an OAuth token (Phase 2 feature)
      const accessToken = credentials.accessToken as string | undefined;
      if (!accessToken) {
        throw new Error(
          "This action requires Slack OAuth authentication. Currently only webhook-based actions are supported.",
        );
      }

      // Validate post_at is in the future
      const now = Date.now() / 1000;
      const postAt =
        typeof params.post_at === "number"
          ? params.post_at
          : new Date(params.post_at).getTime() / 1000;

      if (postAt <= now) {
        throw new Error("Scheduled time must be in the future");
      }

      // Slack has a limit of 120 days in the future
      const maxFutureTime = now + 120 * 24 * 60 * 60;
      if (postAt > maxFutureTime) {
        throw new Error(
          "Scheduled time cannot be more than 120 days in the future",
        );
      }

      await updateProgress(30, "Processing message content...");

      // Replace variables in text
      const processedText = params.text.replace(
        /\{\{(\w+)\}\}/g,
        (match, key) => {
          const value = getVariable(key);
          return value !== undefined ? value : match;
        },
      );

      // Build the payload
      const payload: Record<string, unknown> = {
        channel: params.channel,
        text: processedText,
        post_at: postAt,
      };

      // Add optional parameters
      if (params.blocks) payload.blocks = params.blocks;
      if (params.attachments) payload.attachments = params.attachments;
      if (params.thread_ts) payload.thread_ts = params.thread_ts;
      if (params.unfurl_links !== undefined)
        payload.unfurl_links = params.unfurl_links;
      if (params.unfurl_media !== undefined)
        payload.unfurl_media = params.unfurl_media;
      if (params.link_names !== undefined)
        payload.link_names = params.link_names;
      if (params.metadata) payload.metadata = params.metadata;

      await updateProgress(60, "Scheduling message with Slack...");

      // Make API request to schedule message
      const response = await fetch(
        "https://slack.com/api/chat.scheduleMessage",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();

      await updateProgress(90, "Processing response...");

      if (!data.ok) {
        throw new Error(data.error || "Failed to schedule message");
      }

      const scheduledTime = new Date(postAt * 1000).toLocaleString();
      await updateProgress(100, `Message scheduled for ${scheduledTime}`);

      return {
        ok: true,
        scheduled_message_id: data.scheduled_message_id,
        post_at: data.post_at,
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
