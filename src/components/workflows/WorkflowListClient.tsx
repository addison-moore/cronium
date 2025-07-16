"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  // Archive,
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

interface WorkflowListClientProps {
  initialWorkflows: WorkflowItem[];
}

export function WorkflowListClient({
  initialWorkflows,
}: WorkflowListClientProps) {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const t = useTranslations("Workflows");
  const lang = params.lang;

  const [workflows, setWorkflows] = useState<WorkflowItem[]>(initialWorkflows);
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

  // Track which workflows are being executed
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(
    new Set(),
  );

  // tRPC mutations
  const deleteMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      toast({ title: t("DeleteSuccess") });
    },
    onError: () => {
      toast({ title: t("DeleteError"), variant: "destructive" });
    },
  });

  const updateMutation = trpc.workflows.update.useMutation({
    onSuccess: () => {
      toast({ title: t("UpdateSuccess") });
    },
  });

  const executeMutation = trpc.workflows.execute.useMutation({
    onMutate: ({ id }) => {
      setExecutingWorkflows((prev) => new Set(prev).add(id));
    },
    onSuccess: () => {
      toast({ title: t("ExecuteSuccess") });
    },
    onError: () => {
      toast({ title: t("ExecuteError"), variant: "destructive" });
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
    onSuccess: () => {
      toast({ title: t("BulkSuccess") });
      setSelectedWorkflows(new Set());
    },
    onError: () => {
      toast({ title: t("BulkError"), variant: "destructive" });
    },
    onSettled: () => {
      setBulkActionLoading(null);
    },
  });

  // Extract unique tags
  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    workflows.forEach((workflow) => {
      workflow.tags?.forEach((tag) => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  }, [workflows]);

  // Filter workflows based on search and filters
  useEffect(() => {
    let filtered = workflows;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          workflow.description
            ?.toLowerCase()
            .includes(searchTerm.toLowerCase()),
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(
        (workflow) => workflow.status === statusFilter,
      );
    }

    // Apply tag filter
    if (tagFilter !== "all") {
      filtered = filtered.filter((workflow) =>
        workflow.tags?.includes(tagFilter),
      );
    }

    setFilteredWorkflows(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [workflows, searchTerm, statusFilter, tagFilter]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredWorkflows.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedWorkflows = filteredWorkflows.slice(startIndex, endIndex);

  // Handlers
  const handleDeleteWorkflow = async (id: number) => {
    await deleteMutation.mutateAsync({ id });
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  const handleToggleStatus = async (id: number, currentStatus: EventStatus) => {
    const newStatus =
      currentStatus === EventStatus.Active
        ? EventStatus.Inactive
        : EventStatus.Active;

    await updateMutation.mutateAsync({ id, status: newStatus });
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, status: newStatus } : w)),
    );
  };

  const handleExecuteWorkflow = async (id: number) => {
    await executeMutation.mutateAsync({ id });
  };

  const handleBulkAction = async (action: string) => {
    if (selectedWorkflows.size === 0) return;

    setBulkActionLoading(action);
    const ids = Array.from(selectedWorkflows);

    switch (action) {
      case "activate":
        await bulkMutation.mutateAsync({
          ids,
          operation: "activate",
        });
        setWorkflows((prev) =>
          prev.map((w) =>
            ids.includes(w.id) ? { ...w, status: EventStatus.Active } : w,
          ),
        );
        break;
      case "deactivate":
        await bulkMutation.mutateAsync({
          ids,
          operation: "deactivate",
        });
        setWorkflows((prev) =>
          prev.map((w) =>
            ids.includes(w.id) ? { ...w, status: EventStatus.Inactive } : w,
          ),
        );
        break;
      case "delete":
        await bulkMutation.mutateAsync({
          ids,
          operation: "delete",
        });
        setWorkflows((prev) => prev.filter((w) => !ids.includes(w.id)));
        break;
    }
  };

  const handleSelectAll = () => {
    if (selectedWorkflows.size === paginatedWorkflows.length) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(paginatedWorkflows.map((w) => w.id)));
    }
  };

  const handleSelectWorkflow = (id: number) => {
    const newSelected = new Set(selectedWorkflows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedWorkflows(newSelected);
  };

  const getTriggerIcon = (triggerType: WorkflowTriggerType) => {
    switch (triggerType) {
      case WorkflowTriggerType.Scheduled:
        return <Calendar className="h-4 w-4" />;
      case WorkflowTriggerType.Webhook:
        return <Globe className="h-4 w-4" />;
      case WorkflowTriggerType.Manual:
        return <Hand className="h-4 w-4" />;
      case WorkflowTriggerType.Event:
        return <RefreshCw className="h-4 w-4" />;
    }
  };

  const columns: StandardizedTableColumn<WorkflowItem>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={
            paginatedWorkflows.length > 0 &&
            selectedWorkflows.size === paginatedWorkflows.length
          }
          onCheckedChange={handleSelectAll}
        />
      ),
      cell: (workflow) => (
        <Checkbox
          checked={selectedWorkflows.has(workflow.id)}
          onCheckedChange={() => handleSelectWorkflow(workflow.id)}
        />
      ),
    },
    {
      key: "name",
      header: t("Name"),
      cell: (workflow) => (
        <div className="flex items-center gap-2">
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
      key: "trigger",
      header: t("Trigger"),
      cell: (workflow) => (
        <div className="flex items-center gap-2">
          {getTriggerIcon(workflow.triggerType)}
          <span className="text-sm capitalize">
            {workflow.triggerType.toLowerCase()}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: t("Status"),
      cell: (workflow) => (
        <ClickableStatusBadge
          status={workflow.status}
          onClick={() => handleToggleStatus(workflow.id, workflow.status)}
        />
      ),
    },
    {
      key: "tags",
      header: t("Tags"),
      cell: (workflow) => (
        <div className="flex flex-wrap gap-1">
          {workflow.tags?.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "lastRun",
      header: t("LastRun"),
      cell: (workflow) =>
        workflow.lastRunAt
          ? format(new Date(workflow.lastRunAt), "MMM d, yyyy HH:mm")
          : "-",
    },
    {
      key: "created",
      header: t("Created"),
      cell: (workflow) => format(new Date(workflow.createdAt), "MMM d, yyyy"),
    },
  ];

  const getWorkflowActions = (
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
      onClick: () => void handleExecuteWorkflow(workflow.id),
      disabled: executingWorkflows.has(workflow.id),
      separator: true,
    },
    {
      label: t("Delete"),
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => void handleDeleteWorkflow(workflow.id),
      variant: "destructive",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Bulk actions toolbar */}
      {selectedWorkflows.size > 0 && (
        <div className="bg-muted flex items-center gap-2 rounded-lg p-3">
          <span className="text-sm font-medium">
            {t("SelectedCount", { count: selectedWorkflows.size })}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction("activate")}
            disabled={bulkActionLoading !== null}
          >
            {bulkActionLoading === "activate" ? (
              <Spinner className="mr-2 h-3 w-3" />
            ) : (
              <Play className="mr-2 h-3 w-3" />
            )}
            {t("Activate")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkAction("deactivate")}
            disabled={bulkActionLoading !== null}
          >
            {bulkActionLoading === "deactivate" ? (
              <Spinner className="mr-2 h-3 w-3" />
            ) : (
              <Pause className="mr-2 h-3 w-3" />
            )}
            {t("Deactivate")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleBulkAction("delete")}
            disabled={bulkActionLoading !== null}
          >
            {bulkActionLoading === "delete" ? (
              <Spinner className="mr-2 h-3 w-3" />
            ) : (
              <Trash2 className="mr-2 h-3 w-3" />
            )}
            {t("Delete")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedWorkflows(new Set())}
            className="ml-auto"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("SearchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("FilterByStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("AllStatuses")}</SelectItem>
            <SelectItem value={EventStatus.Active}>{t("Active")}</SelectItem>
            <SelectItem value={EventStatus.Inactive}>
              {t("Inactive")}
            </SelectItem>
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("FilterByTag")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("AllTags")}</SelectItem>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <StandardizedTable
        data={paginatedWorkflows}
        columns={columns}
        actions={getWorkflowActions}
        isLoading={false}
        emptyMessage={
          <div className="flex flex-col items-center py-8">
            <Workflow className="text-muted-foreground mb-4 h-12 w-12" />
            <p className="text-lg font-medium">{t("NoWorkflowsFound")}</p>
            <p className="text-muted-foreground text-sm">
              {searchTerm || statusFilter !== "all" || tagFilter !== "all"
                ? t("NoWorkflowsMatchingFilters")
                : t("CreateYourFirstWorkflow")}
            </p>
          </div>
        }
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Select
            value={itemsPerPage.toString()}
            onValueChange={(value) => setItemsPerPage(Number(value))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 / page</SelectItem>
              <SelectItem value="20">20 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
            </SelectContent>
          </Select>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            totalItems={filteredWorkflows.length}
          />
        </div>
      )}
    </div>
  );
}
