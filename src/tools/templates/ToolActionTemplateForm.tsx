"use client";

import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, X } from "lucide-react";
import { TemplatePreview } from "./TemplatePreview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolPluginRegistry } from "@/tools/plugins";
import { TemplateActionParameterForm } from "./TemplateActionParameterForm";
import { Variable } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

interface ToolActionTemplateFormProps {
  toolType: string;
  actionId: string;
  templateId?: number | null;
  onSuccess: () => void;
  onCancel: () => void;
}

// Template variables available in cronium context
const TEMPLATE_VARIABLES = [
  {
    group: "Event",
    variables: [
      { name: "cronium.event.id", description: "Event ID" },
      { name: "cronium.event.name", description: "Event name" },
      { name: "cronium.event.status", description: "Execution status" },
      {
        name: "cronium.event.duration",
        description: "Runtime in milliseconds",
      },
      { name: "cronium.event.executionTime", description: "Start timestamp" },
      { name: "cronium.event.server", description: "Execution server name" },
      { name: "cronium.event.output", description: "Script output" },
      { name: "cronium.event.error", description: "Error message if any" },
    ],
  },
  {
    group: "Variables",
    variables: [
      { name: "cronium.getVariables.*", description: "User-defined variables" },
    ],
  },
  {
    group: "Input",
    variables: [
      { name: "cronium.input.*", description: "Workflow input data" },
    ],
  },
  {
    group: "Conditions",
    variables: [
      { name: "cronium.getCondition.*", description: "Conditional flags" },
    ],
  },
];

export function ToolActionTemplateForm({
  toolType,
  actionId,
  templateId,
  onSuccess,
  onCancel,
}: ToolActionTemplateFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [currentFieldForVariable, setCurrentFieldForVariable] = useState<
    string | null
  >(null);

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
        description: error.message ?? "Failed to create template",
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
        description: error.message ?? "Failed to update template",
        variant: "destructive",
      });
    },
  });

  // Get plugin and action
  const plugin = ToolPluginRegistry.get(toolType);
  const currentAction = plugin?.actions?.find((a) => a.id === actionId) ?? null;

  // Load template data when editing
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description ?? "");
      setParameters(template.parameters as Record<string, unknown>);
    }
  }, [template]);

  const handleSubmit = async () => {
    if (!name) {
      toast({
        title: "Validation error",
        description: "Please provide a template name",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name,
      description,
      toolType,
      actionId,
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

  // Handle variable insertion
  const insertVariable = (variableName: string) => {
    if (!currentFieldForVariable) return;

    // Get current value of the field
    const currentValue = (parameters[currentFieldForVariable] as string) ?? "";

    // Insert the variable wrapped in handlebars syntax
    const newValue = currentValue + `{{${variableName}}}`;

    setParameters({
      ...parameters,
      [currentFieldForVariable]: newValue,
    });

    toast({
      title: "Variable inserted",
      description: `Added {{${variableName}}} to the field`,
    });
  };

  return (
    <Tabs defaultValue="form" className="space-y-4">
      <TabsList className="grid w-full grid-cols-2">
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

        {/* Show selected tool and action (read-only) */}
        <div className="border-border bg-muted/50 rounded-lg border p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-sm">Tool:</Label>
              <div className="flex items-center gap-2">
                {plugin && <plugin.icon className="h-4 w-4" />}
                <span className="font-medium">{plugin?.name ?? toolType}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-sm">Action:</Label>
              <span className="font-medium">
                {currentAction?.name ?? actionId}
              </span>
            </div>
          </div>
        </div>

        {/* Parameters Form */}
        {currentAction && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Action Parameters</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Variable className="mr-2 h-4 w-4" />
                    Insert Variable
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  {TEMPLATE_VARIABLES.map((group) => (
                    <DropdownMenuSub key={group.group}>
                      <DropdownMenuSubTrigger>
                        {group.group}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {group.variables.map((variable) => (
                          <DropdownMenuItem
                            key={variable.name}
                            onClick={() => insertVariable(variable.name)}
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-sm">
                                {variable.name}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {variable.description}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    Click on a field below, then select a variable to insert
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="border-border rounded-lg border p-4">
              <TemplateActionParameterForm
                action={currentAction}
                value={parameters}
                onChange={setParameters}
                onFieldFocus={setCurrentFieldForVariable}
                disabled={isLoading}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Use Handlebars syntax like {"{{cronium.event.name}}"} in your
              template fields.
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
            toolType={toolType}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
