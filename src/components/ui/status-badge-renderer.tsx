"use client";

import {
  EventStatus,
  LogStatus,
  WorkflowTriggerType,
  ConditionalActionType,
} from "@/shared/schema";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Check,
  AlertTriangle,
  Clock,
  Code,
  Mail,
  Globe,
  Calendar,
  Hand,
  RefreshCw,
} from "lucide-react";

// Union type for all possible status values
type StatusValue =
  | EventStatus
  | LogStatus
  | WorkflowTriggerType
  | ConditionalActionType
  | string;

interface StatusBadgeRendererProps {
  status: StatusValue;
  type?: "script" | "log" | "workflow" | "event";
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

/**
 * Component to standardize status badge rendering across the application
 */
export function StatusBadgeRenderer({
  status,
  type = "script",
  size = "md",
  showIcon = true,
}: StatusBadgeRendererProps) {
  // Get the appropriate status variant and icon based on type and status
  let statusType:
    | "success"
    | "warning"
    | "failure"
    | "running"
    | "info"
    | "pending" = "info";
  let displayLabel = status;
  let icon = null;

  // Handle script status badges
  if (type === "script") {
    switch (status) {
      case EventStatus.ACTIVE:
        statusType = "success";
        displayLabel = "Active";
        icon = showIcon ? <Check className="h-3 w-3" /> : null;
        break;
      case EventStatus.PAUSED:
        statusType = "warning";
        displayLabel = "Paused";
        icon = showIcon ? <Clock className="h-3 w-3" /> : null;
        break;
      case EventStatus.DRAFT:
        statusType = "pending";
        displayLabel = "Draft";
        break;
      default:
        statusType = "info";
        displayLabel = typeof status === "string" ? status : "Unknown";
    }
  }

  // Handle log status badges
  if (type === "log") {
    switch (status) {
      case LogStatus.SUCCESS:
        statusType = "success";
        displayLabel = "Success";
        icon = showIcon ? <Check className="h-3 w-3" /> : null;
        break;
      case LogStatus.FAILURE:
        statusType = "failure";
        displayLabel = "Failed";
        icon = showIcon ? <AlertTriangle className="h-3 w-3" /> : null;
        break;
      case LogStatus.RUNNING:
        statusType = "running";
        displayLabel = "Running";
        icon = showIcon ? <RefreshCw className="h-3 w-3 animate-spin" /> : null;
        break;
      case LogStatus.PAUSED:
        statusType = "warning";
        displayLabel = "Paused";
        icon = showIcon ? <Clock className="h-3 w-3" /> : null;
        break;
      case LogStatus.TIMEOUT:
        statusType = "warning";
        displayLabel = "Timeout";
        icon = showIcon ? <Clock className="h-3 w-3" /> : null;
        break;
      case LogStatus.PARTIAL:
        statusType = "warning";
        displayLabel = "Partial";
        icon = showIcon ? <AlertTriangle className="h-3 w-3" /> : null;
        break;
      default:
        statusType = "pending";
        displayLabel = typeof status === "string" ? status : "Unknown";
    }
  }

  // Handle workflow trigger type badges
  if (type === "workflow") {
    switch (status) {
      case WorkflowTriggerType.SCHEDULE:
        statusType = "info";
        displayLabel = "Schedule";
        icon = showIcon ? <Calendar className="h-3 w-3" /> : null;
        break;
      case WorkflowTriggerType.WEBHOOK:
        statusType = "success";
        displayLabel = "Webhook";
        icon = showIcon ? <Globe className="h-3 w-3" /> : null;
        break;
      case WorkflowTriggerType.MANUAL:
        statusType = "warning";
        displayLabel = "Manual";
        icon = showIcon ? <Hand className="h-3 w-3" /> : null;
        break;
      default:
        statusType = "info";
        displayLabel = typeof status === "string" ? status : "Unknown";
    }
  }

  // Handle event type badges
  if (type === "event") {
    switch (status) {
      case ConditionalActionType.SEND_MESSAGE:
        statusType = "info";
        displayLabel = "Message";
        icon = showIcon ? <Mail className="h-3 w-3" /> : null;
        break;
      case ConditionalActionType.SCRIPT:
        statusType = "warning";
        displayLabel = "Script";
        icon = showIcon ? <Code className="h-3 w-3" /> : null;
        break;
      default:
        statusType = "info";
        displayLabel = typeof status === "string" ? status : "Unknown";
    }
  }

  return (
    <StatusBadge
      status={statusType}
      label={displayLabel}
      size={size}
      icon={icon}
    />
  );
}
