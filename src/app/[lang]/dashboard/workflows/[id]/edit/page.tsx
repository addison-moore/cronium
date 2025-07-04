"use client";

import { useState, useEffect } from "react";
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
import { Spinner } from "@/components/ui/spinner";

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

interface WorkflowData {
  workflow: {
    id: number;
    name: string;
    description: string | null;
    tags: string[] | null;
    triggerType: WorkflowTriggerType;
    runLocation: RunLocation;
    status: EventStatus;
    scheduleNumber: number | null;
    scheduleUnit: string | null;
    customSchedule: string | null;
    shared: boolean;
    overrideEventServers: boolean;
    overrideServerIds: number[] | null;
  };
  nodes: Node[];
  edges: Edge[];
}

export default function EditWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ lang: string; id: string }>();
  const t = useTranslations("Workflows");
  const lang = params.lang;
  const workflowId = parseInt(params.id);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingWorkflow, setLoadingWorkflow] = useState(true);
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);

  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowFormSchema) as any,
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

  useEffect(() => {
    if (isNaN(workflowId)) {
      toast({
        title: "Error",
        description: "Invalid workflow ID",
        variant: "destructive",
      });
      router.push(`/${lang}/dashboard/workflows`);
      return;
    }

    // Fetch workflow data only
    fetchWorkflowData();
  }, [workflowId]);

  const fetchWorkflowData = async () => {
    try {
      setLoadingWorkflow(true);
      const response = await fetch(`/api/workflows/${workflowId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch workflow data");
      }

      const data: WorkflowData = await response.json();
      console.log("Fetched workflow data:", data);
      setWorkflowData(data);
    } catch (error) {
      console.error("Error fetching workflow data:", error);
      toast({
        title: "Error",
        description: "Failed to load workflow data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingWorkflow(false);
    }
  };

  const onSubmit = async (
    values: WorkflowFormValues,
    nodes: Node[],
    edges: Edge[],
  ) => {
    try {
      setIsLoading(true);

      // Send both the form data and the workflow configuration to update the workflow
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          ...values,
          nodes: nodes,
          edges: edges,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update workflow");
      }

      toast({
        title: "Success",
        description: "Workflow updated successfully",
        variant: "success",
      });

      // Redirect back to workflow list or view
      router.push(`/${lang}/dashboard/workflows/${workflowId}`);
    } catch (error) {
      console.error("Error updating workflow:", error);
      toast({
        title: "Error",
        description: "Failed to update workflow. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Update form when workflow data is loaded
  useEffect(() => {
    if (workflowData?.workflow && !loadingWorkflow) {
      console.log("Resetting form with workflow data:", workflowData);
      const workflow = workflowData.workflow;
      const formData = {
        name: workflow.name,
        description: workflow.description ?? "",
        tags: workflow.tags ?? [],
        triggerType: workflow.triggerType,
        runLocation: workflow.runLocation,
        status: workflow.status,
        scheduleNumber: workflow.scheduleNumber,
        scheduleUnit: workflow.scheduleUnit,
        customSchedule: workflow.customSchedule,
        useCronScheduling: !!workflow.customSchedule,
        shared: workflow.shared,
        overrideEventServers: workflow.overrideEventServers ?? false,
        overrideServerIds: workflow.overrideServerIds ?? [],
      };
      console.log("Form data to set:", formData);
      form.reset(formData);
    }
  }, [workflowData, loadingWorkflow]);

  if (loadingWorkflow) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-muted-foreground mt-4">{t("Loading")}</p>
        </div>
      </div>
    );
  }

  if (!workflowData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Workflow not found</p>
          <Button
            onClick={() =>
              router.push(`/${lang}/dashboard/workflows/${workflowId}`)
            }
            className="mt-4"
          >
            {t("BackToWorkflows")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" asChild className="mr-4">
            <Link href={`/${lang}/dashboard/workflows`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("BackToWorkflows")}
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{t("EditWorkflow")}</h1>
            <p className="text-muted-foreground mt-1">
              Update your workflow configuration and design
            </p>
          </div>
        </div>

        <WorkflowForm
          form={form}
          onSubmit={onSubmit}
          isLoading={isLoading}
          submitButtonText={t("SaveWorkflow")}
          showActionsAtTop={true}
          initialNodes={workflowData?.nodes ?? []}
          initialEdges={workflowData?.edges ?? []}
          workflowId={workflowId}
        />
      </div>
    </div>
  );
}
