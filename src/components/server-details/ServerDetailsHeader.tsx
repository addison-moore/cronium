"use client";

import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col lg:flex-row justify-between gap-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit h-8">
          <Link href={`/${langParam}/dashboard/servers`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Servers
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold truncate">{server.name}</h1>
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
          <Trash2 className="h-4 w-4 mr-1" />
          Delete Server
        </Button>
      </div>
    </div>
  );
}
