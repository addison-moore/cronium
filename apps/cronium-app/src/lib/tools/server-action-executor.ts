import { z } from "zod";
import * as nodemailer from "nodemailer";

// Re-define the execution context type to avoid circular dependency
export interface ToolActionExecutionContext {
  variables: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
  onProgress?: (progress: { step: string; percentage: number }) => void;
  onPartialResult?: (result: unknown) => void;
  isTest?: boolean;
  mockData?: unknown;
}

// Define action schemas
const emailActionSchema = z.object({
  to: z
    .string()
    .email()
    .or(z.string().regex(/^.+@.+\..+$/)),
  subject: z.string(),
  body: z.string(),
  isHtml: z.boolean().optional().default(false),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  attachments: z.array(z.any()).optional(),
});

const slackActionSchema = z.object({
  channel: z.string(),
  text: z.string(),
  blocks: z.array(z.any()).optional(),
  attachments: z.array(z.any()).optional(),
  thread_ts: z.string().optional(),
});

const discordActionSchema = z.object({
  content: z.string(),
  embeds: z.array(z.any()).optional(),
  channelId: z.string().optional(),
});

const teamsActionSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  channelId: z.string().optional(),
});

// Map action IDs to their schemas
const actionSchemas: Record<string, z.ZodSchema> = {
  "send-email": emailActionSchema,
  "slack-send-message": slackActionSchema,
  "discord-send-message": discordActionSchema,
  "teams-send-message": teamsActionSchema,
};

// Execute Email action
async function executeEmailAction(
  credentials: Record<string, unknown>,
  parameters: Record<string, unknown>,
  context: ToolActionExecutionContext,
): Promise<unknown> {
  context.logger.info("Executing email send action");

  // Validate parameters
  const validatedParams = emailActionSchema.parse(parameters);

  // Create transporter based on provider
  const provider = (credentials.provider as string) || "smtp";
  let transporter: nodemailer.Transporter;

  if (provider === "gmail") {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: credentials.email as string,
        pass: credentials.appPassword as string,
      },
    });
  } else if (provider === "sendgrid") {
    transporter = nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      auth: {
        user: "apikey",
        pass: credentials.apiKey as string,
      },
    });
  } else {
    // Generic SMTP
    transporter = nodemailer.createTransport({
      host: credentials.host as string,
      port: Number(credentials.port) || 587,
      secure: (credentials.secure as boolean) || false,
      auth: {
        user: credentials.username as string,
        pass: credentials.password as string,
      },
    });
  }

  // Send email
  const result = await transporter.sendMail({
    from: (credentials.from as string) || (credentials.email as string),
    to: validatedParams.to,
    subject: validatedParams.subject,
    text: validatedParams.isHtml ? undefined : validatedParams.body,
    html: validatedParams.isHtml ? validatedParams.body : undefined,
    cc: validatedParams.cc,
    bcc: validatedParams.bcc,
    attachments: validatedParams.attachments,
  });

  context.logger.info(`Email sent successfully to ${validatedParams.to}`);
  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
  };
}

// Execute Slack action
async function executeSlackAction(
  credentials: Record<string, unknown>,
  parameters: Record<string, unknown>,
  context: ToolActionExecutionContext,
): Promise<unknown> {
  context.logger.info("Executing Slack send message action");

  // Validate parameters
  const validatedParams = slackActionSchema.parse(parameters);

  // Check for webhook URL first (many users configure Slack with webhooks)
  const webhookUrl = credentials.webhookUrl as string;
  const token =
    (credentials.botToken as string) ||
    (credentials.token as string) ||
    (credentials.oauthToken as string);

  if (webhookUrl) {
    // Use webhook approach
    context.logger.info("Using Slack webhook to send message");

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: validatedParams.text,
        channel: validatedParams.channel, // Note: channel might be ignored by webhook
        blocks: validatedParams.blocks,
        attachments: validatedParams.attachments,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Slack webhook error: ${errorText || response.statusText}`,
      );
    }

    context.logger.info(`Slack message sent via webhook`);
    return {
      method: "webhook",
      success: true,
    };
  } else if (token) {
    // Use Slack Web API with bot token
    context.logger.info("Using Slack bot token to send message");

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: validatedParams.channel,
        text: validatedParams.text,
        blocks: validatedParams.blocks,
        attachments: validatedParams.attachments,
        thread_ts: validatedParams.thread_ts,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      ts?: string;
      channel?: string;
    };

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error || "Unknown error"}`);
    }

    context.logger.info(
      `Slack message sent to channel ${validatedParams.channel}`,
    );
    return {
      method: "bot",
      timestamp: result.ts,
      channel: result.channel,
    };
  } else {
    throw new Error("Slack webhook URL or bot token is required");
  }
}

// Execute Discord action
async function executeDiscordAction(
  credentials: Record<string, unknown>,
  parameters: Record<string, unknown>,
  context: ToolActionExecutionContext,
): Promise<unknown> {
  context.logger.info("Executing Discord send message action");

  // Validate parameters
  const validatedParams = discordActionSchema.parse(parameters);

  const webhookUrl = credentials.webhookUrl as string;
  const botToken = credentials.botToken as string;
  const channelId =
    validatedParams.channelId || (credentials.defaultChannelId as string);

  if (webhookUrl) {
    // Use webhook
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: validatedParams.content,
        embeds: validatedParams.embeds,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord webhook error: ${error}`);
    }

    context.logger.info("Discord message sent via webhook");
    return { success: true, method: "webhook" };
  } else if (botToken && channelId) {
    // Use bot API
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: validatedParams.content,
          embeds: validatedParams.embeds,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${error}`);
    }

    const result = (await response.json()) as {
      id: string;
      channel_id: string;
    };
    context.logger.info(`Discord message sent to channel ${channelId}`);
    return {
      messageId: result.id,
      channelId: result.channel_id,
      method: "bot",
    };
  } else {
    throw new Error(
      "Discord webhook URL or bot token with channel ID is required",
    );
  }
}

// Execute Teams action
async function executeTeamsAction(
  credentials: Record<string, unknown>,
  parameters: Record<string, unknown>,
  context: ToolActionExecutionContext,
): Promise<unknown> {
  context.logger.info("Executing Teams send message action");

  // Validate parameters
  const validatedParams = teamsActionSchema.parse(parameters);

  const webhookUrl = credentials.webhookUrl as string;
  if (!webhookUrl) {
    throw new Error("Teams webhook URL is required");
  }

  // Send to Teams webhook
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: validatedParams.title || "Message from Cronium",
      title: validatedParams.title,
      text: validatedParams.message,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Teams webhook error: ${error}`);
  }

  context.logger.info("Teams message sent successfully");
  return { success: true };
}

// Map action IDs to their executors
const actionExecutors: Record<
  string,
  (
    credentials: Record<string, unknown>,
    parameters: Record<string, unknown>,
    context: ToolActionExecutionContext,
  ) => Promise<unknown>
> = {
  "send-email": executeEmailAction,
  "slack-send-message": executeSlackAction,
  "discord-send-message": executeDiscordAction,
  "teams-send-message": executeTeamsAction,
};

// Server-side action definition type
interface ServerActionDefinition {
  id: string;
  name: string;
  actionType: string;
  inputSchema: z.ZodSchema;
  features?: {
    webhookSupport?: boolean;
  };
  execute: (
    credentials: Record<string, unknown>,
    parameters: Record<string, unknown>,
    context: ToolActionExecutionContext,
  ) => Promise<unknown>;
}

/**
 * Get server-side action definition by ID
 */
export function getServerActionById(
  actionId: string,
): ServerActionDefinition | null {
  const schema = actionSchemas[actionId];
  const executor = actionExecutors[actionId];

  if (!schema || !executor) {
    return null;
  }

  // Map action IDs to their definitions
  const actionDefinitions: Record<
    string,
    Omit<ServerActionDefinition, "inputSchema" | "execute">
  > = {
    "send-email": {
      id: "send-email",
      name: "Send Email",
      actionType: "communication",
    },
    "slack-send-message": {
      id: "slack-send-message",
      name: "Send Slack Message",
      actionType: "communication",
      features: { webhookSupport: true },
    },
    "discord-send-message": {
      id: "discord-send-message",
      name: "Send Discord Message",
      actionType: "communication",
      features: { webhookSupport: true },
    },
    "teams-send-message": {
      id: "teams-send-message",
      name: "Send Teams Message",
      actionType: "communication",
      features: { webhookSupport: true },
    },
  };

  const definition = actionDefinitions[actionId];
  if (!definition) {
    return null;
  }

  return {
    ...definition,
    inputSchema: schema,
    execute: executor,
  };
}

/**
 * Get all available server action IDs
 */
export function getAllServerActionIds(): string[] {
  return Object.keys(actionSchemas);
}
