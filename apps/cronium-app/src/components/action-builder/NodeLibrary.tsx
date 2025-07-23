"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Zap, GitBranch, Shuffle, Target, Search } from "lucide-react";
import { NodeType, NODE_TEMPLATES } from "./types";
import {
  ToolPluginRegistry,
  type ToolPlugin,
  type ToolAction,
} from "@/tools/types/tool-plugin";
import { Input } from "@/components/ui/input";

const NODE_ICONS: Record<
  NodeType,
  React.ComponentType<{ className?: string }>
> = {
  [NodeType.TRIGGER]: Play,
  [NodeType.ACTION]: Zap,
  [NodeType.CONDITION]: GitBranch,
  [NodeType.TRANSFORMER]: Shuffle,
  [NodeType.OUTPUT]: Target,
};

export function NodeLibrary() {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedTool, setSelectedTool] = React.useState<string | null>(null);

  // Get all available tools and actions
  const tools = React.useMemo(() => {
    const allTools = ToolPluginRegistry.getAll();
    return allTools.map((plugin: ToolPlugin) => ({
      id: plugin.id,
      name: plugin.name,
      icon: plugin.icon,
      actions: plugin.actions ?? [],
    }));
  }, []);

  // Filter actions based on search
  const filteredActions = React.useMemo(() => {
    if (!selectedTool) return [];

    const tool = tools.find((t: (typeof tools)[0]) => t.id === selectedTool);
    if (!tool) return [];

    if (!searchTerm) return tool.actions;

    const lowerSearch = searchTerm.toLowerCase();
    return tool.actions.filter(
      (action: ToolAction) =>
        action.name.toLowerCase().includes(lowerSearch) ||
        action.description.toLowerCase().includes(lowerSearch),
    );
  }, [selectedTool, searchTerm, tools]);

  const handleDragStart = (
    event: React.DragEvent,
    nodeType: NodeType,
    data?: Record<string, unknown>,
  ) => {
    event.dataTransfer.setData("nodeType", nodeType);
    if (data) {
      event.dataTransfer.setData("nodeData", JSON.stringify(data));
    }
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <Card className="h-full w-80">
      <CardHeader>
        <CardTitle>Node Library</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="basic" className="h-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Basic Nodes</TabsTrigger>
            <TabsTrigger value="actions">Tool Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-0 h-full">
            <ScrollArea className="h-[calc(100vh-200px)] p-4">
              <div className="space-y-2">
                {Object.entries(NODE_TEMPLATES).map(([type, template]) => {
                  const Icon = NODE_ICONS[type as NodeType];
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={(e) => handleDragStart(e, type as NodeType)}
                      className="border-border hover:bg-accent cursor-move rounded-lg border p-3 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5" />
                        <div className="flex-1">
                          <div className="font-medium">{template.label}</div>
                          <div className="text-muted-foreground text-xs">
                            {template.description}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="actions" className="mt-0 h-full">
            <div className="border-border border-b p-4">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                <Input
                  placeholder="Search actions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="flex h-[calc(100vh-280px)]">
              {/* Tool list */}
              <div className="border-border w-24 border-r">
                <ScrollArea className="h-full">
                  <div className="p-2">
                    {tools.map((tool: (typeof tools)[0]) => {
                      const Icon = tool.icon;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setSelectedTool(tool.id)}
                          className={`mb-2 flex w-full flex-col items-center gap-1 rounded p-2 transition-colors ${
                            selectedTool === tool.id
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent"
                          }`}
                        >
                          <Icon size={24} />
                          <span className="text-xs">{tool.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Action list */}
              <div className="flex-1">
                <ScrollArea className="h-full p-4">
                  {selectedTool ? (
                    <div className="space-y-2">
                      {filteredActions.length > 0 ? (
                        filteredActions.map((action: ToolAction) => (
                          <div
                            key={action.id}
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(e, NodeType.ACTION, {
                                toolId: selectedTool,
                                actionId: action.id,
                                action,
                              })
                            }
                            className="border-border hover:bg-accent cursor-move rounded-lg border p-3 transition-colors"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <div className="font-medium">{action.name}</div>
                              <Badge variant="secondary" className="text-xs">
                                {action.actionType}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {action.description}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-xs">
                                {action.category}
                              </Badge>
                              {action.developmentMode && (
                                <Badge variant="outline" className="text-xs">
                                  {action.developmentMode}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground py-8 text-center text-sm">
                          No actions found
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground py-8 text-center text-sm">
                      Select a tool to see available actions
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
