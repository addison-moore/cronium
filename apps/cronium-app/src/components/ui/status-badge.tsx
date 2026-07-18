"use client";

import { type ReactNode, cloneElement, isValidElement } from "react";
import {
  EventStatus,
  LogStatus,
  UserStatus,
  type TokenStatus,
} from "@/shared/schema";
import {
  Archive,
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Info,
  Loader2,
  Pause,
} from "lucide-react";

/**
 * Canonical status semantics (see _plans/styling/Review.md §4):
 *
 *   success / active / online / completed -> success (green), CircleCheck
 *   failure / error / offline / disabled  -> destructive (red), CircleX
 *   running / in-progress                 -> info (blue), Loader2 spinning
 *   pending / queued / draft              -> neutral (gray), Clock (static)
 *   warning / paused / timeout / partial  -> warning (amber), AlertTriangle/Pause
 *   informational                         -> info (blue), Info
 *   archived / invited                    -> brand (violet), Archive/Clock
 *
 * All colors come from the semantic tokens in @cronium/ui/styles.css —
 * never raw palette classes. One hue per state, everywhere.
 */

type StatusTheme = {
  /** Icon/accent color (the hue anchor) */
  color: string;
  /** Label text readable on the tinted fill */
  textColor: string;
  /** Translucent tinted fill */
  bgColor: string;
  /** Solid indicator dot */
  indicator: string;
  /** Tinted border */
  border: string;
};

const THEMES = {
  success: {
    color: "text-success",
    textColor: "text-success-text",
    bgColor: "bg-success/10",
    indicator: "bg-success",
    border: "border-success/40",
  },
  destructive: {
    color: "text-destructive",
    textColor: "text-destructive-text",
    bgColor: "bg-destructive/10",
    indicator: "bg-destructive",
    border: "border-destructive/40",
  },
  warning: {
    color: "text-warning",
    textColor: "text-warning-text",
    bgColor: "bg-warning/10",
    indicator: "bg-warning",
    border: "border-warning/40",
  },
  info: {
    color: "text-info",
    textColor: "text-info-text",
    bgColor: "bg-info/10",
    indicator: "bg-info",
    border: "border-info/40",
  },
  neutral: {
    color: "text-muted-foreground",
    textColor: "text-muted-foreground",
    bgColor: "bg-muted/60",
    indicator: "bg-muted-foreground",
    border: "border-border",
  },
  brand: {
    color: "text-primary",
    textColor: "text-primary",
    bgColor: "bg-primary/10",
    indicator: "bg-primary",
    border: "border-primary/40",
  },
} satisfies Record<string, StatusTheme>;

export type StatusThemeName = keyof typeof THEMES;

interface StatusConfig extends StatusTheme {
  label: string;
  theme: StatusThemeName;
  icon?: ReactNode;
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
  | "offline"
  | "archived"
  | "queued"
  | "claimed"
  | "completed"
  | "failed"
  | "cancelled"
  | "error"
  | "skipped"
  | "timeout";

interface StatusBadgeProps {
  /** Known statuses get canonical label/theme/icon; unknown strings fall back to neutral */
  status: StatusType | (string & {});
  label?: string;
  showIndicator?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  className?: string;
  border?: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; theme: StatusThemeName; icon: () => ReactNode }
> = {
  [EventStatus.ACTIVE]: {
    label: "Active",
    theme: "success",
    icon: () => <CircleCheck />,
  },
  [LogStatus.SUCCESS]: {
    label: "Success",
    theme: "success",
    icon: () => <CircleCheck />,
  },
  success: { label: "Success", theme: "success", icon: () => <CircleCheck /> },
  active: { label: "Active", theme: "success", icon: () => <CircleCheck /> },
  online: {
    label: "Online",
    theme: "success",
    icon: () => <Circle className="fill-current" />,
  },
  offline: { label: "Offline", theme: "destructive", icon: () => <CircleX /> },
  [LogStatus.FAILURE]: {
    label: "Failed",
    theme: "destructive",
    icon: () => <CircleX />,
  },
  failure: { label: "Failed", theme: "destructive", icon: () => <CircleX /> },
  [UserStatus.DISABLED]: {
    label: "Disabled",
    theme: "destructive",
    icon: () => <CircleX />,
  },
  [LogStatus.RUNNING]: {
    label: "Running",
    theme: "info",
    icon: () => <Loader2 className="animate-spin" />,
  },
  running: {
    label: "Running",
    theme: "info",
    icon: () => <Loader2 className="animate-spin" />,
  },
  [EventStatus.PAUSED]: {
    label: "Paused",
    theme: "warning",
    icon: () => <Pause />,
  },
  [LogStatus.TIMEOUT]: {
    label: "Timeout",
    theme: "warning",
    icon: () => <Clock />,
  },
  [LogStatus.PARTIAL]: {
    label: "Partial",
    theme: "warning",
    icon: () => <AlertTriangle />,
  },
  warning: {
    label: "Warning",
    theme: "warning",
    icon: () => <AlertTriangle />,
  },
  [EventStatus.DRAFT]: {
    label: "Draft",
    theme: "neutral",
    icon: () => <Circle />,
  },
  // Also covers UserStatus.PENDING (same "PENDING" value)
  [LogStatus.PENDING]: {
    label: "Pending",
    theme: "neutral",
    icon: () => <Clock />,
  },
  pending: { label: "Pending", theme: "neutral", icon: () => <Clock /> },
  [EventStatus.ARCHIVED]: {
    label: "Archived",
    theme: "brand",
    icon: () => <Archive />,
  },
  archived: { label: "Archived", theme: "brand", icon: () => <Archive /> },
  [UserStatus.INVITED]: {
    label: "Invited",
    theme: "brand",
    icon: () => <Clock />,
  },
  info: { label: "Info", theme: "info", icon: () => <Info /> },
  // Job lifecycle statuses (jobs table / job detail)
  queued: { label: "Queued", theme: "neutral", icon: () => <Clock /> },
  claimed: { label: "Claimed", theme: "info", icon: () => <Clock /> },
  completed: {
    label: "Completed",
    theme: "success",
    icon: () => <CircleCheck />,
  },
  failed: { label: "Failed", theme: "destructive", icon: () => <CircleX /> },
  cancelled: { label: "Cancelled", theme: "neutral", icon: () => <CircleX /> },
  // Common lowercase aliases used by execution views
  error: { label: "Error", theme: "destructive", icon: () => <CircleX /> },
  skipped: { label: "Skipped", theme: "neutral", icon: () => <Circle /> },
  timeout: { label: "Timeout", theme: "warning", icon: () => <Clock /> },
  paused: { label: "Paused", theme: "warning", icon: () => <Pause /> },
  draft: { label: "Draft", theme: "neutral", icon: () => <Circle /> },
  inactive: { label: "Inactive", theme: "neutral", icon: () => <Circle /> },
  // Connection / health checks
  healthy: { label: "Healthy", theme: "success", icon: () => <CircleCheck /> },
  unhealthy: {
    label: "Unhealthy",
    theme: "destructive",
    icon: () => <CircleX />,
  },
  checking: {
    label: "Checking",
    theme: "info",
    icon: () => <Loader2 className="animate-spin" />,
  },
  unknown: { label: "Unknown", theme: "neutral", icon: () => <Circle /> },
  connected: {
    label: "Connected",
    theme: "success",
    icon: () => <Circle className="fill-current" />,
  },
  disconnected: {
    label: "Disconnected",
    theme: "neutral",
    icon: () => <Circle />,
  },
};

/**
 * Get status configuration for styling consistency across components
 */
export const getStatusConfig = (
  status: StatusType | (string & {}),
  icon?: ReactNode,
): StatusConfig => {
  const entry = STATUS_MAP[status] ?? {
    label: "Unknown",
    theme: "neutral" as const,
    icon: () => <Circle />,
  };
  return {
    label: entry.label,
    theme: entry.theme,
    ...THEMES[entry.theme],
    icon: icon ?? entry.icon(),
  };
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
 * Icon-only status rendering for tables, graphs and cards. Renders the
 * canonical icon in the canonical hue so every surface agrees.
 */
export function StatusIcon({
  status,
  className = "h-4 w-4",
}: {
  status: StatusType | (string & {});
  className?: string;
}) {
  const config = getStatusConfig(status);
  if (!isValidElement(config.icon)) return null;
  const element = config.icon as React.ReactElement<{ className?: string }>;
  return cloneElement(element, {
    className:
      `${className} ${config.color} ${element.props?.className ?? ""}`.trim(),
  });
}

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
