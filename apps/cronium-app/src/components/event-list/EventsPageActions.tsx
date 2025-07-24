"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@cronium/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cronium/ui";
import { JsonImportModal } from "@/components/dashboard/JsonImportModal";

export function EventsPageActions() {
  const [isJsonImportOpen, setIsJsonImportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild className="border-none">
          <Button variant="outline" size="icon">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-secondary-bg">
          <DropdownMenuItem onClick={() => setIsJsonImportOpen(true)}>
            Add event from JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <JsonImportModal
        isOpen={isJsonImportOpen}
        onClose={() => setIsJsonImportOpen(false)}
      />
    </>
  );
}
