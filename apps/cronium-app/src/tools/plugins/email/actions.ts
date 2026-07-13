// Server-safe email action definitions.
//
// These live outside email-plugin.tsx (which is "use client") so the server
// action registry can import them directly. A "use client" module imported
// from the RSC graph becomes a client-reference proxy whose `execute`/`actions`
// are unusable on the server — which is why routing execution through the
// plugin object silently produced an empty action registry.
import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "../../utils/zod-to-parameters";
import { emailCredentialsSchema, type EmailCredentials } from "./schemas";
import { EmailIcon } from "./email-icon";

type SendEmailParams = {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
};

export const sendEmailSchema = z.object({
  to: z
    .string()
    .min(1, "Recipient is required")
    .refine(
      (value) =>
        value
          .split(",")
          .map((address) => address.trim())
          .filter(Boolean)
          .every((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)),
      "Must be a valid email address (or comma-separated list)",
    )
    .describe("Recipient email address(es), comma-separated"),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(255, "Subject must be less than 255 characters"),
  body: z
    .string()
    .min(1, "Email body is required")
    .describe("Email body content (HTML supported)"),
  isHtml: z
    .boolean()
    .optional()
    .describe("Send the body as HTML (defaults to true)"),
});

export const emailActions: ToolAction[] = [
  {
    id: "send-email",
    name: "Send Email",
    description: "Send an email message to one or more recipients",
    category: "Communication",
    actionType: "create",
    actionTypeColor: "blue",
    developmentMode: "visual",
    isSendMessageAction: true,
    conditionalActionConfig: {
      parameterMapping: {
        recipients: "to",
        message: "body",
        subject: "subject",
      },
      displayConfig: {
        recipientLabel: "Email Addresses",
        messageLabel: "Email Body",
        showSubject: true,
        icon: EmailIcon,
      },
      validate: (params) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const errors: string[] = [];

        if (!params.to || typeof params.to !== "string") {
          errors.push("Email address is required");
        } else if (!emailRegex.test(params.to)) {
          errors.push("Invalid email address format");
        }

        if (!params.subject || typeof params.subject !== "string") {
          errors.push("Subject is required");
        }

        if (!params.body || typeof params.body !== "string") {
          errors.push("Email body is required");
        }

        return { isValid: errors.length === 0, errors };
      },
    },
    inputSchema: sendEmailSchema,
    parameters: safeZodToParameters(sendEmailSchema),
    outputSchema: z.object({
      messageId: z.string(),
      status: z.enum(["sent", "failed"]),
      recipients: z.array(z.string()),
      timestamp: z.string(),
      deliveryInfo: z
        .object({
          accepted: z.array(z.string()),
          rejected: z.array(z.string()),
          pending: z.array(z.string()),
        })
        .optional(),
    }),
    async execute(
      credentials: EmailCredentials,
      params: SendEmailParams,
      context: ExecutionContext,
    ) {
      context.logger.info(
        `Sending email to: ${Array.isArray(params.to) ? params.to.join(", ") : String(params.to)}`,
      );
      context.onProgress?.({ step: "Validating credentials", percentage: 10 });

      // Validate email credentials
      const validationResult = emailCredentialsSchema.safeParse(credentials);
      if (!validationResult.success) {
        const zodErrors = validationResult.error.issues;
        const errorMessages = zodErrors.map((e) => e.message).join(", ");
        throw new Error(`Invalid email credentials: ${errorMessages}`);
      }

      const emailCreds = validationResult.data;
      context.onProgress?.({
        step: "Connecting to SMTP server",
        percentage: 30,
      });

      // Dynamic import keeps nodemailer out of any client bundle that also
      // references this module for types.
      const { sendEmailDetailed } = await import("@/lib/email");

      const recipients = params.to
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean);
      const isHtml = params.isHtml ?? true;

      context.onProgress?.({ step: "Sending email", percentage: 60 });

      const sendResult = await sendEmailDetailed(
        {
          to: recipients.join(", "),
          subject: params.subject,
          text: isHtml ? params.body.replace(/<[^>]*>/g, "") : params.body,
          html: isHtml
            ? params.body
            : `<p>${params.body.replace(/\n/g, "<br>")}</p>`,
        },
        {
          host: emailCreds.smtpHost,
          port: emailCreds.smtpPort,
          user: emailCreds.smtpUser,
          password: emailCreds.smtpPassword,
          fromEmail: emailCreds.fromEmail,
          fromName: emailCreds.fromName ?? "Cronium",
          secure: emailCreds.enableSSL,
        },
      );

      context.onProgress?.({ step: "Email sent", percentage: 100 });

      if (sendResult.accepted.length === 0) {
        throw new Error(
          `Email rejected for all recipients: ${sendResult.rejected.join(", ")}`,
        );
      }

      const result = {
        messageId: sendResult.messageId,
        status: "sent" as const,
        recipients: sendResult.accepted,
        timestamp: new Date().toISOString(),
        deliveryInfo: {
          accepted: sendResult.accepted,
          rejected: sendResult.rejected,
          pending: [],
        },
      };

      context.logger.info(
        `Email sent successfully. Message ID: ${result.messageId}`,
      );
      return result;
    },
    testData: () => ({
      to: "test@example.com",
      subject: "Test Email",
      body: "This is a test email from Cronium.",
    }),
    validate: (params: SendEmailParams) => {
      const result = emailActions[0]?.inputSchema.safeParse(params);
      if (result?.success) {
        return { isValid: true, errors: [] };
      }

      const zodErrors = result?.error?.issues ?? [];
      const errorMessages = zodErrors.map((e) => {
        const path = e.path.join(".");
        return `${path}: ${e.message}`;
      });

      return {
        isValid: false,
        errors: errorMessages,
      };
    },
    helpText: "Send emails using SMTP credentials.",
    examples: [
      {
        name: "Simple Email",
        description: "Send a basic text email",
        input: {
          to: "user@example.com",
          subject: "Hello from Cronium",
          body: "This is a simple text email.",
        },
        output: {
          messageId: "example-123",
          status: "sent",
          recipients: ["user@example.com"],
          timestamp: "2024-01-01T12:00:00Z",
        },
      },
      {
        name: "Event Notification",
        description: "Send an event notification email",
        input: {
          to: "admin@example.com",
          subject: "Event {{cronium.event.name}} Completed",
          body: "The event completed in {{cronium.event.duration}}ms with status: {{cronium.event.status}}",
        },
        output: {
          messageId: "example-456",
          status: "sent",
          recipients: ["admin@example.com"],
          timestamp: "2024-01-01T12:00:00Z",
        },
      },
    ],
  },
];
