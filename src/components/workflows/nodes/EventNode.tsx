"use client";

import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { EventType } from "@/shared/schema";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";

// Event type styling
const eventTypeStyles: Record<string, { bg: string; text: string }> = {
  [EventType.NODEJS]: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  [EventType.PYTHON]: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-400",
  },
  [EventType.BASH]: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-400",
  },
  [EventType.HTTP_REQUEST]: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-400",
  },
};

function EventNode({ data, selected }: NodeProps) {
  let {
    label,
    type,
    eventId,
    description,
    tags,
    serverId,
    serverName,
    createdAt,
    updatedAt,
    updateEvents,
  } = data as {
    label: string;
    type: EventType;
    eventId: number;
    description?: string;
    tags?: string[];
    serverId?: number;
    serverName?: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
    updateEvents?: (eventId: number) => void;
  };

  const handleEventUpdated = () => {
    console.log("Event updated, refreshing node for event ID:", eventId);
    if (updateEvents) {
      updateEvents(eventId);
    } else {
      console.warn("updateEvents function not provided to EventNode");
    }
  };

  // Ensure type is a valid EventType
  const eventType = (type as EventType) || EventType.BASH;

  // Get styling based on script type
  const style = eventTypeStyles[eventType] || {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-700 dark:text-gray-400",
  };

  return (
    <div
      className={`event-node rounded-lg ${selected ? "ring-2 ring-primary ring-offset-2 dark:ring-offset-background" : ""}`}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-gray-300 dark:bg-gray-600 border-2 border-background dark:border-gray-800"
      />

      <Card className="w-48 shadow-sm border-border">
        <CardHeader
          className={`flex flex-row items-center justify-between py-2 px-3 ${style.bg} rounded-lg`}
        >
          <div className="flex items-center m-0">
            <EventTypeIcon
              type={eventType}
              size={16}
              className={`mr-1 ${style.text}`}
            />
            <span
              className={`truncate max-w-[128px] inline-block text-sm font-medium ${style.text}`}
            >
              {label || "Untitled"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <EventDetailsPopover
              eventId={eventId || 0}
              eventName={label || "Untitled"}
              eventType={eventType}
              {...(description !== undefined && { eventDescription: description })}
              {...(tags !== undefined && { eventTags: tags })}
              {...(serverId !== undefined && { eventServerId: serverId })}
              {...(serverName !== undefined && { eventServerName: serverName })}
              {...(createdAt !== undefined && { createdAt })}
              {...(updatedAt !== undefined && { updatedAt })}
              {...(handleEventUpdated !== undefined && { onEventUpdated: handleEventUpdated })}
            >
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 hover:bg-white/20 ${style.text}`}
                onClick={(e) => e.stopPropagation()}
              >
                <Info className="h-3 w-3" />
              </Button>
            </EventDetailsPopover>
          </div>
        </CardHeader>
      </Card>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-gray-300 dark:bg-gray-600 border-2 border-background dark:border-gray-800"
      />
    </div>
  );
}

export default memo(EventNode);
