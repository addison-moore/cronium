"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { EventStatus } from "@/shared/schema";
import { Button } from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import {
  StandardizedTable,
  type StandardizedTableColumn,
  StandardizedTableLink,
  type StandardizedTableAction,
} from "@cronium/ui";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { parseToolActionConfig } from "@/lib/tools/tool-action-config";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@cronium/ui";
import {
  Eye,
  Edit,
  Copy,
  RefreshCw,
  Loader2,
  Archive,
  Trash2,
  Play,
  GitBranch,
  Share2,
} from "lucide-react";
import { type Event, type ServerData } from "./types";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const copy = {
  notScheduled: "Not Scheduled",
  overdue: "Overdue",
  lessThanMinute: "Less than a minute",
  never: "Never",
  eventName: "Event Name",
  sharedEvent: "Shared Event",
  server: "Server",
  nextRun: "Next Run",
  lastRun: "Last Run",
  status: "Status",
  runEvent: "Run Event",
  viewDetails: "View Details",
  fork: "Fork",
  editEvent: "Edit Event",
  duplicate: "Duplicate",
  unarchive: "Unarchive",
  archive: "Archive",
  delete: "Delete",
  noEventsFound: "No events found",
  noEventsDescription: "There are no events matching your filters.",
} as const;

interface EventsTableProps {
  events: Event[];
  servers: ServerData[];
  selectedEvents: Set<number>;
  onSelectedEventsChange: (selected: Set<number>) => void;
  onEventRun: (id: number) => void;
  onEventDuplicate: (id: number) => void;
  onEventFork: (id: number) => void;
  onEventStatusChange: (id: number, status: EventStatus) => void;
  onEventDelete: (id: number) => void;
  isRunning: Record<number, boolean>;
  isLoading: boolean;
  searchTerm: string;
}

export function EventsTable({
  events,
  servers,
  selectedEvents,
  onSelectedEventsChange,
  onEventRun,
  onEventDuplicate,
  onEventFork,
  onEventStatusChange,
  onEventDelete,
  isRunning,
  isLoading,
  searchTerm,
}: EventsTableProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const formatNextRunTime = (nextRunAt: string | null): string => {
    if (!nextRunAt) return copy.notScheduled;

    // Only calculate relative time on the client to avoid hydration mismatches
    if (!isClient) {
      return formatDate(nextRunAt);
    }

    const nextRun = new Date(nextRunAt);
    const now = new Date();

    // If it's in the past, show "Overdue"
    if (nextRun < now) return copy.overdue;

    const diffMs = nextRun.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return copy.lessThanMinute;
    if (diffMins < 60) {
      return diffMins === 1 ? "1 minute" : `${diffMins} minutes`;
    }

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return diffHours === 1 ? "1 hour" : `${diffHours} hours`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? "1 day" : `${diffDays} days`;
  };

  const formatLastRunTime = (lastRunAt: string | null): string => {
    if (!lastRunAt) return copy.never;
    return formatDate(lastRunAt);
  };

  const formatServerLocation = (event: Event): string => {
    // If runLocation is explicitly set to local, show "local"
    if (event.runLocation?.toUpperCase() === "LOCAL") {
      return "local";
    }

    // Events that run locally AND on servers show both
    const localPrefix =
      event.runLocation?.toUpperCase() === "LOCAL_AND_REMOTE" ? "local + " : "";

    // Check for multi-server configuration
    if (event.eventServers && event.eventServers.length > 0) {
      if (event.eventServers.length > 1) {
        return `${localPrefix}multi-server`;
      }
      // Single server from eventServers array
      const serverId = event.eventServers[0];
      const server = servers.find((s) => s.id === serverId);
      return (
        localPrefix + (server ? server.name : `Server ${String(serverId)}`)
      );
    }

    // Check legacy single serverId field
    if (event.serverId) {
      const server = servers.find((s) => s.id === event.serverId);
      return localPrefix + (server ? server.name : `Server ${event.serverId}`);
    }

    // Default to local if no server configuration
    return "local";
  };

  const handleSelectAll = () => {
    if (selectedEvents.size === events.length) {
      onSelectedEventsChange(new Set());
    } else {
      onSelectedEventsChange(new Set(events.map((event) => event.id)));
    }
  };

  const handleEventSelect = (eventId: number, checked: boolean) => {
    const newSelected = new Set(selectedEvents);
    if (checked) {
      newSelected.add(eventId);
    } else {
      newSelected.delete(eventId);
    }
    onSelectedEventsChange(newSelected);
  };

  // Define column configuration for the standardized table
  const columns: StandardizedTableColumn<Event>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={selectedEvents.size === events.length && events.length > 0}
          onCheckedChange={handleSelectAll}
          aria-label="Select all events"
          className="hover:bg-accent/10 cursor-pointer"
        />
      ),
      cell: (event) => (
        <Checkbox
          checked={selectedEvents.has(event.id)}
          onCheckedChange={(checked) => handleEventSelect(event.id, !!checked)}
          aria-label={`Select event ${event.name}`}
          className="hover:bg-accent/10 cursor-pointer"
        />
      ),
      className: "w-12",
    },
    {
      key: "name",
      header: copy.eventName,
      cell: (event) => {
        const isSharedEvent = event.userId !== user?.id;
        return (
          <div className="flex items-center">
            <div className="mr-2">
              <EventTypeIcon
                type={event.type}
                toolType={
                  parseToolActionConfig(event.toolActionConfig)?.toolType
                }
                size={16}
              />
            </div>
            <StandardizedTableLink href={`/dashboard/events/${event.id}`}>
              {event.name}
            </StandardizedTableLink>
            {isClient && isSharedEvent && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Share2 className="text-muted-foreground ml-2 h-4 w-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{copy.sharedEvent}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
    },
    {
      key: "server",
      header: copy.server,
      cell: (event) => (
        <span className="text-muted-foreground text-sm">
          {formatServerLocation(event)}
        </span>
      ),
    },
    {
      key: "schedule",
      header: copy.nextRun,
      cell: (event) => formatNextRunTime(event.nextRunAt),
    },
    {
      key: "lastRun",
      header: copy.lastRun,
      cell: (event) => formatLastRunTime(event.lastRunAt),
    },
    {
      key: "status",
      header: copy.status,
      cell: (event) => (
        <ClickableStatusBadge
          currentStatus={event.status}
          onStatusChange={async (newStatus) =>
            onEventStatusChange(event.id, newStatus)
          }
        />
      ),
    },
    {
      key: "run",
      header: "",
      cell: (event) => (
        <Button
          variant="outline"
          size="sm"
          className="border-success hover:bg-success/10 hover:text-success h-8 w-8 cursor-pointer rounded-full p-0 transition-colors"
          onClick={() => onEventRun(event.id)}
          disabled={isRunning[event.id]}
          title={copy.runEvent}
        >
          {isRunning[event.id] ? (
            <Loader2 className="text-success h-4 w-4 animate-spin" />
          ) : (
            <Play className="text-success h-4 w-4" />
          )}
          <span className="sr-only">{copy.runEvent}</span>
        </Button>
      ),
      className: "text-right w-[60px]",
    },
  ];

  return (
    <div className="rounded-md">
      <StandardizedTable
        data={events}
        columns={columns}
        actions={(event) => {
          const isSharedEvent = event.userId !== user?.id;

          if (isSharedEvent) {
            // Limited actions for shared events
            return [
              {
                label: copy.viewDetails,
                icon: <Eye className="h-4 w-4" />,
                onClick: () => router.push(`/dashboard/events/${event.id}`),
              },
              {
                label: copy.fork,
                icon: <GitBranch className="h-4 w-4" />,
                onClick: () => onEventFork(event.id),
              },
            ];
          }

          // Full actions for owned events
          return [
            {
              label: copy.viewDetails,
              icon: <Eye className="h-4 w-4" />,
              onClick: () => router.push(`/dashboard/events/${event.id}`),
            },
            {
              label: copy.editEvent,
              icon: <Edit className="h-4 w-4" />,
              onClick: () => router.push(`/dashboard/events/${event.id}#edit`),
            },
            {
              label: copy.duplicate,
              icon: <Copy className="h-4 w-4" />,
              onClick: () => onEventDuplicate(event.id),
            },
            ...(event.status === EventStatus.ARCHIVED
              ? [
                  {
                    label: copy.unarchive,
                    icon: <RefreshCw className="h-4 w-4" />,
                    onClick: () =>
                      onEventStatusChange(event.id, EventStatus.ACTIVE),
                  } as StandardizedTableAction,
                ]
              : [
                  {
                    label: copy.archive,
                    icon: <Archive className="h-4 w-4" />,
                    onClick: () =>
                      onEventStatusChange(event.id, EventStatus.ARCHIVED),
                  } as StandardizedTableAction,
                ]),
            {
              label: copy.delete,
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => onEventDelete(event.id),
              variant: "destructive" as const,
              separator: true,
            },
          ];
        }}
        isLoading={isLoading}
        emptyMessage={
          searchTerm ? copy.noEventsFound : copy.noEventsDescription
        }
      />
    </div>
  );
}
