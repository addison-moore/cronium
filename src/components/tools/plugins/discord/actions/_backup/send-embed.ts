import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for Discord embed action parameters
export const sendEmbedSchema = z.object({
  title: z.string().max(256).describe("Embed title"),
  description: z
    .string()
    .max(4096)
    .optional()
    .describe("Main content of the embed"),
  url: z.string().url().optional().describe("URL for the title"),
  color: z
    .union([
      z.number().int().min(0).max(16777215),
      z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    ])
    .optional()
    .describe("Color of the embed (integer or hex string)"),
  timestamp: z.boolean().optional().describe("Include current timestamp"),
  footer_text: z.string().max(2048).optional().describe("Footer text"),
  footer_icon: z.string().url().optional().describe("Footer icon URL"),
  image_url: z.string().url().optional().describe("Main image URL"),
  thumbnail_url: z.string().url().optional().describe("Thumbnail image URL"),
  author_name: z.string().max(256).optional().describe("Author name"),
  author_url: z.string().url().optional().describe("Author URL"),
  author_icon: z.string().url().optional().describe("Author icon URL"),
  fields: z
    .array(
      z.object({
        name: z.string().max(256).describe("Field name"),
        value: z.string().max(1024).describe("Field value"),
        inline: z.boolean().optional().describe("Display inline"),
      }),
    )
    .max(25)
    .optional()
    .describe("Embed fields (up to 25)"),
  content: z
    .string()
    .max(2000)
    .optional()
    .describe("Message content outside the embed"),
  username: z.string().max(80).optional().describe("Override webhook username"),
  avatar_url: z.string().url().optional().describe("Override webhook avatar"),
});

export type SendEmbedParams = z.infer<typeof sendEmbedSchema>;

export const sendEmbedAction: ToolAction = {
  id: "send-embed",
  name: "Send Embed",
  description: "Send a rich embedded message to Discord",
  category: "Communication",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: sendEmbedSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message_id: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Status Update Embed",
      description: "Send a server status update",
      input: {
        title: "Server Status Update",
        description: "All systems are operational",
        color: "#00ff00",
        fields: [
          {
            name: "Status",
            value: "✅ Online",
            inline: true,
          },
          {
            name: "Uptime",
            value: "99.9%",
            inline: true,
          },
          {
            name: "Response Time",
            value: "45ms",
            inline: true,
          },
        ],
        footer_text: "Last checked",
        timestamp: true,
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
    {
      name: "Alert Embed",
      description: "Send an alert notification",
      input: {
        title: "⚠️ Warning",
        description: "High CPU usage detected on server-01",
        color: 16776960, // Yellow
        thumbnail_url: "https://example.com/warning-icon.png",
        fields: [
          {
            name: "Server",
            value: "server-01",
          },
          {
            name: "CPU Usage",
            value: "92%",
          },
          {
            name: "Duration",
            value: "5 minutes",
          },
        ],
        timestamp: true,
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as SendEmbedParams;
    const { variables, logger, onProgress } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing Discord embed...", percentage: 10 });
      }

      // Get webhook URL from credentials
      const webhookUrl = (credentials as { webhookUrl?: string }).webhookUrl;
      if (!webhookUrl) {
        throw new Error("Webhook URL not found in credentials");
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Building embed payload...", percentage: 30 });
      }

      // Build the embed object
      const embed: Record<string, unknown> = {
        title: typedParams.title
          ? replaceVariables(typedParams.title, variables)
          : undefined,
        description: typedParams.description
          ? replaceVariables(typedParams.description, variables)
          : undefined,
        url: typedParams.url,
      };

      // Handle color conversion
      if (typedParams.color !== undefined) {
        if (typeof typedParams.color === "string") {
          // Convert hex to integer
          embed.color = parseInt(typedParams.color.replace("#", ""), 16);
        } else {
          embed.color = typedParams.color;
        }
      }

      // Add timestamp if requested
      if (typedParams.timestamp) {
        embed.timestamp = new Date().toISOString();
      }

      // Add footer
      if (typedParams.footer_text) {
        embed.footer = {
          text: replaceVariables(typedParams.footer_text, variables),
          icon_url: typedParams.footer_icon,
        };
      }

      // Add images
      if (typedParams.image_url) {
        embed.image = { url: typedParams.image_url };
      }
      if (typedParams.thumbnail_url) {
        embed.thumbnail = { url: typedParams.thumbnail_url };
      }

      // Add author
      if (typedParams.author_name) {
        embed.author = {
          name: replaceVariables(typedParams.author_name, variables),
          url: typedParams.author_url,
          icon_url: typedParams.author_icon,
        };
      }

      // Add fields
      if (typedParams.fields && typedParams.fields.length > 0) {
        embed.fields = typedParams.fields.map((field) => ({
          name: replaceVariables(field.name, variables),
          value: replaceVariables(field.value, variables),
          inline: field.inline,
        }));
      }

      // Build the payload
      const payload: Record<string, unknown> = {
        embeds: [embed],
      };

      // Add optional message content
      if (typedParams.content) {
        payload.content = replaceVariables(typedParams.content, variables);
      }

      // Add optional overrides
      if (typedParams.username) {
        payload.username = typedParams.username;
      }
      if (typedParams.avatar_url) {
        payload.avatar_url = typedParams.avatar_url;
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Sending embed to Discord...", percentage: 60 });
      }

      // Send the request to Discord
      const response = await fetch(webhookUrl + "?wait=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseData = (await response.json()) as unknown;

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 90 });
      }

      if (!response.ok) {
        const errorMessage =
          (responseData as { message?: string }).message ??
          `Discord API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Success!
      if (onProgress) {
        onProgress({ step: "Embed sent successfully!", percentage: 100 });
      }

      return {
        success: true,
        message_id: (responseData as { id?: string }).id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Discord embed error: ${errorMessage}`);
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

// Helper function to replace variables in text
function replaceVariables(
  text: string,
  variables: { get: (key: string) => unknown }, // VariableManager from ExecutionContext
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables.get(key);
    if (value === null || value === undefined) return match;
    // Handle different types
    switch (typeof value) {
      case "object":
        return JSON.stringify(value);
      case "string":
        return value;
      case "number":
      case "boolean":
        return String(value);
      default:
        return match;
    }
  });
}
