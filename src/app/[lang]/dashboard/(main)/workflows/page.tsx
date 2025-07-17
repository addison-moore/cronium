import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { WorkflowListClient } from "@/components/workflows/WorkflowListClient";
import { WorkflowsTableSkeleton } from "@/components/ui/table-skeleton";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import type { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import type { Metadata } from "next";

interface WorkflowsPageParams {
  params: Promise<{
    lang: string;
  }>;
}

export async function generateMetadata({
  params: _params,
}: WorkflowsPageParams): Promise<Metadata> {
  const t = await getTranslations("Workflows");

  return {
    title: t("Title"),
    description: t("Description"),
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

export default async function WorkflowsPage({ params }: WorkflowsPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Get translations
  const t = await getTranslations("Workflows");

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title={t("Title")}
        description={t("Description")}
        createButton={{
          href: `/${lang}/dashboard/workflows/new`,
          label: t("CreateWorkflow"),
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
    </div>
  );
}
