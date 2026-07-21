"use client";
import React from "react";
import { Server, CircleCheck, RefreshCw, Info, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { type Event } from "./types";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import WorkflowsCard from "./WorkflowsCard";
import { ScheduleIncidentsCard } from "./ScheduleIncidentsCard";
import { formatDate as formatDateUtil } from "@/lib/utils";

const copy = {
  never: "Never",
  every: "Every",
  eventInfo: "Event Information",
  eventName: "Event Name",
  eventId: "Event ID",
  tags: "Tags",
  scriptType: "Event Type",
  scheduleInfo: "Schedule Information",
  schedule: "Schedule",
  lastRun: "Last Run",
  nextRun: "Next Run",
  timeout: "Timeout",
  executionInfo: "Execution Information",
  executionLocation: "Execution Location",
  retryAttempts: "Retry Attempts",
  executionStats: "Execution Stats",
  successful: "Successful",
  failed: "Failed",
  total: "Total",
  executionCounter: "Execution Counter",
  resetting: "Resetting...",
  resetCounter: "Reset Counter",
  maxExecutions: "Max Executions",
  unlimited: "Unlimited",
  resetCounterOnActive: "Reset Counter on Activation",
  enabled: "Enabled",
  disabled: "Disabled",
} as const;

interface EventOverviewTabProps {
  event: Event;
  onResetCounter: () => void;
  isResettingCounter: boolean;
  isEventLoaded?: boolean;
  onRefresh?: () => Promise<void>;
}

export function EventOverviewTab({
  event,
  onResetCounter,
  isResettingCounter,
  isEventLoaded = true,
  onRefresh: _onRefresh,
}: EventOverviewTabProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return copy.never;
    return formatDateUtil(dateString);
  };

  const formatSchedule = () => {
    if (event.customSchedule) {
      return (
        <span className="bg-muted rounded-md p-1 font-mono text-xs">
          {event.customSchedule}
        </span>
      );
    }

    return `${copy.every} ${event.scheduleNumber} ${event.scheduleUnit.toLowerCase()}`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Event Info - Combined Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              <div className="flex items-center">
                <Info className="text-info mr-2 h-5 w-5" />
                {copy.eventInfo}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Event Basic Info */}
            <div className="border-border space-y-3 border-b pb-3">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {copy.eventName}:{" "}
                </span>
                <span className="font-medium">{event.name}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{copy.eventId}: </span>
                <span className="bg-muted rounded-md p-1 font-mono text-xs">
                  {event.id}
                </span>
              </div>
              {event.tags &&
                Array.isArray(event.tags) &&
                event.tags.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{copy.tags}: </span>
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
                  {copy.scriptType}:{" "}
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
                {copy.scheduleInfo}
              </h4>
              <div className="text-sm">
                <span className="text-muted-foreground">{copy.schedule}: </span>
                <span className="font-medium">{formatSchedule()}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{copy.lastRun}: </span>
                <span className="font-medium">
                  {formatDate(event.lastRunAt)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{copy.nextRun}: </span>
                <span className="font-medium">
                  {formatDate(event.nextRunAt)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{copy.timeout}: </span>
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
                <Server className="text-primary mr-2 h-5 w-5" />
                {copy.executionInfo}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Execution Details */}
            <div className="border-border space-y-3 border-b pb-3">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {copy.executionLocation}:{" "}
                </span>
                {event.runLocation !== "LOCAL" &&
                event.servers &&
                event.servers.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {event.runLocation === "LOCAL_AND_REMOTE" && (
                      <div className="flex items-center font-medium">
                        <Server className="mr-2 h-4 w-4" />
                        <span>Local</span>
                        <span className="text-muted-foreground ml-2">
                          (Cronium host)
                        </span>
                      </div>
                    )}
                    {event.servers.map((server) => (
                      <div
                        key={server.id}
                        className="flex items-center font-medium"
                      >
                        <Server className="text-primary mr-2 h-4 w-4" />
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
                    {event.runLocation === "LOCAL_AND_REMOTE"
                      ? "Local + Remote"
                      : event.runLocation}
                  </span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {copy.retryAttempts}:{" "}
                </span>
                <span className="font-medium">{event.retries}</span>
              </div>
            </div>

            {/* Execution Stats */}
            <div className="space-y-3">
              <h4 className="text-muted-foreground flex items-center text-sm font-medium">
                <CircleCheck className="mr-1.5 h-4 w-4" />
                {copy.executionStats}
              </h4>
              <div className="mt-1 flex items-center gap-4">
                <div className="flex items-center">
                  <span className="text-success mr-2 text-lg font-bold">
                    {event.successCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {copy.successful}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-destructive mr-2 text-lg font-bold">
                    {event.failureCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {copy.failed}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-info mr-2 text-lg font-bold">
                    {(event.successCount ?? 0) + (event.failureCount ?? 0)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {copy.total}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-4">
                <div className="flex items-center">
                  <span className="text-primary mr-2 text-lg font-bold">
                    {event.executionCount ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {copy.executionCounter}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResetCounter}
                  disabled={isResettingCounter}
                >
                  {isResettingCounter ? (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4 motion-safe:animate-spin" />
                      <span className="sm:inline">{copy.resetting}</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                      <span className="sm:inline">{copy.resetCounter}</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {copy.maxExecutions}:{" "}
                </span>
                <span className="font-medium">
                  {event.maxExecutions === 0
                    ? copy.unlimited
                    : event.maxExecutions}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {copy.resetCounterOnActive}:{" "}
                </span>
                <span className="font-medium">
                  {event.resetCounterOnActive === true ||
                  (typeof event.resetCounterOnActive === "string" &&
                    event.resetCounterOnActive === "t") ? (
                    <span className="text-success">{copy.enabled}</span>
                  ) : (
                    <span className="text-gray-500">{copy.disabled}</span>
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Schedule incidents (renders only when there are any) */}
        <ScheduleIncidentsCard eventId={event.id} />

        {/* Workflows Card */}
        <WorkflowsCard eventId={event.id} eventLoaded={isEventLoaded} />
      </div>
    </div>
  );
}
