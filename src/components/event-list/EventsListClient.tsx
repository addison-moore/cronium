"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EventStatus, ConditionalActionType } from "@/shared/schema";
import type { TimeUnit, RunLocation, EventType } from "@/shared/schema";
import { useToast } from "@/components/ui/use-toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EventsFilters,
  EventsTable,
  BulkActionsToolbar,
} from "@/components/event-list";
import type {
  Event,
  WorkflowData,
  EventListFilters,
  EventListState,
} from "@/components/event-list";
import { trpc } from "@/lib/trpc";

interface EventsListClientProps {
  initialEvents: Event[];
  servers: Array<{ id: number; name: string }>;
  workflows: WorkflowData[];
}

export function EventsListClient({
  initialEvents,
  servers,
  workflows,
}: EventsListClientProps) {
  // Filter state
  const [filters, setFilters] = useState<EventListFilters>({
    searchTerm: "",
    typeFilter: "all",
    statusFilter: "all",
    serverFilter: "all",
    tagFilter: "all",
    workflowFilter: "all",
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  // Component state
  const [state, setState] = useState<EventListState>({
    currentPage: 1,
    itemsPerPage: 10,
    selectedEvents: new Set(),
    bulkActionLoading: null,
    isRunning: {},
  });

  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<number | null>(null);

  const t = useTranslations("Events");
  const { toast } = useToast();

  // Mutations
  const deleteMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      toast({ title: t("DeleteSuccess") });
      setEvents((prev) => prev.filter((e) => e.id !== deleteEventId));
      setDeleteEventId(null);
    },
    onError: () => {
      toast({ title: t("DeleteError"), variant: "destructive" });
    },
  });

  const executeMutation = trpc.events.execute.useMutation({
    onMutate: ({ id }) => {
      setState((prev) => ({
        ...prev,
        isRunning: { ...prev.isRunning, [id]: true },
      }));
    },
    onSuccess: () => {
      toast({ title: t("ExecutionSuccess") });
    },
    onError: () => {
      toast({ title: t("ExecutionError"), variant: "destructive" });
    },
    onSettled: (_, __, { id }) => {
      setState((prev) => ({
        ...prev,
        isRunning: { ...prev.isRunning, [id]: false },
      }));
    },
  });

  const activateMutation = trpc.events.activate.useMutation({
    onSuccess: (_, { ids }) => {
      toast({ title: t("ActivateSuccess") });
      setEvents((prev) =>
        prev.map((event) =>
          ids.includes(event.id)
            ? { ...event, status: EventStatus.Active }
            : event,
        ),
      );
    },
  });

  const deactivateMutation = trpc.events.deactivate.useMutation({
    onSuccess: (_, { ids }) => {
      toast({ title: t("DeactivateSuccess") });
      setEvents((prev) =>
        prev.map((event) =>
          ids.includes(event.id)
            ? { ...event, status: EventStatus.Inactive }
            : event,
        ),
      );
    },
  });

  // Apply client-side filtering
  const filteredEvents = events.filter((event) => {
    const matchesSearch =
      event.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      event.description
        ?.toLowerCase()
        .includes(filters.searchTerm.toLowerCase());

    const matchesType =
      filters.typeFilter === "all" || event.type === filters.typeFilter;

    const matchesStatus =
      filters.statusFilter === "all" || event.status === filters.statusFilter;

    const matchesServer =
      filters.serverFilter === "all" ||
      event.serverId?.toString() === filters.serverFilter;

    const matchesWorkflow =
      filters.workflowFilter === "all" ||
      workflows.some(
        (wf) =>
          wf.id.toString() === filters.workflowFilter &&
          wf.eventIds.includes(event.id),
      );

    const matchesTag =
      filters.tagFilter === "all" || event.tags?.includes(filters.tagFilter);

    return (
      matchesSearch &&
      matchesType &&
      matchesStatus &&
      matchesServer &&
      matchesWorkflow &&
      matchesTag
    );
  });

  // Apply sorting
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    let comparison = 0;

    switch (filters.sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "createdAt":
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "nextRun":
        if (!a.nextRunAt && !b.nextRunAt) comparison = 0;
        else if (!a.nextRunAt) comparison = 1;
        else if (!b.nextRunAt) comparison = -1;
        else
          comparison =
            new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
        break;
      default:
        comparison = 0;
    }

    return filters.sortOrder === "asc" ? comparison : -comparison;
  });

  // Pagination
  const totalItems = sortedEvents.length;
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const paginatedEvents = sortedEvents.slice(startIndex, endIndex);

  // Handlers
  const handleRunEvent = async (eventId: number) => {
    await executeMutation.mutateAsync({ id: eventId });
  };

  const handleEditEvent = (eventId: number) => {
    window.location.href = `events/${eventId}/edit`;
  };

  const handleDeleteEvent = (eventId: number) => {
    setDeleteEventId(eventId);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (deleteEventId) {
      await deleteMutation.mutateAsync({ id: deleteEventId });
    }
    setIsDeleteDialogOpen(false);
  };

  const handleBulkAction = async (action: string) => {
    const selectedIds = Array.from(state.selectedEvents);
    setState((prev) => ({ ...prev, bulkActionLoading: action }));

    try {
      switch (action) {
        case "activate":
          await activateMutation.mutateAsync({ ids: selectedIds });
          break;
        case "deactivate":
          await deactivateMutation.mutateAsync({ ids: selectedIds });
          break;
        case "delete":
          for (const id of selectedIds) {
            await deleteMutation.mutateAsync({ id });
          }
          setEvents((prev) => prev.filter((e) => !selectedIds.includes(e.id)));
          break;
      }
      setState((prev) => ({
        ...prev,
        selectedEvents: new Set(),
      }));
    } finally {
      setState((prev) => ({ ...prev, bulkActionLoading: null }));
    }
  };

  // Update functions
  const updateFilters = (newFilters: Partial<EventListFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setState((prev) => ({ ...prev, currentPage: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({
      searchTerm: "",
      typeFilter: "all",
      statusFilter: "all",
      serverFilter: "all",
      tagFilter: "all",
      workflowFilter: "all",
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    setState((prev) => ({ ...prev, currentPage: 1 }));
  };

  const handleSelectAll = () => {
    if (state.selectedEvents.size === paginatedEvents.length) {
      setState((prev) => ({ ...prev, selectedEvents: new Set() }));
    } else {
      setState((prev) => ({
        ...prev,
        selectedEvents: new Set(paginatedEvents.map((e) => e.id)),
      }));
    }
  };

  const handleSelectEvent = (eventId: number) => {
    const newSelection = new Set(state.selectedEvents);
    if (newSelection.has(eventId)) {
      newSelection.delete(eventId);
    } else {
      newSelection.add(eventId);
    }
    setState((prev) => ({ ...prev, selectedEvents: newSelection }));
  };

  const handlePageChange = (page: number) => {
    setState((prev) => ({ ...prev, currentPage: page }));
  };

  const handlePageSizeChange = (size: number) => {
    setState((prev) => ({
      ...prev,
      itemsPerPage: size,
      currentPage: 1,
    }));
  };

  return (
    <div className="mt-6">
      {state.selectedEvents.size > 0 && (
        <BulkActionsToolbar
          selectedCount={state.selectedEvents.size}
          onBulkAction={handleBulkAction}
          isLoading={state.bulkActionLoading}
        />
      )}

      <div className="bg-secondary-bg border-border rounded-lg border p-4">
        <EventsFilters
          filters={filters}
          onFiltersChange={updateFilters}
          onClearFilters={handleClearFilters}
          servers={servers}
          workflows={workflows}
          events={events}
        />

        <EventsTable
          events={paginatedEvents}
          selectedEvents={state.selectedEvents}
          isRunning={state.isRunning}
          onSelectAll={handleSelectAll}
          onSelectEvent={handleSelectEvent}
          onRunEvent={handleRunEvent}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          servers={servers}
          workflows={workflows}
        />

        {totalItems > 0 && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-muted-foreground text-sm">
                  Items per page:
                </span>
                <Select
                  value={state.itemsPerPage.toString()}
                  onValueChange={(value) =>
                    handlePageSizeChange(parseInt(value))
                  }
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
                currentPage={state.currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                itemsPerPage={state.itemsPerPage}
                totalItems={totalItems}
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={confirmDelete}
        title={t("DeleteEvent")}
        description={t("DeleteEventConfirmation")}
        loadingText="Deleting..."
      />
    </div>
  );
}
