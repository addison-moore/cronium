"use client";

import { useEffect, useState } from "react";
import { Log, LogStatus } from "@/shared/schema";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
          <CardTitle className="text-xl flex items-center gap-2">
            Execution Log #{log.id}
            {getBadgeStatus(log.status)}
          </CardTitle>
          <CardDescription>
            {log.eventName || `Script #${log.eventId}`} - {formattedTime}
            {formattedDuration && (
              <span className="ml-2">({formattedDuration})</span>
            )}
          </CardDescription>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Refresh log"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center mb-2">
          <Terminal size={18} className="mr-2" />
          <h3 className="font-medium">Output</h3>
        </div>
        <div className="bg-black text-white p-4 rounded-md overflow-auto max-h-80 font-mono text-sm">
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
