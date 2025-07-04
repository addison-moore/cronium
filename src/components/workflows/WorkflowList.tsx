"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import { toast } from "@/components/ui/use-toast";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Search,
  Play,
  Pause,
  Trash2,
  Workflow,
  Calendar,
  Globe,
  Hand,
  RefreshCw,
  X,
  Eye,
  Edit,
  Archive,
} from "lucide-react";
import { format } from "date-fns";
import { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import { Spinner } from "@/components/ui/spinner";
import {
  StandardizedTable,
  StandardizedTableLink,
  type StandardizedTableColumn,
  type StandardizedTableAction,
} from "@/components/ui/standardized-table";
import { trpc } from "@/lib/trpc";

interface WorkflowItem {
  id: number;
  name: string;
  description: string | null;
  tags?: string[];
  status: EventStatus;
  triggerType: WorkflowTriggerType;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  shared: boolean;
  userId: string;
}

interface WorkflowListProps {
  onRefresh?: () => void;
}

export default function WorkflowListTrpc({ onRefresh }: WorkflowListProps) {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const t = useTranslations("Workflows");
  const { data: session } = useSession();
  const lang = params.lang;

  const [filteredWorkflows, setFilteredWorkflows] = useState<WorkflowItem[]>(
    [],
  );
  const [searchTerm, setSearchTerm] = useState("");

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Bulk actions state
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<number>>(
    new Set(),
  );
  const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(
    null,
  );

  // tRPC queries
  const {
    data: workflowsData,
    isLoading,
    refetch: refetchWorkflows,
  } = trpc.workflows.getAll.useQuery(
    {
      limit: 1000, // Get all workflows for client-side filtering
      offset: 0,
      search: searchTerm || undefined,
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      shared: undefined,
    },
    {
      staleTime: 30000, // 30 seconds
    },
  );

  // tRPC mutations
  const deleteWorkflowMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Workflow deleted successfully",
        variant: "success",
      });
      refetchWorkflows();
    },
  });

  const updateWorkflowMutation = trpc.workflows.update.useMutation({
    onSuccess: (_, variables) => {
      toast({
        title: "Success",
        description: `Workflow status updated to ${variables.status?.toLowerCase()} successfully.`,
        variant: "success",
      });
      refetchWorkflows();
    },
  });

  const bulkOperationMutation = trpc.workflows.bulkOperation.useMutation({
    onSuccess: (result) => {
      const successCount = result.results.filter((r) => r.success).length;
      const failureCount = result.results.filter((r) => !r.success).length;

      if (failureCount === 0) {
        toast({
          title: "Success",
          description: `Successfully processed ${successCount} workflow(s).`,
          variant: "success",
        });
      } else {
        toast({
          title: "Partial Success",
          description: `Processed ${successCount} of ${result.results.length} workflow(s). ${failureCount} failed.`,
          variant: "destructive",
        });
      }

      setSelectedWorkflows(new Set());
      refetchWorkflows();
    },
  });

  // Extract workflows from tRPC response
  const workflows: WorkflowItem[] = (workflowsData?.workflows || []).map(
    (w: any) => ({
      ...w,
      createdAt:
        w.createdAt instanceof Date ? w.createdAt.toISOString() : w.createdAt,
      updatedAt:
        w.updatedAt instanceof Date ? w.updatedAt.toISOString() : w.updatedAt,
      lastRunAt: null, // TODO: Get lastRunAt from workflow execution data
    }),
  );

  useEffect(() => {
    // Filter workflows based on search term, status, and tags
    let filtered = workflows;

    // Search filter
    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(term) ||
          workflow.description?.toLowerCase().includes(term) ||
          workflow.tags?.some((tag: any) => tag.toLowerCase().includes(term)),
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(
        (workflow) => workflow.status === statusFilter,
      );
    }

    // Tag filter
    if (tagFilter !== "all") {
      filtered = filtered.filter((workflow) =>
        workflow.tags?.includes(tagFilter),
      );
    }

    setFilteredWorkflows(filtered);
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [searchTerm, statusFilter, tagFilter, workflows]);

  // Call onRefresh when workflows data is fetched
  useEffect(() => {
    if (onRefresh && workflowsData) {
      onRefresh();
    }
  }, [workflowsData, onRefresh]);

  // Get unique tags from all workflows
  const getAvailableTags = () => {
    const allTags = new Set<string>();
    workflows.forEach((workflow) => {
      if (workflow.tags) {
        workflow.tags.forEach((tag: any) => allTags.add(tag));
      }
    });
    return Array.from(allTags).sort();
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setTagFilter("all");
  };

  const handleDelete = async (workflowId: number) => {
    if (!confirm(t("DeleteConfirmation"))) return;

    try {
      await deleteWorkflowMutation.mutateAsync({ id: workflowId });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    }
  };

  const handleStatusChange = async (
    workflowId: number,
    newStatus: EventStatus,
  ) => {
    try {
      await updateWorkflowMutation.mutateAsync({
        id: workflowId,
        status: newStatus,
      });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    }
  };

  const handleExecute = async (workflowId: number) => {
    try {
      // Note: You might want to add an execute mutation to the workflows router
      // For now, we'll show a placeholder
      toast({
        title: "Info",
        description: "Workflow execution feature coming soon with tRPC",
        variant: "default",
      });
    } catch (error) {
      console.error("Error executing workflow:", error);
      toast({
        title: "Error",
        description: "Failed to execute workflow. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Bulk action handlers
  const handleBulkDelete = async () => {
    if (selectedWorkflows.size === 0) return;

    if (!confirm(t("BulkDeleteConfirmation"))) return;

    setBulkActionLoading("delete");
    try {
      await bulkOperationMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "delete",
      });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkActivate = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("activate");
    try {
      await bulkOperationMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "activate",
      });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkPause = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("pause");
    try {
      await bulkOperationMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "pause",
      });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("archive");
    try {
      await bulkOperationMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "archive",
      });
    } catch (error) {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  // Selection handlers
  const handleSelectAll = () => {
    if (selectedWorkflows.size === filteredWorkflows.length) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(filteredWorkflows.map((w) => w.id)));
    }
  };

  const handleSelectWorkflow = (workflowId: number, checked: boolean) => {
    const newSelected = new Set(selectedWorkflows);
    if (checked) {
      newSelected.add(workflowId);
    } else {
      newSelected.delete(workflowId);
    }
    setSelectedWorkflows(newSelected);
  };

  // Pagination
  const totalItems = filteredWorkflows.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedWorkflows = filteredWorkflows.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedWorkflows(new Set()); // Clear selection when changing pages
  };

  const handlePageSizeChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
    setSelectedWorkflows(new Set());
  };

  // Get trigger type icon
  const getTriggerIcon = (triggerType: WorkflowTriggerType) => {
    switch (triggerType) {
      case WorkflowTriggerType.MANUAL:
        return <Hand className="h-4 w-4" />;
      case WorkflowTriggerType.SCHEDULE:
        return <Calendar className="h-4 w-4" />;
      case WorkflowTriggerType.WEBHOOK:
        return <Globe className="h-4 w-4" />;
      default:
        return <Workflow className="h-4 w-4" />;
    }
  };

  // Table columns configuration
  const columns: StandardizedTableColumn<WorkflowItem>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={
            selectedWorkflows.size === filteredWorkflows.length &&
            filteredWorkflows.length > 0
          }
          onCheckedChange={handleSelectAll}
          aria-label="Select all workflows"
        />
      ),
      cell: (workflow) => (
        <Checkbox
          checked={selectedWorkflows.has(workflow.id)}
          onCheckedChange={(checked) =>
            handleSelectWorkflow(workflow.id, !!checked)
          }
          aria-label={`Select workflow ${workflow.name}`}
        />
      ),
      className: "w-12",
    },
    {
      key: "name",
      header: t("Name"),
      cell: (workflow) => (
        <div className="flex items-center gap-2">
          {getTriggerIcon(workflow.triggerType)}
          <StandardizedTableLink
            href={`/${lang}/dashboard/workflows/${workflow.id}`}
          >
            {workflow.name}
          </StandardizedTableLink>
          {workflow.shared && (
            <Badge variant="secondary" className="text-xs">
              {t("Shared")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "description",
      header: t("Description"),
      cell: (workflow) => (
        <span className="text-muted-foreground text-sm">
          {workflow.description || "-"}
        </span>
      ),
    },
    {
      key: "status",
      header: t("Status"),
      cell: (workflow) => (
        <ClickableStatusBadge
          currentStatus={workflow.status}
          onStatusChange={(newStatus) =>
            handleStatusChange(workflow.id, newStatus)
          }
        />
      ),
    },
    {
      key: "lastRun",
      header: t("LastRun"),
      cell: (workflow) => (
        <span className="text-muted-foreground text-sm">
          {workflow.lastRunAt
            ? format(new Date(workflow.lastRunAt), "MMM dd, yyyy HH:mm")
            : t("Never")}
        </span>
      ),
    },
    {
      key: "updated",
      header: t("Updated"),
      cell: (workflow) => (
        <span className="text-muted-foreground text-sm">
          {format(new Date(workflow.updatedAt), "MMM dd, yyyy")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (workflow) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleExecute(workflow.id)}
          title={t("Execute")}
        >
          <Play className="h-4 w-4" />
        </Button>
      ),
      className: "w-16",
    },
  ];

  // Table actions
  const getTableActions = (
    workflow: WorkflowItem,
  ): StandardizedTableAction[] => [
    {
      label: t("View"),
      icon: <Eye className="h-4 w-4" />,
      onClick: () => router.push(`/${lang}/dashboard/workflows/${workflow.id}`),
    },
    {
      label: t("Edit"),
      icon: <Edit className="h-4 w-4" />,
      onClick: () =>
        router.push(`/${lang}/dashboard/workflows/${workflow.id}/edit`),
    },
    {
      label: t("Execute"),
      icon: <Play className="h-4 w-4" />,
      onClick: () => handleExecute(workflow.id),
    },
    ...(workflow.status === EventStatus.ARCHIVED
      ? [
          {
            label: t("Unarchive"),
            icon: <RefreshCw className="h-4 w-4" />,
            onClick: () => handleStatusChange(workflow.id, EventStatus.ACTIVE),
          } as StandardizedTableAction,
        ]
      : [
          {
            label: t("Archive"),
            icon: <Archive className="h-4 w-4" />,
            onClick: () =>
              handleStatusChange(workflow.id, EventStatus.ARCHIVED),
          } as StandardizedTableAction,
        ]),
    {
      label: t("Delete"),
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => handleDelete(workflow.id),
      variant: "destructive" as const,
      separator: true,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
        <span className="ml-2">{t("Loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Workflows")}</h1>
          <p className="text-muted-foreground">{t("ManageWorkflows")}</p>
        </div>
        <Link href={`/${lang}/dashboard/workflows/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("NewWorkflow")}
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-muted/50 flex flex-wrap items-center gap-4 rounded-lg p-4">
        {/* Search */}
        <div className="min-w-[200px] flex-1">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <Input
              placeholder={t("SearchWorkflows")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("AllStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("AllStatuses")}</SelectItem>
            <SelectItem value={EventStatus.ACTIVE}>
              {t("Status.Active")}
            </SelectItem>
            <SelectItem value={EventStatus.PAUSED}>
              {t("Status.Paused")}
            </SelectItem>
            <SelectItem value={EventStatus.DRAFT}>
              {t("Status.Draft")}
            </SelectItem>
            <SelectItem value={EventStatus.ARCHIVED}>
              {t("Status.Archived")}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Tag Filter */}
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("AllTags")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("AllTags")}</SelectItem>
            {getAvailableTags().map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear Filters */}
        {(searchTerm || statusFilter !== "all" || tagFilter !== "all") && (
          <Button variant="outline" onClick={clearFilters}>
            <X className="mr-2 h-4 w-4" />
            {t("ClearFilters")}
          </Button>
        )}

        {/* Refresh */}
        <Button
          variant="outline"
          onClick={() => refetchWorkflows()}
          disabled={isLoading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
          />
          {t("Refresh")}
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedWorkflows.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
          <span className="text-sm font-medium">
            {t("SelectedCount", { count: selectedWorkflows.size })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkActivate}
              disabled={bulkActionLoading === "activate"}
            >
              <Play className="mr-1 h-4 w-4" />
              {t("Activate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkPause}
              disabled={bulkActionLoading === "pause"}
            >
              <Pause className="mr-1 h-4 w-4" />
              {t("Pause")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkArchive}
              disabled={bulkActionLoading === "archive"}
            >
              <Archive className="mr-1 h-4 w-4" />
              {t("Archive")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkActionLoading === "delete"}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t("Delete")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedWorkflows(new Set())}
            >
              {t("ClearSelection")}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <StandardizedTable
        data={paginatedWorkflows}
        columns={columns}
        actions={getTableActions}
        isLoading={isLoading}
        emptyMessage={
          searchTerm || statusFilter !== "all" || tagFilter !== "all"
            ? t("NoWorkflowsFound")
            : t("NoWorkflowsDescription")
        }
      />

      {/* Pagination */}
      {totalItems > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {t("ItemsPerPage")}:
            </span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => handlePageSizeChange(parseInt(value))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            itemsPerPage={itemsPerPage}
            totalItems={totalItems}
          />
        </div>
      )}
    </div>
  );
}
