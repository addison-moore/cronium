"use client";

import React from "react";
import { z } from "zod";
import { SlackIcon } from "./slack-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Edit, Trash2, Eye, EyeOff, TestTube } from "lucide-react";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";
import { slackActions } from "./actions";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { slackCredentialsSchema, type SlackCredentials } from "./schemas";

const slackFormSchema = slackCredentialsSchema.extend({
  name: z.string().min(1, "Name is required"),
});

type SlackFormData = z.infer<typeof slackFormSchema>;

// Slack credential form component
function SlackCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<SlackFormData>({
    resolver: zodResolver(slackFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as SlackCredentials)
            : (tool.credentials as SlackCredentials)),
        }
      : {
          name: "",
          webhookUrl: "",
        },
  });

  const handleSubmit = async (data: SlackFormData) => {
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
          placeholder="My Slack Workspace"
          {...form.register("name")}
        />
      </div>
      <div>
        <Label htmlFor="webhookUrl">Webhook URL</Label>
        <Input
          id="webhookUrl"
          placeholder="https://hooks.slack.com/services/..."
          {...form.register("webhookUrl")}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          Get this from your Slack app's Incoming Webhooks section
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

function SlackCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const [showTokens, setShowTokens] = React.useState<Record<number, boolean>>(
    {},
  );
  const [testingTool, setTestingTool] = React.useState<number | null>(null);
  const { toast } = useToast();

  const testConnectionMutation = trpc.integrations.testMessage.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Test Successful",
        description: result.message,
      });
      setTestingTool(null);
    },
  });

  const sendTestMessageMutation = trpc.integrations.slack.send.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Test Message Sent",
        description: result.message,
      });
      setTestingTool(null);
    },
  });

  const toggleTokenVisibility = (toolId: number) => {
    setShowTokens((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  const handleTestConnection = async (tool: { id: number }) => {
    setTestingTool(tool.id);
    await testConnectionMutation.mutateAsync({
      toolId: tool.id,
      testType: "connection",
    });
  };

  const handleSendTestMessage = async (tool: { id: number }) => {
    setTestingTool(tool.id);
    await sendTestMessageMutation.mutateAsync({
      toolId: tool.id,
      message:
        "🎉 Test message from Cronium! Your Slack integration is working correctly.",
      channel: undefined, // Use default channel
      username: "Cronium Bot",
    });
  };

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: SlackCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as SlackCredentials)
            : (tool.credentials as SlackCredentials);
        const isTokenVisible = showTokens[tool.id];
        const isTesting = testingTool === tool.id;

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
              <div className="text-muted-foreground grid grid-cols-1 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Webhook URL:</span>
                  <span className="font-mono text-xs">
                    {isTokenVisible
                      ? credentials.webhookUrl
                      : credentials.webhookUrl?.replace(
                          /https:\/\/hooks\.slack\.com\/services\/(.+)/,
                          "https://hooks.slack.com/services/••••••••",
                        )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleTokenVisibility(tool.id)}
                  >
                    {isTokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                </div>
              </div>
              {tool.isActive && (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestConnection(tool)}
                    disabled={isTesting}
                  >
                    <TestTube size={14} className="mr-1" />
                    {isTesting ? "Testing..." : "Test Connection"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSendTestMessage(tool)}
                    disabled={isTesting}
                  >
                    {isTesting ? "Sending..." : "Send Test Message"}
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
    </div>
  );
}

// Interface for Slack message data
interface SendData {
  message: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

// Slack plugin definition with tRPC integration
export const SlackPluginTrpc: ToolPlugin = {
  id: "slack",
  name: "Slack",
  description: "Send notifications to Slack channels via webhook",
  icon: SlackIcon,
  category: "Communication",

  schema: slackCredentialsSchema,
  defaultValues: {
    webhookUrl: "",
    channel: undefined,
    username: undefined,
    iconEmoji: undefined,
    iconUrl: undefined,
  },

  CredentialForm: SlackCredentialForm,
  CredentialDisplay: SlackCredentialDisplay,

  // Add actions support
  actions: Object.values(slackActions),
  getActionById: (id: string) => slackActions[id],
  getActionsByType: (type: string) =>
    Object.values(slackActions).filter((action) => action.actionType === type),

  async validate(credentials: Record<string, unknown>) {
    const result = slackCredentialsSchema.safeParse(credentials);
    if (result.success) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        error: result.error.issues[0]?.message ?? "Invalid credentials",
      };
    }
  },

  async send(credentials: Record<string, unknown>, data: unknown) {
    // Type assertion to ensure data has the expected structure
    const typedData = data as SendData;
    // Extract trpcClient from credentials if available
    const trpcClient = credentials.trpcClient;
    try {
      const { message, channel, username, iconEmoji } = typedData;

      if (!message) {
        return {
          success: false,
          message: "Message content is required",
        };
      }

      if (!trpcClient) {
        // Fallback to REST API if needed
        return {
          success: false,
          message: "tRPC client not available",
        };
      }

      const typedClient = trpcClient as {
        integrations: {
          slack: {
            send: {
              mutate: (params: {
                toolId: number;
                message: string;
                channel?: string;
                username?: string;
                iconEmoji?: string;
              }) => Promise<{ success: boolean; message?: string }>;
            };
          };
        };
      };

      // Ensure id exists and is a number
      const id =
        typeof credentials.id === "number" ? credentials.id : undefined;
      if (id === undefined) {
        return {
          success: false,
          message: "Missing credential ID",
        };
      }

      const params: {
        toolId: number;
        message: string;
        channel?: string;
        username?: string;
        iconEmoji?: string;
      } = {
        toolId: id,
        message,
      };

      if (channel) params.channel = channel;
      if (username) params.username = username;
      if (iconEmoji) params.iconEmoji = iconEmoji;

      const result = await typedClient.integrations.slack.send.mutate(params);

      return {
        success: result.success,
        message: result.message ?? "Slack message sent successfully",
      };
    } catch (error) {
      console.error("Slack send error:", error);
      return {
        success: false,
        message: "Failed to send Slack message",
      };
    }
  },

  // New method for testing Slack functionality using tRPC
  async test(
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    // Extract id from credentials, ensuring it exists
    const id = credentials.id as number;
    if (!id) {
      return {
        success: false,
        message: "Missing credential ID",
      };
    }

    // Extract testType from credentials or use default
    const testType = (credentials.testType as string) || "connection";
    // Extract trpcClient with proper typing to avoid unsafe 'any' assignment
    const trpcClient = credentials.trpcClient as
      | {
          integrations: {
            slack: {
              send: {
                mutate: (params: {
                  toolId: number;
                  message: string;
                  username?: string;
                }) => Promise<{
                  success: boolean;
                  message?: string;
                  details?: string;
                }>;
              };
            };
            testMessage: {
              mutate: (params: {
                toolId: number;
                testType: string;
              }) => Promise<{
                success: boolean;
                message?: string;
                details?: string;
              }>;
            };
          };
        }
      | undefined;

    try {
      if (!trpcClient) {
        return {
          success: false,
          message: "tRPC client not available for testing",
        };
      }

      // Since we've already typed trpcClient properly, we can use it directly
      const typedClient = trpcClient;

      if (testType === "send_test_message") {
        const result = await typedClient.integrations.slack.send.mutate({
          toolId: id,
          message:
            "🎉 Test message from Cronium! Your Slack integration is working correctly.",
          username: "Cronium Bot",
        });

        return {
          success: result.success,
          message: result.message ?? "Test message sent successfully",
        };
      } else {
        const result = await typedClient.integrations.testMessage.mutate({
          toolId: id,
          testType: "connection",
        });

        return {
          success: result.success,
          message: result.message ?? "Connection test completed",
        };
      }
    } catch (error) {
      console.error("Slack test error:", error);
      return {
        success: false,
        message: "Failed to test Slack connection",
      };
    }
  },
};
