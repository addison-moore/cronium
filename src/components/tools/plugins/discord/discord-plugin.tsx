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
import { Edit, Trash2, Eye, EyeOff, Shield } from "lucide-react";
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

function DiscordCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm({
    resolver: zodResolver(discordSchema),
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
        const credentials =
          typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : (tool.credentials as Record<string, any>);
        const isUrlVisible = showUrls[tool.id];

        return (
          <div
            key={tool.id}
            className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h4 className="font-medium">{tool.name}</h4>
                <Badge variant={tool.isActive ? "default" : "secondary"}>
                  {tool.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
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

function DiscordTemplateManager({ toolType }: TemplateManagerProps) {
  const [templates, setTemplates] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<any>(null);

  // Fetch templates
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/tools/templates?type=${toolType}`);
      if (response.ok) {
        const data = await response.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchTemplates();
  }, [toolType]);

  const handleSaveTemplate = async (data: any) => {
    try {
      const url = editingTemplate
        ? `/api/tools/templates/${editingTemplate.id}`
        : "/api/tools/templates";
      const method = editingTemplate ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          type: toolType,
          content: data.content,
          isSystemTemplate: data.isSystemTemplate || false,
        }),
      });

      if (response.ok) {
        await fetchTemplates();
        setShowAddForm(false);
        setEditingTemplate(null);
      }
    } catch (error) {
      console.error("Failed to save template:", error);
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
      const response = await fetch(`/api/tools/templates/${templateId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchTemplates();
      }
    } catch (error) {
      console.error("Failed to delete template:", error);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading templates...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Discord Message Templates</h3>
        <Button onClick={() => setShowAddForm(true)}>Add Template</Button>
      </div>

      {showAddForm && (
        <TemplateForm
          toolType={toolType}
          template={editingTemplate}
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
            className="border border-border rounded-lg hover:bg-muted/50"
          >
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem
                value={`template-${template.id}`}
                className="border-none"
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 flex-1">
                    <AccordionTrigger className="flex-1 hover:no-underline [&[data-state=open]>svg]:rotate-180 p-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{template.name}</h4>
                        {template.isSystemTemplate && (
                          <Badge
                            variant="secondary"
                            className="flex items-center gap-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                          >
                            <Shield size={12} />
                            System
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
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
                  <div className="text-sm text-muted-foreground space-y-2">
                    <div>
                      <span className="font-medium">Content:</span>
                      <div className="mt-1 p-3 bg-muted rounded border font-mono text-xs whitespace-pre-wrap">
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
        <div className="text-center py-8 text-muted-foreground">
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

  async validate(credentials: any) {
    const result = discordSchema.safeParse(credentials);
    if (result.success) {
      return { isValid: true };
    } else {
      return { 
        isValid: false, 
        error: result.error.issues[0]?.message || "Validation failed" 
      };
    }
  },
};
