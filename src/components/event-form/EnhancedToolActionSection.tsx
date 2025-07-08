"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import {
  Play,
  TestTube,
  Search,
  Settings,
  Star,
  Clock,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { type Tool } from "@/shared/schema";
import {
  type ToolAction,
  type ToolPlugin,
  ToolPluginRegistry,
} from "@/components/tools/types/tool-plugin";
import {
  ToolBrowser,
  ActionPreviewPanel,
  QuickAccessPanel,
} from "@/components/tools/tool-browser";
import ActionParameterForm from "./ActionParameterForm";
import TestDataGenerator from "@/components/tools/TestDataGenerator";
import { cn } from "@/lib/utils";

// Tool Action Configuration Interface
export interface ToolActionConfig {
  toolType: string;
  actionId: string;
  toolId: number;
  parameters: Record<string, any>;
  outputMapping?: Record<string, string>;
}

interface EnhancedToolActionSectionProps {
  value: ToolActionConfig | null;
  onChange: (config: ToolActionConfig | null) => void;
  availableTools: Tool[];
  className?: string;
}

// Local storage keys
const FAVORITES_KEY = "cronium_tool_favorites";
const RECENT_ACTIONS_KEY = "cronium_recent_actions";

export default function EnhancedToolActionSection({
  value,
  onChange,
  availableTools,
  className,
}: EnhancedToolActionSectionProps) {
  const { toast } = useToast();

  // State
  const [selectedTool, setSelectedTool] = useState<ToolPlugin | null>(null);
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"browse" | "configure">("browse");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentActions, setRecentActions] = useState<string[]>([]);

  // Load favorites and recent actions from localStorage
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem(FAVORITES_KEY);
      const savedRecent = localStorage.getItem(RECENT_ACTIONS_KEY);

      if (savedFavorites) {
        setFavorites(JSON.parse(savedFavorites));
      }
      if (savedRecent) {
        setRecentActions(JSON.parse(savedRecent));
      }
    } catch (error) {
      console.error("Failed to load preferences:", error);
    }
  }, []);

  // Initialize from existing value
  useEffect(() => {
    if (value?.toolType && value?.actionId) {
      const plugin = ToolPluginRegistry.getPlugin(value.toolType);
      const action = plugin?.actions?.find((a) => a.id === value.actionId);

      if (plugin && action) {
        setSelectedTool(plugin);
        setSelectedAction(action);
        setActiveTab("configure");
      }
    }
  }, [value]);

  // Get tool credential from available tools
  const toolCredential = useMemo(() => {
    if (!selectedTool) return null;
    return availableTools.find(
      (t) => t.type === selectedTool.id && t.configured,
    );
  }, [selectedTool, availableTools]);

  // TRPC mutations
  const testActionMutation = trpc.tools.executeAction.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Test Successful",
        description: "Action executed successfully in test mode",
      });
    },
    onError: (error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle action selection
  const handleActionSelect = (tool: ToolPlugin, action: ToolAction) => {
    setSelectedTool(tool);
    setSelectedAction(action);
    setActiveTab("configure");

    // Update recent actions
    const actionKey = `${tool.id}:${action.id}`;
    const updatedRecent = [
      actionKey,
      ...recentActions.filter((key) => key !== actionKey),
    ].slice(0, 10);

    setRecentActions(updatedRecent);
    localStorage.setItem(RECENT_ACTIONS_KEY, JSON.stringify(updatedRecent));
  };

  // Handle favorite toggle
  const handleToggleFavorite = (actionKey: string) => {
    const updatedFavorites = favorites.includes(actionKey)
      ? favorites.filter((key) => key !== actionKey)
      : [...favorites, actionKey];

    setFavorites(updatedFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updatedFavorites));
  };

  // Handle parameter change
  const handleParameterChange = (parameters: Record<string, any>) => {
    if (!selectedTool || !selectedAction || !toolCredential) return;

    onChange({
      toolType: selectedTool.id,
      actionId: selectedAction.id,
      toolId: toolCredential.id,
      parameters,
      outputMapping: value?.outputMapping,
    });
  };

  // Handle test action
  const handleTestAction = async () => {
    if (!value || !toolCredential) return;

    setIsTestMode(true);
    try {
      await testActionMutation.mutateAsync({
        toolId: toolCredential.id,
        actionId: value.actionId,
        parameters: value.parameters,
        testMode: true,
      });
    } finally {
      setIsTestMode(false);
    }
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedTool(null);
    setSelectedAction(null);
    onChange(null);
    setActiveTab("browse");
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Tool Action Configuration
          </CardTitle>
          {selectedAction && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              {selectedTool?.name} - {selectedAction.name}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="browse" className="gap-2">
              <Search className="h-4 w-4" />
              Browse Actions
            </TabsTrigger>
            <TabsTrigger
              value="configure"
              disabled={!selectedAction}
              className="gap-2"
            >
              <Settings className="h-4 w-4" />
              Configure
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              {/* Main Browser */}
              <div>
                <ToolBrowser
                  onActionSelect={handleActionSelect}
                  selectedToolId={selectedTool?.id}
                  selectedActionId={selectedAction?.id}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                  recentActions={recentActions}
                />
              </div>

              {/* Quick Access Sidebar */}
              <div className="space-y-4">
                {selectedTool && selectedAction ? (
                  <ActionPreviewPanel
                    tool={selectedTool}
                    action={selectedAction}
                    onUseAction={() => setActiveTab("configure")}
                    onTestAction={handleTestAction}
                    isFavorite={favorites.includes(
                      `${selectedTool.id}:${selectedAction.id}`,
                    )}
                    onToggleFavorite={() =>
                      handleToggleFavorite(
                        `${selectedTool.id}:${selectedAction.id}`,
                      )
                    }
                  />
                ) : (
                  <QuickAccessPanel
                    favorites={favorites}
                    recentActions={recentActions}
                    onActionSelect={handleActionSelect}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="configure" className="mt-6">
            {selectedTool && selectedAction && (
              <div className="space-y-6">
                {/* Action Header */}
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium">
                      {selectedAction.name}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {selectedAction.description}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearSelection}
                  >
                    Change Action
                  </Button>
                </div>

                {/* Credential Status */}
                {!toolCredential ? (
                  <Alert variant="warning">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {selectedTool.name} is not configured. Please add your
                      credentials in the Tools section before using this action.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="success">
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Using {selectedTool.name} credentials:{" "}
                      <span className="font-medium">{toolCredential.name}</span>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Parameter Form */}
                {toolCredential && (
                  <>
                    <ActionParameterForm
                      action={selectedAction}
                      value={value?.parameters || {}}
                      onChange={handleParameterChange}
                      onSubmit={() => {}}
                      disabled={!toolCredential}
                    />

                    {/* Test Data Generator */}
                    <TestDataGenerator
                      action={selectedAction}
                      onApply={handleParameterChange}
                      currentValue={value?.parameters}
                    />

                    {/* Test Action Button */}
                    <div className="flex justify-end">
                      <Button
                        onClick={handleTestAction}
                        disabled={!value || testActionMutation.isPending}
                        variant="outline"
                      >
                        <TestTube className="mr-2 h-4 w-4" />
                        {testActionMutation.isPending
                          ? "Testing..."
                          : "Test Action"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
