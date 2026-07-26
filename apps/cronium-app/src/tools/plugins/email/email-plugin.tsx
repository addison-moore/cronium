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
  type ActionType,
} from "../../types/tool-plugin";
import { emailCredentialsSchema, type EmailCredentials } from "./schemas";
import { emailActions } from "./actions";
import { TestConnectionButton } from "@/tools/components/TestConnectionButton";

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

// When editing an existing tool the server redacts smtpPassword to "" in read
// responses and treats a blank secret on update as "keep the current value"
// (see lib/tools/credential-redaction.ts). Requiring min(1) here would force
// re-typing the password on every edit, so the edit-mode schema allows blank.
const emailEditFormSchema = emailFormSchema.extend({
  smtpPassword: z.string(),
});

type EmailFormData = z.infer<typeof emailFormSchema>;

// Email credential form component
function EmailCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<EmailFormData>({
    resolver: zodResolver(tool ? emailEditFormSchema : emailFormSchema),
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
        <p className="text-muted-foreground mt-1 text-xs">
          Your mail provider&apos;s outgoing SMTP server (e.g. smtp.gmail.com,
          smtp.office365.com).
        </p>
      </div>
      <div>
        <Label htmlFor="smtpPort">Port</Label>
        <Input
          id="smtpPort"
          placeholder="587"
          {...form.register("smtpPort", { valueAsNumber: true })}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          587 for STARTTLS (Enable TLS), 465 for SSL (Enable SSL), 25 for
          unencrypted.
        </p>
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
        <p className="text-muted-foreground mt-1 text-xs">
          For Gmail, Outlook, and most providers with 2FA, use an{" "}
          <strong>app password</strong>, not your account password.
        </p>
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
      <TestConnectionButton
        type="email"
        toolId={tool?.id}
        getCredentials={() => {
          const { name: _name, ...creds } = form.getValues();
          return creds;
        }}
      />
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
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
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
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tool.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

  // API Routes

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
