"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  EventStatus,
  TimeUnit,
  RunLocation,
  type Event as DbEvent,
} from "@shared/schema";
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
  EventListFilters,
  EventListState,
} from "@/components/event-list";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface ServerEventsListProps {
  serverId: number;
}

// Type guard to check if the data has the expected shape
function isValidEventsData(
  data: unknown,
): data is { events: DbEvent[]; total: number; hasMore: boolean } {
  return (
    typeof data === "object" &&
    data !== null &&
    "events" in data &&
    Array.isArray((data as { events: unknown }).events)
  );
}

// Type guard to check if the data has the expected servers shape
function isValidServersData(
  data: unknown,
): data is { servers: Array<{ id: number; name: string }> } {
  return (
    typeof data === "object" &&
    data !== null &&
    "servers" in data &&
    Array.isArray((data as { servers: unknown }).servers)
  );
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

  // tRPC queries for all events (will filter by server client-side)
  const {
    data: eventsData,
    isLoading,
    refetch: refetchEvents,
  } = trpc.events.getAll.useQuery(
    { limit: 1000 }, // Get all events for client-side filtering
    QUERY_OPTIONS.dynamic,
  );

  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100 },
    QUERY_OPTIONS.static,
  );

  // tRPC mutations for event operations
  const runEventMutation = trpc.events.execute.useMutation({
    onSuccess: () => {
      toast({
        title: t("EventTriggered"),
        description: t("EventTriggeredDescription"),
      });
      void refetchEvents();
    },
    onError: (error) => {
      toast({
        title: t("Error"),
        description:
          error instanceof Error ? error.message : t("RunEventError"),
        variant: "destructive",
      });
    },
  });

  // Note: duplicate mutation doesn't exist, using create with existing data
  const duplicateEventMutation = trpc.events.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Duplicated",
        description: "The event has been successfully duplicated.",
      });
      void refetchEvents();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to duplicate event. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      void refetchEvents();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update event status",
        variant: "destructive",
      });
    },
  });

  const deleteEventMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event deleted successfully",
      });
      void refetchEvents();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete event",
        variant: "destructive",
      });
    },
  });

  // Extract data from tRPC responses with type validation
  const allEvents: DbEvent[] = isValidEventsData(eventsData)
    ? eventsData.events
    : [];
  const servers = isValidServersData(serversData) ? serversData.servers : [];

  // Helper function to safely map DbEvent to Event type
  function mapDbEventToEvent(event: DbEvent): Event {
    // Validate that the event has required fields
    if (typeof event !== "object" || event === null) {
      throw new Error("Invalid event data");
    }

    const dbEvent = event as Record<string, unknown>;

    const mappedEvent: Event = {
      id: typeof dbEvent.id === "number" ? dbEvent.id : 0,
      name: typeof dbEvent.name === "string" ? dbEvent.name : "",
      description:
        typeof dbEvent.description === "string" ? dbEvent.description : null,
      shared: typeof dbEvent.shared === "boolean" ? dbEvent.shared : false,
      type: dbEvent.type as Event["type"],
      status: dbEvent.status as Event["status"],
      content: typeof dbEvent.content === "string" ? dbEvent.content : null,
      scheduleNumber:
        typeof dbEvent.scheduleNumber === "number" ? dbEvent.scheduleNumber : 1,
      scheduleUnit:
        typeof dbEvent.scheduleUnit === "string"
          ? (dbEvent.scheduleUnit as TimeUnit)
          : TimeUnit.MINUTES,
      customSchedule:
        typeof dbEvent.customSchedule === "string"
          ? dbEvent.customSchedule
          : null,
      userId: typeof dbEvent.userId === "string" ? dbEvent.userId : "",
      createdAt:
        dbEvent.createdAt instanceof Date
          ? dbEvent.createdAt.toISOString()
          : new Date().toISOString(),
      updatedAt:
        dbEvent.updatedAt instanceof Date
          ? dbEvent.updatedAt.toISOString()
          : new Date().toISOString(),
      lastRunAt:
        dbEvent.lastRunAt instanceof Date
          ? dbEvent.lastRunAt.toISOString()
          : null,
      nextRunAt:
        dbEvent.nextRunAt instanceof Date
          ? dbEvent.nextRunAt.toISOString()
          : null,
      tags: Array.isArray(dbEvent.tags)
        ? dbEvent.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      serverId: typeof dbEvent.serverId === "number" ? dbEvent.serverId : null,
      timeoutUnit:
        typeof dbEvent.timeoutUnit === "string"
          ? (dbEvent.timeoutUnit as TimeUnit)
          : TimeUnit.SECONDS,
    };

    // Add optional properties if they exist and are valid
    if (typeof dbEvent.successCount === "number") {
      mappedEvent.successCount = dbEvent.successCount;
    }
    if (typeof dbEvent.failureCount === "number") {
      mappedEvent.failureCount = dbEvent.failureCount;
    }
    if (typeof dbEvent.httpMethod === "string") {
      mappedEvent.httpMethod = dbEvent.httpMethod;
    }
    if (typeof dbEvent.httpUrl === "string") {
      mappedEvent.httpUrl = dbEvent.httpUrl;
    }
    if (Array.isArray(dbEvent.httpHeaders)) {
      mappedEvent.httpHeaders = dbEvent.httpHeaders.filter(
        (header): header is { key: string; value: string } =>
          typeof header === "object" &&
          header !== null &&
          typeof (header as { key?: unknown }).key === "string" &&
          typeof (header as { value?: unknown }).value === "string",
      );
    }
    if (typeof dbEvent.httpBody === "string") {
      mappedEvent.httpBody = dbEvent.httpBody;
    }
    if (typeof dbEvent.runLocation === "string") {
      mappedEvent.runLocation = dbEvent.runLocation;
    }
    if (typeof dbEvent.timeoutValue === "number") {
      mappedEvent.timeoutValue = dbEvent.timeoutValue;
    }
    if (typeof dbEvent.retries === "number") {
      mappedEvent.retries = dbEvent.retries;
    }

    return mappedEvent;
  }

  // Filter events by serverId and safely map to component Event type
  const events: Event[] = allEvents
    .filter((event): event is DbEvent => {
      return (
        typeof event === "object" &&
        event !== null &&
        typeof (event as { serverId?: unknown }).serverId === "number" &&
        (event as { serverId: number }).serverId === serverId
      );
    })
    .map(mapDbEventToEvent);

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

  // Apply search filter
  const filteredEvents = events.filter((event) => {
    const matchesSearch =
      !filters.searchTerm ||
      event.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      event.description
        ?.toLowerCase()
        .includes(filters.searchTerm.toLowerCase());

    return matchesSearch;
  });

  // Apply sorting to filtered events
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

      await runEventMutation.mutateAsync({ id: eventId });
    } catch (error) {
      console.error(
        "Error running event:",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      updateState({
        isRunning: { ...state.isRunning, [eventId]: false },
      });
    }
  };

  const handleDuplicateEvent = async (eventId: number) => {
    try {
      // Find the event to duplicate
      const eventToDuplicate = events.find((e) => e.id === eventId);
      if (!eventToDuplicate) {
        toast({
          title: "Error",
          description: "Event not found",
          variant: "destructive",
        });
        return;
      }

      // Create a new event with the same properties
      await duplicateEventMutation.mutateAsync({
        name: `${eventToDuplicate.name} (Copy)`,
        description: eventToDuplicate.description ?? undefined,
        type: eventToDuplicate.type,
        status: EventStatus.DRAFT,
        content: eventToDuplicate.content ?? undefined,
        scheduleNumber: eventToDuplicate.scheduleNumber,
        scheduleUnit: eventToDuplicate.scheduleUnit as TimeUnit,
        customSchedule: eventToDuplicate.customSchedule ?? undefined,
        runLocation: (eventToDuplicate.runLocation ??
          RunLocation.LOCAL) as RunLocation,
        ...(eventToDuplicate.serverId && {
          serverId: eventToDuplicate.serverId,
        }),
        timeoutValue: eventToDuplicate.timeoutValue ?? 30,
        timeoutUnit: (eventToDuplicate.timeoutUnit ??
          TimeUnit.SECONDS) as TimeUnit,
        retries: eventToDuplicate.retries ?? 0,
        ...(eventToDuplicate.httpMethod && {
          httpMethod: eventToDuplicate.httpMethod,
        }),
        ...(eventToDuplicate.httpUrl && { httpUrl: eventToDuplicate.httpUrl }),
        ...(eventToDuplicate.httpHeaders && {
          httpHeaders: eventToDuplicate.httpHeaders,
        }),
        ...(eventToDuplicate.httpBody && {
          httpBody: eventToDuplicate.httpBody,
        }),
      });
    } catch (error) {
      console.error(
        "Error duplicating event:",
        error instanceof Error ? error.message : "Unknown error",
      );
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

    try {
      await updateEventMutation.mutateAsync({
        id: eventId,
        status: newStatus,
      });

      toast({
        title: "Success",
        description: `Event ${actionText} successfully`,
      });
    } catch (error) {
      console.error(
        `Error updating event status:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };

  const confirmDelete = (eventId: number) => {
    setDeleteEventId(eventId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteEvent = async () => {
    if (!deleteEventId) return;

    try {
      await deleteEventMutation.mutateAsync({ id: deleteEventId });
    } catch (error) {
      console.error(
        "Error deleting event:",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsDeleteDialogOpen(false);
      setDeleteEventId(null);
    }
  };

  // Sort options for the sort dropdown
  const sortOptions = [
    { value: "name", label: t("Alphabetical") ?? "Alphabetical" },
    { value: "createdAt", label: t("DateCreated") ?? "Date Created" },
    { value: "lastRunAt", label: t("LastExecution") ?? "Last Execution" },
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
              placeholder={t("SearchPlaceholder") ?? "Search events..."}
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
        onEventFork={handleDuplicateEvent} // Fork uses same logic as duplicate
        onEventStatusChange={handleStatusChange}
        onEventDelete={confirmDelete}
        isRunning={state.isRunning}
        isLoading={Boolean(isLoading)}
        searchTerm={filters.searchTerm ?? ""}
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
