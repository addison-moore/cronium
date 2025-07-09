"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ToolAction,
  type ActionType,
  ToolPluginRegistry,
} from "@/components/tools/types/tool-plugin";

interface ActionSelectorProps {
  toolType: string;
  selectedActionId?: string;
  onActionSelect: (action: ToolAction) => void;
  className?: string;
}

export default function ActionSelector({
  toolType,
  selectedActionId,
  onActionSelect,
  className,
}: ActionSelectorProps) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [filterType, setFilterType] = React.useState<ActionType | "all">("all");

  // Get plugin and actions
  const plugin = ToolPluginRegistry.get(toolType);
  const actions = plugin?.actions ?? [];

  // Filter actions
  const filteredActions = actions.filter((action) => {
    const matchesSearch =
      action.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      action.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      action.category.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType =
      filterType === "all" || action.actionType === filterType;

    return matchesSearch && matchesType;
  });

  // Group actions by category
  const actionsByCategory = filteredActions.reduce(
    (acc, action) => {
      const category = action.category;
      acc[category] ??= [];
      acc[category].push(action);
      return acc;
    },
    {} as Record<string, ToolAction[]>,
  );

  // Get action type badge color
  const getActionTypeBadgeColor = (actionType: ActionType) => {
    switch (actionType) {
      case "create":
        return "bg-green-500 text-white hover:bg-green-600";
      case "update":
        return "bg-blue-500 text-white hover:bg-blue-600";
      case "search":
        return "bg-purple-500 text-white hover:bg-purple-600";
      case "delete":
        return "bg-red-500 text-white hover:bg-red-600";
      default:
        return "bg-gray-500 text-white hover:bg-gray-600";
    }
  };

  // Get development mode badge
  const getDevelopmentModeBadge = (mode: string) => {
    return mode === "visual" ? (
      <Badge variant="outline" className="text-xs">
        Visual
      </Badge>
    ) : (
      <Badge variant="outline" className="text-xs">
        Code
      </Badge>
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Available Actions
          <Badge variant="outline">{filteredActions.length} actions</Badge>
        </CardTitle>

        {/* Search and Filter */}
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
            <Input
              placeholder="Search actions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={filterType}
            onValueChange={(value) =>
              setFilterType(value as ActionType | "all")
            }
          >
            <SelectTrigger className="w-32">
              <Filter className="mr-1 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="search">Search</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <ScrollArea className="h-96">
          {Object.entries(actionsByCategory).length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              No actions found matching your criteria.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(actionsByCategory).map(
                ([category, categoryActions]) => (
                  <div key={category}>
                    <h4 className="text-muted-foreground mb-2 text-sm font-medium">
                      {category}
                    </h4>
                    <div className="space-y-2">
                      {categoryActions.map((action) => (
                        <Card
                          key={action.id}
                          className={`hover:bg-accent cursor-pointer p-3 transition-colors ${
                            selectedActionId === action.id
                              ? "border-primary bg-accent"
                              : ""
                          }`}
                          onClick={() => onActionSelect(action)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="mb-1 flex items-center gap-2">
                                <h5 className="text-sm font-medium">
                                  {action.name}
                                </h5>
                                <Badge
                                  className={getActionTypeBadgeColor(
                                    action.actionType,
                                  )}
                                >
                                  {action.actionType}
                                </Badge>
                                {getDevelopmentModeBadge(
                                  action.developmentMode,
                                )}
                              </div>
                              <p className="text-muted-foreground text-xs">
                                {action.description}
                              </p>
                              {action.helpText && (
                                <p className="text-muted-foreground mt-1 text-xs italic">
                                  💡 {action.helpText}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Action Examples Count */}
                          {action.examples && action.examples.length > 0 && (
                            <div className="mt-2">
                              <Badge variant="outline" className="text-xs">
                                {action.examples.length} example
                                {action.examples.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
