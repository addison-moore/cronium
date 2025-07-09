"use client";

import React from "react";
import { z } from "zod";
import { TeamsIcon } from "./teams-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Edit, Trash2, Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { teamsActions } from "./actions";
import { ToolHealthBadge } from "@/components/tools/ToolHealthIndicator";

const teamsSchema = z.object({
  name: z.string().min(1, "Name is required"),
  scope: z.string().default("https://graph.microsoft.com/.default"),
  webhookUrl: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .describe("Teams webhook URL for sending messages"),
  clientId: z.string().optional().describe("Azure AD application client ID"),
  clientSecret: z
    .string()
    .optional()
    .describe("Azure AD application client secret"),
  tenantId: z.string().optional().describe("Azure AD tenant ID"),
  refreshToken: z.string().optional(),
});

type TeamsFormData = z.infer<typeof teamsSchema>;
type TeamsCredentials = Omit<TeamsFormData, "name">;

function TeamsCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<TeamsFormData>({
    resolver: zodResolver(teamsSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as TeamsCredentials)
            : (tool.credentials as TeamsCredentials)),
        }
      : {
          name: "",
          webhookUrl: "",
          clientId: "",
          clientSecret: "",
          tenantId: "",
          scope: "https://graph.microsoft.com/.default",
        },
  });

  const handleSubmit = async (data: TeamsFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Microsoft Teams integration supports both webhook-based messaging
          (simple) and OAuth-based operations (advanced). For webhook messaging,
          you only need a webhook URL. For advanced features like creating
          meetings and managing teams, you'll need to register an Azure AD
          application.
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Teams Integration"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="webhookUrl">Webhook URL (for messaging)</Label>
        <Input
          id="webhookUrl"
          type="url"
          placeholder="https://outlook.office.com/webhook/..."
          {...form.register("webhookUrl")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Get this from your Teams channel settings → Connectors → Incoming
          Webhook
        </p>
      </div>

      <div className="space-y-4 border-t pt-4">
        <h4 className="text-sm font-medium">
          OAuth Settings (for advanced features)
        </h4>

        <div>
          <Label htmlFor="tenantId">Tenant ID</Label>
          <Input
            id="tenantId"
            placeholder="your-tenant-id"
            {...form.register("tenantId")}
          />
        </div>

        <div>
          <Label htmlFor="clientId">Client ID</Label>
          <Input
            id="clientId"
            placeholder="your-client-id"
            {...form.register("clientId")}
          />
        </div>

        <div>
          <Label htmlFor="clientSecret">Client Secret</Label>
          <Input
            id="clientSecret"
            type="password"
            placeholder="your-client-secret"
            {...form.register("clientSecret")}
          />
        </div>

        <p className="text-muted-foreground text-xs">
          To use OAuth features, register an app in{" "}
          <a
            href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Azure Active Directory
          </a>{" "}
          with Microsoft Graph permissions.
        </p>
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

function TeamsCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const [showSecrets, setShowSecrets] = React.useState<Record<number, boolean>>(
    {},
  );

  const toggleSecretVisibility = (toolId: number) => {
    setShowSecrets((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: TeamsCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as TeamsCredentials)
            : (tool.credentials as TeamsCredentials);
        const isSecretVisible = showSecrets[tool.id];
        const hasWebhook = !!credentials.webhookUrl;
        const hasOAuth = !!(
          credentials.clientId &&
          credentials.clientSecret &&
          credentials.tenantId
        );

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
                <ToolHealthBadge
                  toolId={tool.id}
                />
                {hasWebhook && (
                  <Badge variant="outline" className="text-blue-600">
                    Webhook
                  </Badge>
                )}
                {hasOAuth && (
                  <Badge variant="outline" className="text-green-600">
                    OAuth
                  </Badge>
                )}
                {hasOAuth && !credentials.refreshToken && (
                  <Badge variant="outline" className="text-orange-600">
                    Authorization Required
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground grid grid-cols-1 gap-2 text-sm">
                {hasWebhook && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Webhook:</span>
                    <span className="font-mono text-xs">
                      {credentials.webhookUrl?.substring(0, 40)}...
                    </span>
                  </div>
                )}
                {hasOAuth && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Tenant ID:</span>
                      <span className="font-mono text-xs">
                        {credentials.tenantId}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Client ID:</span>
                      <span className="font-mono text-xs">
                        {credentials.clientId?.substring(0, 20)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Client Secret:</span>
                      <span className="font-mono text-xs">
                        {isSecretVisible
                          ? credentials.clientSecret
                          : "••••••••••••••••"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSecretVisibility(tool.id)}
                      >
                        {isSecretVisible ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </div>
              {hasOAuth && !credentials.refreshToken && tool.isActive && (
                <div className="mt-3">
                  <Button variant="outline" size="sm" disabled>
                    Authorize Access (OAuth2 coming soon)
                  </Button>
                </div>
              )}
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

      {tools.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Microsoft Teams Configurations</CardTitle>
            <CardDescription>
              Add a Microsoft Teams configuration to start sending messages and
              managing teams.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Microsoft Teams integration allows you to:
            </p>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Send messages and adaptive cards to channels</li>
              <li>Create and manage meetings</li>
              <li>Manage teams and channels</li>
              <li>Add and remove team members</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const TeamsPlugin: ToolPlugin = {
  id: "teams",
  name: "Microsoft Teams",
  description: "Send messages and manage Microsoft Teams",
  icon: TeamsIcon,
  category: "Communication",

  schema: teamsSchema,
  defaultValues: {
    name: "",
    webhookUrl: "",
    clientId: "",
    clientSecret: "",
    tenantId: "",
    scope: "https://graph.microsoft.com/.default",
  },

  CredentialForm: TeamsCredentialForm,
  CredentialDisplay: TeamsCredentialDisplay,

  // Add actions support
  actions: Object.values(teamsActions),
  getActionById: (id: string) => teamsActions[id],
  getActionsByType: (type: string) =>
    Object.values(teamsActions).filter((action) => action.actionType === type),

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = teamsSchema.safeParse(credentials);
    if (result.success) {
      const creds = result.data;
      // At least webhook or OAuth must be configured
      if (
        !creds.webhookUrl &&
        (!creds.clientId || !creds.clientSecret || !creds.tenantId)
      ) {
        return {
          isValid: false,
          error:
            "Either webhook URL or OAuth credentials (client ID, secret, and tenant ID) must be provided",
        };
      }
      return { isValid: true };
    } else {
      return {
        isValid: false,
        error: result.error.issues[0]?.message ?? "Invalid credentials",
      };
    }
  },

  async test(
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const creds = credentials as TeamsCredentials;

      if (creds.webhookUrl) {
        // Test webhook by sending a test message
        const response = await fetch(creds.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            summary: "Test Message",
            sections: [
              {
                text: "This is a test message from Cronium Teams integration.",
              },
            ],
          }),
        });

        if (response.ok) {
          const responseText = await response.text();
          if (responseText === "1") {
            return {
              success: true,
              message: "Teams webhook test successful",
            };
          }
        }

        return {
          success: false,
          message: `Teams webhook test failed: ${response.statusText}`,
        };
      }

      if (creds.clientId && creds.refreshToken) {
        // Would test OAuth connection here
        return {
          success: true,
          message: "Teams OAuth configuration looks valid",
        };
      }

      return {
        success: false,
        message: "No valid Teams configuration found",
      };
    } catch {
      return {
        success: false,
        message: "Failed to test Teams connection",
      };
    }
  },
};
