"use client";

import React, { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, ChevronRight } from "lucide-react";
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
import { type Tool } from "@/shared/schema";
import { ToolPluginRegistry } from "./plugins";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";

// Generic template form component - unchanged UI, only API calls changed
function TemplateForm({
  toolType,
  onSubmit,
  onCancel,
}: {
  toolType: string;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    content: "",
  });
  const [editorSettings, setEditorSettings] = useState({
    fontSize: 14,
    theme: "vs-dark",
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  });

  // Fetch user editor settings - keeping REST for now as this isn't part of Phase 3
  useEffect(() => {
    const fetchEditorSettings = async () => {
      try {
        const response = await fetch("/api/settings/editor");
        if (response.ok) {
          const settings = await response.json();
          setEditorSettings(settings);
        }
      } catch (error) {
        console.error("Failed to fetch editor settings:", error);
      }
    };

    fetchEditorSettings();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="templateName">Template Name</Label>
        <Input
          id="templateName"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter template name"
          required
        />
      </div>

      {toolType === "email" && (
        <div className="space-y-2">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            type="text"
            value={formData.subject}
            onChange={(e) =>
              setFormData({ ...formData, subject: e.target.value })
            }
            placeholder="Email subject"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="content">
          {toolType === "email" ? "Message Content" : "Message Template"}
        </Label>
        <MonacoEditor
          value={formData.content}
          onChange={(value) => setFormData({ ...formData, content: value })}
          language="html"
          height="200px"
          editorSettings={editorSettings}
          className="border-0"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Template</Button>
      </div>
    </form>
  );
}

export function ModularToolsManager() {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"credentials" | "templates">(
    "credentials",
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);
  const { toast } = useToast();

  // tRPC queries and mutations
  const {
    data: toolsData,
    isLoading,
    refetch: refetchTools,
  } = trpc.tools.getAll.useQuery({ limit: 100 });

  // Get tool stats
  const { data: statsData } = trpc.tools.getStats.useQuery({
    period: "month",
    groupBy: "type",
  });

  const createToolMutation = trpc.tools.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool created successfully",
      });
      refetchTools();
      setShowAddForm(false);
      setEditingTool(null);
    },
  });

  const updateToolMutation = trpc.tools.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool updated successfully",
      });
      refetchTools();
      setShowAddForm(false);
      setEditingTool(null);
    },
  });

  const deleteToolMutation = trpc.tools.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tool deleted successfully",
      });
      refetchTools();
    },
  });

  const createTemplateMutation = trpc.integrations.templates.create.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Template Created",
          description: "Template has been saved successfully",
        });
        setShowAddTemplateForm(false);
      },
    },
  );

  // Extract tools array from the response structure
  const tools = toolsData?.tools || [];

  const handleCredentialSubmit = async (data: {
    name: string;
    credentials: Record<string, any>;
  }) => {
    try {
      const plugin = ToolPluginRegistry.get(selectedTool!);
      if (!plugin) throw new Error("Plugin not found");

      const payload = {
        name: data.name,
        type: plugin.id.toUpperCase() as any,
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
      // Error is already handled by the mutation's onError callback
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
      // Error is already handled by the mutation's onError callback
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

  const handleTemplateSubmit = async (data: any) => {
    try {
      const templateData = {
        name: data.name,
        type: selectedTool?.toUpperCase() as any,
        content: data.content,
        subject: data.subject,
        description: "",
        variables: [],
        isSystemTemplate: false,
        tags: [],
      };

      await createTemplateMutation.mutateAsync(templateData);
    } catch (error) {
      // Error is already handled by the mutation's onError callback
      console.error("Error creating template:", error);
    }
  };

  const getFilteredTools = (pluginId: string) => {
    return tools
      .filter((tool) => tool.type.toLowerCase() === pluginId.toLowerCase())
      .map((tool) => ({
        ...tool,
        // Convert credentials object to string for CredentialDisplay component
        credentials:
          typeof tool.credentials === "string"
            ? tool.credentials
            : JSON.stringify(tool.credentials),
      }));
  };

  const allPlugins = ToolPluginRegistry.getAll();
  const selectedPluginInstance = selectedTool
    ? ToolPluginRegistry.get(selectedTool)
    : null;

  // Auto-select first tool if none selected
  useEffect(() => {
    if (!selectedTool && allPlugins.length > 0 && allPlugins[0]) {
      setSelectedTool(allPlugins[0].id);
    }
  }, [selectedTool, allPlugins]);

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
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsData?.totalTools || tools.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsData?.activeTools || tools.filter((t) => t.isActive).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Inactive Tools
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsData?.inactiveTools ||
                tools.filter((t) => !t.isActive).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-h-[calc(100vh-240px)] flex-col gap-3 lg:flex-row">
        {/* Integration List - Top on small screens, Right Side on large screens */}
        <div className="order-1 w-full flex-shrink-0 overflow-hidden lg:order-2 lg:w-80">
          <Card className="h-60 lg:h-full lg:min-h-[calc(100vh-240px)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings size={20} />
                Available Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-48 space-y-1 overflow-y-auto lg:h-[calc(100vh-320px)]">
                {allPlugins.map((plugin) => {
                  const Icon = plugin.icon;
                  const pluginTools = getFilteredTools(plugin.id);
                  const isSelected = selectedTool === plugin.id;

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
                        <div className="flex items-center gap-1">
                          <div className="text-muted-foreground text-xs">
                            {pluginTools.length} configured
                          </div>
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
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Integration Details Panel - Bottom on small screens, Left Side on large screens */}
        <div className="order-2 min-h-0 flex-1 lg:order-1">
          {selectedPluginInstance ? (
            <Card className="flex h-full flex-col lg:min-h-[calc(100vh-240px)]">
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
                    setActiveTab(value as "credentials" | "templates")
                  }
                  className="flex h-full flex-col"
                >
                  <TabsList className="grid w-full flex-shrink-0 grid-cols-2">
                    <TabsTrigger value="credentials">Credentials</TabsTrigger>
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
                            <Button onClick={handleAddTool}>
                              Add New Credential
                            </Button>
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
