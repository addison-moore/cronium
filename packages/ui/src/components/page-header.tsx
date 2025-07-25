"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "./button";
import { ArrowLeft, Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  backLink?: {
    href: string;
    label: string;
  };
  actions?: ReactNode;
  createButton?: {
    href: string;
    label: string;
    icon?: ReactNode;
  };
  className?: string;
}

/**
 * Enhanced page header component with standard styling and options for back link and action buttons.
 * Used to create consistent page headers across the dashboard.
 */
export function PageHeader({
  title,
  description,
  backLink,
  actions,
  createButton,
  className = "flex flex-col sm:flex-row sm:items-center mb-6 gap-4",
}: PageHeaderProps) {
  return (
    <div className={className}>
      <div className="flex-1">
        {backLink && (
          <Button variant="ghost" size="sm" className="mb-2 h-8 p-0" asChild>
            <Link href={backLink.href}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {backLink.label}
            </Link>
          </Button>
        )}
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>

      <div className="flex items-center gap-2">
        {createButton && (
          <Button asChild className="flex items-center gap-2">
            <Link href={createButton.href}>
              {createButton.icon ?? <Plus className="h-4 w-4" />}
              <span>{createButton.label}</span>
            </Link>
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
