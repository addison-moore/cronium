"use client";

import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Star,
  Clock,
  Zap,
  MessageSquare,
  FileText,
  Database,
  Cloud,
  Code,
  Grid,
  List,
  Filter,
} from "lucide-react";
import {
  ToolPluginRegistry,
  type ToolPlugin,
  type ToolAction,
} from "@/components/tools/types/tool-plugin";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ToolBrowserProps {
  onActionSelect?: (tool: ToolPlugin, action: ToolAction) => void;
  selectedToolId?: string;
  selectedActionId?: string;
  favorites?: string[];
  onToggleFavorite?: (actionKey: string) => void;
  recentActions?: string[];
}

// Tool categories for better organization
const TOOL_CATEGORIES = {
  communication: {
    name: "Communication",
    icon: MessageSquare,
    description: "Messaging and collaboration tools",
  },
  productivity: {
    name: "Productivity",
    icon: FileText,
    description: "Document and task management",
  },
  data: {
    name: "Data & Analytics",
    icon: Database,
    description: "Spreadsheets and databases",
  },
  development: {
    name: "Development",
    icon: Code,
    description: "Developer tools and APIs",
  },
  cloud: {
    name: "Cloud Services",
    icon: Cloud,
    description: "Cloud platforms and services",
  },
  other: {
    name: "Other",
    icon: Grid,
    description: "Miscellaneous tools",
  },
};

export function ToolBrowser({
  onActionSelect,
  selectedToolId,
  selectedActionId,
  favorites = [],
  onToggleFavorite,
  recentActions = [],
}: ToolBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);

  // Get all tools from registry
  const allTools = useMemo(() => {
    return ToolPluginRegistry.getAll();
  }, []);

  // Categorize tools
  const categorizedTools = useMemo(() => {
    const categories: Record<string, ToolPlugin[]> = {
      communication: [],
      productivity: [],
      data: [],
      development: [],
      cloud: [],
      other: [],
    };

    allTools.forEach((tool: ToolPlugin) => {
      // Simple categorization based on tool ID or name
      if (["slack", "discord", "teams", "email"].includes(tool.id)) {
        categories.communication?.push(tool);
      } else if (["notion", "trello", "asana"].includes(tool.id)) {
        categories.productivity?.push(tool);
      } else if (["google-sheets", "airtable"].includes(tool.id)) {
        categories.data?.push(tool);
      } else if (["github", "gitlab", "bitbucket"].includes(tool.id)) {
        categories.development?.push(tool);
      } else if (["aws", "gcp", "azure"].includes(tool.id)) {
        categories.cloud?.push(tool);
      } else {
        categories.other?.push(tool);
      }
    });

    return categories;
  }, [allTools]);

  // Filter tools and actions based on search
  const filteredResults = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const results: Array<{ tool: ToolPlugin; action: ToolAction }> = [];

    allTools.forEach((tool: ToolPlugin) => {
      // Filter by category if selected
      if (selectedCategory) {
        const toolsInCategory = categorizedTools[selectedCategory] ?? [];
        if (!toolsInCategory.includes(tool)) return;
      }

      // Filter by availability if enabled
      // Note: isAvailable property is not part of ToolPlugin interface
      // if (showOnlyAvailable && !tool.isAvailable) return;

      // Search in tool name and actions
      const toolMatches = tool.name.toLowerCase().includes(query);

      tool.actions?.forEach((action: ToolAction) => {
        const actionMatches =
          action.name.toLowerCase().includes(query) ||
          action.description.toLowerCase().includes(query) ||
          action.category.toLowerCase().includes(query);

        if (!query || toolMatches || actionMatches) {
          results.push({ tool, action });
        }
      });
    });

    return results;
  }, [
    allTools,
    searchQuery,
    selectedCategory,
    showOnlyAvailable,
    categorizedTools,
  ]);

  // Get favorite actions
  const favoriteActions = useMemo(() => {
    return filteredResults.filter((result) => {
      const actionKey = `${result.tool.id}:${result.action.id}`;
      return favorites.includes(actionKey);
    });
  }, [filteredResults, favorites]);

  // Get recent actions
  const recentActionResults = useMemo(() => {
    return recentActions
      .map((actionKey) => {
        const [toolId, actionId] = actionKey.split(":");
        const tool = allTools.find((t: ToolPlugin) => t.id === toolId);
        const action = tool?.actions?.find(
          (a: ToolAction) => a.id === actionId,
        );
        return tool && action ? { tool, action } : null;
      })
      .filter(Boolean) as Array<{ tool: ToolPlugin; action: ToolAction }>;
  }, [recentActions, allTools]);

  const handleActionClick = (tool: ToolPlugin, action: ToolAction) => {
    onActionSelect?.(tool, action);
  };

  const handleToggleFavorite = (tool: ToolPlugin, action: ToolAction) => {
    const actionKey = `${tool.id}:${action.id}`;
    onToggleFavorite?.(actionKey);
  };

  const isActionFavorite = (tool: ToolPlugin, action: ToolAction) => {
    const actionKey = `${tool.id}:${action.id}`;
    return favorites.includes(actionKey);
  };

  const isActionSelected = (tool: ToolPlugin, action: ToolAction) => {
    return selectedToolId === tool.id && selectedActionId === action.id;
  };

  const renderActionCard = (tool: ToolPlugin, action: ToolAction) => {
    const selected = isActionSelected(tool, action);
    const favorite = isActionFavorite(tool, action);
    const Icon = tool.icon;

    return (
      <Card
        key={`${tool.id}:${action.id}`}
        className={cn(
          "cursor-pointer transition-all hover:shadow-md",
          selected && "ring-primary ring-2",
          // !tool.isAvailable && "opacity-60",
        )}
        onClick={() => handleActionClick(tool, action)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="bg-muted mt-1 rounded-lg p-2">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{action.name}</h4>
                  <Badge variant="outline" className="text-xs">
                    {action.category}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                  {action.description}
                </p>
                <div className="text-muted-foreground mt-2 flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    {tool.name}
                  </span>
                  {action.developmentMode && (
                    <Badge variant="secondary" className="text-xs">
                      {action.developmentMode}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(tool, action);
                    }}
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        favorite && "fill-yellow-400 text-yellow-400",
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {favorite ? "Remove from favorites" : "Add to favorites"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderActionList = (tool: ToolPlugin, action: ToolAction) => {
    const selected = isActionSelected(tool, action);
    const favorite = isActionFavorite(tool, action);
    const Icon = tool.icon;

    return (
      <div
        key={`${tool.id}:${action.id}`}
        className={cn(
          "hover:bg-accent flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all",
          selected && "ring-primary bg-accent ring-2",
          // !tool.isAvailable && "opacity-60",
        )}
        onClick={() => handleActionClick(tool, action)}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{action.name}</span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {action.category}
            </Badge>
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {tool.name} • {action.description}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleFavorite(tool, action);
          }}
        >
          <Star
            className={cn(
              "h-4 w-4",
              favorite && "fill-yellow-400 text-yellow-400",
            )}
          />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search tools and actions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOnlyAvailable(!showOnlyAvailable)}
            className={cn(showOnlyAvailable && "bg-accent")}
          >
            <Filter className="mr-1 h-4 w-4" />
            Available Only
          </Button>
          <div className="flex gap-1 rounded-lg border p-1">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="all" onClick={() => setSelectedCategory(null)}>
            All Tools
          </TabsTrigger>
          {favoriteActions.length > 0 && (
            <TabsTrigger value="favorites">
              <Star className="mr-1 h-4 w-4" />
              Favorites
            </TabsTrigger>
          )}
          {recentActionResults.length > 0 && (
            <TabsTrigger value="recent">
              <Clock className="mr-1 h-4 w-4" />
              Recent
            </TabsTrigger>
          )}
          {Object.entries(TOOL_CATEGORIES).map(([key, category]) => {
            const Icon = category.icon;
            const count = categorizedTools[key]?.length ?? 0;
            if (count === 0) return null;
            return (
              <TabsTrigger
                key={key}
                value={key}
                onClick={() => setSelectedCategory(key)}
              >
                <Icon className="mr-1 h-4 w-4" />
                {category.name}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <ScrollArea className="h-[600px]">
            <div
              className={cn(
                viewMode === "grid"
                  ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  : "space-y-2",
              )}
            >
              {filteredResults.map(({ tool, action }) =>
                viewMode === "grid"
                  ? renderActionCard(tool, action)
                  : renderActionList(tool, action),
              )}
            </div>
            {filteredResults.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">
                  No actions found matching your search.
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="favorites" className="mt-4">
          <ScrollArea className="h-[600px]">
            <div
              className={cn(
                viewMode === "grid"
                  ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  : "space-y-2",
              )}
            >
              {favoriteActions.map(({ tool, action }) =>
                viewMode === "grid"
                  ? renderActionCard(tool, action)
                  : renderActionList(tool, action),
              )}
            </div>
            {favoriteActions.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">
                  No favorite actions yet. Click the star icon to add favorites.
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="recent" className="mt-4">
          <ScrollArea className="h-[600px]">
            <div
              className={cn(
                viewMode === "grid"
                  ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  : "space-y-2",
              )}
            >
              {recentActionResults.map(({ tool, action }) =>
                viewMode === "grid"
                  ? renderActionCard(tool, action)
                  : renderActionList(tool, action),
              )}
            </div>
            {recentActionResults.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">
                  No recent actions. Your recently used actions will appear
                  here.
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {Object.entries(TOOL_CATEGORIES).map(([key, category]) => {
          const categoryResults = filteredResults.filter((result) =>
            (categorizedTools[key] ?? []).includes(result.tool),
          );

          return (
            <TabsContent key={key} value={key} className="mt-4">
              <div className="mb-4">
                <h3 className="text-lg font-medium">{category.name}</h3>
                <p className="text-muted-foreground text-sm">
                  {category.description}
                </p>
              </div>
              <ScrollArea className="h-[600px]">
                <div
                  className={cn(
                    viewMode === "grid"
                      ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                      : "space-y-2",
                  )}
                >
                  {categoryResults.map(({ tool, action }) =>
                    viewMode === "grid"
                      ? renderActionCard(tool, action)
                      : renderActionList(tool, action),
                  )}
                </div>
                {categoryResults.length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-muted-foreground">
                      No actions found in this category.
                    </p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
