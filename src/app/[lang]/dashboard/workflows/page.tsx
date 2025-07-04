"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import WorkflowList from "@/components/workflows/WorkflowList";
import { PageHeader } from "@/components/ui/page-header";

export default function WorkflowsPage() {
  const params = useParams<{ lang: string }>();
  const t = useTranslations("Workflows");
  const lang = params.lang as string;

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
          <WorkflowList />
        </CardContent>
      </Card>
    </div>
  );
}
