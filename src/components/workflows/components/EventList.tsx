import React from "react";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";
import { useTranslations } from "next-intl";
import type { EventType } from "@/shared/schema";

interface Event {
  id: number;
  name: string;
  type: EventType;
  description?: string | null;
}

interface EventListProps {
  events: Event[];
  onDragStart: (event: React.DragEvent, eventData: Event) => void;
  updateEvents: () => void;
}

export function EventList({
  events,
  onDragStart,
  updateEvents,
}: EventListProps) {
  const t = useTranslations("workflows");

  if (events.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        {t("noEventsFound")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => (
        <div
          key={event.id}
          draggable
          onDragStart={(e) => onDragStart(e, event)}
          className="group bg-card hover:border-primary/20 hover:bg-accent/50 relative flex cursor-move items-center gap-3 rounded-lg border border-transparent p-3 transition-all hover:shadow-sm"
        >
          <EventTypeIcon type={event.type} className="h-5 w-5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{event.name}</p>
            {event.description && (
              <p className="text-muted-foreground truncate text-xs">
                {event.description}
              </p>
            )}
          </div>
          <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
            <EventDetailsPopover eventId={event.id} onUpdate={updateEvents} />
          </div>
        </div>
      ))}
    </div>
  );
}
