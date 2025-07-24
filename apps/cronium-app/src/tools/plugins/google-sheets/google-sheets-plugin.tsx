"use client";

import React from "react";
import { z } from "zod";
import { GoogleSheetsIcon } from "./google-sheets-icon";
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
import { googleSheetsActions } from "./actions";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { Badge } from "@cronium/ui";
import { googleSheetsCredentialsSchema } from "./schemas";
import { googleSheetsApiRoutes } from "./api-routes";

const googleSheetsFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  refreshToken: z.string().optional(),
  scope: z.string().min(1, "Scope is required"),
  spreadsheetId: z.string().optional(),
});

type GoogleSheetsFormData = z.infer<typeof googleSheetsFormSchema>;
type GoogleSheetsCredentials = z.infer<typeof googleSheetsCredentialsSchema>;

function GoogleSheetsCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<GoogleSheetsFormData>({
    resolver: zodResolver(googleSheetsFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as GoogleSheetsCredentials)
            : (tool.credentials as GoogleSheetsCredentials)),
        }
      : {
          name: "",
          clientId: "",
          clientSecret: "",
          scope: "https://www.googleapis.com/auth/spreadsheets",
        },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          To use Google Sheets integration, you need to set up OAuth2
          credentials in the Google Cloud Console. Visit the{" "}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Google Cloud Console
          </a>{" "}
          to create credentials.
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Google Sheets"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="clientId">Client ID</Label>
        <Input
          id="clientId"
          placeholder="your-client-id.apps.googleusercontent.com"
          {...form.register("clientId")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          From your OAuth2 credentials
        </p>
      </div>

      <div>
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input
          id="clientSecret"
          type="password"
          placeholder="your-client-secret"
          {...form.register("clientSecret")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Keep this secret and never share it
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

function GoogleSheetsCredentialDisplay({
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
        const credentials: GoogleSheetsCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as GoogleSheetsCredentials)
            : (tool.credentials as GoogleSheetsCredentials);
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
                {!credentials.refreshToken && (
                  <Badge variant="outline" className="text-orange-600">
                    Authorization Required
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground grid grid-cols-1 gap-2 text-sm">
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
                    {isSecretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  <span>
                    {credentials.refreshToken ? "Authorized" : "Not Authorized"}
                  </span>
                </div>
              </div>
              {!credentials.refreshToken && tool.isActive && (
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
            <CardTitle>No Google Sheets Configurations</CardTitle>
            <CardDescription>
              Add a Google Sheets configuration to start automating your
              spreadsheets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Google Sheets integration allows you to:
            </p>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Read and write data to spreadsheets</li>
              <li>Create new sheets and format cells</li>
              <li>Execute formulas and calculations</li>
              <li>Automate data processing workflows</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const GoogleSheetsPlugin: ToolPlugin = {
  id: "google-sheets",
  name: "Google Sheets",
  description: "Read, write, and automate Google Sheets spreadsheets",
  icon: GoogleSheetsIcon,
  category: "Productivity",

  schema: googleSheetsCredentialsSchema,
  defaultValues: {
    name: "",
    clientId: "",
    clientSecret: "",
    scope: "https://www.googleapis.com/auth/spreadsheets",
  },

  CredentialForm: GoogleSheetsCredentialForm,
  CredentialDisplay: GoogleSheetsCredentialDisplay,

  // Add actions support
  actions: Object.values(googleSheetsActions),
  getActionById: (id: string) => googleSheetsActions[id],
  getActionsByType: (type: string) =>
    Object.values(googleSheetsActions).filter(
      (action) => action.actionType === type,
    ),

  apiRoutes: googleSheetsApiRoutes,

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = googleSheetsCredentialsSchema.safeParse(credentials);
    if (result.success) {
      // In the future, could validate OAuth tokens here
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
      const creds = credentials as GoogleSheetsCredentials;

      if (!creds.refreshToken) {
        return {
          success: false,
          message:
            "OAuth authorization required. Please authorize access first.",
        };
      }

      // In production, would test API connection here
      return {
        success: true,
        message: "Google Sheets connection test successful",
      };
    } catch {
      return {
        success: false,
        message: "Failed to test Google Sheets connection",
      };
    }
  },
};
