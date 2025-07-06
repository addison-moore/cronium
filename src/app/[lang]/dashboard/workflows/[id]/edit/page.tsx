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

export default function EditWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ lang: string; id: string }>();
  const t = useTranslations("Workflows");
  const lang = params.lang;
  const workflowId = parseInt(params.id);

  const [isLoading, setIsLoading] = useState(false);
  const [workflowNodes, setWorkflowNodes] = useState<Node[]>([]);
  const [workflowEdges, setWorkflowEdges] = useState<Edge[]>([]);

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

  // Use tRPC query to fetch workflow data
  const {
    data: workflowData,
    isLoading: loadingWorkflow,
    error: workflowError,
  } = trpc.workflows.getById.useQuery(
    { id: workflowId },
    {
      enabled: !isNaN(workflowId),
    },
  );

  // Handle invalid workflow ID
  useEffect(() => {
    if (isNaN(workflowId)) {
      toast({
        title: "Error",
        description: "Invalid workflow ID",
        variant: "destructive",
      });
      router.push(`/${lang}/dashboard/workflows`);
    }
  }, [workflowId, router, lang]);

  // Handle workflow error
  useEffect(() => {
    if (workflowError) {
      if (workflowError.data?.code === "NOT_FOUND") {
        toast({
          title: "Error",
          description: "Workflow not found",
          variant: "destructive",
        });
        router.push(`/${lang}/dashboard/workflows`);
      } else {
        toast({
          title: "Error",
          description: "Failed to load workflow data. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [workflowError, router, lang]);

  // Convert workflow nodes and edges when data is loaded
  useEffect(() => {
    if (workflowData) {
      // Define proper types for workflow data from tRPC
      interface WorkflowNode {
        id: number;
        eventId: number;
        position_x: number;
        position_y: number;
        event?: {
          id: number;
          name: string;
          type: string;
        };
      }

      interface WorkflowConnection {
        id: number;
        sourceNodeId: number;
        targetNodeId: number;
        connectionType?: string;
      }

      // Convert workflow nodes to canvas format
      const typedNodes = workflowData.nodes as WorkflowNode[] | undefined;
      const nodes: Node[] = (typedNodes ?? []).map((node) => ({
        id: `node-${String(node.id)}`,
        type: "workflowNode",
        position: { x: node.position_x, y: node.position_y },
        data: {
          eventId: node.eventId,
          label: node.event?.name ?? "",
          type: node.event?.type ?? "",
          eventTypeIcon: node.event?.type ?? "",
        },
      }));
      setWorkflowNodes(nodes);

      // Convert workflow connections to canvas format
      const typedConnections = workflowData.connections as
        | WorkflowConnection[]
        | undefined;
      const edges: Edge[] = (typedConnections ?? []).map((conn) => ({
        id: `edge-${String(conn.id)}`,
        source: `node-${String(conn.sourceNodeId)}`,
        target: `node-${String(conn.targetNodeId)}`,
        type: "default",
      }));
      setWorkflowEdges(edges);
    }
  }, [workflowData]);

  // Use tRPC mutation to update workflow
  const updateWorkflowMutation = trpc.workflows.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Workflow updated successfully",
        variant: "success",
      });
      router.push(`/${lang}/dashboard/workflows/${workflowId}`);
    },
    onError: (error) => {
      console.error("Error updating workflow:", error);
      toast({
        title: "Error",
        description: "Failed to update workflow. Please try again.",
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
      await updateWorkflowMutation.mutateAsync({
        id: workflowId,
        ...values,
        nodes,
        edges,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Update form when workflow data is loaded
  useEffect(() => {
    if (workflowData && !loadingWorkflow) {
      const formData = {
        name: workflowData.name,
        description: workflowData.description ?? "",
        tags: (workflowData.tags ?? []) as string[],
        triggerType: workflowData.triggerType,
        runLocation: workflowData.runLocation,
        status: workflowData.status,
        scheduleNumber: workflowData.scheduleNumber,
        scheduleUnit: workflowData.scheduleUnit,
        customSchedule: workflowData.customSchedule,
        useCronScheduling: !!workflowData.customSchedule,
        shared: workflowData.shared,
        overrideEventServers: workflowData.overrideEventServers ?? false,
        overrideServerIds: (workflowData.overrideServerIds ?? []) as number[],
      };
      form.reset(formData);
    }
  }, [workflowData, loadingWorkflow, form]);

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
          initialNodes={workflowNodes}
          initialEdges={workflowEdges}
          workflowId={workflowId}
        />
      </div>
    </div>
  );
}
