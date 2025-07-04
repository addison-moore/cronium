"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EventStatus } from "@/shared/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  StandardizedTable,
  StandardizedTableColumn,
  StandardizedTableLink,
  StandardizedTableAction,
} from "@/components/ui/standardized-table";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import {
  Eye,
  Edit,
  Copy,
  RefreshCw,
  Archive,
  Trash2,
  Play,
} from "lucide-react";
import { Event, ServerData } from "./types";

interface EventsTableProps {
  events: Event[];
  servers: ServerData[];
  selectedEvents: Set<number>;
  onSelectedEventsChange: (selected: Set<number>) => void;
  onEventRun: (id: number) => void;
  onEventDuplicate: (id: number) => void;
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
  onEventStatusChange,
  onEventDelete,
  isRunning,
  isLoading,
  searchTerm,
}: EventsTableProps) {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const t = useTranslations("Events");

  const formatNextRunTime = (nextRunAt: string | null): string => {
    if (!nextRunAt) return t("NotScheduled");

    const nextRun = new Date(nextRunAt);
    const now = new Date();

    // If it's in the past, show "Overdue"
    if (nextRun < now) return t("Status.Overdue");

    const diffMs = nextRun.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t("LessThanMinute");
    if (diffMins < 60)
      return diffMins > 1
        ? t("MinutesPlural", { count: diffMins })
        : t("MinuteSingular", { count: diffMins });

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24)
      return diffHours > 1
        ? t("HoursPlural", { count: diffHours })
        : t("HourSingular", { count: diffHours });

    const diffDays = Math.floor(diffHours / 24);
    return diffDays > 1
      ? t("DaysPlural", { count: diffDays })
      : t("DaySingular", { count: diffDays });
  };

  const formatLastRunTime = (lastRunAt: string | null): string => {
    if (!lastRunAt) return t("Never");
    return new Date(lastRunAt).toLocaleString();
  };

  const formatServerLocation = (event: Event): string => {
    // If runLocation is explicitly set to local, show "local"
    if (event.runLocation === "local") {
      return "local";
    }

    // Check for multi-server configuration
    if (event.eventServers && event.eventServers.length > 0) {
      if (event.eventServers.length > 1) {
        return "multi-server";
      }
      // Single server from eventServers array
      const serverId = event.eventServers[0];
      const server = servers.find((s) => s.id === serverId);
      return server ? server.name : `Server ${serverId}`;
    }

    // Check legacy single serverId field
    if (event.serverId) {
      const server = servers.find((s) => s.id === event.serverId);
      return server ? server.name : `Server ${event.serverId}`;
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
          className="cursor-pointer hover:bg-accent/10"
        />
      ),
      cell: (event) => (
        <Checkbox
          checked={selectedEvents.has(event.id)}
          onCheckedChange={(checked) => handleEventSelect(event.id, !!checked)}
          aria-label={`Select event ${event.name}`}
          className="cursor-pointer hover:bg-accent/10"
        />
      ),
      className: "w-12",
    },
    {
      key: "name",
      header: t("EventName"),
      cell: (event) => (
        <div className="flex items-center">
          <div className="mr-2">
            <EventTypeIcon type={event.type} size={16} />
          </div>
          <StandardizedTableLink
            href={`/${params.lang}/dashboard/events/${event.id}`}
          >
            {event.name}
          </StandardizedTableLink>
        </div>
      ),
    },
    {
      key: "server",
      header: t("Server"),
      cell: (event) => (
        <span className="text-sm text-muted-foreground">
          {formatServerLocation(event)}
        </span>
      ),
    },
    {
      key: "schedule",
      header: t("NextRun"),
      cell: (event) => formatNextRunTime(event.nextRunAt),
    },
    {
      key: "lastRun",
      header: t("LastRun"),
      cell: (event) => formatLastRunTime(event.lastRunAt),
    },
    {
      key: "status",
      header: t("StatusLabel"),
      cell: (event) => (
        <ClickableStatusBadge
          currentStatus={event.status}
          onStatusChange={(newStatus) =>
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
          className="h-8 w-8 p-0 border-green-500 dark:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 hover:text-green-600 dark:hover:text-green-500 transition-colors rounded-full cursor-pointer"
          onClick={() => onEventRun(event.id)}
          disabled={isRunning[event.id]}
          title={t("RunEvent")}
        >
          {isRunning[event.id] ? (
            <RefreshCw className="h-4 w-4 animate-spin text-green-500" />
          ) : (
            <Play className="h-4 w-4 text-green-500" />
          )}
          <span className="sr-only">{t("RunEvent")}</span>
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
        actions={(event) => [
          {
            label: t("ViewDetails"),
            icon: <Eye className="h-4 w-4" />,
            onClick: () =>
              router.push(`/${params.lang}/dashboard/events/${event.id}`),
          },
          {
            label: t("EditEvent"),
            icon: <Edit className="h-4 w-4" />,
            onClick: () =>
              router.push(`/${params.lang}/dashboard/events/${event.id}#edit`),
          },
          {
            label: "Duplicate Event",
            icon: <Copy className="h-4 w-4" />,
            onClick: () => onEventDuplicate(event.id),
          },
          ...(event.status === EventStatus.ARCHIVED
            ? [
                {
                  label: t("UnarchiveEvent"),
                  icon: <RefreshCw className="h-4 w-4" />,
                  onClick: () =>
                    onEventStatusChange(event.id, EventStatus.ACTIVE),
                } as StandardizedTableAction,
              ]
            : [
                {
                  label: t("ArchiveEvent"),
                  icon: <Archive className="h-4 w-4" />,
                  onClick: () =>
                    onEventStatusChange(event.id, EventStatus.ARCHIVED),
                } as StandardizedTableAction,
              ]),
          {
            label: t("DeleteEvent"),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: () => onEventDelete(event.id),
            variant: "destructive" as const,
            separator: true,
          },
        ]}
        isLoading={isLoading}
        emptyMessage={
          searchTerm ? t("NoEventsFound") : t("NoEventsDescription")
        }
      />
    </div>
  );
}
