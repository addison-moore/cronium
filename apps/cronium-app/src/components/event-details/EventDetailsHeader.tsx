"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Play, RefreshCw } from "lucide-react";
import { type EventStatus } from "@/shared/schema";
import { Button } from "@cronium/ui";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import { type Event } from "./types";
import { EventTypeIcon } from "@/components/ui/event-type-icon";

const copy = {
  backToEvents: "Back to Events",
  running: "Running...",
  runNow: "Run Now",
  delete: "Delete",
} as const;

interface EventDetailsHeaderProps {
  event: Event;
  onDelete: () => void;
  onRun: () => Promise<void>;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  isRunning: boolean;
}

export function EventDetailsHeader({
  event,
  onDelete,
  onRun,
  onStatusChange,
  isRunning,
}: EventDetailsHeaderProps) {
  return (
    <div className="mb-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="h-8 w-fit">
          <Link href="/dashboard/events">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {copy.backToEvents}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <EventTypeIcon type={event.type} size={20} />
            <h1 className="truncate text-xl font-bold">{event.name}</h1>
          </div>
          <ClickableStatusBadge
            currentStatus={event.status}
            onStatusChange={onStatusChange}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={isRunning}
            className="border-info/40 bg-info/10 text-info-text hover:bg-info/20"
          >
            {isRunning ? (
              <>
                <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                <span className="sm:inline">{copy.running}</span>
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-4 w-4" />
                <span className="sm:inline">{copy.runNow}</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="border-destructive/40 bg-destructive/10 text-destructive-text hover:bg-destructive/20"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            <span className="sm:inline">{copy.delete}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
