"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Webhook,
  Plus,
  MoreHorizontal,
  Copy,
  Trash2,
  Shield,
  BarChart3,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/components/providers/TrpcProvider";
import { WebhookForm } from "./WebhookForm";
import { WebhookSecurityForm } from "./WebhookSecurityForm";
import { WebhookMonitor } from "./WebhookMonitor";

// Define webhook interface based on the router's mock data structure
interface Webhook {
  id: number;
  userId: string;
  workflowId: number;
  key: string;
  url: string;
  description?: string;
  isActive: boolean;
  allowedMethods: ("GET" | "POST" | "PUT" | "PATCH")[];
  allowedIps?: string[];
  rateLimitPerMinute: number;
  requireAuth: boolean;
  authToken?: string | null;
  customHeaders?: Record<string, string>;
  responseFormat: "json" | "text" | "xml";
  triggerCount: number;
  lastTriggered?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookDashboardProps {
  workflowId?: number;
}

export function WebhookDashboard({ workflowId }: WebhookDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [showSecurityDialog, setShowSecurityDialog] = useState(false);
  const [showMonitorDialog, setShowMonitorDialog] = useState(false);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const { toast } = useToast();

  // tRPC queries and mutations
  const {
    data: webhooksData,
    isLoading,
    refetch: refetchWebhooks,
  } = trpc.webhooks.getAll.useQuery({
    workflowId,
    includeInactive: true,
    search: searchQuery || undefined,
  });

  const { data: statsData } = trpc.webhooks.getStats.useQuery({
    workflowId,
  });

  const createWebhookMutation = trpc.webhooks.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Webhook Created",
        description: "Webhook has been created successfully",
      });
      void refetchWebhooks();
      setShowCreateDialog(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create webhook",
        variant: "destructive",
      });
    },
  });

  const deleteWebhookMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Webhook Deleted",
        description: "Webhook has been deleted successfully",
      });
      void refetchWebhooks();
      setDeleteConfirmKey(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete webhook",
        variant: "destructive",
      });
    },
  });

  const webhooks = (webhooksData?.webhooks ?? []) as Webhook[];
  const stats = statsData ?? {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageResponseTime: 0,
  };

  const filteredWebhooks = webhooks.filter((webhook) => {
    if (statusFilter === "active" && !webhook.isActive) return false;
    if (statusFilter === "inactive" && webhook.isActive) return false;
    return true;
  });

  const copyWebhookUrl = (webhook: Webhook) => {
    const url = `${window.location.origin}/api/workflows/webhook/${String(webhook.key)}`;
    void navigator.clipboard.writeText(url);
    toast({
      title: "URL Copied",
      description: "Webhook URL has been copied to clipboard",
    });
  };

  const handleCreateWebhook = async (data: {
    workflowId: number;
    key: string;
    description?: string | undefined;
    isActive: boolean;
    allowedMethods: ("GET" | "POST" | "PUT" | "PATCH")[];
    rateLimitPerMinute: number;
    requireAuth: boolean;
    authToken?: string | undefined;
    responseFormat: "json" | "text" | "xml";
  }) => {
    try {
      await createWebhookMutation.mutateAsync(data);
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteWebhook = async (key: string) => {
    try {
      await deleteWebhookMutation.mutateAsync({ key });
    } catch {
      // Error handled by mutation
    }
  };

  const getStatusIcon = (webhook: Webhook) => {
    if (!webhook.isActive) {
      return <XCircle className="h-4 w-4 text-gray-500" />;
    }

    // This could be enhanced with real-time health status
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  };

  const formatDateTime = (date: string | Date) => {
    return new Date(date).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin" />
          <p className="text-muted-foreground">Loading webhooks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Webhook Management
          </h2>
          <p className="text-muted-foreground">
            Manage workflow webhook endpoints and monitor their performance
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Webhook
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Webhook</DialogTitle>
            </DialogHeader>
            <WebhookForm
              {...(workflowId !== undefined ? { workflowId } : {})}
              onSubmit={handleCreateWebhook}
              onCancel={() => setShowCreateDialog(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Webhook className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Total Webhooks
              </p>
            </div>
            <p className="text-2xl font-bold">{webhooks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <BarChart3 className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Total Executions
              </p>
            </div>
            <p className="text-2xl font-bold">{stats.totalExecutions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <p className="text-muted-foreground text-sm font-medium">
                Success Rate
              </p>
            </div>
            <p className="text-2xl font-bold">
              {stats.totalExecutions > 0
                ? Math.round(
                    (stats.successfulExecutions / stats.totalExecutions) * 100,
                  )
                : 0}
              %
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Clock className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Avg Response Time
              </p>
            </div>
            <p className="text-2xl font-bold">
              {formatDuration(stats.averageResponseTime)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="flex-1">
          <Input
            placeholder="Search webhooks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Webhooks Table */}
      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredWebhooks.length === 0 ? (
            <div className="py-8 text-center">
              <Webhook className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <h3 className="mb-2 text-lg font-semibold">No webhooks found</h3>
              <p className="text-muted-foreground mb-4">
                Create your first webhook to start receiving workflow triggers
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Webhook
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Methods</TableHead>
                  <TableHead>Triggers</TableHead>
                  <TableHead>Last Triggered</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWebhooks.map((webhook) => (
                  <TableRow key={webhook.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(webhook)}
                        <Badge
                          variant={webhook.isActive ? "default" : "secondary"}
                        >
                          {webhook.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <code className="bg-muted rounded px-2 py-1 text-sm">
                          {webhook.key}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyWebhookUrl(webhook)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs truncate">
                        {webhook.description ?? "No description"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {webhook.allowedMethods.map((method: string) => (
                          <Badge
                            key={method}
                            variant="outline"
                            className="text-xs"
                          >
                            {method}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <div className="font-semibold">
                          {webhook.triggerCount ?? 0}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          total
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {webhook.lastTriggered
                          ? formatDateTime(webhook.lastTriggered)
                          : "Never"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => copyWebhookUrl(webhook)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy URL
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedWebhook(webhook);
                              setShowSecurityDialog(true);
                            }}
                          >
                            <Shield className="mr-2 h-4 w-4" />
                            Security Settings
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedWebhook(webhook);
                              setShowMonitorDialog(true);
                            }}
                          >
                            <BarChart3 className="mr-2 h-4 w-4" />
                            View Analytics
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                `/api/workflows/webhook/${String(webhook.key)}`,
                                "_blank",
                              )
                            }
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Test Endpoint
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteConfirmKey(webhook.key)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Security Dialog */}
      <Dialog open={showSecurityDialog} onOpenChange={setShowSecurityDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Webhook Security Settings</DialogTitle>
          </DialogHeader>
          {selectedWebhook && (
            <WebhookSecurityForm
              webhook={selectedWebhook}
              onSave={() => {
                setShowSecurityDialog(false);
                void refetchWebhooks();
              }}
              onCancel={() => setShowSecurityDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Monitor Dialog */}
      <Dialog open={showMonitorDialog} onOpenChange={setShowMonitorDialog}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Webhook Analytics</DialogTitle>
          </DialogHeader>
          {selectedWebhook && (
            <WebhookMonitor
              webhookKey={selectedWebhook.key}
              onClose={() => setShowMonitorDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteConfirmKey !== null}
        onOpenChange={() => setDeleteConfirmKey(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Webhook</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this webhook? This action cannot
              be undone and will break any existing integrations using this
              webhook URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteConfirmKey && void handleDeleteWebhook(deleteConfirmKey)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
