"use client";

import React from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { ActionMenu } from "./action-menu";
import { cn } from "../lib/utils";

export interface StandardizedTableAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  separator?: boolean; // Add separator above this action
}

export interface StandardizedTableColumn<T> {
  key: string;
  header: string | React.ReactNode;
  cell: (item: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

export interface StandardizedTableProps<T> {
  data: T[];
  columns: StandardizedTableColumn<T>[];
  actions?: (item: T) => StandardizedTableAction[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  rowClassName?: (item: T) => string;
}

/**
 * Standardized Table Component
 *
 * This component provides consistent styling across all tables:
 * - Consistent cell padding and colors matching WorkflowExecutionHistory
 * - Standardized link styling matching Events List
 * - Consistent action menu styling with proper color coding and separators
 */
export function StandardizedTable<T extends { id: number | string }>({
  data,
  columns,
  actions,
  isLoading = false,
  emptyMessage = "No data available",
  className,
  rowClassName,
}: StandardizedTableProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table className={cn("", className)}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
          {actions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => (
          <TableRow
            key={item.id}
            className={rowClassName ? rowClassName(item) : ""}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(item)}
              </TableCell>
            ))}
            {actions && actions(item).length > 0 && (
              <TableCell className="text-right">
                <ActionMenu actions={actions(item)} menuButtonLabel="Options" />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Standardized Link Component for Tables
 * Provides consistent link styling matching the Events List
 */
export interface StandardizedTableLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

export function StandardizedTableLink({
  href,
  children,
  className,
}: StandardizedTableLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "hover:text-primary cursor-pointer font-medium underline-offset-4 transition-colors hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
