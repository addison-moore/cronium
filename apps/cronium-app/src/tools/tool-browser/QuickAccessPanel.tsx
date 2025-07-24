"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import {
  Star,
  Clock,
  Zap,
  ChevronRight,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import {
  ToolPluginRegistry,
  type ToolPlugin,
  type ToolAction,
} from "@/tools/types/tool-plugin";
import { cn } from "@/lib/utils";

interface QuickAccessPanelProps {
  favorites: string[];
  recentActions: string[];
  popularActions?: string[];
  onActionSelect?: (tool: ToolPlugin, action: ToolAction) => void;
  onToggleFavorite?: (actionKey: string) => void;
  className?: string;
}

interface ActionItem {
  tool: ToolPlugin;
  action: ToolAction;
  key: string;
  lastUsed?: Date;
  useCount?: number;
}

export function QuickAccessPanel({
  favorites,
  recentActions,
  popularActions = [],
  onActionSelect,
  onToggleFavorite,
  className,
}: QuickAccessPanelProps) {
  // Convert action keys to action items
  const getActionItems = (actionKeys: string[]): ActionItem[] => {
    return actionKeys
      .map((key) => {
        const [toolId, actionId] = key.split(":");
        if (!toolId || !actionId) return null;

        const tool = ToolPluginRegistry.get(toolId);
        const action = tool?.actions?.find(
          (a: ToolAction) => a.id === actionId,
        );

        if (!tool || !action) return null;

        return {
          tool,
          action,
          key,
        };
      })
      .filter(Boolean) as ActionItem[];
  };

  const favoriteItems = getActionItems(favorites);
  const recentItems = getActionItems(recentActions.slice(0, 5));
  const popularItems = getActionItems(popularActions.slice(0, 5));

  const renderActionItem = (
    item: ActionItem,
    showFavorite = true,
    compact = false,
  ) => {
    const { tool, action, key } = item;
    const Icon = tool.icon;
    const isFavorite = favorites.includes(key);

    return (
      <div
        key={key}
        className={cn(
          "group hover:bg-accent flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors",
          compact && "p-1.5",
        )}
        onClick={() => onActionSelect?.(tool, action)}
      >
        <div className={cn("bg-muted rounded p-1.5", compact && "p-1")}>
          <Icon className={cn("h-4 w-4", compact && "h-3 w-3")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-medium", compact && "text-sm")}>
              {action.name}
            </span>
            {!compact && (
              <Badge variant="outline" className="text-xs">
                {action.category}
              </Badge>
            )}
          </div>
          <p
            className={cn(
              "text-muted-foreground truncate text-xs",
              compact && "text-[10px]",
            )}
          >
            {tool.name}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {showFavorite && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 w-8 opacity-0 group-hover:opacity-100",
                compact && "h-6 w-6",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.(key);
              }}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  isFavorite && "fill-yellow-400 text-yellow-400",
                  compact && "h-3 w-3",
                )}
              />
            </Button>
          )}
          <ChevronRight
            className={cn(
              "text-muted-foreground h-4 w-4",
              compact && "h-3 w-3",
            )}
          />
        </div>
      </div>
    );
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Favorites Section */}
      {favoriteItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-yellow-400" />
              Favorites
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ScrollArea className="h-[200px]">
              <div className="space-y-1">
                {favoriteItems.map((item) => renderActionItem(item))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Recent Actions */}
      {recentItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-blue-500" />
              Recent
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="space-y-1">
              {recentItems.map((item) => renderActionItem(item, true, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Popular Actions */}
      {popularItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Popular
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="space-y-1">
              {popularItems.map((item) => renderActionItem(item, true, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suggested Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Try These
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="space-y-2 text-sm">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const slackTool = ToolPluginRegistry.get("slack");
                const sendMessage = slackTool?.actions?.find(
                  (a: ToolAction) => a.id === "send-message",
                );
                if (slackTool && sendMessage) {
                  onActionSelect?.(slackTool, sendMessage);
                }
              }}
            >
              <Zap className="mr-2 h-4 w-4" />
              Send a Slack message
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const sheetsTool = ToolPluginRegistry.get("google-sheets");
                const writeData = sheetsTool?.actions?.find(
                  (a: ToolAction) => a.id === "write-data",
                );
                if (sheetsTool && writeData) {
                  onActionSelect?.(sheetsTool, writeData);
                }
              }}
            >
              <Zap className="mr-2 h-4 w-4" />
              Update Google Sheet
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const trelloTool = ToolPluginRegistry.get("trello");
                const createCard = trelloTool?.actions?.find(
                  (a: ToolAction) => a.id === "create-card",
                );
                if (trelloTool && createCard) {
                  onActionSelect?.(trelloTool, createCard);
                }
              }}
            >
              <Zap className="mr-2 h-4 w-4" />
              Create Trello card
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
