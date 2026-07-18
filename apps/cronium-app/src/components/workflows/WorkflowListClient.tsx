"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import { toast } from "@cronium/ui";
import { Pagination } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import {
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
import {
  StandardizedTable,
  StandardizedTableLink,
  type StandardizedTableColumn,
  type StandardizedTableAction,
} from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { usePersistentPagination } from "@/hooks/use-persistent-pagination";

const copy = {
  deleteSuccess: "Workflow deleted successfully",
  deleteError: "Failed to delete workflow",
  updateSuccess: "Workflow updated successfully",
  executeSuccess: "Workflow execution started",
  executeError: "Failed to execute workflow",
  bulkError: "Failed to process all workflows",
  deleteConfirmation:
    "Are you sure you want to delete this workflow? This cannot be undone.",
  bulkDeleteConfirmation:
    "Delete all selected workflows? This cannot be undone.",
  name: "Name",
  sharedLabel: "Shared",
  statusLabel: "Status",
  lastRun: "Last Run",
  never: "Never",
  updated: "Updated",
  execute: "Execute",
  view: "View",
  edit: "Edit",
  unarchive: "Unarchive",
  archive: "Archive",
  delete: "Delete",
  searchPlaceholder: "Search workflows...",
  allStatuses: "All Statuses",
  statusActive: "Active",
  statusPaused: "Paused",
  statusDraft: "Draft",
  statusArchived: "Archived",
  allTags: "All Tags",
  clearFilters: "Clear Filters",
  refresh: "Refresh",
  activate: "Activate",
  pause: "Pause",
  clearSelection: "Clear Selection",
  noWorkflowsFound: "No workflows found",
  noWorkflowsDescription: "There are no workflows matching your filters.",
  itemsPerPage: "Items per page",
} as const;

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

interface WorkflowListClientProps {
  initialWorkflows: WorkflowItem[];
  onRefresh?: () => void;
}

export function WorkflowListClient({
  initialWorkflows,
  onRefresh,
}: WorkflowListClientProps) {
  const router = useRouter();

  const [workflows, setWorkflows] = useState<WorkflowItem[]>(initialWorkflows);
  const [filteredWorkflows, setFilteredWorkflows] = useState<WorkflowItem[]>(
    [],
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  // Pagination state
  const { itemsPerPage, setItemsPerPage } = usePersistentPagination(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Bulk actions state
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<number>>(
    new Set(),
  );
  const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(
    null,
  );

  // Track which workflows are being executed
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(
    new Set(),
  );

  // tRPC mutations
  const deleteMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      toast({ title: copy.deleteSuccess, variant: "success" });
    },
    onError: () => {
      toast({ title: copy.deleteError, variant: "destructive" });
    },
  });

  const updateMutation = trpc.workflows.update.useMutation({
    onSuccess: () => {
      toast({ title: copy.updateSuccess, variant: "success" });
    },
  });

  const executeMutation = trpc.workflows.execute.useMutation({
    onMutate: ({ id }) => {
      setExecutingWorkflows((prev) => new Set(prev).add(id));
    },
    onSuccess: () => {
      toast({ title: copy.executeSuccess, variant: "success" });
    },
    onError: () => {
      toast({ title: copy.executeError, variant: "destructive" });
    },
    onSettled: (_, __, { id }) => {
      setExecutingWorkflows((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });

  const bulkMutation = trpc.workflows.bulkOperation.useMutation({
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
    },
    onError: () => {
      toast({ title: copy.bulkError, variant: "destructive" });
    },
    onSettled: () => {
      setBulkActionLoading(null);
    },
  });

  // Extract unique tags - memoized to prevent re-renders
  const availableTags = useMemo(() => {
    const allTags = new Set<string>();
    workflows.forEach((workflow) => {
      if (workflow.tags) {
        workflow.tags.forEach((tag) => allTags.add(tag));
      }
    });
    return Array.from(allTags).sort();
  }, [workflows]);

  // Filter workflows based on search and filters
  useEffect(() => {
    // Filter workflows based on search term, status, and tags
    let filtered = workflows;

    // Search filter
    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(term) ||
          (workflow.description?.toLowerCase().includes(term) ?? false) ||
          workflow.tags?.some((tag) => tag.toLowerCase().includes(term)),
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(
        (workflow) => workflow.status === (statusFilter as EventStatus),
      );
    }

    // Tag filter
    if (tagFilter !== "all") {
      filtered = filtered.filter((workflow) =>
        workflow.tags?.includes(tagFilter),
      );
    }

    // Only update state if the filtered results actually changed
    setFilteredWorkflows((prev) => {
      const isEqual =
        prev.length === filtered.length &&
        prev.every((item, index) => item.id === filtered[index]?.id);
      return isEqual ? prev : filtered;
    });
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [searchTerm, statusFilter, tagFilter, workflows]);

  // Update workflows when initialWorkflows changes
  useEffect(() => {
    setWorkflows(initialWorkflows);
  }, [initialWorkflows]);

  // Call onRefresh when workflows data is updated
  useEffect(() => {
    if (onRefresh && workflows.length > 0) {
      onRefresh();
    }
  }, [workflows]); // Remove onRefresh from dependencies to prevent infinite loop

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setStatusFilter("all");
    setTagFilter("all");
  }, []);

  // Filter change handlers
  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value);
  }, []);

  const handleTagFilterChange = useCallback((value: string) => {
    setTagFilter(value);
  }, []);

  // Pagination
  const totalItems = filteredWorkflows.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedWorkflows = filteredWorkflows.slice(startIndex, endIndex);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setSelectedWorkflows(new Set()); // Clear selection when changing pages
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
    setSelectedWorkflows(new Set());
  }, []);

  const handlePageSizeSelectChange = useCallback(
    (value: string) => {
      handlePageSizeChange(parseInt(value));
    },
    [handlePageSizeChange],
  );

  // Handlers
  const handleDelete = async (workflowId: number) => {
    if (!confirm(copy.deleteConfirmation)) return;

    try {
      await deleteMutation.mutateAsync({ id: workflowId });
      setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  const handleStatusChange = async (
    workflowId: number,
    newStatus: EventStatus,
  ) => {
    try {
      await updateMutation.mutateAsync({
        id: workflowId,
        status: newStatus,
      });
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId ? { ...w, status: newStatus } : w,
        ),
      );
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  const handleExecute = async (workflowId: number) => {
    setExecutingWorkflows((prev) => new Set(prev).add(workflowId));
    try {
      await executeMutation.mutateAsync({
        id: workflowId,
        manual: true,
      });
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setExecutingWorkflows((prev) => {
        const next = new Set(prev);
        next.delete(workflowId);
        return next;
      });
    }
  };

  // Bulk action handlers
  const handleBulkDelete = async () => {
    if (selectedWorkflows.size === 0) return;

    if (!confirm(copy.bulkDeleteConfirmation)) return;

    setBulkActionLoading("delete");
    try {
      await bulkMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "delete",
      });
      setWorkflows((prev) => prev.filter((w) => !selectedWorkflows.has(w.id)));
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkActivate = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("activate");
    try {
      await bulkMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "activate",
      });
      setWorkflows((prev) =>
        prev.map((w) =>
          selectedWorkflows.has(w.id)
            ? { ...w, status: EventStatus.ACTIVE }
            : w,
        ),
      );
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkPause = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("pause");
    try {
      await bulkMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "pause",
      });
      setWorkflows((prev) =>
        prev.map((w) =>
          selectedWorkflows.has(w.id)
            ? { ...w, status: EventStatus.PAUSED }
            : w,
        ),
      );
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading("archive");
    try {
      await bulkMutation.mutateAsync({
        workflowIds: Array.from(selectedWorkflows),
        operation: "archive",
      });
      setWorkflows((prev) =>
        prev.map((w) =>
          selectedWorkflows.has(w.id)
            ? { ...w, status: EventStatus.ARCHIVED }
            : w,
        ),
      );
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setBulkActionLoading(null);
    }
  };

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (selectedWorkflows.size === filteredWorkflows.length) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(filteredWorkflows.map((w) => w.id)));
    }
  }, [selectedWorkflows.size, filteredWorkflows]);

  const handleSelectWorkflow = useCallback(
    (workflowId: number, checked: boolean) => {
      const newSelected = new Set(selectedWorkflows);
      if (checked) {
        newSelected.add(workflowId);
      } else {
        newSelected.delete(workflowId);
      }
      setSelectedWorkflows(newSelected);
    },
    [selectedWorkflows],
  );

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
      header: copy.name,
      cell: (workflow) => (
        <div className="flex items-center gap-2">
          {getTriggerIcon(workflow.triggerType)}
          <StandardizedTableLink href={`/dashboard/workflows/${workflow.id}`}>
            {workflow.name}
          </StandardizedTableLink>
          {workflow.shared && (
            <Badge variant="secondary" className="text-xs">
              {copy.sharedLabel}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: copy.statusLabel,
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
      header: copy.lastRun,
      cell: (workflow) => (
        <span className="text-muted-foreground text-sm">
          {workflow.lastRunAt
            ? format(new Date(workflow.lastRunAt), "MMM dd, yyyy HH:mm")
            : copy.never}
        </span>
      ),
    },
    {
      key: "updated",
      header: copy.updated,
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
          className="border-success hover:bg-success/10 hover:text-success h-8 w-8 cursor-pointer rounded-full p-0 transition-colors"
          onClick={() => handleExecute(workflow.id)}
          disabled={executingWorkflows.has(workflow.id)}
          title={copy.execute}
        >
          {executingWorkflows.has(workflow.id) ? (
            <RefreshCw className="text-success h-4 w-4 motion-safe:animate-spin" />
          ) : (
            <Play className="text-success h-4 w-4" />
          )}
          <span className="sr-only">{copy.execute}</span>
        </Button>
      ),
      className: "w-[60px]",
    },
  ];

  // Table actions
  const getTableActions = (
    workflow: WorkflowItem,
  ): StandardizedTableAction[] => [
    {
      label: copy.view,
      icon: <Eye className="h-4 w-4" />,
      onClick: () => router.push(`/dashboard/workflows/${workflow.id}`),
    },
    {
      label: copy.edit,
      icon: <Edit className="h-4 w-4" />,
      onClick: () => router.push(`/dashboard/workflows/${workflow.id}/edit`),
    },
    {
      label: copy.execute,
      icon: <Play className="h-4 w-4" />,
      onClick: () => {
        void handleExecute(workflow.id);
      },
    },
    ...(workflow.status === EventStatus.ARCHIVED
      ? [
          {
            label: copy.unarchive,
            icon: <RefreshCw className="h-4 w-4" />,
            onClick: () => {
              void handleStatusChange(workflow.id, EventStatus.ACTIVE);
            },
          } as StandardizedTableAction,
        ]
      : [
          {
            label: copy.archive,
            icon: <Archive className="h-4 w-4" />,
            onClick: () => {
              void handleStatusChange(workflow.id, EventStatus.ARCHIVED);
            },
          } as StandardizedTableAction,
        ]),
    {
      label: copy.delete,
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => {
        void handleDelete(workflow.id);
      },
      variant: "destructive" as const,
      separator: true,
    },
  ];

  // Handle refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    if (onRefresh) {
      onRefresh();
    }
    // Reset refreshing state after a short delay to show the animation
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div className="border-border bg-secondary-bg space-y-4 rounded-lg border p-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="min-w-[200px] flex-1">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <Input
              placeholder={copy.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={copy.allStatuses} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allStatuses}</SelectItem>
            <SelectItem value={EventStatus.ACTIVE}>
              {copy.statusActive}
            </SelectItem>
            <SelectItem value={EventStatus.PAUSED}>
              {copy.statusPaused}
            </SelectItem>
            <SelectItem value={EventStatus.DRAFT}>
              {copy.statusDraft}
            </SelectItem>
            <SelectItem value={EventStatus.ARCHIVED}>
              {copy.statusArchived}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Tag Filter */}
        <Select value={tagFilter} onValueChange={handleTagFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={copy.allTags} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allTags}</SelectItem>
            {availableTags.map((tag) => (
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
            {copy.clearFilters}
          </Button>
        )}

        {/* Refresh */}
        <Button
          variant="outline"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "motion-safe:animate-spin" : ""}`}
          />
          {copy.refresh}
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedWorkflows.size > 0 && (
        <div className="border-info/40 bg-info/10 flex items-center gap-2 rounded-lg border p-4">
          <span className="text-sm font-medium">
            Selected workflows: {selectedWorkflows.size}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkActivate}
              disabled={bulkActionLoading === "activate"}
            >
              <Play className="mr-1 h-4 w-4" />
              {copy.activate}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkPause}
              disabled={bulkActionLoading === "pause"}
            >
              <Pause className="mr-1 h-4 w-4" />
              {copy.pause}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkArchive}
              disabled={bulkActionLoading === "archive"}
            >
              <Archive className="mr-1 h-4 w-4" />
              {copy.archive}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkActionLoading === "delete"}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {copy.delete}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedWorkflows(new Set())}
            >
              {copy.clearSelection}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <StandardizedTable
        data={paginatedWorkflows}
        columns={columns}
        actions={getTableActions}
        isLoading={isRefreshing}
        emptyMessage={
          searchTerm || statusFilter !== "all" || tagFilter !== "all"
            ? copy.noWorkflowsFound
            : copy.noWorkflowsDescription
        }
      />

      {/* Pagination */}
      {totalItems > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {copy.itemsPerPage}:
            </span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={handlePageSizeSelectChange}
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
