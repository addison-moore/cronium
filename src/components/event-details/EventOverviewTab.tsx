"use client";

import React from "react";
import { Server, CheckCircle2, RefreshCw, Info, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { type Event } from "./types";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import WorkflowsCard from "./WorkflowsCard";
import { RunLocation } from "@/shared/schema";

interface EventOverviewTabProps {
  event: Event;
  onResetCounter: () => void;
  isResettingCounter: boolean;
  isEventLoaded?: boolean;
  onRefresh?: () => Promise<void>;
  langParam?: string;
}

export function EventOverviewTab({
  event,
  onResetCounter,
  isResettingCounter,
  isEventLoaded = true,
  _onRefresh,
  _langParam,
}: EventOverviewTabProps) {
  const t = useTranslations("Events");

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t("never");
    return new Date(dateString).toLocaleString();
  };

  const formatSchedule = () => {
    if (event.customSchedule) {
      return (
        <span className="bg-muted rounded p-1 font-mono text-xs">
          {event.customSchedule}
        </span>
      );
    }

    return `${t("every")} ${event.scheduleNumber} ${event.scheduleUnit.toLowerCase()}`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Event Info - Combined Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              <div className="flex items-center">
                <Info className="mr-2 h-5 w-5 text-blue-500" />
                {t("eventInfo")}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Event Basic Info */}
            <div className="border-border space-y-3 border-b pb-3">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("eventName")}:{" "}
                </span>
                <span className="font-medium">{event.name}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("eventId")}: </span>
                <span className="bg-muted rounded p-1 font-mono text-xs">
                  {event.id}
                </span>
              </div>
              {event.tags &&
                Array.isArray(event.tags) &&
                event.tags.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{t("tags")}: </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {event.tags.map((tag: string, index: number) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="text-xs"
                        >
                          <Tag className="mr-1 h-3 w-3" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("scriptType")}:{" "}
                </span>
                <span className="flex items-center gap-1.5 font-medium">
                  <EventTypeIcon type={event.type} size={16} />
                  {event.type}
                </span>
              </div>
            </div>

            {/* Schedule Information */}
            <div className="space-y-3 pb-3">
              <h4 className="text-muted-foreground flex items-center text-sm font-medium">
                <RefreshCw className="mr-1.5 h-4 w-4" />
                {t("scheduleInfo")}
              </h4>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("schedule")}: </span>
                <span className="font-medium">{formatSchedule()}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("lastRun")}: </span>
                <span className="font-medium">
                  {formatDate(event.lastRunAt)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("nextRun")}: </span>
                <span className="font-medium">
                  {formatDate(event.nextRunAt)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("timeout")}: </span>
                <span className="font-medium">
                  {event.timeoutValue} {event.timeoutUnit.toLowerCase()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Execution Information */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              <div className="flex items-center">
                <Server className="mr-2 h-5 w-5 text-purple-500" />
                {t("executionInfo")}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Execution Details */}
            <div className="border-border space-y-3 border-b pb-3">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("executionLocation")}:{" "}
                </span>
                {event.runLocation === "REMOTE" &&
                event.servers &&
                event.servers.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {event.servers.map((server) => (
                      <div
                        key={server.id}
                        className="flex items-center font-medium"
                      >
                        <Server className="mr-2 h-4 w-4 text-purple-500" />
                        <span>{server.name}</span>
                        <span className="text-muted-foreground ml-2">
                          ({server.address})
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="flex items-center font-medium">
                    <Server className="mr-1 h-4 w-4" />
                    {event.runLocation}
                  </span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("retryAttempts")}:{" "}
                </span>
                <span className="font-medium">{event.retries}</span>
              </div>
            </div>

            {/* Execution Stats */}
            <div className="space-y-3">
              <h4 className="text-muted-foreground flex items-center text-sm font-medium">
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                {t("executionStats")}
              </h4>
              <div className="mt-1 flex items-center gap-4">
                <div className="flex items-center">
                  <span className="mr-2 text-lg font-bold text-green-500">
                    {event.successCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("successful")}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="mr-2 text-lg font-bold text-red-500">
                    {event.failureCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("failed")}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="mr-2 text-lg font-bold text-blue-500">
                    {(event.successCount ?? 0) + (event.failureCount ?? 0)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("total")}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-4">
                <div className="flex items-center">
                  <span className="mr-2 text-lg font-bold text-purple-500">
                    {event.executionCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("executionCounter")}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResetCounter}
                  disabled={isResettingCounter}
                  className="border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {isResettingCounter ? (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                      <span className="sm:inline">{t("resetting")}</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                      <span className="sm:inline">{t("resetCounter")}</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("maxExecutions")}:{" "}
                </span>
                <span className="font-medium">
                  {event.maxExecutions === 0
                    ? t("unlimited")
                    : event.maxExecutions}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {t("resetCounterOnActive")}:{" "}
                </span>
                <span className="font-medium">
                  {(event.resetCounterOnActive === true ??
                  (typeof event.resetCounterOnActive === "string" &&
                    event.resetCounterOnActive === "t")) ? (
                    <span className="text-green-500">{t("enabled")}</span>
                  ) : (
                    <span className="text-gray-500">{t("disabled")}</span>
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Workflows Card */}
        <WorkflowsCard eventId={event.id} eventLoaded={isEventLoaded} />
      </div>
    </div>
  );
}
