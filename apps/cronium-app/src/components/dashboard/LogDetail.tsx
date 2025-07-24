"use client";

import { useEffect, useState } from "react";
import { type Log, type LogStatus } from "@/shared/schema";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { RefreshCw, Terminal } from "lucide-react";
import { formatDistance } from "date-fns";

interface LogDetailProps {
  log: Log;
  onRefresh?: () => void;
}

export default function LogDetail({ log, onRefresh }: LogDetailProps) {
  const [formattedTime, setFormattedTime] = useState<string>("");
  const [formattedDuration, setFormattedDuration] = useState<string>("");

  useEffect(() => {
    if (log.startTime) {
      const start = new Date(log.startTime);
      setFormattedTime(formatDistance(start, new Date(), { addSuffix: true }));
    }

    if (log.duration) {
      // Format duration from milliseconds
      const durationMs = log.duration;
      if (durationMs < 1000) {
        setFormattedDuration(`${durationMs}ms`);
      } else if (durationMs < 60000) {
        setFormattedDuration(`${(durationMs / 1000).toFixed(2)}s`);
      } else {
        setFormattedDuration(`${(durationMs / 60000).toFixed(2)}m`);
      }
    }
  }, [log]);

  const getBadgeStatus = (status: LogStatus) => {
    return <StatusBadge status={status} size="sm" />;
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            Execution Log #{log.id}
            {getBadgeStatus(log.status)}
          </CardTitle>
          <CardDescription>
            {log.eventName ?? `Script #${log.eventId}`} - {formattedTime}
            {formattedDuration && (
              <span className="ml-2">({formattedDuration})</span>
            )}
          </CardDescription>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Refresh log"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center">
          <Terminal size={18} className="mr-2" />
          <h3 className="font-medium">Output</h3>
        </div>
        <div className="max-h-80 overflow-auto rounded-md bg-black p-4 font-mono text-sm text-white">
          {log.output ? (
            <pre className="whitespace-pre-wrap">{log.output}</pre>
          ) : (
            <span className="text-gray-400">No output</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
