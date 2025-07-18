"use client";

import React, { useState } from "react";
import { api } from "@/trpc/react";
import { LogsPageSkeleton } from "@/components/logs/LogsPageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { LogStatus } from "@/shared/schema";

export default function LogsPageClient() {
  const params = useParams();
  const lang = params.lang as string;
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = api.logs.getAll.useQuery({
    limit,
    offset: (page - 1) * limit,
  });

  if (isLoading) {
    return <LogsPageSkeleton />;
  }

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Execution Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No logs found
            </p>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => (
                <Link
                  key={log.id}
                  href={`/${lang}/dashboard/logs/${log.id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{log.eventName}</span>
                        <Badge
                          variant={log.status === LogStatus.SUCCESS ? "default" : "destructive"}
                        >
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(log.startTime), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}