"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, ChevronRight, Plus, Zap, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type Tool as ToolBase, type ToolType } from "@/shared/schema";

// Tool with parsed credentials
type Tool = Omit<ToolBase, 'credentials'> & {
  credentials: Record<string, any>;
  description?: string;
  tags: string[];
};
import { ToolPluginRegistry } from "./plugins";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ToolHealthBadge } from "./ToolHealthIndicator";
import { ToolErrorDiagnostics } from "./ToolErrorDiagnostics";
import Link from "next/link";

// Create dynamic schema based on tool type
const createTemplateSchema = (toolType: string) => {
  const baseSchema = {
    name: z
      .string()
      .min(1, "Template name is required")
      .max(100, "Template name is too long"),
    content: z.string().min(1, "Content is required"),
  };

  if (toolType === "email") {
    return z.object({
      ...baseSchema,
      subject: z
        .string()
        .min(1, "Subject is required")
        .max(200, "Subject is too long"),
    });
  }

  return z.object(baseSchema);
};

type TemplateFormData = {
  name: string;
  subject?: string;
  content: string;
};

// Generic template form component - refactored to use React Hook Form and tRPC
function TemplateForm({
  toolType,
  onSubmit,
  onCancel,
}: {
  toolType: string;
  onSubmit: (data: TemplateFormData) => void;
  onCancel: () => void;
}) {
  // Use tRPC query for editor settings
  const { data: editorSettings } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    {
      ...QUERY_OPTIONS.static,
    },
  );

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(createTemplateSchema(toolType)),
    defaultValues: {
      name: "",
      subject: "",
      content: "",
    },
  });

  const handleSubmit = (data: TemplateFormData) => {
    onSubmit(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Enter template name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {toolType === "email" && (
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subject</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Email subject" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {toolType === "email" ? "Message Content" : "Message Template"}
              </FormLabel>
              <FormControl>
                <MonacoEditor
                  value={field.value}
                  onChange={field.onChange}
                  language="html"
                  height="200px"
                  editorSettings={
                    editorSettings ?? {
                      fontSize: 14,
                      theme: "vs-dark",
                      wordWrap: true,
                      minimap: false,
                      lineNumbers: true,
                    }
                  }
                  className="border-0"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Save Template
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function ModularToolsManager() {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<
    "credentials" | "templates" | "actions"
  >("credentials");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState("");
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

  const createTemplateMutation = trpc.toolActionTemplates.create.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Template Created",
          description: "Template has been saved successfully",
        });
        setShowAddTemplateForm(false);
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message ?? "Failed to create template",
          variant: "destructive",
        });
      },
    },
  );

  // Extract tools array from the response structure
  const tools = toolsData?.tools ?? [];

  const handleCredentialSubmit = async (data: {
    name: string;
    credentials: Record<string, unknown>;
  }) => {
    try {
      const plugin = ToolPluginRegistry.get(selectedTool!);
      if (!plugin) throw new Error("Plugin not found");

      const payload = {
        name: data.name,
        type: plugin.id.toUpperCase() as ToolType,
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

  const handleEdit = (tool: Tool) => {
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

  const handleAddTemplate = () => {
    setShowAddTemplateForm(true);
    setShowAddForm(false);
    setEditingTool(null);
    setActiveTab("templates");
  };

  const handleTemplateSubmit = async (data: TemplateFormData) => {
    try {
      // Get the selected tool action
      const plugin = ToolPluginRegistry.get(selectedTool ?? "");
      const firstAction = plugin?.actions?.[0];
      
      if (!firstAction) {
        throw new Error("No actions available for this tool");
      }

      const templateData = {
        name: data.name,
        toolType: selectedTool ?? "",
        actionId: firstAction.id,
        parameters: {
          content: data.content,
          subject: data.subject ?? "",
        },
        description: `Template for ${data.name}`,
      };

      await createTemplateMutation.mutateAsync(templateData);
    } catch (error) {
      // Error is handled by mutation callbacks
      console.error("Error creating template:", error);
    }
  };

  const getFilteredTools = (pluginId: string) => {
    return tools
      .filter((tool) => tool.type.toLowerCase() === pluginId.toLowerCase())
      .map((tool) => ({
        ...tool,
        // Keep credentials as-is, don't stringify if already an object
        credentials: tool.credentials,
      }));
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
      <div className="flex min-h-[calc(100vh-200px)] flex-col gap-3 lg:flex-row">
        {/* Integration List - Top on small screens, Right Side on large screens */}
        <div className="order-1 w-full flex-shrink-0 overflow-hidden lg:order-2 lg:w-80">
          <Card className="h-60 lg:h-full lg:min-h-[calc(100vh-200px)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings size={20} />
                Available Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search bar */}
              <div className="relative">
                <Input
                  placeholder="Search tools..."
                  value={toolSearchQuery}
                  onChange={(e) => setToolSearchQuery(e.target.value)}
                  className="pl-9"
                />
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Search className="text-muted-foreground h-4 w-4" />
                </div>
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
                      onClick={() => setSelectedTool(plugin.id)}
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
                          {pluginTools.some((t) => t.isActive) && (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-50 text-xs text-green-700"
                            >
                              Active
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
                    <TabsTrigger value="templates">Templates</TabsTrigger>
                    <TabsTrigger value="actions">Actions</TabsTrigger>
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
                            const tools = getFilteredTools(selectedPluginInstance.id);
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
                      {selectedPluginInstance.TemplateManager ? (
                        showAddTemplateForm ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium">Add New Template</h3>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowAddTemplateForm(false)}
                              >
                                Cancel
                              </Button>
                            </div>
                            <TemplateForm
                              toolType={selectedPluginInstance.id}
                              onSubmit={handleTemplateSubmit}
                              onCancel={() => setShowAddTemplateForm(false)}
                            />
                          </div>
                        ) : (
                          <selectedPluginInstance.TemplateManager
                            toolType={selectedPluginInstance.id}
                            onAddTemplate={handleAddTemplate}
                          />
                        )
                      ) : (
                        <div className="text-muted-foreground py-8 text-center">
                          Templates not available for this tool type
                        </div>
                      )}
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
