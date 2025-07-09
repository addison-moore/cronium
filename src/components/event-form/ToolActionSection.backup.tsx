"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { TestTube, FileText, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { type Tool } from "@/shared/schema";
import {
  type ToolAction,
  type ActionType,
  ToolPluginRegistry,
} from "@/components/tools/types/tool-plugin";
import ActionParameterForm from "./ActionParameterForm";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Tool Action Configuration Interface
export interface ToolActionConfig {
  toolType: string;
  actionId: string;
  toolId: number;
  parameters: Record<string, any>;
  outputMapping?: Record<string, string>;
}

interface ToolActionSectionProps {
  value: ToolActionConfig | null;
  onChange: (config: ToolActionConfig | null) => void;
  availableTools: Tool[];
}

export default function ToolActionSection({
  value,
  onChange,
  availableTools,
}: ToolActionSectionProps) {
  const { toast } = useToast();

  // State
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [isTestingAction, setIsTestingAction] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [showTemplateAlert, setShowTemplateAlert] = useState(false);

  // Get available actions for selected tool
  const availableActions = selectedTool
    ? ToolPluginRegistry.get(selectedTool.type)?.actions || []
    : [];

  // Fetch templates for selected tool and action
  const { data: templatesData } =
    trpc.toolActionTemplates.getByToolAction.useQuery(
      {
        toolType: selectedTool?.type ?? "",
        actionId: selectedAction?.id ?? "",
      },
      {
        enabled: !!selectedTool && !!selectedAction,
      },
    );

  const availableTemplates = templatesData ?? [];

  // Initialize state from value
  useEffect(() => {
    if (value) {
      const tool = availableTools.find((t) => t.id === value.toolId);
      if (tool) {
        setSelectedTool(tool);
        const action = ToolPluginRegistry.getActionById(value.actionId);
        if (action) {
          setSelectedAction(action);
          setParameters(value.parameters || {});
        }
      }
    }
  }, [value, availableTools]);

  // Handle tool selection
  const handleToolChange = (toolId: string) => {
    const tool = availableTools.find((t) => t.id === parseInt(toolId));
    setSelectedTool(tool || null);
    setSelectedAction(null);
    setParameters({});
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);

    if (!tool) {
      onChange(null);
    }
  };

  // Handle action selection
  const handleActionChange = (actionId: string) => {
    const action = ToolPluginRegistry.getActionById(actionId);
    setSelectedAction(action || null);
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);

    // Reset parameters to action defaults
    const defaultParams = action?.testData?.() || {};
    setParameters(defaultParams);

    // Update configuration
    if (selectedTool && action) {
      onChange({
        toolType: selectedTool.type,
        actionId: action.id,
        toolId: selectedTool.id,
        parameters: defaultParams,
      });
    }
  };

  // Handle template selection
  const handleTemplateChange = (templateId: string) => {
    if (templateId === "custom") {
      setSelectedTemplateId(null);
      setShowTemplateAlert(false);
      return;
    }

    const template = availableTemplates.find(
      (t) => t.id === parseInt(templateId),
    );
    if (template && selectedTool && selectedAction) {
      setSelectedTemplateId(template.id);
      const templateParams = template.parameters as Record<string, any>;
      setParameters(templateParams);
      setShowTemplateAlert(true);

      // Update configuration with template parameters
      onChange({
        toolType: selectedTool.type,
        actionId: selectedAction.id,
        toolId: selectedTool.id,
        parameters: templateParams,
      });

      // Hide alert after 3 seconds
      setTimeout(() => setShowTemplateAlert(false), 3000);
    }
  };

  // Handle parameter changes
  const handleParametersChange = (newParams: Record<string, any>) => {
    setParameters(newParams);

    if (selectedTool && selectedAction) {
      onChange({
        toolType: selectedTool.type,
        actionId: selectedAction.id,
        toolId: selectedTool.id,
        parameters: newParams,
      });
    }
  };

  // Test action execution
  const testActionMutation = trpc.tools.executeAction.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Test Successful",
        description: "Action executed successfully in test mode",
      });
      console.log("Test result:", result);
    },
    onError: (error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsTestingAction(false);
    },
  });

  const handleTestAction = () => {
    if (!selectedTool || !selectedAction) return;

    setIsTestingAction(true);
    testActionMutation.mutate({
      toolId: selectedTool.id,
      actionId: selectedAction.id,
      parameters,
      isTest: true,
    });
  };

  // Get action type badge color
  const getActionTypeBadgeColor = (actionType: ActionType) => {
    switch (actionType) {
      case "create":
        return "bg-green-500 text-white";
      case "update":
        return "bg-blue-500 text-white";
      case "search":
        return "bg-purple-500 text-white";
      case "delete":
        return "bg-red-500 text-white";
      default:
        return "bg-gray-500 text-white";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Action Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* No Tools Available */}
        {availableTools.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">
              No tools configured. Please configure tool credentials first.
            </p>
            <Button variant="outline" className="mt-4">
              Configure Tools
            </Button>
          </div>
        ) : (
          <>
            {/* Tool Selection */}
            <div className="space-y-2">
              <Label htmlFor="tool-select">Select Tool</Label>
              <Select
                value={selectedTool?.id.toString() ?? ""}
                onValueChange={handleToolChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a tool to integrate..." />
                </SelectTrigger>
                <SelectContent>
                  {availableTools.map((tool) => (
                    <SelectItem key={tool.id} value={tool.id.toString()}>
                      <div className="flex items-center gap-2">
                        <span>{tool.name}</span>
                        <Badge variant="outline">{tool.type}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTool && (
                <div className="text-muted-foreground text-sm">
                  <strong>Tool:</strong> {selectedTool.name} (
                  {selectedTool.type})
                </div>
              )}
            </div>

            {/* Action Selection */}
            {selectedTool && availableActions.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="action-select">Select Action</Label>
                <Select
                  value={selectedAction?.id ?? ""}
                  onValueChange={handleActionChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an action to perform..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableActions.map((action) => (
                      <SelectItem key={action.id} value={action.id}>
                        <div className="flex items-center gap-2">
                          <span>{action.name}</span>
                          <Badge
                            className={getActionTypeBadgeColor(
                              action.actionType,
                            )}
                          >
                            {action.actionType}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAction && (
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-sm">
                      <strong>Description:</strong> {selectedAction.description}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      <strong>Category:</strong> {selectedAction.category}
                    </div>
                    {selectedAction.helpText && (
                      <div className="text-muted-foreground text-sm">
                        <strong>Help:</strong> {selectedAction.helpText}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Template Selection */}
            {selectedAction && availableTemplates.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="template-select">Use Template (Optional)</Label>
                <Select
                  value={selectedTemplateId?.toString() ?? "custom"}
                  onValueChange={handleTemplateChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template or configure manually..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">
                      <div className="flex items-center gap-2">
                        <X className="h-4 w-4" />
                        <span>Configure Manually</span>
                      </div>
                    </SelectItem>
                    {availableTemplates.map((template) => (
                      <SelectItem
                        key={template.id}
                        value={template.id.toString()}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          <span>{template.name}</span>
                          {template.isSystemTemplate && (
                            <Badge variant="outline" className="ml-2">
                              System
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplateId && (
                  <div className="text-muted-foreground text-sm">
                    {
                      availableTemplates.find(
                        (t) => t.id === selectedTemplateId,
                      )?.description
                    }
                  </div>
                )}
              </div>
            )}

            {/* Template Applied Alert */}
            {showTemplateAlert && (
              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  Template parameters have been applied. You can customize them
                  below.
                </AlertDescription>
              </Alert>
            )}

            {/* Action Parameters */}
            {selectedAction && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Configure Action Parameters</Label>
                  {selectedTool && selectedAction && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestAction}
                      disabled={isTestingAction}
                      className="flex items-center gap-2"
                    >
                      {isTestingAction ? (
                        <TestTube className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                      Test Action
                    </Button>
                  )}
                </div>
                <ActionParameterForm
                  action={selectedAction}
                  value={parameters}
                  onChange={handleParametersChange}
                  isTest={false}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
