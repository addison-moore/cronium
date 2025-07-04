"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Play, RefreshCw } from "lucide-react";
import { EventStatus } from "@/shared/schema";
import { Button } from "@/components/ui/button";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";
import { useTranslations } from "next-intl";
import { Event } from "./types";
import { EventTypeIcon } from "@/components/ui/event-type-icon";

interface EventDetailsHeaderProps {
  event: Event;
  langParam: string;
  onDelete: () => void;
  onRun: () => Promise<void>;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  isRunning: boolean;
  onResetCounter: () => Promise<void>;
  isResettingCounter: boolean;
}

export function EventDetailsHeader({
  event,
  langParam,
  onDelete,
  onRun,
  onStatusChange,
  isRunning,
  onResetCounter,
  isResettingCounter,
}: EventDetailsHeaderProps) {
  const t = useTranslations("Events");

  return (
    <div className="flex flex-col lg:flex-row justify-between gap-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit h-8">
          <Link href={`/${langParam}/dashboard/events`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("backToEvents")}
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <EventTypeIcon type={event.type} size={20} />
            <h1 className="text-xl font-bold truncate">{event.name}</h1>
          </div>
          <ClickableStatusBadge
            currentStatus={event.status}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-center justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900"
        >
          {isRunning ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              <span className="sm:inline">{t("running")}</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-1.5" />
              <span className="sm:inline">{t("runNow")}</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:text-red-800 dark:bg-red-950 dark:text-red-300 dark:border-red-900 dark:hover:bg-red-900 dark:hover:text-red-200"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          <span className="sm:inline">{t("delete")}</span>
        </Button>
      </div>
    </div>
  );
}
