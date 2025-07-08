"use client";

import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, X } from "lucide-react";
import ActionParameterForm from "@/components/event-form/ActionParameterForm";
import { type ToolAction } from "@/components/tools/types/tool-plugin";
import { DiscordPlugin } from "@/components/tools/plugins/discord/discord-plugin";
import { SlackPluginTrpc as SlackPlugin } from "@/components/tools/plugins/slack/slack-plugin";
import { EmailPlugin } from "@/components/tools/plugins/email/email-plugin";
import { TemplatePreview } from "./TemplatePreview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ToolActionTemplateFormProps {
  templateId?: number;
  onSuccess: () => void;
  onCancel: () => void;
}

// Map of tool plugins
const TOOL_PLUGINS = {
  DISCORD: DiscordPlugin,
  SLACK: SlackPlugin,
  EMAIL: EmailPlugin,
  // Add other plugins as needed
};

export function ToolActionTemplateForm({
  templateId,
  onSuccess,
  onCancel,
}: ToolActionTemplateFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTool, setSelectedTool] = useState("");
  const [selectedAction, setSelectedAction] = useState("");
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [currentAction, setCurrentAction] = useState<ToolAction | null>(null);

  // Fetch template if editing
  const { data: template, isLoading: isLoadingTemplate } =
    trpc.toolActionTemplates.getById.useQuery(
      { id: templateId! },
      { enabled: !!templateId },
    );

  // Create mutation
  const createMutation = trpc.toolActionTemplates.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Template created",
        description: "Your template has been created successfully.",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create template",
        variant: "destructive",
      });
    },
  });

  // Update mutation
  const updateMutation = trpc.toolActionTemplates.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Template updated",
        description: "Your template has been updated successfully.",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update template",
        variant: "destructive",
      });
    },
  });

  // Load template data when editing
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || "");
      setSelectedTool(template.toolType);
      setSelectedAction(template.actionId);
      setParameters(template.parameters as Record<string, unknown>);

      // Set current action
      const plugin =
        TOOL_PLUGINS[template.toolType as keyof typeof TOOL_PLUGINS];
      if (plugin && plugin.getActionById) {
        const action = plugin.getActionById(template.actionId);
        if (action) {
          setCurrentAction(action);
        }
      }
    }
  }, [template]);

  // Update current action when selection changes
  useEffect(() => {
    if (selectedTool && selectedAction) {
      const plugin = TOOL_PLUGINS[selectedTool as keyof typeof TOOL_PLUGINS];
      if (plugin && plugin.getActionById) {
        const action = plugin.getActionById(selectedAction);
        if (action) {
          setCurrentAction(action);
        }
      }
    } else {
      setCurrentAction(null);
    }
  }, [selectedTool, selectedAction]);

  const handleSubmit = async () => {
    if (!name || !selectedTool || !selectedAction) {
      toast({
        title: "Validation error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name,
      description,
      toolType: selectedTool,
      actionId: selectedAction,
      parameters,
    };

    if (templateId) {
      await updateMutation.mutateAsync({ id: templateId, ...data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const isLoading =
    createMutation.isPending || updateMutation.isPending || isLoadingTemplate;

  // Get available actions for selected tool
  const getAvailableActions = () => {
    if (!selectedTool) return [];
    const plugin = TOOL_PLUGINS[selectedTool as keyof typeof TOOL_PLUGINS];
    if (!plugin || !plugin.actions) return [];
    return plugin.actions;
  };

  const availableActions = getAvailableActions();

  return (
    <Tabs defaultValue="form" className="space-y-4">
      <TabsList>
        <TabsTrigger value="form">Template Details</TabsTrigger>
        <TabsTrigger value="preview" disabled={!currentAction}>
          Preview
        </TabsTrigger>
      </TabsList>

      <TabsContent value="form" className="space-y-4">
        {/* Template Name */}
        <div className="space-y-2">
          <Label htmlFor="name">
            Template Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Success Notification"
            disabled={isLoading}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this template does..."
            rows={3}
            disabled={isLoading}
          />
        </div>

        {/* Tool Selection */}
        <div className="space-y-2">
          <Label htmlFor="tool">
            Tool <span className="text-red-500">*</span>
          </Label>
          <Select
            value={selectedTool}
            onValueChange={(value) => {
              setSelectedTool(value);
              setSelectedAction("");
              setParameters({});
            }}
            disabled={isLoading || !!templateId}
          >
            <SelectTrigger id="tool">
              <SelectValue placeholder="Select a tool" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(TOOL_PLUGINS).map((tool) => (
                <SelectItem key={tool} value={tool}>
                  {tool}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Action Selection */}
        {selectedTool && (
          <div className="space-y-2">
            <Label htmlFor="action">
              Action <span className="text-red-500">*</span>
            </Label>
            <Select
              value={selectedAction}
              onValueChange={(value) => {
                setSelectedAction(value);
                setParameters({});
              }}
              disabled={isLoading || !!templateId}
            >
              <SelectTrigger id="action">
                <SelectValue placeholder="Select an action" />
              </SelectTrigger>
              <SelectContent>
                {availableActions.map((action) => (
                  <SelectItem key={action.id} value={action.id}>
                    {action.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Parameters Form */}
        {currentAction && (
          <div className="space-y-2">
            <Label>Action Parameters</Label>
            <div className="rounded-lg border p-4">
              <ActionParameterForm
                action={currentAction}
                value={parameters}
                onChange={setParameters}
                disabled={isLoading}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Use {"{{cronium.event.name}}"}, {"{{cronium.event.status}}"}, and
              other variables in your template fields.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {templateId ? "Update Template" : "Create Template"}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="preview" className="space-y-4">
        {currentAction && (
          <TemplatePreview
            action={currentAction}
            parameters={parameters}
            toolType={selectedTool}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
