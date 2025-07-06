"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { EventStatus, WorkflowTriggerType, RunLocation } from "@/shared/schema";
import WorkflowForm, {
  type WorkflowFormValues,
} from "@/components/workflows/WorkflowForm";
import type { Node, Edge } from "@xyflow/react";
import { trpc } from "@/lib/trpc";

// Workflow form schema
const workflowFormSchema = z.object({
  name: z.string().min(1, { message: "Workflow name is required" }),
  description: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  triggerType: z.nativeEnum(WorkflowTriggerType),
  runLocation: z.nativeEnum(RunLocation),
  status: z.nativeEnum(EventStatus),
  scheduleNumber: z.number().optional().nullable(),
  scheduleUnit: z.string().optional().nullable(),
  customSchedule: z.string().optional().nullable(),
  useCronScheduling: z.boolean().default(false),
  shared: z.boolean().default(false),
  overrideEventServers: z.boolean().default(false),
  overrideServerIds: z.array(z.number()).default([]),
});

export default function NewWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ lang: string }>();
  const t = useTranslations("Workflows");
  const lang = params.lang;
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowFormSchema),
    defaultValues: {
      name: "",
      description: "",
      tags: [],
      triggerType: WorkflowTriggerType.MANUAL,
      runLocation: RunLocation.LOCAL,
      status: EventStatus.DRAFT,
      scheduleNumber: null,
      scheduleUnit: null,
      customSchedule: null,
      useCronScheduling: false,
      shared: false,
      overrideEventServers: false,
      overrideServerIds: [],
    },
  });

  // Use tRPC mutation to create workflow
  const createWorkflowMutation = trpc.workflows.create.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Workflow created successfully",
        variant: "success",
      });
      // Redirect to the newly created workflow
      if (data?.id) {
        router.push(`/${lang}/dashboard/workflows/${data.id}`);
      } else {
        router.push(`/${lang}/dashboard/workflows`);
      }
    },
    onError: (error) => {
      console.error("Error creating workflow:", error);
      toast({
        title: "Error",
        description: "Failed to create workflow. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (
    values: WorkflowFormValues,
    nodes: Node[],
    edges: Edge[],
  ) => {
    setIsLoading(true);
    try {
      await createWorkflowMutation.mutateAsync({
        ...values,
        nodes,
        edges,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" asChild>
          <Link href={`/${lang}/dashboard/workflows`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("BackToWorkflows")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{t("CreateNewWorkflow")}</h1>
      </div>

      <WorkflowForm
        form={form}
        onSubmit={onSubmit}
        isLoading={isLoading}
        submitButtonText="Create Workflow"
        cancelButtonText="Cancel"
        onCancel={() => router.push(`/${lang}/dashboard/workflows`)}
      />
    </div>
  );
}
