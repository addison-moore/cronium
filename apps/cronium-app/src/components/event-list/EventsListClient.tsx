"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { EventStatus } from "@/shared/schema";
import type { TimeUnit, RunLocation, EventType } from "@/shared/schema";
import { useToast } from "@cronium/ui";
import { ConfirmationDialog } from "@cronium/ui";
import { Pagination } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
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
  ServerData,
} from "@/components/event-list";
import { trpc } from "@/lib/trpc";

interface EventsListClientProps {
  initialEvents: Event[];
  servers: ServerData[];
  workflows: WorkflowData[];
  onRefresh?: () => void;
}

export function EventsListClient({
  initialEvents,
  servers,
  workflows,
  onRefresh,
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

  // For workflow-event relationships, we'll need to extract from events or implement a separate endpoint
  const workflowEvents: { workflowId: number; eventId: number }[] = [];

  // tRPC mutations
  const deleteEventMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event has been successfully deleted.",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const executeEventMutation = trpc.events.execute.useMutation({
    onSuccess: () => {
      toast({
        title: t("EventExecuted"),
        description: "Event execution initiated successfully.",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const createEventMutation = trpc.events.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event duplicated successfully",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const forkEventMutation = trpc.events.fork.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event forked successfully",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: (_, variables) => {
      const statusText = variables.status?.toLowerCase() ?? "updated";
      toast({
        title: "Success",
        description: `Event status updated to ${statusText} successfully.`,
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const activateEventMutation = trpc.events.activate.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event activated successfully.",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const deactivateEventMutation = trpc.events.deactivate.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event paused successfully.",
        variant: "success",
      });
      if (onRefresh) onRefresh();
    },
  });

  const downloadMutation = trpc.events.download.useMutation();

  // Helper functions for state updates
  const updateFilters = useCallback((newFilters: Partial<EventListFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    // Reset to first page when filters change
    if (
      Object.keys(newFilters).some(
        (key) => key !== "sortBy" && key !== "sortOrder",
      )
    ) {
      setState((prev) => ({
        ...prev,
        currentPage: 1,
        selectedEvents: new Set(),
      }));
    }
  }, []);

  const updateState = useCallback((newState: Partial<EventListState>) => {
    setState((prev) => ({ ...prev, ...newState }));
  }, []);

  const handleClearFilters = useCallback(() => {
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
    setState((prev) => ({
      ...prev,
      currentPage: 1,
      selectedEvents: new Set(),
    }));
  }, []);

  // Apply filters to events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesSearch = event.name
        .toLowerCase()
        .includes(filters.searchTerm.toLowerCase());
      const matchesType =
        filters.typeFilter === "all" || !filters.typeFilter
          ? true
          : event.type === (filters.typeFilter as EventType);
      const matchesStatus =
        filters.statusFilter === "all" || !filters.statusFilter
          ? event.status !== EventStatus.ARCHIVED // Exclude archived events when "all" is selected
          : event.status === (filters.statusFilter as EventStatus);
      const matchesServer =
        filters.serverFilter === "all" || !filters.serverFilter
          ? true
          : filters.serverFilter === "local"
            ? event.runLocation === "local" ||
              (!event.serverId &&
                (!event.eventServers || event.eventServers.length === 0))
            : (event.eventServers?.includes(parseInt(filters.serverFilter)) ??
                false) ||
              event.serverId === parseInt(filters.serverFilter);
      const matchesTag =
        filters.tagFilter === "all" || !filters.tagFilter
          ? true
          : event.tags &&
            Array.isArray(event.tags) &&
            event.tags.includes(filters.tagFilter);
      const matchesWorkflow =
        filters.workflowFilter === "all" || !filters.workflowFilter
          ? true
          : workflowEvents.some(
              (we) =>
                we.workflowId === parseInt(filters.workflowFilter) &&
                we.eventId === event.id,
            );

      return (
        matchesSearch &&
        matchesType &&
        matchesStatus &&
        matchesServer &&
        matchesTag &&
        matchesWorkflow
      );
    });
  }, [events, filters, workflowEvents]);

  // Apply sorting to filtered events
  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      let comparison = 0;

      switch (filters.sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "lastRunAt":
          // Handle null values: never-executed events should be considered "older" than any executed event
          if (!a.lastRunAt && !b.lastRunAt) comparison = 0;
          else if (!a.lastRunAt)
            comparison = -1; // Never-executed is "older"
          else if (!b.lastRunAt)
            comparison = 1; // Never-executed is "older"
          else
            comparison =
              new Date(a.lastRunAt).getTime() - new Date(b.lastRunAt).getTime();
          break;
        default:
          comparison = 0;
      }

      return filters.sortOrder === "asc" ? comparison : -comparison;
    });
  }, [filteredEvents, filters.sortBy, filters.sortOrder]);

  // Calculate pagination values
  const totalItems = sortedEvents.length;
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const paginatedEvents = sortedEvents.slice(startIndex, endIndex);

  // Update events when initialEvents changes
  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  // Call onRefresh when events data is updated
  useEffect(() => {
    if (onRefresh && events.length > 0) {
      onRefresh();
    }
  }, [events]); // Remove onRefresh from dependencies to prevent infinite loop

  // Handle page size change
  const handlePageSizeChange = useCallback((newSize: number) => {
    setState((prev) => ({
      ...prev,
      itemsPerPage: newSize,
      currentPage: 1,
      selectedEvents: new Set(),
    }));
  }, []);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    setState((prev) => ({
      ...prev,
      currentPage: page,
      selectedEvents: new Set(),
    }));
  }, []);

  // Handle event deletion
  const confirmDelete = useCallback((id: number) => {
    setDeleteEventId(id);
    setIsDeleteDialogOpen(true);
  }, []);

  const handleDelete = async () => {
    if (!deleteEventId) return;

    try {
      await deleteEventMutation.mutateAsync({ id: deleteEventId });
      setEvents((prev) => prev.filter((e) => e.id !== deleteEventId));
      setIsDeleteDialogOpen(false);
      setDeleteEventId(null);
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  // Handle running an event
  const handleRunEvent = async (id: number) => {
    try {
      // Set loading state for this specific event
      updateState({ isRunning: { ...state.isRunning, [id]: true } });

      await executeEventMutation.mutateAsync({ id, manual: true });
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      // Clear loading state for this specific event
      updateState({ isRunning: { ...state.isRunning, [id]: false } });
    }
  };

  // Handle duplicate event
  const handleDuplicateEvent = async (eventId: number) => {
    try {
      // Find the event in the current data first to avoid unnecessary query
      const existingEvent = events.find((e) => e.id === eventId);
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const eventData = existingEvent;

      // Create duplicate event with "(copy)" appended to name
      // Build the duplicate data object with proper type safety
      const duplicateData = {
        // Required fields
        name: `${eventData.name} (copy)`,
        type: eventData.type,

        // Optional fields
        ...(eventData.description !== undefined &&
          eventData.description !== null && {
            description: eventData.description,
          }),
        ...(eventData.shared !== undefined && {
          shared: Boolean(eventData.shared),
        }),
        ...(Array.isArray(eventData.tags) && {
          tags: eventData.tags.map(String),
        }),
        ...(eventData.content !== undefined &&
          eventData.content !== null && {
            content: eventData.content,
          }),
        status: EventStatus.DRAFT,

        // HTTP specific fields
        ...(eventData.httpMethod !== undefined &&
          eventData.httpMethod !== null && {
            httpMethod: eventData.httpMethod,
          }),
        ...(eventData.httpUrl !== undefined &&
          eventData.httpUrl !== null && {
            httpUrl: eventData.httpUrl,
          }),
        ...(Array.isArray(eventData.httpHeaders) && {
          httpHeaders: eventData.httpHeaders.map(
            (h: { key?: unknown; value?: unknown }) => ({
              key:
                typeof h.key === "string"
                  ? h.key
                  : typeof h.key === "number" || typeof h.key === "boolean"
                    ? String(h.key)
                    : "",
              value:
                typeof h.value === "string"
                  ? h.value
                  : typeof h.value === "number" || typeof h.value === "boolean"
                    ? String(h.value)
                    : "",
            }),
          ),
        }),
        ...(eventData.httpBody !== undefined &&
          eventData.httpBody !== null && {
            httpBody: eventData.httpBody,
          }),

        // Schedule related fields
        ...(typeof eventData.scheduleNumber === "number" && {
          scheduleNumber: eventData.scheduleNumber,
        }),
        ...(eventData.scheduleUnit && {
          scheduleUnit: eventData.scheduleUnit as TimeUnit,
        }),
        ...(eventData.customSchedule !== undefined &&
          eventData.customSchedule !== null && {
            customSchedule: eventData.customSchedule,
          }),

        // Server related fields
        ...(eventData.runLocation && {
          runLocation: eventData.runLocation as RunLocation,
        }),
        ...(typeof eventData.serverId === "number" && {
          serverId: eventData.serverId,
        }),
        ...(Array.isArray(eventData.eventServers) && {
          serverIds: eventData.eventServers,
        }),

        // Additional fields
        ...(typeof eventData.timeoutValue === "number" && {
          timeoutValue: eventData.timeoutValue,
        }),
        ...(eventData.timeoutUnit && {
          timeoutUnit: eventData.timeoutUnit as TimeUnit,
        }),
        ...(typeof eventData.retries === "number" && {
          retries: eventData.retries,
        }),
      };

      await createEventMutation.mutateAsync(duplicateData);

      // Update local state to include the new event
      if (onRefresh) {
        onRefresh();
      }
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  // Handle fork event (for shared events)
  const handleForkEvent = async (eventId: number) => {
    try {
      await forkEventMutation.mutateAsync({ id: eventId });

      // Update local state to include the new event
      if (onRefresh) {
        onRefresh();
      }
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  // Handle status change from dropdown
  const handleStatusChange = async (id: number, newStatus: EventStatus) => {
    try {
      if (newStatus === EventStatus.ACTIVE) {
        await activateEventMutation.mutateAsync({ id, resetCounter: false });
        setEvents((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, status: EventStatus.ACTIVE } : e,
          ),
        );
      } else if (newStatus === EventStatus.PAUSED) {
        await deactivateEventMutation.mutateAsync({ id });
        setEvents((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, status: EventStatus.PAUSED } : e,
          ),
        );
      } else {
        // For draft/archived status, use update
        await updateEventMutation.mutateAsync({ id, status: newStatus });
        setEvents((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e)),
        );
      }
    } catch {
      // Error handling is done in the mutation onError callbacks
    }
  };

  const handleBulkDelete = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "delete" });

    let successCount = 0;
    let failureCount = 0;

    try {
      // Process deletions sequentially to avoid overwhelming the server
      for (const eventId of Array.from(state.selectedEvents)) {
        try {
          await deleteEventMutation.mutateAsync({ id: eventId });
          successCount++;
        } catch {
          failureCount++;
        }
      }

      // Show appropriate success/failure message
      if (successCount > 0 && failureCount === 0) {
        toast({
          title: "Success",
          description: `Successfully deleted ${successCount} event(s).`,
          variant: "success",
        });
      } else if (successCount > 0 && failureCount > 0) {
        toast({
          title: "Partial Success",
          description: `Deleted ${successCount} of ${state.selectedEvents.size} event(s). ${failureCount} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: `Failed to delete all ${state.selectedEvents.size} event(s).`,
          variant: "destructive",
        });
      }

      updateState({ selectedEvents: new Set() });
      setEvents((prev) => prev.filter((e) => !state.selectedEvents.has(e.id)));
    } catch {
      toast({
        title: "Error",
        description: "An unexpected error occurred during bulk deletion.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkActivate = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "activate" });
    try {
      const activatePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return activateEventMutation.mutateAsync({
            id: eventId,
            resetCounter: false,
          });
        },
      );

      const results = await Promise.allSettled(activatePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Activated ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully activated ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });

      // Update local state
      const selectedIds = Array.from(state.selectedEvents);
      setEvents((prev) =>
        prev.map((e) =>
          selectedIds.includes(e.id) ? { ...e, status: EventStatus.ACTIVE } : e,
        ),
      );
    } catch {
      toast({
        title: "Error",
        description: "Failed to activate some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkPause = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "pause" });
    try {
      const pausePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return deactivateEventMutation.mutateAsync({ id: eventId });
        },
      );

      const results = await Promise.allSettled(pausePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Paused ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully paused ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });

      // Update local state
      const selectedIds = Array.from(state.selectedEvents);
      setEvents((prev) =>
        prev.map((e) =>
          selectedIds.includes(e.id) ? { ...e, status: EventStatus.PAUSED } : e,
        ),
      );
    } catch {
      toast({
        title: "Error",
        description: "Failed to pause some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkDownload = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "download" });
    try {
      const eventIds = Array.from(state.selectedEvents);

      const downloadData = await downloadMutation.mutateAsync({
        eventIds,
        format: "json",
      });

      // Create blob and download
      const blob = new Blob([downloadData.data], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadData.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: `Successfully downloaded ${state.selectedEvents.size} event(s).`,
        variant: "success",
      });

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "Failed to download events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkArchive = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "archive" });
    try {
      const archivePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return updateEventMutation.mutateAsync({
            id: eventId,
            status: EventStatus.ARCHIVED,
          });
        },
      );

      const results = await Promise.allSettled(archivePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Archived ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully archived ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });

      // Update local state
      const selectedIds = Array.from(state.selectedEvents);
      setEvents((prev) =>
        prev.map((e) =>
          selectedIds.includes(e.id)
            ? { ...e, status: EventStatus.ARCHIVED }
            : e,
        ),
      );
    } catch {
      toast({
        title: "Error",
        description: "Failed to archive some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  return (
    <div className="border-border bg-secondary-bg rounded-lg border p-4">
      <EventsFilters
        filters={filters}
        onFiltersChange={updateFilters}
        onClearFilters={handleClearFilters}
        events={events}
        servers={servers}
        workflows={workflows}
      />

      <BulkActionsToolbar
        selectedCount={state.selectedEvents.size}
        bulkActionLoading={state.bulkActionLoading}
        onBulkActivate={handleBulkActivate}
        onBulkPause={handleBulkPause}
        onBulkDownload={handleBulkDownload}
        onBulkArchive={handleBulkArchive}
        onBulkDelete={handleBulkDelete}
        onClearSelection={() => updateState({ selectedEvents: new Set() })}
      />

      <EventsTable
        events={paginatedEvents}
        servers={servers}
        selectedEvents={state.selectedEvents}
        onSelectedEventsChange={(selected) =>
          updateState({ selectedEvents: selected })
        }
        onEventRun={handleRunEvent}
        onEventDuplicate={handleDuplicateEvent}
        onEventFork={handleForkEvent}
        onEventStatusChange={handleStatusChange}
        onEventDelete={confirmDelete}
        isRunning={state.isRunning}
        isLoading={false}
        searchTerm={filters.searchTerm}
      />

      {/* Pagination Controls */}
      {totalItems > 0 && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Items per page selector */}
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground text-sm">
                Items per page:
              </span>
              <Select
                value={state.itemsPerPage.toString()}
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

            {/* Pagination component */}
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

      <ConfirmationDialog
        title={t("DeleteEventConfirmation")}
        description={t("DeleteEventDescription")}
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDelete}
        cancelText={t("Cancel")}
        confirmText={t("Delete")}
        loadingText={t("Deleting")}
        variant="destructive"
      />
    </div>
  );
}
