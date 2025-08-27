"use client";

import React from "react";
import { z } from "zod";
import { DiscordIcon } from "./discord-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Edit, Trash2, Eye, EyeOff } from "lucide-react";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { discordActions } from "./actions";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { discordCredentialsSchema, type DiscordCredentials } from "./schemas";
import { discordApiRoutes } from "./api-routes";

const discordFormSchema = discordCredentialsSchema.extend({
  name: z.string().min(1, "Name is required"),
});

type DiscordFormData = z.infer<typeof discordFormSchema>;

function DiscordCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<DiscordFormData>({
    resolver: zodResolver(discordFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as DiscordCredentials)
            : (tool.credentials as DiscordCredentials)),
        }
      : {
          name: "",
          webhookUrl: "",
        },
  });

  const handleSubmit = async (data: DiscordFormData) => {
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
          placeholder="My Discord Server"
          {...form.register("name")}
        />
      </div>
      <div>
        <Label htmlFor="webhookUrl">Webhook URL</Label>
        <Input
          id="webhookUrl"
          placeholder="https://discord.com/api/webhooks/..."
          {...form.register("webhookUrl")}
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

function DiscordCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const [showUrls, setShowUrls] = React.useState<Record<number, boolean>>({});

  const toggleUrlVisibility = (toolId: number) => {
    setShowUrls((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: DiscordCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as DiscordCredentials)
            : (tool.credentials as DiscordCredentials);
        const isUrlVisible = showUrls[tool.id];

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
              <div className="text-muted-foreground text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Webhook URL:</span>
                  <span>
                    {isUrlVisible
                      ? credentials.webhookUrl
                      : "https://discord.com/api/webhooks/••••••••"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleUrlVisibility(tool.id)}
                  >
                    {isUrlVisible ? <EyeOff size={14} /> : <Eye size={14} />}
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
    </div>
  );
}

export const DiscordPlugin: ToolPlugin = {
  id: "discord",
  name: "Discord",
  description: "Send messages to Discord channels via webhooks",
  icon: DiscordIcon,
  category: "Communication",

  schema: discordCredentialsSchema,
  defaultValues: {
    webhookUrl: "",
    username: undefined,
    avatarUrl: undefined,
  },

  CredentialForm: DiscordCredentialForm,
  CredentialDisplay: DiscordCredentialDisplay,
  // TemplateManager: DiscordTemplateManager, // Removed - using tool action templates

  // Add actions support
  actions: Object.values(discordActions),
  getActionById: (id: string) => discordActions[id],
  getActionsByType: (type: string) =>
    Object.values(discordActions).filter(
      (action) => action.actionType === type,
    ),
  getConditionalAction: () =>
    Object.values(discordActions).find((action) => action.isSendMessageAction),

  // API Routes
  apiRoutes: discordApiRoutes,

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = discordCredentialsSchema.safeParse(credentials);
    if (result.success) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        error: result.error.issues[0]?.message ?? "Validation failed",
      };
    }
  },
};
