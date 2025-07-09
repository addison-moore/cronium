"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ToolHealthIndicatorProps {
  toolId: number;
  toolName: string;
  className?: string;
  showTestButton?: boolean;
  onHealthChange?: (healthy: boolean) => void;
}

type HealthStatus = "healthy" | "unhealthy" | "unknown" | "checking";

export function ToolHealthIndicator({
  toolId,
  className,
  showTestButton = true,
  onHealthChange,
}: ToolHealthIndicatorProps) {
  const [status, setStatus] = useState<HealthStatus>("unknown");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const { toast } = useToast();

  const testConnectionMutation = trpc.tools.testConnection.useMutation({
    onSuccess: (result) => {
      const isHealthy = result.valid;
      setStatus(isHealthy ? "healthy" : "unhealthy");
      setLastChecked(new Date());
      onHealthChange?.(isHealthy);

      if (!isHealthy && result.error) {
        toast({
          title: "Connection Failed",
          description: result.error,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      setStatus("unhealthy");
      setLastChecked(new Date());
      onHealthChange?.(false);

      toast({
        title: "Connection Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = () => {
    setStatus("checking");
    testConnectionMutation.mutate({ id: toolId });
  };

  const getStatusIcon = () => {
    switch (status) {
      case "healthy":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "unhealthy":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "checking":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "healthy":
        return "Connected";
      case "unhealthy":
        return "Disconnected";
      case "checking":
        return "Checking...";
      default:
        return "Not tested";
    }
  };

  const getLastCheckedText = () => {
    if (!lastChecked) return "Never tested";

    const now = new Date();
    const diff = now.getTime() - lastChecked.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "Just now";
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {getStatusIcon()}
              <span className="text-sm font-medium">{getStatusText()}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Last checked: {getLastCheckedText()}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showTestButton && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTestConnection}
          disabled={status === "checking"}
          className="h-7 px-2"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              status === "checking" && "animate-spin",
            )}
          />
          <span className="ml-1.5 text-xs">Test</span>
        </Button>
      )}
    </div>
  );
}

// Compact version for use in lists
export function ToolHealthBadge({
  toolId,
  onHealthChange,
}: {
  toolId: number;
  onHealthChange?: (healthy: boolean) => void;
}) {
  const [status, setStatus] = useState<HealthStatus>("unknown");

  const testConnectionMutation = trpc.tools.testConnection.useMutation({
    onSuccess: (result) => {
      const isHealthy = result.valid;
      setStatus(isHealthy ? "healthy" : "unhealthy");
      onHealthChange?.(isHealthy);
    },
    onError: () => {
      setStatus("unhealthy");
      onHealthChange?.(false);
    },
  });

  // Auto-check on mount
  useEffect(() => {
    testConnectionMutation.mutate({ id: toolId });
  }, [toolId]);

  const getVariant = ():
    | "default"
    | "destructive"
    | "secondary"
    | "outline" => {
    switch (status) {
      case "healthy":
        return "default";
      case "unhealthy":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <Badge variant={getVariant()} className="h-5 px-1.5 text-xs">
      {status === "checking" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === "healthy" ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : status === "unhealthy" ? (
        <XCircle className="h-3 w-3" />
      ) : (
        <AlertCircle className="h-3 w-3" />
      )}
    </Badge>
  );
}
