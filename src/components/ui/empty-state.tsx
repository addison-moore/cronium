"use client";

import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  // Support both object-based action and individual props for backward compatibility
  action?: {
    label: string;
    href: string;
    icon?: ReactNode;
  };
  actionLabel?: string; // For backward compatibility
  actionHref?: string; // For backward compatibility
  actionIcon?: ReactNode; // For backward compatibility
  className?: string;
}

/**
 * A reusable empty state component for displaying when there's no data
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  actionLabel,
  actionHref,
  actionIcon,
  className = "",
}: EmptyStateProps) {
  // Determine if we have an action through individual props or the action object
  const hasAction = action || (actionLabel && actionHref);

  // Extract action details from either source
  const actionDetails =
    action ||
    (actionLabel && actionHref
      ? {
          label: actionLabel,
          href: actionHref,
          icon: actionIcon,
        }
      : undefined);

  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-8 ${className}`}
    >
      <div className="text-muted-foreground mb-4">{icon}</div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      {description && (
        <p className="text-muted-foreground mb-4 max-w-md">{description}</p>
      )}

      {hasAction && actionDetails && (
        <Button asChild>
          <Link href={actionDetails.href} className="flex items-center">
            {actionDetails.icon && (
              <span className="mr-2">{actionDetails.icon}</span>
            )}
            {actionDetails.label}
          </Link>
        </Button>
      )}
    </div>
  );
}
