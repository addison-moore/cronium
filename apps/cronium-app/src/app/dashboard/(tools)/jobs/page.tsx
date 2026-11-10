import { api } from "@/trpc/server";
import { PageHeader, PageShell, JobsTableSkeleton } from "@cronium/ui";
import { JobsTable } from "@/components/jobs/JobsTable";
import { JobFilters } from "@/components/jobs/JobFilters";
import { Suspense } from "react";
import {
  jobListInput,
  jobListQuery,
  parseJobListFilters,
  type JobListFilters,
  type JobListSearchParams,
} from "@/shared/job-list-filters";

interface JobsPageProps {
  searchParams: Promise<JobListSearchParams>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const filters = parseJobListFilters(await searchParams);
  // Both start again whenever the address's filters change: the controls show
  // them after Back or Forward too, and the list shows its skeleton while the
  // matching jobs load, rather than the old rows. Siblings need keys of their
  // own: with one key between them React shows the controls twice.
  const filtersKey = jobListQuery(filters);

  return (
    <PageShell>
      <PageHeader title="Jobs" description="View and manage execution jobs" />

      <div className="border-border bg-secondary-bg space-y-4 rounded-lg border p-4">
        <JobFilters key={`filters?${filtersKey}`} initial={filters} />
        <Suspense key={`jobs?${filtersKey}`} fallback={<JobsTableSkeleton />}>
          <JobsContent filters={filters} />
        </Suspense>
      </div>
    </PageShell>
  );
}

async function JobsContent({ filters }: { filters: JobListFilters }) {
  const response = await api.jobs.list({
    ...jobListInput(filters),
    limit: 50,
    offset: 0,
  });

  return <JobsTable jobs={response.items} />;
}
