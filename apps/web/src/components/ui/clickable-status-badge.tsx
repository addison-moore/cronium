"use client";

import React, {
  useState,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EventStatus } from "@/shared/schema";
import { ChevronDown, Loader2 } from "lucide-react";
import { getStatusConfig, sizeClasses, iconSizeClasses } from "./status-badge";

// Helper function to safely get className from React element
function getElementClassName(element: ReactElement): string {
  const props = element.props as { className?: string };
  return props?.className ?? "";
}

// Helper function to safely clone element with className
function cloneElementWithClassName(
  element: ReactElement,
  additionalClassName: string,
): ReactElement {
  const existingClassName = getElementClassName(element);
  const combinedClassName =
    `${additionalClassName} ${existingClassName}`.trim();
  return cloneElement(element, {
    className: combinedClassName,
  } as React.JSX.IntrinsicAttributes);
}

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
        className={`inline-flex items-center rounded-full border font-medium ${currentConfig.border ?? ""} ${sizeClasses[size]} ${currentConfig.bgColor} ${currentConfig.textColor} ${isUpdating ? "opacity-60" : ""} ${className}`}
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
                  ? cloneElementWithClassName(
                      currentConfig.icon as ReactElement,
                      iconSizeClasses[size],
                    )
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
          className={`inline-flex cursor-pointer items-center rounded-full border font-medium transition-opacity hover:opacity-80 ${currentConfig.border ?? ""} ${sizeClasses[size]} ${currentConfig.bgColor} ${currentConfig.textColor} ${className}`}
        >
          {currentConfig.icon && (
            <span className="mr-0.5 flex-shrink-0">
              {isValidElement(currentConfig.icon)
                ? cloneElementWithClassName(
                    currentConfig.icon as ReactElement,
                    iconSizeClasses[size],
                  )
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
                className={`pointer-events-none inline-flex items-center rounded-full border font-medium ${config.border ?? ""} ${sizeClasses[size]} ${config.bgColor} ${config.textColor}`}
              >
                {config.icon && (
                  <span className="mr-0.5 flex-shrink-0">
                    {isValidElement(config.icon)
                      ? cloneElementWithClassName(
                          config.icon as ReactElement,
                          iconSizeClasses[size],
                        )
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
