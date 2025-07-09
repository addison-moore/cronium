"use client";

import React from "react";
import { z } from "zod";
import { TrelloIcon } from "./trello-icon";
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
import { trelloActions } from "./actions";
import { ToolHealthBadge } from "@/components/tools/ToolHealthIndicator";

const trelloSchema = z.object({
  name: z.string().min(1, "Name is required"),
  apiKey: z.string().min(1, "API key is required").describe("Trello API key"),
  apiToken: z
    .string()
    .min(1, "API token is required")
    .describe("Trello API token"),
});

type TrelloFormData = z.infer<typeof trelloSchema>;
type TrelloCredentials = Omit<TrelloFormData, "name">;

function TrelloCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<TrelloFormData>({
    resolver: zodResolver(trelloSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as TrelloCredentials)
            : (tool.credentials as TrelloCredentials)),
        }
      : {
          name: "",
          apiKey: "",
          apiToken: "",
        },
  });

  const handleSubmit = async (data: TrelloFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          To use Trello integration:
          <ol className="mt-2 list-inside list-decimal text-sm">
            <li>
              Go to{" "}
              <a
                href="https://trello.com/app-key"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Trello App Key
              </a>
            </li>
            <li>Copy your API Key</li>
            <li>
              Click the &quot;Token&quot; link on that page to generate a token
            </li>
            <li>Authorize the app and copy the token</li>
          </ol>
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Trello Workspace"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          placeholder="Your Trello API key"
          {...form.register("apiKey")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Found at https://trello.com/app-key
        </p>
      </div>

      <div>
        <Label htmlFor="apiToken">API Token</Label>
        <Input
          id="apiToken"
          type="password"
          placeholder="Your Trello API token"
          {...form.register("apiToken")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Generated from the API key page
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

function TrelloCredentialDisplay({
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
        const credentials: TrelloCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as TrelloCredentials)
            : (tool.credentials as TrelloCredentials);
        const isSecretVisible = showSecrets[tool.id];

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
                <ToolHealthBadge toolId={tool.id} />
              </div>
              <div className="text-muted-foreground grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">API Key:</span>
                  <span className="font-mono text-xs">
                    {credentials.apiKey.substring(0, 8)}...
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">API Token:</span>
                  <span className="font-mono text-xs">
                    {isSecretVisible
                      ? credentials.apiToken
                      : `${credentials.apiToken.substring(0, 8)}...`}
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
            <CardTitle>No Trello Configurations</CardTitle>
            <CardDescription>
              Add a Trello configuration to start managing your boards and
              cards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Trello integration allows you to:
            </p>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Create and move cards between lists</li>
              <li>Assign members to cards</li>
              <li>Add checklists and track progress</li>
              <li>Attach files and links</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const TrelloPlugin: ToolPlugin = {
  id: "trello",
  name: "Trello",
  description: "Manage Trello boards, cards, and workflows",
  icon: TrelloIcon,
  category: "Productivity",

  schema: trelloSchema,
  defaultValues: {
    name: "",
    apiKey: "",
    apiToken: "",
  },

  CredentialForm: TrelloCredentialForm,
  CredentialDisplay: TrelloCredentialDisplay,

  // Add actions support
  actions: Object.values(trelloActions),
  getActionById: (id: string) => trelloActions[id],
  getActionsByType: (type: string) =>
    Object.values(trelloActions).filter((action) => action.actionType === type),

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = trelloSchema.safeParse(credentials);
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
      const creds = credentials as TrelloCredentials;

      // Test API credentials by fetching member info
      const url = new URL("https://api.trello.com/1/members/me");
      url.searchParams.append("key", creds.apiKey);
      url.searchParams.append("token", creds.apiToken);
      url.searchParams.append("fields", "fullName,username");

      const response = await fetch(url.toString());

      if (response.ok) {
        const data = (await response.json()) as {
          fullName?: string;
          username?: string;
        };
        return {
          success: true,
          message: `Connected as ${data.fullName ?? data.username ?? "Unknown"}`,
        };
      } else {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
        };
        return {
          success: false,
          message: `Trello API error: ${errorData.message ?? errorData.error ?? response.statusText}`,
        };
      }
    } catch {
      return {
        success: false,
        message: "Failed to test Trello connection",
      };
    }
  },
};
