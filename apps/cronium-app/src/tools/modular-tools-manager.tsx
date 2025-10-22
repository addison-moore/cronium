"use client";

import React, { useState, useEffect } from "react";
import { useToast } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import {
  Settings,
  ChevronRight,
  Plus,
  Zap,
  Search,
  Edit,
  Trash2,
  FileText,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cronium/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cronium/ui";
// ToolType import removed - using strings directly
import { type ToolWithParsedCredentials } from "./types/tool-plugin";
import { ToolPluginRegistry } from "./plugins";
import { cn } from "@/lib/utils";
import { Input } from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { Badge } from "@cronium/ui";
import { ToolErrorDiagnostics } from "./ToolErrorDiagnostics";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import { ToolActionTemplateForm } from "./templates/ToolActionTemplateForm";

export function ModularToolsManager() {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [editingTool, setEditingTool] =
    useState<ToolWithParsedCredentials | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<
    "credentials" | "templates" | "actions"
  >("credentials");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(
    null,
  );
  const [selectedActionType, setSelectedActionType] = useState<string>("all");
  const { toast } = useToast();

  // tRPC queries and mutations
  const {
    data: toolsData,
    isLoading,
    refetch: refetchTools,
  } = trpc.tools.getAll.useQuery({ limit: 100 });

  const createToolMutation = trpc.tools.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool created successfully",
      });
      void refetchTools();
      setShowAddForm(false);
      setEditingTool(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to create tool",
        variant: "destructive",
      });
    },
  });

  const updateToolMutation = trpc.tools.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool updated successfully",
      });
      void refetchTools();
      setShowAddForm(false);
      setEditingTool(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update tool",
        variant: "destructive",
      });
    },
  });

  const deleteToolMutation = trpc.tools.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool deleted successfully",
      });
      void refetchTools();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to delete tool",
        variant: "destructive",
      });
    },
  });

  // Fetch templates for the selected tool
  const { data: templatesData, refetch: refetchTemplates } =
    trpc.toolActionTemplates.getByToolAction.useQuery(
      {
        toolType: selectedTool ?? "",
        actionId:
          selectedActionType === "all" ? "" : (selectedActionType ?? ""),
      },
      {
        enabled: !!selectedTool,
      },
    );

  // Delete template mutation
  const deleteTemplateMutation = trpc.toolActionTemplates.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Template Deleted",
        description: "The template has been deleted successfully",
      });
      void refetchTemplates();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to delete template",
        variant: "destructive",
      });
    },
  });

  // Extract tools array from the response structure
  const tools = toolsData?.tools ?? [];
  const templates = templatesData ?? [];

  const handleCredentialSubmit = async (data: {
    name: string;
    credentials: Record<string, unknown>;
  }) => {
    try {
      const plugin = ToolPluginRegistry.get(selectedTool!);
      if (!plugin) throw new Error("Plugin not found");

      const payload = {
        name: data.name,
        type: plugin.id.toUpperCase(),
        credentials: data.credentials,
      };

      if (editingTool) {
        await updateToolMutation.mutateAsync({
          id: editingTool.id,
          ...payload,
        });
      } else {
        await createToolMutation.mutateAsync(payload);
      }
    } catch (error) {
      // Error is handled by mutation callbacks
      console.error("Error saving tool:", error);
    }
  };

  const handleEdit = (tool: ToolWithParsedCredentials) => {
    setEditingTool(tool);
    setSelectedTool(tool.type.toLowerCase());
    setShowAddForm(true);
    setActiveTab("credentials");
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteToolMutation.mutateAsync({ id });
    } catch (error) {
      // Error is handled by mutation callbacks
      console.error("Error deleting tool:", error);
    }
    setDeleteConfirmId(null);
  };

  const handleAddTool = () => {
    setEditingTool(null);
    setShowAddForm(true);
    setShowAddTemplateForm(false);
    setActiveTab("credentials");
  };

  const getFilteredTools = (pluginId: string): ToolWithParsedCredentials[] => {
    return tools
      .filter((tool) => tool.type.toLowerCase() === pluginId.toLowerCase())
      .map((tool) => {
        let parsedCredentials = {};
        try {
          if (typeof tool.credentials === "string") {
            parsedCredentials = JSON.parse(tool.credentials) as Record<
              string,
              unknown
            >;
          } else if (
            typeof tool.credentials === "object" &&
            tool.credentials !== null
          ) {
            parsedCredentials = tool.credentials;
          }
        } catch (error) {
          console.error(
            "Failed to parse credentials for tool:",
            tool.name,
            error,
          );
        }
        return {
          ...tool,
          credentials: parsedCredentials,
        };
      });
  };

  const allPlugins = ToolPluginRegistry.getAll();

  // Filter plugins based on search query
  const filteredPlugins = allPlugins.filter((plugin) => {
    if (!toolSearchQuery) return true;
    const searchLower = toolSearchQuery.toLowerCase();
    return (
      plugin.name.toLowerCase().includes(searchLower) ||
      plugin.description.toLowerCase().includes(searchLower) ||
      plugin.category?.toLowerCase().includes(searchLower)
    );
  });

  const selectedPluginInstance = selectedTool
    ? ToolPluginRegistry.get(selectedTool)
    : null;

  // Auto-select first tool if none selected
  useEffect(() => {
    if (!selectedTool && filteredPlugins.length > 0 && filteredPlugins[0]) {
      setSelectedTool(filteredPlugins[0].id);
      // Clear any open forms when auto-selecting
      setEditingTool(null);
      setShowAddForm(false);
      setShowAddTemplateForm(false);
      setEditingTemplateId(null);
    }
  }, [selectedTool, filteredPlugins]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="border-primary mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground">Loading tools...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid min-h-[calc(100vh-200px)] gap-4 lg:grid-cols-[1fr_320px]">
        {/* Integration Details Panel - Bottom on small screens, Left Side on large screens */}
        <div className="order-2 min-h-0 flex-1 lg:order-1">
          {selectedPluginInstance ? (
            <Card className="flex h-full flex-col lg:min-h-[calc(100vh-200px)]">
              <CardHeader className="flex-shrink-0 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <selectedPluginInstance.icon
                      size={24}
                      className="text-primary"
                    />
                    <div>
                      <CardTitle className="text-xl">
                        {selectedPluginInstance.name}
                      </CardTitle>
                      <div className="text-muted-foreground text-sm">
                        {selectedPluginInstance.description}
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Tabs
                  value={activeTab}
                  onValueChange={(value) =>
                    setActiveTab(
                      value as "credentials" | "templates" | "actions",
                    )
                  }
                  className="flex h-full flex-col"
                >
                  <TabsList className="grid w-full flex-shrink-0 grid-cols-3">
                    <TabsTrigger value="credentials">Credentials</TabsTrigger>
                    <TabsTrigger value="actions">Actions</TabsTrigger>
                    <TabsTrigger value="templates">Templates</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="credentials"
                    className="mt-4 flex-1 overflow-hidden"
                  >
                    <div className="h-full space-y-4 overflow-y-auto p-1">
                      {editingTool ? (
                        // Show form for editing
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium">Edit Tool</h3>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingTool(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                          <selectedPluginInstance.CredentialForm
                            tool={editingTool}
                            onSubmit={handleCredentialSubmit}
                            onCancel={() => setEditingTool(null)}
                          />
                        </div>
                      ) : showAddForm ? (
                        // Show form for adding new
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium">Add New Credential</h3>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowAddForm(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                          <selectedPluginInstance.CredentialForm
                            tool={null}
                            onSubmit={handleCredentialSubmit}
                            onCancel={() => setShowAddForm(false)}
                          />
                        </div>
                      ) : (
                        // Show credential display
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-medium">
                              {selectedPluginInstance.name} Credentials
                            </h3>
                            <div className="flex items-center gap-2">
                              {selectedPluginInstance.actions &&
                                selectedPluginInstance.actions.length > 0 && (
                                  <Link href="/dashboard/events/new?type=TOOL_ACTION">
                                    <Button variant="outline" size="sm">
                                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                                      Create Event
                                    </Button>
                                  </Link>
                                )}
                              <Button onClick={handleAddTool}>
                                Add New Credential
                              </Button>
                            </div>
                          </div>
                          <div>
                            {getFilteredTools(selectedPluginInstance.id)
                              .length > 0 ? (
                              <selectedPluginInstance.CredentialDisplay
                                tools={getFilteredTools(
                                  selectedPluginInstance.id,
                                )}
                                onEdit={handleEdit}
                                onDelete={(id) => setDeleteConfirmId(id)}
                              />
                            ) : (
                              <div className="text-muted-foreground py-8 text-center">
                                No credentials configured for this tool
                              </div>
                            )}
                          </div>
                          {(() => {
                            const tools = getFilteredTools(
                              selectedPluginInstance.id,
                            );
                            const firstToolId = tools[0]?.id;
                            return tools.length > 0 && firstToolId ? (
                              <div className="mt-4">
                                <ToolErrorDiagnostics
                                  toolId={firstToolId}
                                  compact
                                />
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="templates"
                    className="mt-4 flex-1 overflow-hidden"
                  >
                    <div className="h-full space-y-4 overflow-y-auto p-1">
                      {/* Action Type Filter and New Template Button */}
                      <div className="flex items-center justify-end gap-4">
                        <div className="flex items-center gap-2">
                          <Select
                            value={selectedActionType}
                            onValueChange={setSelectedActionType}
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue placeholder="Filter by action type..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Actions</SelectItem>
                              {selectedPluginInstance?.actions?.map(
                                (action) => (
                                  <SelectItem key={action.id} value={action.id}>
                                    {action.name}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          onClick={() => {
                            if (
                              !selectedActionType ||
                              selectedActionType === "all"
                            ) {
                              toast({
                                title: "Select an action type",
                                description:
                                  "Please select an action type before creating a template",
                                variant: "destructive",
                              });
                              return;
                            }
                            setShowAddTemplateForm(true);
                            setEditingTemplateId(null);
                          }}
                          disabled={
                            !selectedActionType || selectedActionType === "all"
                          }
                          size="sm"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          New Template
                        </Button>
                      </div>

                      {/* Template Form (when adding/editing) */}
                      {(showAddTemplateForm || editingTemplateId) &&
                        selectedPluginInstance && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">
                                {editingTemplateId
                                  ? "Edit Template"
                                  : "Create New Template"}
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ToolActionTemplateForm
                                toolType={selectedPluginInstance.id}
                                actionId={selectedActionType}
                                templateId={editingTemplateId}
                                onSuccess={() => {
                                  setShowAddTemplateForm(false);
                                  setEditingTemplateId(null);
                                  void refetchTemplates();
                                }}
                                onCancel={() => {
                                  setShowAddTemplateForm(false);
                                  setEditingTemplateId(null);
                                }}
                              />
                            </CardContent>
                          </Card>
                        )}

                      {/* Templates Table */}
                      <div>
                        {templates.length === 0 ? (
                          <div className="text-muted-foreground flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
                            <FileText className="mb-3 h-12 w-12 opacity-50" />
                            <p className="text-lg font-medium">
                              No templates yet
                            </p>
                            <p className="mt-1 text-sm">
                              {selectedActionType
                                ? "Create your first template for this action"
                                : "Select an action type and create a template"}
                            </p>
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-12">Icon</TableHead>
                                <TableHead>Template Name</TableHead>
                                <TableHead>Action Type</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {templates
                                .filter(
                                  (template) =>
                                    !selectedActionType ||
                                    selectedActionType === "all" ||
                                    template.actionId === selectedActionType,
                                )
                                .map((template) => {
                                  const action =
                                    selectedPluginInstance?.actions?.find(
                                      (a) => a.id === template.actionId,
                                    );
                                  return (
                                    <TableRow key={template.id}>
                                      <TableCell>
                                        {selectedPluginInstance && (
                                          <selectedPluginInstance.icon className="text-muted-foreground h-5 w-5" />
                                        )}
                                      </TableCell>
                                      <TableCell className="font-medium">
                                        {template.name}
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {action?.name ?? template.actionId}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-muted-foreground max-w-[300px] truncate text-sm">
                                        {template.description ?? "-"}
                                      </TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        {new Date(
                                          template.createdAt,
                                        ).toLocaleDateString()}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              setEditingTemplateId(template.id);
                                              setSelectedActionType(
                                                template.actionId,
                                              );
                                              setShowAddTemplateForm(false);
                                            }}
                                          >
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              if (
                                                confirm(
                                                  "Are you sure you want to delete this template?",
                                                )
                                              ) {
                                                deleteTemplateMutation.mutate({
                                                  id: template.id,
                                                });
                                              }
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="actions"
                    className="mt-4 flex-1 overflow-hidden"
                  >
                    <div className="h-full space-y-4 overflow-y-auto p-1">
                      {selectedPluginInstance.actions &&
                      selectedPluginInstance.actions.length > 0 ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-medium">
                              Available Actions
                            </h3>
                            <Badge variant="secondary" className="text-xs">
                              {selectedPluginInstance.actions.length} action
                              {selectedPluginInstance.actions.length !== 1
                                ? "s"
                                : ""}
                            </Badge>
                          </div>

                          <div className="grid gap-3">
                            {selectedPluginInstance.actions.map((action) => (
                              <div
                                key={action.id}
                                className="border-border hover:bg-muted/50 rounded-lg border p-4 transition-colors"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-medium">
                                        {action.name}
                                      </h4>
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {action.actionType}
                                      </Badge>
                                    </div>
                                    <p className="text-muted-foreground mt-1 text-sm">
                                      {action.description}
                                    </p>
                                    {action.category && (
                                      <div className="mt-2">
                                        <Badge
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {action.category}
                                        </Badge>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={`/dashboard/events/new?type=TOOL_ACTION&toolType=${selectedPluginInstance.id}&actionId=${action.id}`}
                                    >
                                      <Button size="sm" variant="outline">
                                        <Plus className="mr-1 h-3 w-3" />
                                        Use
                                      </Button>
                                    </Link>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Zap className="text-muted-foreground mb-4 h-12 w-12" />
                          <h3 className="text-lg font-medium">
                            No Actions Available
                          </h3>
                          <p className="text-muted-foreground text-sm">
                            This tool doesn't have any available actions
                          </p>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Settings
                    size={48}
                    className="text-muted-foreground mx-auto mb-4"
                  />
                  <h3 className="mb-2 font-medium">Select a Tool</h3>
                  <p className="text-muted-foreground text-sm">
                    Choose a tool from the list to configure credentials and
                    templates
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Available Tools - Top on small screens, Right Side on large screens */}
        <div className="order-1 lg:order-2">
          <Card className="flex h-full flex-col lg:min-h-[calc(100vh-200px)]">
            <CardHeader className="flex-shrink-0 pb-3">
              <CardTitle className="text-lg">Available Tools</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search bar */}
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search tools..."
                  value={toolSearchQuery}
                  onChange={(e) => setToolSearchQuery(e.target.value)}
                  className="pl-[2.5rem]"
                />
              </div>
              {/* Tools list */}
              <div className="h-40 space-y-1 overflow-y-auto lg:h-[calc(100vh-380px)]">
                {filteredPlugins.map((plugin) => {
                  const Icon = plugin.icon;
                  const pluginTools = getFilteredTools(plugin.id);
                  const isSelected = selectedTool === plugin.id;

                  const actionCount = plugin.actions?.length || 0;

                  return (
                    <div
                      key={plugin.id}
                      className={cn(
                        "hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-l-2 p-4 transition-all",
                        isSelected
                          ? "border-l-primary bg-muted/50"
                          : "border-l-transparent",
                      )}
                      onClick={() => {
                        setSelectedTool(plugin.id);
                        // Close any open forms when switching tools
                        setEditingTool(null);
                        setShowAddForm(false);
                        // Close template form when switching tools
                        setShowAddTemplateForm(false);
                        setEditingTemplateId(null);
                        // Reset action type filter
                        setSelectedActionType("all");
                      }}
                    >
                      <Icon size={20} className="text-primary flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {plugin.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-muted-foreground text-xs">
                            {pluginTools.length} credential
                            {pluginTools.length !== 1 ? "s" : ""}
                          </div>
                          {actionCount > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {actionCount} action{actionCount !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <ChevronRight
                          size={16}
                          className="text-muted-foreground flex-shrink-0"
                        />
                      )}
                    </div>
                  );
                })}
                {filteredPlugins.length === 0 && toolSearchQuery && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Search className="text-muted-foreground mb-2 h-8 w-8" />
                    <p className="text-muted-foreground text-sm">
                      No tools found matching "{toolSearchQuery}"
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <AlertDialog
          open={deleteConfirmId !== null}
          onOpenChange={() => setDeleteConfirmId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Tool</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this tool? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
