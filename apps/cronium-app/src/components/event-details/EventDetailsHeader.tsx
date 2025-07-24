"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Play, RefreshCw } from "lucide-react";
import { type EventStatus } from "@/shared/schema";
import { Button } from "@cronium/ui";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import { useTranslations } from "next-intl";
import { type Event } from "./types";
import { EventTypeIcon } from "@/components/ui/event-type-icon";

interface EventDetailsHeaderProps {
  event: Event;
  langParam: string;
  onDelete: () => void;
  onRun: () => Promise<void>;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  isRunning: boolean;
}

export function EventDetailsHeader({
  event,
  langParam,
  onDelete,
  onRun,
  onStatusChange,
  isRunning,
}: EventDetailsHeaderProps) {
  const t = useTranslations("Events");

  return (
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button variant="ghost" size="sm" asChild className="h-8 w-fit">
          <Link href={`/${langParam}/dashboard/events`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("backToEvents")}
          </Link>
        </Button>
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
      </div>

      <div className="flex flex-wrap justify-start gap-2 lg:justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
        >
          {isRunning ? (
            <>
              <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
              <span className="sm:inline">{t("running")}</span>
            </>
          ) : (
            <>
              <Play className="mr-1.5 h-4 w-4" />
              <span className="sm:inline">{t("runNow")}</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900 dark:hover:text-red-200"
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          <span className="sm:inline">{t("delete")}</span>
        </Button>
      </div>
    </div>
  );
}
