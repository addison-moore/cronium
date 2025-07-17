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
import {
  EventStatus,
  WorkflowTriggerType,
  RunLocation,
  type TimeUnit,
  ConnectionType,
} from "@/shared/schema";
import WorkflowForm, {
  type WorkflowFormValues,
} from "@/components/workflows/WorkflowForm";
import type { Node, Edge } from "@xyflow/react";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { WorkflowNode, WorkflowEdge } from "@/shared/schemas/workflows";

// type WorkflowData = RouterOutputs["workflows"]["getById"]; // Removed unused type

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

export default function EditWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ lang: string; id: string }>();
  const t = useTranslations("Workflows");
  const lang = params.lang;
  const workflowId = parseInt(params.id);

  const [isLoading, setIsLoading] = useState(false);
  const [workflowNodes, setWorkflowNodes] = useState<Node[]>([]);
  const [workflowEdges, setWorkflowEdges] = useState<Edge[]>([]);

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
      const workflowDataTyped = workflowData.data as any;
      const typedNodes = workflowDataTyped?.nodes as WorkflowNode[] | undefined;
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
      const typedConnections = workflowDataTyped?.connections as
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
      // Transform nodes to match expected type
      const transformedNodes: WorkflowNode[] = nodes.map((node) => ({
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

      // Transform edges to match expected type
      const transformedEdges: WorkflowEdge[] = edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "connectionEdge" as const,
        animated: edge.animated ?? true,
        data: {
          type: (edge.data?.type as ConnectionType) ?? ConnectionType.ALWAYS,
          connectionType:
            (edge.data?.connectionType as ConnectionType) ??
            (edge.data?.type as ConnectionType) ??
            ConnectionType.ALWAYS,
        },
      }));

      await updateWorkflowMutation.mutateAsync({
        id: workflowId,
        ...workflowValues,
        scheduleUnit: workflowValues.scheduleUnit as
          | TimeUnit
          | null
          | undefined,
        nodes: transformedNodes,
        edges: transformedEdges,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Update form when workflow data is loaded
  useEffect(() => {
    if (workflowData && !loadingWorkflow) {
      const workflowDataTyped = workflowData.data as any;
      const formData: WorkflowFormData = {
        name: workflowDataTyped.name as string,
        description: (workflowDataTyped.description ?? "") as string,
        tags: (workflowDataTyped.tags ?? []) as string[],
        triggerType: workflowDataTyped.triggerType as WorkflowTriggerType,
        runLocation: workflowDataTyped.runLocation as RunLocation,
        status: workflowDataTyped.status as EventStatus,
        scheduleNumber: workflowDataTyped.scheduleNumber as number | null,
        scheduleUnit: workflowDataTyped.scheduleUnit as string | null,
        customSchedule: workflowDataTyped.customSchedule as string | null,
        useCronScheduling: !!workflowDataTyped.customSchedule,
        shared: (workflowDataTyped.shared ?? false) as boolean,
        overrideEventServers: (workflowDataTyped.overrideEventServers ??
          false) as boolean,
        overrideServerIds: (workflowDataTyped.overrideServerIds ??
          []) as number[],
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
