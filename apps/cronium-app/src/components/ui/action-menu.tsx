"use client";

import { type ReactNode } from "react";
import { MoreVertical, Copy, Trash, Edit, Play, Pause } from "lucide-react";
import { Button } from "@cronium/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@cronium/ui";

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  variant?: "default" | "destructive";
  destructive?: boolean; // Alternative way to specify destructive action for backward compatibility
  disabled?: boolean;
}

interface ActionMenuProps {
  // Support both items and actions for backward compatibility
  items?: ActionMenuItem[];
  actions?: ActionMenuItem[];
  triggerIcon?: ReactNode;
  separatorIndices?: number[];
  menuButtonLabel?: string;
}

/**
 * A reusable action menu component for displaying a dropdown of actions
 */
export function ActionMenu({
  items,
  actions,
  triggerIcon = <MoreVertical className="h-4 w-4 cursor-pointer" />,
  separatorIndices,
}: ActionMenuProps) {
  // Use actions prop if provided, otherwise use items
  const menuItems = actions ?? items ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          {triggerIcon}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {menuItems.map((item, index) => (
          <div key={`div-${index}`}>
            {separatorIndices?.includes(index) && (
              <DropdownMenuSeparator key={`sep-${index}`} />
            )}
            <DropdownMenuItem
              key={`item-${index}`}
              onClick={item.onClick}
              disabled={item.disabled ?? false}
              className={`${item.variant === "destructive" || "destructive" in item ? "text-red-600 focus:text-red-600" : ""} ${item.disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              {item.icon && <span className="mr-2">{item.icon}</span>}
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Common action menu items for typical CRUD operations
 */
export const commonActionItems = {
  edit: (onClick: () => void, label = "Edit"): ActionMenuItem => ({
    label,
    onClick,
    icon: <Edit className="h-4 w-4" />,
  }),

  delete: (onClick: () => void, label = "Delete"): ActionMenuItem => ({
    label,
    onClick,
    icon: <Trash className="h-4 w-4" />,
    variant: "destructive",
  }),

  duplicate: (onClick: () => void, label = "Duplicate"): ActionMenuItem => ({
    label,
    onClick,
    icon: <Copy className="h-4 w-4" />,
  }),

  activate: (onClick: () => void, label = "Activate"): ActionMenuItem => ({
    label,
    onClick,
    icon: <Play className="h-4 w-4" />,
  }),

  deactivate: (onClick: () => void, label = "Deactivate"): ActionMenuItem => ({
    label,
    onClick,
    icon: <Pause className="h-4 w-4" />,
  }),
};
