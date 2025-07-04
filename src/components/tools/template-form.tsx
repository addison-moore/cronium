"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Shield, Info } from "lucide-react";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { useAuth } from "@/hooks/useAuth";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const templateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  content: z.string().min(1, "Content is required"),
  subject: z.string().optional(),
  isSystemTemplate: z.boolean().optional(),
});

interface TemplateFormProps {
  toolType: string;
  template?: any;
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  showSubjectField?: boolean;
  language?: string;
  helperText?: string;
}

export function TemplateForm({
  toolType,
  template,
  onSubmit,
  onCancel,
  showSubjectField = false,
  language = "html",
  helperText,
}: TemplateFormProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorSettings, setEditorSettings] = useState<any>({
    fontSize: 14,
    theme: "vs-dark",
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  });

  const isAdmin = user?.role === "ADMIN";
  const isEditing = !!template;
  const isSystemTemplate = template?.isSystemTemplate || false;

  const form = useForm({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: template?.name || "",
      content: template?.content || "",
      subject: template?.subject || "",
      isSystemTemplate: isSystemTemplate,
    },
  });

  // Fetch user editor settings
  useEffect(() => {
    const fetchEditorSettings = async () => {
      try {
        const response = await fetch("/api/settings/editor");
        if (response.ok) {
          const settings = await response.json();
          setEditorSettings(settings);
        }
      } catch (error) {
        console.error("Failed to fetch editor settings:", error);
      }
    };

    fetchEditorSettings();
  }, []);

  const handleSubmit = async (data: any) => {
    try {
      setIsSubmitting(true);
      await onSubmit({
        ...data,
        type: toolType,
      });
    } catch (error) {
      console.error("Failed to save template:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getContentLanguage = () => {
    if (language) return language;

    switch (toolType.toUpperCase()) {
      case "SLACK":
      case "DISCORD":
        return "json";
      case "EMAIL":
        return "html";
      default:
        return "text";
    }
  };

  const getHelperText = () => {
    if (helperText) return helperText;

    switch (toolType.toUpperCase()) {
      case "SLACK":
        return "Use JSON format for Slack Block Kit messages or plain text";
      case "DISCORD":
        return "Use JSON format for Discord embeds/components or plain text";
      case "EMAIL":
        return "Use HTML format for rich email content";
      default:
        return "Template content";
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      {/* Template Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Template Name</Label>
        <Input
          id="name"
          {...form.register("name")}
          placeholder="Enter template name"
        />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      {/* System Template Switch (Admin only) */}
      {isAdmin && (
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              <div>
                <Label
                  htmlFor="isSystemTemplate"
                  className="text-sm font-medium"
                >
                  System Template
                </Label>
                <p className="text-xs text-muted-foreground">
                  System templates are visible to all users but only editable by
                  admins
                </p>
              </div>
            </div>
            <Switch
              id="isSystemTemplate"
              checked={form.watch("isSystemTemplate")}
              onCheckedChange={(checked) =>
                form.setValue("isSystemTemplate", checked)
              }
            />
          </div>
        </div>
      )}

      {/* System Template Badge (for non-admins viewing system templates) */}
      {!isAdmin && isSystemTemplate && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <Shield className="h-4 w-4 text-blue-500" />
          <Badge
            variant="secondary"
            className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
          >
            System Template
          </Badge>
          <span className="text-xs text-blue-600 dark:text-blue-400">
            This template is managed by administrators
          </span>
        </div>
      )}

      {/* Subject Field (Email only) */}
      {showSubjectField && (
        <div className="space-y-2">
          <Label htmlFor="subject">Subject (Optional)</Label>
          <Input
            id="subject"
            {...form.register("subject")}
            placeholder="Enter email subject template"
          />
        </div>
      )}

      {/* Content Editor */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="content">Content</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <div className="space-y-1 text-xs">
                  <p>
                    <strong>Available template variables:</strong>
                  </p>
                  <p>
                    • <code>{"{{cronium.event.name}}"}</code> - Event name
                  </p>
                  <p>
                    • <code>{"{{cronium.event.status}}"}</code> - Event status
                    (success/failure)
                  </p>
                  <p>
                    • <code>{"{{cronium.event.executionTime}}"}</code> -
                    Execution timestamp
                  </p>
                  <p>
                    • <code>{"{{cronium.event.server}}"}</code> - Server name
                  </p>
                  <p>
                    • <code>{"{{cronium.event.output}}"}</code> - Event output
                  </p>
                  <p>
                    • <code>{"{{cronium.event.error}}"}</code> - Error message
                    (if any)
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="text-xs text-muted-foreground">{getHelperText()}</p>
        <div className="border border-border rounded-md">
          <MonacoEditor
            height="300px"
            language={getContentLanguage()}
            value={form.watch("content")}
            onChange={(value) => form.setValue("content", value || "")}
            editorSettings={editorSettings}
          />
        </div>
        {form.formState.errors.content && (
          <p className="text-sm text-red-500">
            {form.formState.errors.content.message}
          </p>
        )}
      </div>

      {/* Form Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting
            ? "Saving..."
            : isEditing
              ? "Update Template"
              : "Save Template"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
