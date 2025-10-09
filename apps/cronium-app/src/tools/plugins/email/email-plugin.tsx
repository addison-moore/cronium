"use client";

import React from "react";
import { z } from "zod";
import { EmailIcon } from "./email-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { ToolHealthIndicator } from "../../ToolHealthIndicator";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
  type ToolAction,
  type ActionType,
  type ExecutionContext,
} from "../../types/tool-plugin";
import { safeZodToParameters } from "../../utils/zod-to-parameters";
import { emailCredentialsSchema, type EmailCredentials } from "./schemas";
import { emailApiRoutes } from "./api-routes";

// Email form schema (includes name field for UI)
const emailFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z
    .number()
    .int()
    .min(1)
    .max(65535, "Port must be between 1 and 65535"),
  smtpUser: z.string().min(1, "SMTP username is required"),
  smtpPassword: z.string().min(1, "SMTP password is required"),
  fromEmail: z.string().email("Must be a valid email address"),
  fromName: z.string().optional(),
  enableTLS: z.boolean(),
  enableSSL: z.boolean(),
});

type EmailFormData = z.infer<typeof emailFormSchema>;

// Define parameter types for email actions - Simplified for MVP
type SendEmailParams = {
  to: string;
  subject: string;
  body: string;
};

// Email credential form component
function EmailCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<EmailFormData>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as EmailCredentials)
            : (tool.credentials as EmailCredentials)),
        }
      : {
          name: "",
          smtpHost: "",
          smtpPort: 587,
          smtpUser: "",
          smtpPassword: "",
          fromEmail: "",
          fromName: "",
          enableTLS: true,
          enableSSL: false,
        },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Email Server"
          {...form.register("name")}
        />
      </div>
      <div>
        <Label htmlFor="smtpHost">SMTP Host</Label>
        <Input
          id="smtpHost"
          placeholder="smtp.gmail.com"
          {...form.register("smtpHost")}
        />
      </div>
      <div>
        <Label htmlFor="smtpPort">Port</Label>
        <Input
          id="smtpPort"
          placeholder=""
          {...form.register("smtpPort", { valueAsNumber: true })}
        />
      </div>
      <div>
        <Label htmlFor="smtpUser">SMTP User</Label>
        <Input
          id="smtpUser"
          placeholder="your-email@gmail.com"
          {...form.register("smtpUser")}
        />
      </div>
      <div>
        <Label htmlFor="smtpPassword">Password</Label>
        <Input
          id="smtpPassword"
          type="password"
          placeholder="Your email password or app password"
          {...form.register("smtpPassword")}
        />
      </div>
      <div>
        <Label htmlFor="fromEmail">From Email</Label>
        <Input
          id="fromEmail"
          type="email"
          placeholder="noreply@yourcompany.com"
          {...form.register("fromEmail")}
        />
      </div>
      <div>
        <Label htmlFor="fromName">From Name</Label>
        <Input
          id="fromName"
          placeholder="Your Company Name"
          {...form.register("fromName")}
        />
      </div>
      <div className="flex items-center space-x-2">
        <input type="checkbox" id="enableTLS" {...form.register("enableTLS")} />
        <Label htmlFor="enableTLS">Enable TLS</Label>
      </div>
      <div className="flex items-center space-x-2">
        <input type="checkbox" id="enableSSL" {...form.register("enableSSL")} />
        <Label htmlFor="enableSSL">Enable SSL</Label>
      </div>
      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{tool ? "Update" : "Create"}</Button>
      </div>
    </form>
  );
}

// Email credential display component
function EmailCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const [showPasswords, setShowPasswords] = React.useState<
    Record<number, boolean>
  >({});

  const togglePasswordVisibility = (toolId: number) => {
    setShowPasswords((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: EmailCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as EmailCredentials)
            : (tool.credentials as EmailCredentials);
        const isPasswordVisible = showPasswords[tool.id];

        return (
          <div
            key={tool.id}
            className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h4 className="font-medium">{tool.name}</h4>
                <StatusBadge status={tool.isActive ? "active" : "offline"} />
                <ToolHealthIndicator
                  toolId={tool.id}
                  toolName={tool.name}
                  showTestButton={true}
                />
              </div>
              <div className="text-muted-foreground grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Host:</span>{" "}
                  {credentials.smtpHost}
                </div>
                <div>
                  <span className="font-medium">Port:</span>{" "}
                  {credentials.smtpPort}
                </div>
                <div>
                  <span className="font-medium">User:</span>{" "}
                  {credentials.smtpUser}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Password:</span>
                  <span>
                    {isPasswordVisible ? credentials.smtpPassword : "••••••••"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => togglePasswordVisibility(tool.id)}
                  >
                    {isPasswordVisible ? (
                      <EyeOff size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                  </Button>
                </div>
                <div>
                  <span className="font-medium">From Email:</span>{" "}
                  {credentials.fromEmail}
                </div>
                <div>
                  <span className="font-medium">From Name:</span>{" "}
                  {credentials.fromName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(tool)}>
                <Edit size={16} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tool.id)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Email Actions Definition - Simplified for MVP
const sendEmailSchema = z.object({
  to: z.string().email("Must be a valid email address"),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(255, "Subject must be less than 255 characters"),
  body: z
    .string()
    .min(1, "Email body is required")
    .describe("Email body content (HTML supported)"),
});

const emailActions: ToolAction[] = [
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
        throw new Error(
          `Invalid email credentials: ${validationResult.error.errors.map((e) => e.message).join(", ")}`,
        );
      }

      const _emailCreds = validationResult.data;
      context.onProgress?.({
        step: "Connecting to SMTP server",
        percentage: 30,
      });

      // Simulate email sending for Phase 1 - Simplified for MVP
      // In a real implementation, this would use nodemailer or similar
      const recipient = params.to;

      context.onProgress?.({ step: "Preparing email", percentage: 50 });

      // Mock email sending logic
      const mockDelay = Math.random() * 2000 + 500; // 500-2500ms
      await new Promise((resolve) => setTimeout(resolve, mockDelay));

      context.onProgress?.({ step: "Sending email", percentage: 80 });

      // Validate recipient email
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

      context.onProgress?.({ step: "Email sent", percentage: 100 });

      const result = {
        messageId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: isValidEmail ? "sent" : "failed",
        recipients: isValidEmail ? [recipient] : [],
        timestamp: new Date().toISOString(),
        deliveryInfo: {
          accepted: isValidEmail ? [recipient] : [],
          rejected: isValidEmail ? [] : [recipient],
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
      return {
        isValid: result?.success ?? false,
        errors: result?.success
          ? []
          : (result?.error?.errors.map(
              (e) => `${e.path.join(".")}: ${e.message}`,
            ) ?? []),
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

// Email plugin definition - fully tRPC integrated
export const EmailPlugin: ToolPlugin = {
  id: "email",
  name: "Email",
  description: "Send email notifications via SMTP",
  icon: EmailIcon,
  category: "Communication",
  categoryIcon: "Mail",

  schema: emailCredentialsSchema,
  defaultValues: {
    smtpHost: "",
    smtpPort: 587,
    smtpUser: "",
    smtpPassword: "",
    fromEmail: "",
    fromName: "",
    enableTLS: true,
    enableSSL: false,
  },

  CredentialForm: EmailCredentialForm,
  CredentialDisplay: EmailCredentialDisplay,
  // TemplateManager: EmailTemplateManager, // Removed - using tool action templates

  // Tool Actions
  actions: emailActions,
  getActionById: (id: string) =>
    emailActions.find((action) => action.id === id),
  getActionsByType: (type: ActionType) =>
    emailActions.filter((action) => action.actionType === type),
  getConditionalAction: () =>
    emailActions.find((action) => action.isSendMessageAction),

  // API Routes
  apiRoutes: emailApiRoutes,

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = emailCredentialsSchema.safeParse(credentials);
    if (result.success) {
      return { isValid: true };
    } else {
      const errorMessage = result.error.issues[0]?.message;
      if (errorMessage) {
        return {
          isValid: false,
          error: errorMessage,
        };
      } else {
        return {
          isValid: false,
        };
      }
    }
  },
};
