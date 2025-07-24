"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@cronium/ui";
import { toast } from "@cronium/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  EventStatus,
  WorkflowTriggerType,
  RunLocation,
  ConnectionType,
  type TimeUnit,
} from "@/shared/schema";
import WorkflowForm, {
  type WorkflowFormValues,
} from "@/components/workflows/WorkflowForm";
import type { Node, Edge } from "@xyflow/react";
import { trpc } from "@/lib/trpc";

// Define a more explicit type for the form that handles exact optional properties
interface WorkflowFormData {
  name: string;
  description: string;
  tags: string[];
  triggerType: WorkflowTriggerType;
  runLocation: RunLocation;
  status: EventStatus;
  scheduleNumber: number | null;
  scheduleUnit: string | null;
  customSchedule: string | null;
  useCronScheduling: boolean;
  shared: boolean;
  overrideEventServers: boolean;
  overrideServerIds: number[];
}

// Workflow form schema
const workflowFormSchema = z.object({
  name: z.string().min(1, { message: "Workflow name is required" }),
  description: z.string(),
  tags: z.array(z.string()),
  triggerType: z.nativeEnum(WorkflowTriggerType),
  runLocation: z.nativeEnum(RunLocation),
  status: z.nativeEnum(EventStatus),
  scheduleNumber: z.number().nullable(),
  scheduleUnit: z.string().nullable(),
  customSchedule: z.string().nullable(),
  useCronScheduling: z.boolean(),
  shared: z.boolean(),
  overrideEventServers: z.boolean(),
  overrideServerIds: z.array(z.number()),
}) satisfies z.ZodType<WorkflowFormData>;

export default function NewWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ lang: string }>();
  const lang = params.lang;
  const t = useTranslations("Workflows");
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<WorkflowFormData>({
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
      if (data?.data?.id) {
        router.push(`/${lang}/dashboard/workflows/${String(data.data.id)}`);
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

  // Convert WorkflowFormData to WorkflowFormValues
  const convertToWorkflowFormValues = (
    data: WorkflowFormData,
  ): WorkflowFormValues => {
    const result: WorkflowFormValues = {
      name: data.name,
      triggerType: data.triggerType,
      runLocation: data.runLocation,
      status: data.status,
      useCronScheduling: data.useCronScheduling,
      shared: data.shared,
      overrideEventServers: data.overrideEventServers,
      overrideServerIds: data.overrideServerIds,
    };

    // Only add optional properties if they have meaningful values
    if (data.description?.trim()) {
      result.description = data.description;
    }
    if (data.tags?.length > 0) {
      result.tags = data.tags;
    }
    if (data.scheduleNumber !== null) {
      result.scheduleNumber = data.scheduleNumber;
    }
    if (data.scheduleUnit !== null) {
      result.scheduleUnit = data.scheduleUnit;
    }
    if (data.customSchedule !== null) {
      result.customSchedule = data.customSchedule;
    }

    return result;
  };

  const onSubmit = async (
    values: WorkflowFormData,
    nodes: Node[],
    edges: Edge[],
  ) => {
    setIsLoading(true);
    try {
      const workflowValues = convertToWorkflowFormValues(values);
      // Transform nodes and edges to match the expected schema
      const transformedNodes = nodes.map((node) => ({
        id: node.id,
        type: "eventNode" as const,
        position: node.position,
        data: {
          eventId: node.data.eventId as number,
          label: node.data.label as string,
          type: node.data.type as string,
          eventTypeIcon: node.data.eventTypeIcon as string,
          description: node.data.description as string | undefined,
          tags: (node.data.tags as string[]) || [],
          serverId: node.data.serverId as number | undefined,
          serverName: node.data.serverName as string | undefined,
          createdAt: node.data.createdAt as string | undefined,
          updatedAt: node.data.updatedAt as string | undefined,
        },
      }));

      const transformedEdges = edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "connectionEdge" as const,
        animated: edge.animated ?? true,
        data: {
          type: (edge.data?.type as ConnectionType) || ConnectionType.ALWAYS,
          connectionType:
            (edge.data?.connectionType as ConnectionType) ||
            (edge.data?.type as ConnectionType) ||
            ConnectionType.ALWAYS,
        },
      }));

      await createWorkflowMutation.mutateAsync({
        ...workflowValues,
        scheduleNumber: workflowValues.scheduleNumber ?? undefined,
        scheduleUnit: workflowValues.scheduleUnit as TimeUnit | undefined,
        customSchedule: workflowValues.customSchedule ?? undefined,
        nodes: transformedNodes,
        edges: transformedEdges,
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
        form={form as never}
        onSubmit={async (
          values: WorkflowFormValues,
          nodes: Node[],
          edges: Edge[],
        ) => {
          // Convert WorkflowFormValues back to WorkflowFormData format for our handler
          const formData: WorkflowFormData = {
            name: values.name,
            description: values.description ?? "",
            tags: values.tags ?? [],
            triggerType: values.triggerType,
            runLocation: values.runLocation,
            status: values.status,
            scheduleNumber: values.scheduleNumber ?? null,
            scheduleUnit: values.scheduleUnit ?? null,
            customSchedule: values.customSchedule ?? null,
            useCronScheduling: values.useCronScheduling,
            shared: values.shared,
            overrideEventServers: values.overrideEventServers,
            overrideServerIds: values.overrideServerIds,
          };
          return onSubmit(formData, nodes, edges);
        }}
        isLoading={isLoading}
        submitButtonText="Create Workflow"
        cancelButtonText="Cancel"
        onCancel={() => router.push(`/${lang}/dashboard/workflows`)}
      />
    </div>
  );
}
