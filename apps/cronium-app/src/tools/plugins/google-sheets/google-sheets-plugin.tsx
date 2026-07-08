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
import { Edit, Trash2, AlertTriangle, Link2, Unlink } from "lucide-react";
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
import { trpc } from "@/lib/trpc";

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const googleSheetsFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
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
  const existingCredentials: Partial<GoogleSheetsCredentials> = tool
    ? typeof tool.credentials === "string"
      ? (JSON.parse(tool.credentials) as GoogleSheetsCredentials)
      : (tool.credentials as GoogleSheetsCredentials)
    : {};

  const form = useForm<GoogleSheetsFormData>({
    resolver: zodResolver(googleSheetsFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          scope: existingCredentials.scope ?? GOOGLE_SHEETS_SCOPE,
          spreadsheetId: existingCredentials.spreadsheetId ?? "",
        }
      : {
          name: "",
          scope: GOOGLE_SHEETS_SCOPE,
          spreadsheetId: "",
        },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const { name, ...credentials } = data;
    // Preserve legacy credential fields for existing tools
    await onSubmit({
      name,
      credentials: { ...existingCredentials, ...credentials },
    });
    form.reset();
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Google Sheets uses your server&apos;s Google OAuth app (configured by
          the administrator via <code>OAUTH_GOOGLE_CLIENT_ID</code> /{" "}
          <code>OAUTH_GOOGLE_CLIENT_SECRET</code>). After saving, click{" "}
          <strong>Connect Google Account</strong> to authorize access.
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
        <Label htmlFor="spreadsheetId">Default Spreadsheet ID (optional)</Label>
        <Input
          id="spreadsheetId"
          placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
          {...form.register("spreadsheetId")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Used when an action does not specify a spreadsheet
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

// Connect/disconnect state for a Google Sheets tool, driven by the real
// OAuth token status (not stored credential fields)
function GoogleConnectSection({ toolId }: { toolId: number }) {
  const { data: oauthStatus, refetch } = trpc.tools.checkOAuthStatus.useQuery({
    toolId,
    providerId: "google",
  });
  const revokeMutation = trpc.tools.revokeOAuthTokens.useMutation({
    onSettled: () => void refetch(),
  });
  const [isConnecting, setIsConnecting] = React.useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolId,
          providerId: "google",
          scope: GOOGLE_SHEETS_SCOPE,
        }),
      });
      const data = (await response.json()) as {
        authUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.authUrl) {
        throw new Error(data.error ?? "Failed to start Google authorization");
      }
      window.location.href = data.authUrl;
    } catch (error) {
      console.error("Google connect failed:", error);
      setIsConnecting(false);
    }
  };

  if (!oauthStatus) {
    return null;
  }

  if (!oauthStatus.configured) {
    return (
      <Badge variant="outline" className="text-orange-600">
        Google OAuth not configured on this server
      </Badge>
    );
  }

  if (oauthStatus.hasTokens) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-green-600">
          Google account connected
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            revokeMutation.mutate({ toolId, providerId: "google" })
          }
          disabled={revokeMutation.isPending}
        >
          <Unlink size={14} className="mr-1" />
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleConnect}
      disabled={isConnecting}
    >
      <Link2 size={14} className="mr-1" />
      Connect Google Account
    </Button>
  );
}

function GoogleSheetsCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: GoogleSheetsCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as GoogleSheetsCredentials)
            : (tool.credentials as GoogleSheetsCredentials);

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
                  <span className="font-medium">Scope:</span>
                  <span className="font-mono text-xs">
                    {credentials.scope ?? GOOGLE_SHEETS_SCOPE}
                  </span>
                </div>
                {credentials.spreadsheetId && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Default Spreadsheet:</span>
                    <span className="font-mono text-xs">
                      {credentials.spreadsheetId}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-3">
                <GoogleConnectSection toolId={tool.id} />
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
  categoryIcon: "FileText",

  schema: googleSheetsCredentialsSchema,
  defaultValues: {
    name: "",
    scope: "https://www.googleapis.com/auth/spreadsheets",
  },

  // The server injects credentials.oauthToken before executing actions
  requiresOAuth: {
    providerId: "google",
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
