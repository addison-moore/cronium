import { api } from "@/trpc/server";
import { notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { JobStatusCard } from "@/components/jobs/JobStatusCard";
import { JobExecutionLogs } from "@/components/jobs/JobExecutionLogs";
import { Card } from "@cronium/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cronium/ui";

interface JobDetailsPageProps {
  params: Promise<{
    id: string;
    lang: string;
  }>;
}

export default async function JobDetailsPage({ params }: JobDetailsPageProps) {
  const { id } = await params;
  const response = await api.jobs.get({ jobId: id }).catch(() => null);

  if (!response?.data) {
    notFound();
  }

  const job = response.data;

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <DashboardHeader
        heading={`Job ${id}`}
        text="View job execution details and logs"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Tabs defaultValue="logs" className="space-y-4">
            <TabsList>
              <TabsTrigger value="logs">Execution Logs</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="logs" className="space-y-4">
              <Card>
                <JobExecutionLogs jobId={id} />
              </Card>
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <Card className="p-6">
                <h3 className="mb-4 text-lg font-medium">Job Payload</h3>
                <pre className="bg-muted overflow-auto rounded-md p-4">
                  {JSON.stringify(job.payload, null, 2)}
                </pre>
              </Card>

              {job.metadata &&
              typeof job.metadata === "object" &&
              job.metadata !== null &&
              Object.keys(job.metadata as Record<string, unknown>).length >
                0 ? (
                <Card className="p-6">
                  <h3 className="mb-4 text-lg font-medium">Job Metadata</h3>
                  <pre className="bg-muted overflow-auto rounded-md p-4">
                    {JSON.stringify(job.metadata, null, 2)}
                  </pre>
                </Card>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <JobStatusCard job={job} />

          <Card className="p-6">
            <h3 className="mb-4 text-lg font-medium">Metadata</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Event ID</dt>
                <dd className="font-mono">{job.eventId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">User ID</dt>
                <dd className="font-mono">{job.userId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{job.type}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd>{job.priority}</dd>
              </div>
              {job.orchestratorId && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Orchestrator</dt>
                  <dd className="font-mono">{job.orchestratorId}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
