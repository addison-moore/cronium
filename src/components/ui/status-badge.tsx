"use client";

import { type ReactNode, cloneElement, isValidElement } from "react";
import {
  EventStatus,
  LogStatus,
  UserStatus,
  type TokenStatus,
} from "@/shared/schema";
import {
  CheckCircle,
  XCircle,
  Clock,
  Pause,
  AlertCircle,
  AlertTriangle,
  Archive,
  RefreshCw,
  Info,
  Circle,
} from "lucide-react";

interface StatusConfig {
  label: string;
  color: string;
  textColor: string;
  bgColor: string;
  indicator: string;
  icon?: ReactNode;
  border?: string;
}

type StatusType =
  | EventStatus
  | LogStatus
  | UserStatus
  | TokenStatus
  | "success"
  | "failure"
  | "running"
  | "pending"
  | "warning"
  | "info"
  | "active"
  | "online"
  | "offline";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  showIndicator?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  className?: string;
  border?: string;
}

/**
 * Get status configuration for styling consistency across components
 */
export const getStatusConfig = (
  status: StatusType,
  icon?: ReactNode,
): StatusConfig => {
  switch (status) {
    case EventStatus.ACTIVE:
    case UserStatus.ACTIVE:
    case "active":
      return {
        label: "Active",
        color: "text-green-600 dark:text-green-400",
        textColor: "text-green-700 dark:text-green-300",
        bgColor: "bg-green-50 dark:bg-green-900/20",
        indicator: "bg-green-500",
        icon: icon ?? <CheckCircle />,
        border: "border-green-300 dark:border-green-600",
      };
    case LogStatus.SUCCESS:
    case "success":
      return {
        label: "Success",
        color: "text-green-600 dark:text-green-400",
        textColor: "text-green-700 dark:text-green-300",
        bgColor: "bg-green-50 dark:bg-green-900/20",
        indicator: "bg-green-500",
        icon: icon ?? <CheckCircle />,
        border: "border-green-300 dark:border-green-600",
      };
    case "online":
      return {
        label: "Online",
        color: "text-green-600 dark:text-green-400",
        textColor: "text-green-700 dark:text-green-300",
        bgColor: "bg-green-50 dark:bg-green-900/20",
        indicator: "bg-green-500",
        icon: icon ?? <Circle className="fill-current" />,
        border: "border-green-300 dark:border-green-600",
      };
    case "offline":
      return {
        label: "Offline",
        color: "text-red-600 dark:text-red-400",
        textColor: "text-red-700 dark:text-red-300",
        bgColor: "bg-red-50 dark:bg-red-900/20",
        indicator: "bg-red-500",
        icon: icon ?? <XCircle />,
        border: "border-red-300 dark:border-red-600",
      };
    case EventStatus.PAUSED:
    case LogStatus.PAUSED:
      return {
        label: "Paused",
        color: "text-yellow-600 dark:text-yellow-400",
        textColor: "text-yellow-700 dark:text-yellow-300",
        bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
        indicator: "bg-yellow-500",
        icon: icon ?? <Pause />,
        border: "border-yellow-300 dark:border-yellow-600",
      };
    case LogStatus.TIMEOUT:
      return {
        label: "Timeout",
        color: "text-amber-600 dark:text-amber-400",
        textColor: "text-amber-700 dark:text-amber-300",
        bgColor: "bg-amber-50 dark:bg-amber-900/20",
        indicator: "bg-amber-500",
        icon: icon ?? <Clock />,
        border: "border-amber-300 dark:border-amber-600",
      };
    case LogStatus.PARTIAL:
      return {
        label: "Partial",
        color: "text-orange-600 dark:text-orange-400",
        textColor: "text-orange-700 dark:text-orange-300",
        bgColor: "bg-orange-50 dark:bg-orange-900/20",
        indicator: "bg-orange-500",
        icon: icon ?? <AlertTriangle />,
        border: "border-orange-300 dark:border-orange-600",
      };
    case "warning":
      return {
        label: "Warning",
        color: "text-yellow-600 dark:text-yellow-400",
        textColor: "text-yellow-700 dark:text-yellow-300",
        bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
        indicator: "bg-yellow-500",
        icon: icon ?? <AlertCircle />,
        border: "border-yellow-300 dark:border-yellow-600",
      };
    case EventStatus.DRAFT:
      return {
        label: "Draft",
        color: "text-gray-600 dark:text-gray-400",
        textColor: "text-gray-700 dark:text-gray-300",
        bgColor: "bg-gray-50 dark:bg-gray-800",
        indicator: "bg-gray-500",
        icon: icon ?? <Circle />,
        border: "border-gray-300 dark:border-gray-600",
      };
    case LogStatus.PENDING:
    case "pending":
      return {
        label: "Pending",
        color: "text-gray-600 dark:text-gray-400",
        textColor: "text-gray-700 dark:text-gray-300",
        bgColor: "bg-gray-50 dark:bg-gray-800",
        indicator: "bg-gray-500",
        icon: icon ?? <Clock />,
        border: "border-gray-300 dark:border-gray-600",
      };
    case EventStatus.ARCHIVED:
      return {
        label: "Archived",
        color: "text-slate-600 dark:text-slate-400",
        textColor: "text-slate-700 dark:text-slate-300",
        bgColor: "bg-slate-50 dark:bg-slate-800",
        indicator: "bg-slate-500",
        icon: icon ?? <Archive />,
        border: "border-slate-300 dark:border-slate-600",
      };
    case LogStatus.RUNNING:
    case "running":
      return {
        label: "Running",
        color: "text-blue-600 dark:text-blue-400",
        textColor: "text-blue-700 dark:text-blue-300",
        bgColor: "bg-blue-50 dark:bg-blue-900/20",
        indicator: "bg-blue-500",
        icon: icon ?? <RefreshCw className="animate-spin" />,
        border: "border-blue-300 dark:border-blue-600",
      };
    case LogStatus.FAILURE:
    case "failure":
      return {
        label: "Failed",
        color: "text-red-600 dark:text-red-400",
        textColor: "text-red-700 dark:text-red-300",
        bgColor: "bg-red-50 dark:bg-red-900/20",
        indicator: "bg-red-500",
        icon: icon ?? <XCircle />,
        border: "border-red-300 dark:border-red-600",
      };
    case UserStatus.INVITED:
      return {
        label: "Invited",
        color: "text-purple-600 dark:text-purple-400",
        textColor: "text-purple-700 dark:text-purple-300",
        bgColor: "bg-purple-50 dark:bg-purple-900/20",
        indicator: "bg-purple-500",
        icon: icon ?? <Clock />,
        border: "border-purple-300 dark:border-purple-600",
      };
    case UserStatus.DISABLED:
      return {
        label: "Disabled",
        color: "text-red-600 dark:text-red-400",
        textColor: "text-red-700 dark:text-red-300",
        bgColor: "bg-red-50 dark:bg-red-900/20",
        indicator: "bg-red-500",
        icon: icon ?? <XCircle />,
        border: "border-red-300 dark:border-red-600",
      };
    case UserStatus.PENDING:
      return {
        label: "Pending",
        color: "text-yellow-600 dark:text-yellow-400",
        textColor: "text-yellow-700 dark:text-yellow-300",
        bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
        indicator: "bg-yellow-500",
        icon: icon ?? <Clock />,
        border: "border-yellow-300 dark:border-yellow-600",
      };
    case "info":
      return {
        label: "Info",
        color: "text-indigo-600 dark:text-indigo-400",
        textColor: "text-indigo-700 dark:text-indigo-300",
        bgColor: "bg-indigo-50 dark:bg-indigo-900/20",
        indicator: "bg-indigo-500",
        icon: icon ?? <Info />,
        border: "border-indigo-300 dark:border-indigo-600",
      };
    default:
      return {
        label: "Unknown",
        color: "text-gray-600 dark:text-gray-400",
        textColor: "text-gray-700 dark:text-gray-300",
        bgColor: "bg-gray-50 dark:bg-gray-800",
        indicator: "bg-gray-500",
        icon: icon ?? <Circle />,
        border: "border-gray-300 dark:border-gray-600",
      };
  }
};

export const sizeClasses = {
  sm: "pr-2 pl-1 py-0.5 text-xs",
  md: "pr-2.5 pl-1.5 py-1 text-xs",
  lg: "pr-3 pl-2 py-1.5 text-sm",
};

export const indicatorSizeClasses = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
};

export const iconSizeClasses = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
};

/**
 * A reusable status badge component for displaying status with consistent styling
 */
export function StatusBadge({
  status,
  label,
  showIndicator = true,
  size = "md",
  icon,
  className = "",
}: StatusBadgeProps) {
  const config = getStatusConfig(status, icon);
  const displayLabel = label ?? config.label;

  return (
    <div
      className={`inline-flex items-center rounded-full border font-medium ${config.border ?? ""} ${sizeClasses[size]} ${config.bgColor} ${config.textColor} ${className ?? ""}`}
    >
      {config.icon ? (
        <span className="mr-0.5 flex-shrink-0">
          {isValidElement(config.icon)
            ? cloneElement(
                config.icon as React.ReactElement<{ className?: string }>,
                {
                  className: `${iconSizeClasses[size]} ${(config.icon as React.ReactElement<{ className?: string }>).props?.className ?? ""}`,
                },
              )
            : config.icon}
        </span>
      ) : showIndicator ? (
        <span
          className={`flex ${indicatorSizeClasses[size]} rounded-full ${config.indicator} mr-0.5`}
        ></span>
      ) : null}
      {displayLabel}
    </div>
  );
}
