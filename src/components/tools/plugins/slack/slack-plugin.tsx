"use client";

import React from "react";
import { z } from "zod";
import { SlackIcon } from "./slack-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Edit, Trash2, Eye, EyeOff, TestTube } from "lucide-react";
import { TemplateForm } from "../../template-form";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
  type TemplateManagerProps,
} from "../../types/tool-plugin";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";

const slackSchema = z.object({
  name: z.string().min(1, "Name is required"),
  webhookUrl: z
    .string()
    .url("Valid webhook URL is required")
    .min(1, "Webhook URL is required"),
});

// Slack credential form component - unchanged UI
function SlackCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm({
    resolver: zodResolver(slackSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : tool.credentials),
        }
      : {
          name: "",
          webhookUrl: "",
        },
  });

  const handleSubmit = async (data: any) => {
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

// Enhanced Slack credential display with tRPC testing
function SlackCredentialDisplayTrpc({
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

  const handleTestConnection = async (tool: any) => {
    setTestingTool(tool.id);
    await testConnectionMutation.mutateAsync({
      toolId: tool.id,
      testType: "connection",
    });
  };

  const handleSendTestMessage = async (tool: any) => {
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
        const credentials =
          typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : (tool.credentials as Record<string, any>);
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
                <Badge variant={tool.isActive ? "default" : "secondary"}>
                  {tool.isActive ? "Active" : "Inactive"}
                </Badge>
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

// Slack template manager component - migrated to use tRPC
function SlackTemplateManagerTrpc({ toolType }: TemplateManagerProps) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<any>(null);

  // tRPC queries and mutations
  const {
    data: templatesData,
    isLoading,
    refetch: refetchTemplates,
  } = trpc.integrations.templates.getAll.useQuery({
    type: "SLACK",
    includeSystem: true,
    includeUser: true,
  });

  const createTemplateMutation = trpc.integrations.templates.create.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Slack template created successfully",
        });
        refetchTemplates();
        setShowAddForm(false);
        setEditingTemplate(null);
      },
    },
  );

  const updateTemplateMutation = trpc.integrations.templates.update.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Slack template updated successfully",
        });
        refetchTemplates();
        setShowAddForm(false);
        setEditingTemplate(null);
      },
    },
  );

  const deleteTemplateMutation = trpc.integrations.templates.delete.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Slack template deleted successfully",
        });
        refetchTemplates();
      },
    },
  );

  const templates = templatesData?.templates || [];

  const handleSaveTemplate = async (data: any) => {
    try {
      const templateData = {
        name: data.name,
        type: "SLACK" as any,
        content: data.content,
        description: data.description || "",
        variables: data.variables || [],
        isSystemTemplate: false,
        tags: data.tags || [],
      };

      if (editingTemplate) {
        await updateTemplateMutation.mutateAsync({
          id: editingTemplate.id,
          ...templateData,
        });
      } else {
        await createTemplateMutation.mutateAsync(templateData);
      }
    } catch (error) {
      console.error("Error saving template:", error);
    }
  };

  const handleEditTemplate = (template: any) => {
    setEditingTemplate(template);
    setShowAddForm(true);
  };

  const handleCancelEdit = () => {
    setEditingTemplate(null);
    setShowAddForm(false);
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (templateId < 0) return; // Can't delete built-in templates

    try {
      await deleteTemplateMutation.mutateAsync({ id: templateId });
    } catch (error) {
      console.error("Error deleting template:", error);
    }
  };

  if (isLoading) {
    return <div className="py-8 text-center">Loading templates...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Slack Templates</h3>
        <Button onClick={() => setShowAddForm(true)}>Add Template</Button>
      </div>

      {showAddForm && (
        <div className="border-border bg-muted/50 rounded-lg border p-4">
          <h4 className="mb-4 font-medium">
            {editingTemplate ? "Edit Template" : "Create New Template"}
          </h4>
          <TemplateForm
            toolType="SLACK"
            template={editingTemplate}
            onSubmit={handleSaveTemplate}
            onCancel={handleCancelEdit}
            showSubjectField={false}
          />
        </div>
      )}

      <div className="space-y-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className="border-border hover:bg-muted/50 rounded-lg border"
          >
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem
                value={`template-${template.id}`}
                className="border-none"
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <AccordionTrigger className="p-0 hover:no-underline">
                      <div className="flex items-center gap-3">
                        <h4 className="font-medium">{template.name}</h4>
                        <Badge
                          variant={
                            template.isSystemTemplate ? "outline" : "default"
                          }
                        >
                          {template.isSystemTemplate ? "System" : "Custom"}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                  </div>
                  <div className="flex items-center gap-2">
                    {!template.isSystemTemplate && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditTemplate(template)}
                        >
                          <Edit size={16} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteTemplate(template.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <AccordionContent className="px-4 pb-4">
                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="font-medium">Message Content:</span>
                      <div className="bg-muted mt-1 rounded border p-3 font-mono text-xs whitespace-pre-wrap">
                        {template.content}
                      </div>
                    </div>
                    {template.variables && template.variables.length > 0 && (
                      <div>
                        <span className="font-medium">Variables:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {template.variables.map(
                            (variable: any, index: number) => (
                              <Badge
                                key={index}
                                variant="outline"
                                className="text-xs"
                              >
                                {variable.name}
                                {variable.required && (
                                  <span className="text-red-500">*</span>
                                )}
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">
          <p>No Slack templates configured yet.</p>
          <p className="text-sm">
            Templates help you create consistent Slack notifications with
            placeholders for dynamic content.
          </p>
        </div>
      )}
    </div>
  );
}

// Slack plugin definition with tRPC integration
export const SlackPluginTrpc: ToolPlugin = {
  id: "slack",
  name: "Slack",
  description: "Send notifications to Slack channels via webhook",
  icon: SlackIcon,
  category: "Communication",

  schema: slackSchema,
  defaultValues: {
    name: "",
    webhookUrl: "",
  },

  CredentialForm: SlackCredentialForm,
  CredentialDisplay: SlackCredentialDisplayTrpc,
  TemplateManager: SlackTemplateManagerTrpc,

  async validate(credentials: any) {
    const result = slackSchema.safeParse(credentials);
    return {
      isValid: result.success,
      error: result.success ? undefined : result.error.issues[0]?.message,
    };
  },

  // Updated send method to use tRPC integrations API
  async send(credentials: any, data: any, trpcClient?: any) {
    try {
      const { message, channel, username, iconEmoji } = data;

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

      // Use tRPC integrations API
      const result = await trpcClient.integrations.slack.send.mutate({
        toolId: credentials.id,
        message: message,
        channel: channel,
        username: username,
        iconEmoji: iconEmoji,
      });

      return {
        success: result.success,
        message: result.message || "Slack message sent successfully",
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
    credentials: any,
    testType: string = "connection",
    trpcClient?: any,
  ) {
    try {
      if (!trpcClient) {
        return {
          success: false,
          message: "tRPC client not available for testing",
        };
      }

      if (testType === "send_test_message") {
        const result = await trpcClient.integrations.slack.send.mutate({
          toolId: credentials.id,
          message:
            "🎉 Test message from Cronium! Your Slack integration is working correctly.",
          username: "Cronium Bot",
        });

        return {
          success: result.success,
          message: result.message,
          details: result.details,
        };
      } else {
        const result = await trpcClient.integrations.testMessage.mutate({
          toolId: credentials.id,
          testType: "connection",
        });

        return {
          success: result.success,
          message: result.message,
          details: result.details,
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
