"use client";

import React from "react";
import { z } from "zod";
import { NotionIcon } from "./notion-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@cronium/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { Edit, Trash2, Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { notionActions } from "./actions";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { notionCredentialsSchema, type NotionCredentials } from "./schemas";
import { notionApiRoutes } from "./api-routes";

const notionFormSchema = notionCredentialsSchema.extend({
  name: z.string().min(1, "Name is required"),
});

type NotionFormData = z.infer<typeof notionFormSchema>;

function NotionCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<NotionFormData>({
    resolver: zodResolver(notionFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as NotionCredentials)
            : (tool.credentials as NotionCredentials)),
        }
      : {
          name: "",
          apiKey: "",
        },
  });

  const handleSubmit = async (data: NotionFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          To use Notion integration:
          <ol className="mt-2 list-inside list-decimal text-sm">
            <li>
              Go to{" "}
              <a
                href="https://www.notion.so/my-integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                My Integrations
              </a>{" "}
              in Notion
            </li>
            <li>Click &quot;New integration&quot;</li>
            <li>Give it a name and select the workspace</li>
            <li>Copy the &quot;Internal Integration Token&quot;</li>
            <li>
              Share the pages/databases you want to access with your integration
            </li>
          </ol>
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Notion Workspace"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="apiKey">Integration Token</Label>
        <Input
          id="apiKey"
          type="password"
          placeholder="secret_abc123..."
          {...form.register("apiKey")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Your Notion internal integration token
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

function NotionCredentialDisplay({
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
        const credentials: NotionCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as NotionCredentials)
            : (tool.credentials as NotionCredentials);
        const isSecretVisible = showSecrets[tool.id];

        return (
          <div
            key={tool.id}
            className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h4 className="font-medium">{tool.name}</h4>
                <StatusBadge status={tool.isActive ? "active" : "offline"} />
                <ToolHealthBadge toolId={tool.id} />
              </div>
              <div className="text-muted-foreground grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">API Key:</span>
                  <span className="font-mono text-xs">
                    {isSecretVisible
                      ? credentials.apiKey
                      : `${credentials.apiKey.substring(0, 10)}...`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSecretVisibility(tool.id)}
                  >
                    {isSecretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
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

      {tools.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Notion Configurations</CardTitle>
            <CardDescription>
              Add a Notion configuration to start managing your workspace
              content.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Notion integration allows you to:
            </p>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Create and update pages</li>
              <li>Manage database entries</li>
              <li>Search across your workspace</li>
              <li>Add and modify content blocks</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const NotionPlugin: ToolPlugin = {
  id: "notion",
  name: "Notion",
  description: "Create and manage content in your Notion workspace",
  icon: NotionIcon,
  category: "Productivity",

  schema: notionCredentialsSchema,
  defaultValues: {
    apiKey: "",
    workspaceId: undefined,
  },

  CredentialForm: NotionCredentialForm,
  CredentialDisplay: NotionCredentialDisplay,

  // Add actions support
  actions: Object.values(notionActions),
  getActionById: (id: string) => notionActions[id],
  getActionsByType: (type: string) =>
    Object.values(notionActions).filter((action) => action.actionType === type),

  apiRoutes: notionApiRoutes,

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = notionCredentialsSchema.safeParse(credentials);
    if (result.success) {
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
      const creds = credentials as NotionCredentials;

      // Test API key by making a simple request
      const response = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (response.ok) {
        const data = (await response.json()) as {
          type?: string;
          name?: string;
        };
        return {
          success: true,
          message: `Connected as ${data.type ?? "Unknown"}: ${data.name ?? "Unknown"}`,
        };
      } else {
        const errorData = (await response.json()) as {
          message?: string;
          code?: string;
        };
        return {
          success: false,
          message: `Notion API error: ${errorData.message ?? response.statusText}`,
        };
      }
    } catch {
      return {
        success: false,
        message: "Failed to test Notion connection",
      };
    }
  },
};
