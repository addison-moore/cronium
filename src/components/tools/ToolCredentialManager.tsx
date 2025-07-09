"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import { useToast } from "@/components/ui/use-toast";
import { type Tool, type ToolType } from "@/shared/schema";
import {
  ToolPluginRegistry,
  type ToolWithParsedCredentials,
} from "./types/tool-plugin";
import { cn } from "@/lib/utils";
import {
  Shield,
  Key,
  Settings,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  MoreHorizontal,
  Plus,
  Trash,
  Edit,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  HelpCircle,
  AlertTriangle,
  Clock,
  Globe,
  Lock,
  Unlock,
  Download,
  Upload,
  Search,
  Filter,
  ChevronRight,
  Activity,
  Zap,
} from "lucide-react";

interface ToolCredentialManagerProps {
  className?: string;
}

interface CredentialFormData {
  name: string;
  type: ToolType;
  config: Record<string, string>;
}

interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "checking";
  message?: string;
  lastChecked?: Date;
  details?: Record<string, unknown>;
}

// Credential status colors
const statusColors = {
  configured: "bg-green-500",
  unconfigured: "bg-gray-500",
  error: "bg-red-500",
  checking: "bg-yellow-500",
};

// Tool categories for filtering
const TOOL_CATEGORIES = {
  all: "All Tools",
  communication: "Communication",
  productivity: "Productivity",
  data: "Data & Analytics",
  development: "Development",
  cloud: "Cloud Services",
};

export default function ToolCredentialManager({
  className,
}: ToolCredentialManagerProps) {
  const { toast } = useToast();
  const utils = trpc.useContext();

  // State
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({});
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedTool, setSelectedTool] =
    useState<ToolWithParsedCredentials | null>(null);
  const [formData, setFormData] = useState<CredentialFormData>({
    name: "",
    type: "email" as ToolType,
    config: {},
  });
  const [healthChecks, setHealthChecks] = useState<
    Record<number, HealthCheckResult>
  >({});
  const [isTestingConnection, setIsTestingConnection] = useState<number | null>(
    null,
  );

  // Queries
  const { data: tools = [], isLoading } = trpc.tools.list.useQuery(undefined, {
    ...QUERY_OPTIONS.static,
  }) as { data: ToolWithParsedCredentials[]; isLoading: boolean };

  // Note: Since the tools.list query returns decrypted credentials, we use the same data
  const toolsWithDecrypted = tools;

  // Mutations
  const createToolMutation = trpc.tools.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Tool Added",
        description: "Tool credentials have been saved securely.",
      });
      utils.tools.list.invalidate();
      utils.tools.list.invalidate();
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateToolMutation = trpc.tools.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Tool Updated",
        description: "Tool credentials have been updated.",
      });
      utils.tools.list.invalidate();
      utils.tools.list.invalidate();
      setIsEditDialogOpen(false);
      setSelectedTool(null);
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteToolMutation = trpc.tools.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Tool Deleted",
        description: "Tool credentials have been removed.",
      });
      utils.tools.list.invalidate();
      utils.tools.list.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testConnectionMutation = trpc.tools.testConnection.useMutation({
    onSuccess: (result, variables) => {
      setHealthChecks((prev) => ({
        ...prev,
        [variables.id]: {
          status: result.success ? "healthy" : "unhealthy",
          message: result.message,
          lastChecked: new Date(),
          details: result.details,
        },
      }));

      toast({
        title: result.success ? "Connection Successful" : "Connection Failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsTestingConnection(null);
    },
  });

  // Reset form
  const resetForm = () => {
    setFormData({
      name: "",
      type: "email" as ToolType,
      config: {},
    });
  };

  // Toggle secret visibility
  const toggleSecretVisibility = (toolId: number) => {
    setShowSecrets((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  // Test connection
  const testConnection = (tool: ToolWithParsedCredentials) => {
    setIsTestingConnection(tool.id);
    testConnectionMutation.mutate({ id: tool.id });
  };

  // Copy credential
  const copyCredential = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: "Copied",
        description: `${field} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  // Handle tool selection for add
  const handleToolTypeSelect = (type: ToolType) => {
    const plugin = ToolPluginRegistry.get(type);
    if (!plugin) return;

    setFormData({
      name: `${plugin.name} - ${new Date().toLocaleDateString()}`,
      type,
      config: plugin.defaultValues as Record<string, string>,
    });
  };

  // Handle edit
  const handleEdit = (tool: ToolWithParsedCredentials) => {
    const decryptedTool = toolsWithDecrypted.find((t) => t.id === tool.id);
    if (!decryptedTool) return;

    setSelectedTool(tool);
    setFormData({
      name: tool.name,
      type: tool.type,
      config: decryptedTool.credentials || {},
    });
    setIsEditDialogOpen(true);
  };

  // Handle save
  const handleSave = () => {
    if (selectedTool) {
      updateToolMutation.mutate({
        id: selectedTool.id,
        name: formData.name,
        credentials: formData.config,
      });
    } else {
      createToolMutation.mutate({
        name: formData.name,
        type: formData.type,
        credentials: formData.config,
      });
    }
  };

  // Filter tools
  const filteredTools = tools.filter((tool) => {
    const plugin = ToolPluginRegistry.get(tool.type);
    if (!plugin) return false;

    const matchesCategory =
      selectedCategory === "all" ||
      plugin.category?.toLowerCase() === selectedCategory;

    const matchesSearch =
      !searchQuery ||
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  // Group tools by type
  const groupedTools = filteredTools.reduce(
    (acc, tool) => {
      if (!acc[tool.type]) {
        acc[tool.type] = [];
      }
      acc[tool.type].push(tool);
      return acc;
    },
    {} as Record<ToolType, ToolWithParsedCredentials[]>,
  );

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Tool Credential Management
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Manage and test your tool integrations securely
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Tool
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Tabs
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            className="w-full sm:w-auto"
          >
            <TabsList>
              {Object.entries(TOOL_CATEGORIES).map(([key, label]) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Tools List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : filteredTools.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {searchQuery || selectedCategory !== "all"
                ? "No tools found matching your criteria."
                : "No tools configured yet. Click 'Add Tool' to get started."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTools).map(([type, typeTools]) => {
              const plugin = ToolPluginRegistry.get(type as ToolType);
              if (!plugin) return null;

              return (
                <div key={type} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <plugin.icon className="text-muted-foreground h-5 w-5" />
                    <h3 className="text-lg font-medium">{plugin.name}</h3>
                    <Badge variant="outline" className="ml-auto">
                      {typeTools.length} configured
                    </Badge>
                  </div>

                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Credentials</TableHead>
                          <TableHead>Last Tested</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {typeTools.map((tool) => {
                          const healthCheck = healthChecks[tool.id];
                          const decryptedTool = tool;

                          return (
                            <TableRow key={tool.id}>
                              <TableCell className="font-medium">
                                {tool.name}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {healthCheck?.status === "checking" ||
                                  isTestingConnection === tool.id ? (
                                    <>
                                      <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                                      <span className="text-muted-foreground text-sm">
                                        Checking...
                                      </span>
                                    </>
                                  ) : healthCheck?.status === "healthy" ? (
                                    <>
                                      <div className="h-2 w-2 rounded-full bg-green-500" />
                                      <span className="text-sm text-green-600">
                                        Connected
                                      </span>
                                    </>
                                  ) : healthCheck?.status === "unhealthy" ? (
                                    <>
                                      <div className="h-2 w-2 rounded-full bg-red-500" />
                                      <span className="text-sm text-red-600">
                                        Error
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <div className="h-2 w-2 rounded-full bg-gray-500" />
                                      <span className="text-muted-foreground text-sm">
                                        Not tested
                                      </span>
                                    </>
                                  )}
                                </div>
                                {healthCheck?.message && (
                                  <p className="text-muted-foreground mt-1 text-xs">
                                    {healthCheck.message}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  {Object.entries(
                                    (decryptedTool as any)?.credentials || {},
                                  ).map(([key, value]: [string, any]) => {
                                    const isSecret =
                                      key.toLowerCase().includes("secret") ||
                                      key.toLowerCase().includes("password") ||
                                      key.toLowerCase().includes("token");
                                    const isVisible = showSecrets[tool.id];

                                    return (
                                      <div
                                        key={key}
                                        className="flex items-center gap-2 text-sm"
                                      >
                                        <span className="text-muted-foreground">
                                          {key}:
                                        </span>
                                        {value ? (
                                          <div className="flex items-center gap-1">
                                            <code className="bg-muted rounded px-1 py-0.5 text-xs">
                                              {isSecret && !isVisible
                                                ? "••••••••"
                                                : String(value)}
                                            </code>
                                            {isSecret && (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0"
                                                onClick={() =>
                                                  toggleSecretVisibility(
                                                    tool.id,
                                                  )
                                                }
                                              >
                                                {isVisible ? (
                                                  <EyeOff className="h-3 w-3" />
                                                ) : (
                                                  <Eye className="h-3 w-3" />
                                                )}
                                              </Button>
                                            )}
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 w-6 p-0"
                                              onClick={() =>
                                                copyCredential(
                                                  String(value),
                                                  key,
                                                )
                                              }
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">
                                            Not set
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                              <TableCell>
                                {healthCheck?.lastChecked ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="text-muted-foreground flex items-center gap-1 text-sm">
                                          <Clock className="h-3 w-3" />
                                          {new Date(
                                            healthCheck.lastChecked,
                                          ).toLocaleDateString()}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {new Date(
                                          healthCheck.lastChecked,
                                        ).toLocaleString()}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  <span className="text-muted-foreground text-sm">
                                    Never
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => testConnection(tool)}
                                      disabled={isTestingConnection === tool.id}
                                    >
                                      <Activity className="mr-2 h-4 w-4" />
                                      Test Connection
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleEdit(tool)}
                                    >
                                      <Edit className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                    {plugin.actions?.[0]?.helpUrl && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          const url =
                                            plugin.actions?.[0]?.helpUrl;
                                          if (url) window.open(url, "_blank");
                                        }}
                                      >
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        View Docs
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() =>
                                        deleteToolMutation.mutate({
                                          id: tool.id,
                                        })
                                      }
                                      className="text-destructive"
                                    >
                                      <Trash className="mr-2 h-4 w-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog
        open={isAddDialogOpen || isEditDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setIsEditDialogOpen(false);
            setSelectedTool(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {selectedTool ? "Edit Tool Credentials" : "Add Tool Credentials"}
            </DialogTitle>
            <DialogDescription>
              {selectedTool
                ? "Update your tool credentials and test the connection."
                : "Select a tool and provide your credentials to get started."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Tool Selection (only for add) */}
            {!selectedTool && (
              <div className="space-y-4">
                <Label>Select Tool Type</Label>
                <div className="grid grid-cols-2 gap-3">
                  {ToolPluginRegistry.getAll().map((plugin: any) => (
                    <Button
                      key={plugin.id}
                      variant={
                        formData.type === plugin.id ? "default" : "outline"
                      }
                      className="justify-start"
                      onClick={() =>
                        handleToolTypeSelect(plugin.id as ToolType)
                      }
                    >
                      <plugin.icon className="mr-2 h-4 w-4" />
                      {plugin.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Configuration Form */}
            {formData.type && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Credential Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Production Slack"
                  />
                </div>

                {/* Render generic inputs for the config object */}
                {Object.entries(formData.config).map(([key, value]) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={key}>
                      {key.charAt(0).toUpperCase() +
                        key
                          .slice(1)
                          .replace(/([A-Z])/g, " $1")
                          .trim()}
                      {/* Mark common required fields */}
                      {(key === "apiKey" ||
                        key === "token" ||
                        key === "clientId") && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                    </Label>
                    <Input
                      id={key}
                      type={
                        key.toLowerCase().includes("secret") ||
                        key.toLowerCase().includes("password") ||
                        key.toLowerCase().includes("token")
                          ? "password"
                          : "text"
                      }
                      value={value || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: {
                            ...formData.config,
                            [key]: e.target.value,
                          },
                        })
                      }
                      placeholder={`Enter ${key}`}
                    />
                  </div>
                ))}

                {/* Setup Guide */}
                {(() => {
                  const plugin = ToolPluginRegistry.get(formData.type);
                  const helpUrl = plugin?.actions?.[0]?.helpUrl;
                  return helpUrl ? (
                    <Alert>
                      <HelpCircle className="h-4 w-4" />
                      <AlertDescription>
                        Need help setting up?{" "}
                        <a
                          href={helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline"
                        >
                          View setup guide
                        </a>
                      </AlertDescription>
                    </Alert>
                  ) : null;
                })()}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setIsEditDialogOpen(false);
                setSelectedTool(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !formData.name ||
                !formData.type ||
                createToolMutation.isPending ||
                updateToolMutation.isPending
              }
            >
              {createToolMutation.isPending || updateToolMutation.isPending
                ? "Saving..."
                : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
