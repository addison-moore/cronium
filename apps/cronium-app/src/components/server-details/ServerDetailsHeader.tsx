"use client";

import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";

interface ServerDetailsHeaderProps {
  server: {
    id: number;
    name: string;
    online?: boolean;
  };
  langParam: string;
  onDelete: () => void;
}

export function ServerDetailsHeader({
  server,
  langParam,
  onDelete,
}: ServerDetailsHeaderProps) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button variant="ghost" size="sm" asChild className="h-8 w-fit">
          <Link href={`/${langParam}/dashboard/servers`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Servers
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-bold">{server.name}</h1>
          {server.online !== undefined && (
            <StatusBadge
              status={server.online ? "online" : "offline"}
              size="md"
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          className="flex items-center"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Delete Server
        </Button>
      </div>
    </div>
  );
}
