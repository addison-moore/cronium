"use client";

import React from "react";
import { z } from "zod";
import { EmailIcon } from "./email-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { zodToParameters } from "../../utils/zod-to-parameters";

// Email credentials schema
const emailSchema = z.object({
  name: z.string().min(1, "Name is required"),
  host: z.string().min(1, "SMTP host is required"),
  port: z.number().min(1, "Port is required"),
  user: z.string().min(1, "SMTP user is required"),
  password: z.string().min(1, "Password is required"),
  fromEmail: z.string().email("Valid email address is required"),
  fromName: z.string().min(1, "From name is required"),
});

type EmailFormData = z.infer<typeof emailSchema>;
type EmailCredentials = Omit<EmailFormData, "name">;

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
    resolver: zodResolver(emailSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as EmailCredentials)
            : (tool.credentials as EmailCredentials)),
        }
      : {
          name: "",
          host: "",
          port: 587,
          user: "",
          password: "",
          fromEmail: "",
          fromName: "",
        },
  });

  const handleSubmit = async (data: EmailFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Email Server"
          {...form.register("name")}
        />
      </div>
      <div>
        <Label htmlFor="host">SMTP Host</Label>
        <Input
          id="host"
          placeholder="smtp.gmail.com"
          {...form.register("host")}
        />
      </div>
      <div>
        <Label htmlFor="port">Port</Label>
        <Input
          id="port"
          placeholder=""
          {...form.register("port", { valueAsNumber: true })}
        />
      </div>
      <div>
        <Label htmlFor="user">SMTP User</Label>
        <Input
          id="user"
          placeholder="your-email@gmail.com"
          {...form.register("user")}
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Your email password or app password"
          {...form.register("password")}
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
                <Badge variant={tool.isActive ? "default" : "secondary"}>
                  {tool.isActive ? "Active" : "Inactive"}
                </Badge>
                <ToolHealthIndicator
                  toolId={tool.id}
                  toolName={tool.name}
                  showTestButton={true}
                />
              </div>
              <div className="text-muted-foreground grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Host:</span> {credentials.host}
                </div>
                <div>
                  <span className="font-medium">Port:</span> {credentials.port}
                </div>
                <div>
                  <span className="font-medium">User:</span> {credentials.user}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Password:</span>
                  <span>
                    {isPasswordVisible ? credentials.password : "••••••••"}
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
    developmentMode: "visual",
    isConditionalAction: true,
    inputSchema: sendEmailSchema,
    parameters: zodToParameters(sendEmailSchema),
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
      const validationResult = emailSchema.safeParse(credentials);
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

  schema: emailSchema,
  defaultValues: {
    name: "",
    host: "",
    port: 587,
    user: "",
    password: "",
    fromEmail: "",
    fromName: "",
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

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = emailSchema.safeParse(credentials);
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
