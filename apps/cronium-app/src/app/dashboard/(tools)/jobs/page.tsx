import { api } from "@/trpc/server";
import { PageHeader, PageShell, JobsTableSkeleton } from "@cronium/ui";
import { JobsTable } from "@/components/jobs/JobsTable";
import { JobFilters } from "@/components/jobs/JobFilters";
import { Suspense } from "react";
import { Skeleton } from "@cronium/ui";

export default async function JobsPage() {
  return (
    <PageShell>
      <PageHeader title="Jobs" description="View and manage execution jobs" />

      <Suspense fallback={<JobsPageSkeleton />}>
        <JobsContent />
      </Suspense>
    </PageShell>
  );
}

async function JobsContent() {
  const response = await api.jobs.list({
    limit: 50,
    offset: 0,
  });

  return (
    <div className="border-border bg-secondary-bg space-y-4 rounded-lg border p-4">
      <JobFilters />
      <JobsTable jobs={response.items} />
    </div>
  );
}

function JobsPageSkeleton() {
  return (
    <div className="border-border bg-secondary-bg space-y-4 rounded-lg border p-4">
      <div className="flex gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <JobsTableSkeleton />
    </div>
  );
}
