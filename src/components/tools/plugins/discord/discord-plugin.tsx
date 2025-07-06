"use client";

import React from "react";
import { z } from "zod";
import { DiscordIcon } from "./discord-icon";
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
import { Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { TemplateForm } from "../../template-form";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
  type TemplateManagerProps,
} from "../../types/tool-plugin";

const discordSchema = z.object({
  name: z.string().min(1, "Name is required"),
  webhookUrl: z.string().url("Valid webhook URL is required"),
});

type DiscordFormData = z.infer<typeof discordSchema>;
type DiscordCredentials = Omit<DiscordFormData, "name">;

function DiscordCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<DiscordFormData>({
    resolver: zodResolver(discordSchema),
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
                <Badge variant={tool.isActive ? "default" : "secondary"}>
                  {tool.isActive ? "Active" : "Inactive"}
                </Badge>
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

interface Template {
  id: number;
  name: string;
  type: string;
  content: string;
  subject?: string;
  isSystemTemplate?: boolean;
}

function DiscordTemplateManager({ toolType }: TemplateManagerProps) {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<Template | null>(
    null,
  );

  // TODO: Replace with tRPC query when templates endpoint is available
  // For now, we'll use local state with default templates
  React.useEffect(() => {
    // Default Discord templates
    const defaultTemplates: Template[] = [
      {
        id: -1,
        name: "Simple Message",
        type: toolType,
        content: JSON.stringify(
          {
            content: "{{message}}",
          },
          null,
          2,
        ),
        isSystemTemplate: true,
      },
      {
        id: -2,
        name: "Embed Message",
        type: toolType,
        content: JSON.stringify(
          {
            embeds: [
              {
                title: "{{title}}",
                description: "{{description}}",
                color: 5814783,
                fields: [
                  {
                    name: "Status",
                    value: "{{status}}",
                    inline: true,
                  },
                ],
                timestamp: new Date().toISOString(),
              },
            ],
          },
          null,
          2,
        ),
        isSystemTemplate: true,
      },
    ];
    setTemplates(defaultTemplates);
  }, [toolType]);

  interface TemplateFormData {
    name: string;
    content: string;
    subject?: string | undefined;
    isSystemTemplate?: boolean | undefined;
    type: string;
  }

  const handleSaveTemplate = async (data: TemplateFormData) => {
    // TODO: Replace with tRPC mutation when available
    const newTemplate: Template = {
      id:
        templates.length > 0 ? Math.max(...templates.map((t) => t.id)) + 1 : 1,
      name: data.name,
      type: data.type,
      content: data.content,
      isSystemTemplate: data.isSystemTemplate ?? false,
    };

    if (editingTemplate) {
      setTemplates(
        templates.map((t) =>
          t.id === editingTemplate.id
            ? { ...t, ...newTemplate, id: editingTemplate.id }
            : t,
        ),
      );
    } else {
      setTemplates([...templates, newTemplate]);
    }

    setShowAddForm(false);
    setEditingTemplate(null);
  };

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setShowAddForm(true);
  };

  const handleCancelEdit = () => {
    setEditingTemplate(null);
    setShowAddForm(false);
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (templateId < 0) return; // Can't delete built-in templates

    // TODO: Replace with tRPC mutation when available
    setTemplates(templates.filter((t) => t.id !== templateId));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Discord Message Templates</h3>
        <Button onClick={() => setShowAddForm(true)}>Add Template</Button>
      </div>

      {showAddForm && (
        <TemplateForm
          toolType={toolType}
          template={
            editingTemplate
              ? ({
                  id: editingTemplate.id,
                  name: editingTemplate.name,
                  content: editingTemplate.content,
                  ...(editingTemplate.isSystemTemplate !== undefined && {
                    isSystemTemplate: editingTemplate.isSystemTemplate,
                  }),
                } as {
                  id?: number;
                  name: string;
                  content: string;
                  isSystemTemplate?: boolean;
                })
              : undefined
          }
          onSubmit={handleSaveTemplate}
          onCancel={handleCancelEdit}
          language="json"
          helperText="Use JSON format for Discord embeds and message components"
        />
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
                  <div className="flex flex-1 items-center gap-2">
                    <AccordionTrigger className="flex-1 p-0 hover:no-underline [&[data-state=open]>svg]:rotate-180">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{template.name}</h4>
                        {template.isSystemTemplate && (
                          <Badge variant="outline">System</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditTemplate(template)}
                    >
                      <Edit size={16} />
                    </Button>
                    {!template.isSystemTemplate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteTemplate(template.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                <AccordionContent className="px-4 pb-4">
                  <div className="text-muted-foreground space-y-2 text-sm">
                    <div>
                      <span className="font-medium">Content:</span>
                      <div className="bg-muted mt-1 rounded border p-3 font-mono text-xs whitespace-pre-wrap">
                        {template.content}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">
          <p>No Discord message templates configured yet.</p>
          <p className="text-sm">
            Templates will help you create consistent Discord notifications.
          </p>
        </div>
      )}
    </div>
  );
}

export const DiscordPlugin: ToolPlugin = {
  id: "discord",
  name: "Discord",
  description: "Send messages to Discord channels via webhooks",
  icon: DiscordIcon,
  category: "Communication",

  schema: discordSchema,
  defaultValues: {
    name: "",
    webhookUrl: "",
  },

  CredentialForm: DiscordCredentialForm,
  CredentialDisplay: DiscordCredentialDisplay,
  TemplateManager: DiscordTemplateManager,

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = discordSchema.safeParse(credentials);
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
