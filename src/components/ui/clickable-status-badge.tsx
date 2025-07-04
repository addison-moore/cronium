"use client";

import { useState, cloneElement, isValidElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EventStatus } from "@/shared/schema";
import { ChevronDown, Loader2 } from "lucide-react";
import { getStatusConfig, sizeClasses, iconSizeClasses } from "./status-badge";

interface ClickableStatusBadgeProps {
  currentStatus: EventStatus;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

// Available statuses for the dropdown (excluding ARCHIVED)
const availableStatuses = [
  EventStatus.ACTIVE,
  EventStatus.PAUSED,
  EventStatus.DRAFT,
];

export function ClickableStatusBadge({
  currentStatus,
  onStatusChange,
  disabled = false,
  className = "",
  size = "md",
}: ClickableStatusBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (isUpdating) return;

    setIsUpdating(true);
    setIsOpen(false);

    try {
      await onStatusChange(newStatus);
    } finally {
      setIsUpdating(false);
    }
  };

  const currentConfig = getStatusConfig(currentStatus);

  if (disabled || isUpdating) {
    return (
      <div
        className={`inline-flex items-center font-medium rounded-full border ${currentConfig.border} ${sizeClasses[size]} ${currentConfig.bgColor} ${currentConfig.textColor} ${isUpdating ? "opacity-60" : ""} ${className}`}
      >
        {isUpdating ? (
          <>
            <span className="mr-0.5 flex-shrink-0">
              <Loader2 className={`${iconSizeClasses[size]} animate-spin`} />
            </span>
            Updating...
          </>
        ) : (
          <>
            {currentConfig.icon && (
              <span className="mr-0.5 flex-shrink-0">
                {isValidElement(currentConfig.icon)
                  ? cloneElement(currentConfig.icon as any, {
                      className: `${iconSizeClasses[size]} ${(currentConfig.icon as any).props?.className || ""}`,
                    })
                  : currentConfig.icon}
              </span>
            )}
            {currentConfig.label}
          </>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <div
          className={`cursor-pointer hover:opacity-80 transition-opacity inline-flex items-center font-medium rounded-full border ${currentConfig.border} ${sizeClasses[size]} ${currentConfig.bgColor} ${currentConfig.textColor} ${className}`}
        >
          {currentConfig.icon && (
            <span className="mr-0.5 flex-shrink-0">
              {isValidElement(currentConfig.icon)
                ? cloneElement(currentConfig.icon as any, {
                    className: `${iconSizeClasses[size]} ${(currentConfig.icon as any).props?.className || ""}`,
                  })
                : currentConfig.icon}
            </span>
          )}
          {currentConfig.label}
          <ChevronDown className={`${iconSizeClasses[size]} ml-0.5`} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-fit">
        {availableStatuses.map((status) => {
          const config = getStatusConfig(status);
          return (
            <DropdownMenuItem
              key={status}
              onClick={() => handleStatusChange(status)}
              className="cursor-pointer"
              disabled={status === currentStatus}
            >
              <div
                className={`pointer-events-none inline-flex items-center font-medium rounded-full border ${config.border} ${sizeClasses[size]} ${config.bgColor} ${config.textColor}`}
              >
                {config.icon && (
                  <span className="mr-0.5 flex-shrink-0">
                    {isValidElement(config.icon)
                      ? cloneElement(config.icon as any, {
                          className: `${iconSizeClasses[size]} ${(config.icon as any).props?.className || ""}`,
                        })
                      : config.icon}
                  </span>
                )}
                {config.label}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
