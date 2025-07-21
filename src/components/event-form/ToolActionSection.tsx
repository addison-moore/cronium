"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Search,
  Zap,
  MessageSquare,
  Database,
  Mail,
  Globe,
  Users,
  FileText,
  AlertCircle,
  TestTube,
  Info,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { type Tool } from "@/shared/schema";
import {
  type ToolAction,
  type ToolPlugin,
  ToolPluginRegistry,
} from "@/tools/types/tool-plugin";
import ActionParameterForm from "./ActionParameterForm";
import { cn } from "@/lib/utils";
import {
  SlackMessagePreview,
  EmailPreview,
  ApiRequestPreview,
} from "@/tools/previews";
import Link from "next/link";

// Tool Action Configuration Interface
export interface ToolActionConfig {
  toolType: string;
  actionId: string;
  toolId: number;
  parameters: Record<string, unknown>;
  outputMapping?: Record<string, string>;
}

interface ToolActionSectionProps {
  value: ToolActionConfig | null;
  onChange: (config: ToolActionConfig | null) => void;
  availableTools: Tool[];
}

// Tool category icons
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  communication: <MessageSquare className="h-4 w-4" />,
  productivity: <FileText className="h-4 w-4" />,
  data: <Database className="h-4 w-4" />,
  development: <Globe className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  team: <Users className="h-4 w-4" />,
};

// Action type colors
const ACTION_TYPE_COLORS: Record<string, string> = {
  message: "bg-blue-500 text-white",
  create: "bg-green-500 text-white",
  update: "bg-yellow-500 text-white",
  delete: "bg-red-500 text-white",
  query: "bg-purple-500 text-white",
};

export default function ToolActionSection({
  value,
  onChange,
  availableTools,
}: ToolActionSectionProps) {
  const { toast } = useToast();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedToolType, setSelectedToolType] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<ToolPlugin | null>(null);
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [isTestingAction, setIsTestingAction] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [showTemplateAlert, setShowTemplateAlert] = useState(false);

  // Get all plugins
  const allPlugins = useMemo(() => ToolPluginRegistry.getAll(), []);

  // Fetch templates for selected tool and action
  const { data: templatesData } =
    trpc.toolActionTemplates.getByToolAction.useQuery(
      {
        toolType: selectedPlugin?.id ?? "",
        actionId: selectedAction?.id ?? "",
      },
      {
        enabled: !!selectedPlugin && !!selectedAction,
      },
    );

  const availableTemplates = templatesData ?? [];

  // Group available tools by plugin type
  const toolsByType = useMemo(() => {
    const grouped: Record<string, Tool[]> = {};
    availableTools.forEach((tool) => {
      const type = tool.type.toLowerCase();
      grouped[type] ??= [];
      grouped[type].push(tool);
    });
    return grouped;
  }, [availableTools]);

  // Get unique tool types from available tools
  const availableToolTypes = useMemo(() => {
    const types = new Set<string>();
    availableTools.forEach((tool) => {
      const plugin = allPlugins.find(
        (p) => p.id.toUpperCase() === tool.type.toUpperCase(),
      );
      if (plugin) {
        types.add(plugin.id);
      }
    });
    return Array.from(types);
  }, [availableTools, allPlugins]);

  // Filter tool types based on search and category
  const filteredToolTypes = useMemo(() => {
    let types = availableToolTypes;

    // Filter by search query
    if (searchQuery) {
      types = types.filter((type) => {
        const plugin = allPlugins.find((p) => p.id === type);
        return (
          plugin?.name.toLowerCase().includes(searchQuery.toLowerCase()) ??
          type.toLowerCase().includes(searchQuery.toLowerCase())
        );
      });
    }

    // Filter by category
    if (selectedCategory) {
      types = types.filter((type) => {
        const plugin = allPlugins.find((p) => p.id === type);
        return plugin?.category === selectedCategory;
      });
    }

    return types;
  }, [availableToolTypes, searchQuery, selectedCategory, allPlugins]);

  // Get categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    allPlugins.forEach((plugin) => {
      if (plugin.category && availableToolTypes.includes(plugin.id)) {
        cats.add(plugin.category);
      }
    });
    return Array.from(cats).sort();
  }, [allPlugins, availableToolTypes]);

  // Get tools for selected type
  const toolsForSelectedType = useMemo(() => {
    if (!selectedToolType) return [];
    return toolsByType[selectedToolType.toLowerCase()] ?? [];
  }, [selectedToolType, toolsByType]);

  // Initialize from value
  useEffect(() => {
    if (value?.toolId && value?.actionId) {
      const tool = availableTools.find((t) => t.id === value.toolId);
      if (tool) {
        const plugin = allPlugins.find(
          (p) => p.id.toUpperCase() === tool.type.toUpperCase(),
        );
        if (plugin) {
          setSelectedToolType(plugin.id);
          setSelectedTool(tool);
          setSelectedPlugin(plugin);

          const action = plugin.actions?.find((a) => a.id === value.actionId);
          if (action) {
            setSelectedAction(action);
            setParameters(value.parameters || {});
          }
        }
      }
    }
  }, [value, availableTools, allPlugins]);

  // Handle tool type selection
  const handleToolTypeSelect = (type: string) => {
    const plugin = allPlugins.find((p) => p.id === type);
    if (!plugin) return;

    setSelectedToolType(type);
    setSelectedPlugin(plugin);

    // Auto-select first available credential if only one exists
    const tools = toolsByType[type.toLowerCase()] ?? [];
    if (tools.length === 1 && tools[0]) {
      setSelectedTool(tools[0]);
    } else {
      setSelectedTool(null);
    }

    setSelectedAction(null);
    setParameters({});
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);
    onChange(null);
  };

  // Handle credential selection
  const handleCredentialSelect = (toolId: string) => {
    const tool = availableTools.find((t) => t.id === parseInt(toolId));
    if (tool) {
      setSelectedTool(tool);
    }
  };

  // Handle action selection
  const handleActionSelect = (actionId: string) => {
    if (!selectedPlugin) return;

    const action = selectedPlugin.actions?.find((a) => a.id === actionId);
    if (!action) return;

    setSelectedAction(action);
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);

    // Initialize with default parameters
    const defaultParams = action.testData?.() ?? {};
    setParameters(defaultParams);

    // Update configuration
    if (selectedTool && selectedPlugin) {
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: action.id,
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
    if (template && selectedTool && selectedPlugin && selectedAction) {
      setSelectedTemplateId(template.id);
      const templateParams = template.parameters as Record<string, unknown>;
      setParameters(templateParams);
      setShowTemplateAlert(true);

      // Update configuration with template parameters
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: selectedAction.id,
        parameters: templateParams,
      });

      // Hide alert after 3 seconds
      setTimeout(() => setShowTemplateAlert(false), 3000);
    }
  };

  // Handle parameter changes
  const handleParametersChange = (newParams: Record<string, unknown>) => {
    setParameters(newParams);

    if (selectedTool && selectedPlugin && selectedAction) {
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: selectedAction.id,
        parameters: newParams,
      });
    }
  };

  // Test action
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

  // Clear selection
  const handleClearSelection = () => {
    setSelectedToolType(null);
    setSelectedTool(null);
    setSelectedPlugin(null);
    setSelectedAction(null);
    setParameters({});
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);
    onChange(null);
  };

  // Render tool type card
  const renderToolTypeCard = (type: string) => {
    const plugin = allPlugins.find((p) => p.id === type);
    if (!plugin) return null;

    const Icon = plugin.icon;
    const isSelected = selectedToolType === type;
    const toolCount = toolsByType[type.toLowerCase()]?.length ?? 0;

    return (
      <div
        key={type}
        className={cn(
          "border-border bg-tertiary-bg cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md",
          isSelected
            ? "border-primary bg-primary/5 ring-primary ring-2 ring-offset-2"
            : "hover:border-primary/50",
        )}
        onClick={() => handleToolTypeSelect(type)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "rounded-lg p-2",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-medium">{plugin.name}</h4>
              <p className="text-muted-foreground text-sm">
                {toolCount} credential{toolCount !== 1 ? "s" : ""} configured
              </p>
            </div>
          </div>
          {plugin.actions && (
            <Badge variant="secondary" className="text-xs">
              {plugin.actions.length} actions
            </Badge>
          )}
        </div>
      </div>
    );
  };

  // Render action preview
  const renderActionPreview = () => {
    if (!selectedPlugin || !selectedAction || !parameters) {
      return null;
    }

    // Slack preview
    if (selectedPlugin.id === "slack" && selectedAction.id === "send-message") {
      return (
        <SlackMessagePreview
          channel={
            typeof parameters.channel === "string"
              ? parameters.channel
              : "#general"
          }
          message={typeof parameters.text === "string" ? parameters.text : ""}
          {...(typeof parameters.username === "string" && {
            username: parameters.username,
          })}
          {...(typeof parameters.icon_emoji === "string" && {
            iconEmoji: parameters.icon_emoji,
          })}
          {...(typeof parameters.icon_url === "string" && {
            iconUrl: parameters.icon_url,
          })}
          {...(Array.isArray(parameters.blocks) && {
            blocks: parameters.blocks as Array<{
              type?: string;
              text?: { text?: string };
            }>,
          })}
          {...(Array.isArray(parameters.attachments) && {
            attachments: parameters.attachments as Array<{
              title?: string;
              text?: string;
            }>,
          })}
        />
      );
    }

    // Email preview
    if (selectedPlugin.id === "email" && selectedAction.id === "send-email") {
      const emailProps: React.ComponentProps<typeof EmailPreview> = {
        to: typeof parameters.to === "string" ? parameters.to : "",
        subject:
          typeof parameters.subject === "string" ? parameters.subject : "",
        body: typeof parameters.body === "string" ? parameters.body : "",
      };

      if (parameters.cc) emailProps.cc = parameters.cc as string;
      if (parameters.bcc) emailProps.bcc = parameters.bcc as string;
      if (parameters.priority)
        emailProps.priority = parameters.priority as "low" | "normal" | "high";
      if (parameters.isHtml !== undefined)
        emailProps.isHtml = parameters.isHtml as boolean;
      if (Array.isArray(parameters.attachments)) {
        emailProps.attachments = parameters.attachments.filter(
          (a): a is string => typeof a === "string",
        );
      }

      return <EmailPreview {...emailProps} />;
    }

    // Webhook/API preview
    if (
      selectedPlugin.id === "webhook" &&
      selectedAction.id === "send-request"
    ) {
      const apiProps: React.ComponentProps<typeof ApiRequestPreview> = {
        method:
          typeof parameters.method === "string" ? parameters.method : "GET",
        url: typeof parameters.url === "string" ? parameters.url : "",
      };

      if (parameters.headers)
        apiProps.headers = parameters.headers as Record<string, string>;
      if (parameters.queryParams)
        apiProps.queryParams = parameters.queryParams as Record<string, string>;
      if (parameters.body)
        apiProps.body = parameters.body as string | Record<string, unknown>;
      if (parameters.authType)
        apiProps.authType = parameters.authType as
          | "none"
          | "api_key"
          | "bearer"
          | "basic";
      if (parameters.timeout) apiProps.timeout = parameters.timeout as number;

      return <ApiRequestPreview {...apiProps} />;
    }

    // Discord preview (similar to Slack)
    if (
      selectedPlugin.id === "discord" &&
      selectedAction.id === "send-message"
    ) {
      return (
        <SlackMessagePreview
          channel={parameters.webhook_url ? "Discord Channel" : "#general"}
          message={
            typeof parameters.content === "string" ? parameters.content : ""
          }
          username={
            typeof parameters.username === "string"
              ? parameters.username
              : "Cronium Bot"
          }
          {...(typeof parameters.avatar_url === "string" && {
            iconUrl: parameters.avatar_url,
          })}
        />
      );
    }

    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Tool Action Configuration
          </CardTitle>
          {selectedToolType && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 h-4 w-4" />
              Clear Selection
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tool selection section */}
        {!selectedToolType ? (
          <div className="space-y-4">
            {/* Search and filters */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search tools..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={!selectedCategory ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                >
                  All
                </Button>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    variant={selectedCategory === cat ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(cat)}
                    className="flex items-center gap-1"
                  >
                    {CATEGORY_ICONS[cat] ?? <Zap className="h-3 w-3" />}
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* No tools message */}
            {availableTools.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No tool credentials configured. Configure tool credentials to
                  start using Tool Actions.
                  <Button variant="link" asChild className="px-1">
                    <Link href="/dashboard/settings#tools">
                      Configure Tools
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Tools grid */}
            {filteredToolTypes.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredToolTypes.map(renderToolTypeCard)}
              </div>
            )}

            {/* No results */}
            {availableTools.length > 0 && filteredToolTypes.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-muted-foreground">
                  No tools match your search criteria
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Configuration section - appears after tool selection */
          <div className="space-y-6">
            {/* Selected tool header */}
            {selectedPlugin && (
              <div className="bg-muted/50 flex items-center gap-3 rounded-lg p-4">
                <selectedPlugin.icon className="text-primary h-8 w-8" />
                <div className="flex-1">
                  <h3 className="font-semibold">{selectedPlugin.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {selectedPlugin.description}
                  </p>
                </div>
              </div>
            )}

            <Separator />

            {/* Credential and Action selection - side by side on large screens */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Credential selection */}
              <div className="space-y-2">
                <Label htmlFor="credential-select">Select Credential</Label>
                <Select
                  value={selectedTool?.id.toString() ?? ""}
                  onValueChange={handleCredentialSelect}
                >
                  <SelectTrigger id="credential-select">
                    <SelectValue placeholder="Choose a credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {toolsForSelectedType.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id.toString()}>
                        <div className="flex items-center gap-2">
                          {/* Minimal status indicator */}
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              tool.isActive ? "bg-green-500" : "bg-gray-400",
                            )}
                          />
                          <span>{tool.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {toolsForSelectedType.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    No credentials available for this tool.
                    <Button
                      variant="link"
                      asChild
                      className="h-auto p-0 text-sm"
                    >
                      <Link href="/dashboard/settings#tools">
                        Add credential
                      </Link>
                    </Button>
                  </p>
                )}
              </div>

              {/* Action selection */}
              {selectedTool && selectedPlugin && (
                <div className="space-y-2">
                  <Label htmlFor="action-select">Select Action</Label>
                  <Select
                    value={selectedAction?.id ?? ""}
                    onValueChange={handleActionSelect}
                  >
                    <SelectTrigger id="action-select">
                      <SelectValue placeholder="Choose an action" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPlugin.actions?.map((action) => (
                        <SelectItem key={action.id} value={action.id}>
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-medium">{action.name}</span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "ml-2 text-xs",
                                ACTION_TYPE_COLORS[action.actionType] ??
                                  "bg-gray-500 text-white",
                              )}
                            >
                              {action.actionType}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Continue with remaining content after action selection */}
            {selectedTool && selectedPlugin && selectedAction && (
              <>
                {/* Template Selection */}
                {availableTemplates.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="template-select">
                      Use Template (Optional)
                    </Label>
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
                      Template parameters have been applied. You can customize
                      them below.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Action parameters */}
                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Configure Parameters</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestAction}
                      disabled={isTestingAction}
                      className="flex items-center gap-2"
                    >
                      <TestTube
                        className={cn(
                          "h-4 w-4",
                          isTestingAction && "animate-spin",
                        )}
                      />
                      Test Action
                    </Button>
                  </div>

                  <ActionParameterForm
                    action={selectedAction}
                    value={parameters}
                    onChange={handleParametersChange}
                    isTest={false}
                  />
                </div>

                {/* Live Preview */}
                {renderActionPreview()}
              </>
            )}
          </div>
        )}

        {/* Help text */}
        {!selectedToolType && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Tool Actions allow you to integrate with external services without
              writing code. Select a tool to get started.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
