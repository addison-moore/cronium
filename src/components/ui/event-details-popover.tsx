"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Info,
  Tag,
  Calendar,
  Server,
  Clock,
  FileText,
  ExternalLink,
  Edit,
} from "lucide-react";
import {
  EventTypeIcon,
  getEventTypeDisplayName,
} from "@/components/ui/event-type-icon";
import { type EventType } from "@/shared/schema";
import { formatDate } from "@/lib/utils";
import { EventEditModal } from "@/components/ui/event-edit-modal";

interface EventDetailsPopoverProps {
  eventId: number;
  eventName: string;
  eventType: EventType;
  eventDescription?: string;
  eventTags?: string[];
  eventServerId?: number;
  eventServerName?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  children: React.ReactNode;
  className?: string;
  onEventUpdated?: () => void;
}

export function EventDetailsPopover({
  eventId,
  eventName,
  eventType,
  eventDescription,
  eventTags = [],
  eventServerId,
  eventServerName,
  createdAt,
  updatedAt,
  children,
  className,
  onEventUpdated,
}: EventDetailsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild className={className}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" side="right" align="start">
        <div className="space-y-4 p-4">
          {/* Header with Event Name and Type */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <EventTypeIcon type={eventType} size={20} />
              <Link
                href={`/en/dashboard/events/${eventId}`}
                className="hover:text-primary flex items-center gap-1 text-lg font-semibold transition-colors"
                onClick={() => setOpen(false)}
              >
                {eventName}
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
            <Badge variant="secondary" className="w-fit">
              {getEventTypeDisplayName(eventType)}
            </Badge>
          </div>

          <Separator />

          {/* Event Details */}
          <ScrollArea className="max-h-64">
            <div className="space-y-3">
              {/* Event ID */}
              <div className="flex items-center gap-2 text-sm">
                <Info className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground">Event ID:</span>
                <span className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                  {eventId}
                </span>
              </div>

              {/* Description */}
              {eventDescription && (
                <div className="flex items-start gap-2 text-sm">
                  <FileText className="text-muted-foreground mt-0.5 h-4 w-4" />
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <p className="text-foreground mt-1">{eventDescription}</p>
                  </div>
                </div>
              )}

              {/* Tags */}
              {eventTags.length > 0 && (
                <div className="flex items-start gap-2 text-sm">
                  <Tag className="text-muted-foreground mt-0.5 h-4 w-4" />
                  <div>
                    <span className="text-muted-foreground">Tags:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {eventTags.map((tag, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Server */}
              {eventServerId && eventServerName && (
                <div className="flex items-center gap-2 text-sm">
                  <Server className="text-muted-foreground h-4 w-4" />
                  <span className="text-muted-foreground">Server:</span>
                  <span className="font-medium">{eventServerName}</span>
                </div>
              )}

              {/* Created Date */}
              {createdAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="text-muted-foreground h-4 w-4" />
                  <span className="text-muted-foreground">Created:</span>
                  <span>{formatDate(createdAt)}</span>
                </div>
              )}

              {/* Updated Date */}
              {updatedAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="text-muted-foreground h-4 w-4" />
                  <span className="text-muted-foreground">Updated:</span>
                  <span>{formatDate(updatedAt)}</span>
                </div>
              )}
            </div>
          </ScrollArea>

          <Separator />

          {/* Footer with Action Buttons */}
          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditModalOpen(true);
                setOpen(false);
              }}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit Event
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              <Link href={`/en/dashboard/events/${eventId}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Full Details
              </Link>
            </Button>
          </div>
        </div>
      </PopoverContent>

      {/* Event Edit Modal */}
      <EventEditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        eventId={eventId}
        {...(onEventUpdated && { onEventUpdated })}
      />
    </Popover>
  );
}
