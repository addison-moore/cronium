import { api } from "@/trpc/server";
import { Card } from "@cronium/ui";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { JobsTable } from "@/components/jobs/JobsTable";
import { JobFilters } from "@/components/jobs/JobFilters";
import { Suspense } from "react";
import { Skeleton } from "@cronium/ui";

export default async function JobsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <DashboardHeader heading="Jobs" text="View and manage execution jobs" />

      <Suspense fallback={<JobsPageSkeleton />}>
        <JobsContent />
      </Suspense>
    </div>
  );
}

async function JobsContent() {
  const response = await api.jobs.list({
    limit: 50,
    offset: 0,
  });

  return (
    <div className="space-y-4">
      <JobFilters />
      <Card>
        <JobsTable jobs={response.items} />
      </Card>
    </div>
  );
}

function JobsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Card>
        <div className="space-y-4 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
