"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EventStatus } from "@/shared/schema";
import { useFetchData } from "@/hooks/useFetchData";
import { useOptimisticUpdate } from "@/hooks/useOptimisticUpdate";
import { useToast } from "@/components/ui/use-toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventsTable } from "@/components/event-list";
import type {
  Event,
  ServerData,
  EventListFilters,
  EventListState,
} from "@/components/event-list";

interface ServerEventsListProps {
  serverId: number;
}

export default function ServerEventsList({ serverId }: ServerEventsListProps) {
  // Filter state - simplified for server view
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

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<number | null>(null);
  const t = useTranslations("Events");
  const { toast } = useToast();

  // Fetch events data for this specific server
  const {
    data: events = [],
    isLoading,
    refreshData,
  } = useFetchData<Event[]>({
    url: `/api/servers/${serverId}/events`,
    errorMessage: t("FetchError"),
    initialData: [],
  });

  // Fetch servers data for the EventsTable component
  const { data: servers = [] } = useFetchData<ServerData[]>({
    url: "/api/servers",
    errorMessage: "Failed to fetch servers",
    initialData: [],
  });

  // Use optimistic updates for event operations
  const {
    items: optimisticEvents,
    updateItem,
    deleteItem,
  } = useOptimisticUpdate<Event>({
    items: events || [],
    keyExtractor: (event) => event.id,
  });

  // Helper function to update state
  const updateState = (updates: Partial<EventListState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  // Helper function to update filters
  const updateFilters = (updates: Partial<EventListFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    // Reset to first page when filters change
    updateState({ currentPage: 1 });
  };

  // Events are already filtered by server on the backend, no need for client-side filtering
  // Apply search filter
  const filteredEvents = optimisticEvents.filter((event: Event) => {
    const matchesSearch =
      !filters.searchTerm ||
      event.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      event.description
        ?.toLowerCase()
        .includes(filters.searchTerm.toLowerCase());

    return matchesSearch;
  });

  // Apply sorting to filtered events
  const sortedEvents = [...filteredEvents].sort((a: Event, b: Event) => {
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

  // Event handlers
  const handleRunEvent = async (eventId: number) => {
    try {
      updateState({
        isRunning: { ...state.isRunning, [eventId]: true },
      });

      const response = await fetch(`/api/events/${eventId}/run`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to run event");
      }

      toast({
        title: t("EventTriggered"),
        description: t("EventTriggeredDescription"),
      });

      // Refresh the events data
      void refreshData();
    } catch (error) {
      console.error("Error running event:", error);
      toast({
        title: t("Error"),
        description: t("RunEventError"),
        variant: "destructive",
      });
    } finally {
      updateState({
        isRunning: { ...state.isRunning, [eventId]: false },
      });
    }
  };

  const handleDuplicateEvent = async (eventId: number) => {
    try {
      const response = await fetch(`/api/events/${eventId}/duplicate`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to duplicate event");
      }

      toast({
        title: "Event Duplicated",
        description: "The event has been successfully duplicated.",
      });

      // Refresh the events data
      void refreshData();
    } catch (error) {
      console.error("Error duplicating event:", error);
      toast({
        title: "Error",
        description: "Failed to duplicate event. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (
    eventId: number,
    newStatus: EventStatus,
  ) => {
    const actionText =
      newStatus === EventStatus.ARCHIVED
        ? "archived"
        : newStatus === EventStatus.ACTIVE
          ? "activated"
          : "paused";

    await updateItem(
      eventId,
      (event) => ({ ...event, status: newStatus }),
      async () => {
        const response = await fetch(`/api/events/${eventId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!response.ok) {
          throw new Error("Failed to update event status");
        }
      },
      `Event ${actionText} successfully`,
      `Failed to ${actionText} event`,
    );
  };

  const confirmDelete = (eventId: number) => {
    setDeleteEventId(eventId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteEvent = async () => {
    if (!deleteEventId) return;

    await deleteItem(
      deleteEventId,
      async () => {
        const response = await fetch(`/api/events/${deleteEventId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete event");
        }
      },
      "Event deleted successfully",
      "Failed to delete event",
    );

    setIsDeleteDialogOpen(false);
    setDeleteEventId(null);
  };

  // Sort options for the sort dropdown
  const sortOptions = [
    { value: "name", label: t("Alphabetical") || "Alphabetical" },
    { value: "createdAt", label: t("DateCreated") || "Date Created" },
    { value: "lastRunAt", label: t("LastExecution") || "Last Execution" },
  ];

  if (sortedEvents.length === 0 && !isLoading) {
    return (
      <div className="py-8 text-center">
        <Search className="mx-auto mb-4 h-12 w-12 text-gray-300" />
        <p className="mb-4 text-gray-500">
          {filters.searchTerm
            ? "No events found matching your search."
            : "No events configured to run on this server yet."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Simplified filters - only search and sort */}
      <div className="mb-6 flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <Input
              placeholder={t("SearchPlaceholder") || "Search events..."}
              value={filters.searchTerm}
              onChange={(e) => updateFilters({ searchTerm: e.target.value })}
              className="pl-10"
            />
          </div>
        </div>

        <Select
          value={filters.sortBy}
          onValueChange={(value) =>
            updateFilters({ sortBy: value as EventListFilters["sortBy"] })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            updateFilters({
              sortOrder: filters.sortOrder === "asc" ? "desc" : "asc",
            })
          }
          className="px-3"
        >
          {filters.sortOrder === "asc" ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Events Table */}
      <EventsTable
        events={sortedEvents}
        servers={servers}
        selectedEvents={state.selectedEvents}
        onSelectedEventsChange={(selected) =>
          updateState({ selectedEvents: selected })
        }
        onEventRun={handleRunEvent}
        onEventDuplicate={handleDuplicateEvent}
        onEventStatusChange={handleStatusChange}
        onEventDelete={confirmDelete}
        isRunning={state.isRunning}
        isLoading={isLoading}
        searchTerm={filters.searchTerm}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDeleteEvent}
        title="Delete Event"
        description="Are you sure you want to delete this event? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
      />
    </>
  );
}
