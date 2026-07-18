import { Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, PageShell } from "@cronium/ui";
import { PageHeader } from "@cronium/ui";
import { WorkflowListClient } from "@/components/workflows/WorkflowListClient";
import { WorkflowsTableSkeleton } from "@cronium/ui";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import type { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Workflows",
    description: "Design and manage your automation workflows",
  };
}

interface WorkflowItem {
  id: number;
  name: string;
  description: string | null;
  tags?: string[];
  status: EventStatus;
  triggerType: WorkflowTriggerType;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  shared: boolean;
  userId: string;
}

// Async component that fetches and renders the workflows list
async function WorkflowsList() {
  // Fetch workflows on the server side
  const workflowsData = await api.workflows.getAll({
    limit: 100,
    offset: 0,
  });

  // Transform workflows to match the WorkflowItem interface
  const workflows: WorkflowItem[] = workflowsData.workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    tags: Array.isArray(workflow.tags) ? workflow.tags : [],
    status: workflow.status,
    triggerType: workflow.triggerType,
    createdAt: new Date(workflow.createdAt).toISOString(),
    updatedAt: new Date(workflow.updatedAt).toISOString(),
    lastRunAt: null, // Workflow doesn't have lastRunAt field
    shared: workflow.shared,
    userId: workflow.userId,
  }));

  return <WorkflowListClient initialWorkflows={workflows} />;
}

export default async function WorkflowsPage() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <PageShell>
      <PageHeader
        title="Workflows"
        description="Design and manage your automation workflows"
        createButton={{
          href: "/dashboard/workflows/new",
          label: "Create Workflow",
          icon: <Plus className="h-4 w-4" />,
        }}
      />
      <Card>
        <CardContent>
          {/* Stream the workflows list */}
          <Suspense fallback={<WorkflowsTableSkeleton />}>
            <WorkflowsList />
          </Suspense>
        </CardContent>
      </Card>
    </PageShell>
  );
}
