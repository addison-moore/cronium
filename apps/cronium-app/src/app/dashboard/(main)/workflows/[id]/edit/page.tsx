"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button, PageShell, DetailPageSkeleton } from "@cronium/ui";
import { toast } from "@cronium/ui";
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
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/trpc/shared";
import type { WorkflowNode, WorkflowEdge } from "@/shared/schemas/workflows";
import {
  isSameGraph,
  toCanvasGraph,
} from "@/components/workflows/lib/stored-graph";

const copy = {
  loading: "Loading workflow...",
  backToWorkflows: "Back to Workflows",
  editWorkflow: "Edit Workflow",
  saveWorkflow: "Save Workflow",
} as const;

type StoredWorkflow = NonNullable<
  RouterOutputs["workflows"]["getById"]["data"]
>;

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

/**
 * The form's values for what's stored. The form compares this by value with what it
 * last had, and a difference resets the fields nobody has edited, so the same workflow
 * must always give the same values.
 */
function toFormData(workflow: StoredWorkflow): WorkflowFormData {
  return {
    name: workflow.name,
    description: workflow.description ?? "",
    tags: (workflow.tags ?? []) as string[],
    triggerType: workflow.triggerType,
    runLocation: workflow.runLocation,
    status: workflow.status,
    scheduleNumber: workflow.scheduleNumber,
    scheduleUnit: workflow.scheduleUnit,
    customSchedule: workflow.customSchedule,
    useCronScheduling: !!workflow.customSchedule,
    shared: workflow.shared ?? false,
    overrideEventServers: workflow.overrideEventServers ?? false,
    overrideServerIds: (workflow.overrideServerIds ?? []) as number[],
  };
}

export default function EditWorkflowPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const workflowId = params?.id ? parseInt(params.id) : NaN;

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
      router.push("/dashboard/workflows");
    }
  }, [workflowId, router, toast]);

  // Handle workflow error
  useEffect(() => {
    if (workflowError) {
      if (workflowError.data?.code === "NOT_FOUND") {
        toast({
          title: "Error",
          description: "Workflow not found",
          variant: "destructive",
        });
        router.push("/dashboard/workflows");
      } else {
        toast({
          title: "Error",
          description: "Failed to load workflow data. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [workflowError, router, toast]);

  if (loadingWorkflow) {
    return <DetailPageSkeleton withSidebar={false} />;
  }

  const workflow = workflowData?.data;
  if (!workflow) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Workflow not found</p>
          <Button
            onClick={() => router.push(`/dashboard/workflows/${workflowId}`)}
            className="mt-4"
          >
            {copy.backToWorkflows}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <PageShell>
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" asChild className="mr-4">
            <Link href="/dashboard/workflows">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {copy.backToWorkflows}
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{copy.editWorkflow}</h1>
            <p className="text-muted-foreground mt-1">
              Update your workflow configuration and design
            </p>
          </div>
        </div>

        {/* One form per workflow: what's typed belongs to the workflow it was typed for. */}
        <EditWorkflowForm key={workflow.id} workflow={workflow} />
      </PageShell>
    </div>
  );
}

/**
 * The form, made only once the workflow is here, so it starts from what's stored: a
 * field showing the form's own starting value, such as Draft for the status, while the
 * form holds the workflow's, misleads whoever saves.
 */
function EditWorkflowForm({ workflow }: { workflow: StoredWorkflow }) {
  const router = useRouter();
  const workflowId = workflow.id;
  const [isLoading, setIsLoading] = useState(false);

  // What's stored, compared by value. Every read of the workflow is a new object, a
  // refocus's included, because superjson's Dates defeat React Query's structural
  // sharing. When a stored value really has changed, a field nobody has edited takes
  // it and an edited one keeps what was typed, so a save neither loses what was typed
  // nor writes back the old value of something changed elsewhere.
  const storedValues = useMemo(() => toFormData(workflow), [workflow]);
  const form = useForm<WorkflowFormData>({
    resolver: zodResolver(workflowFormSchema),
    values: storedValues,
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
      keepIsSubmitted: true,
    },
  });

  // The graph the form starts from. The form copies it once, as it mounts, and a later
  // read mustn't change it under the form: a save compares the canvas against it, and
  // only sends the graph if the canvas changed it.
  const [startingGraph] = useState(() => toCanvasGraph(workflow));

  // Use tRPC mutation to update workflow
  const updateWorkflowMutation = trpc.workflows.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Workflow updated successfully",
        variant: "success",
      });
      router.push(`/dashboard/workflows/${workflowId}`);
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
          connectionType:
            (edge.data?.connectionType as ConnectionType) ??
            ConnectionType.ALWAYS,
        },
      }));

      // A graph that's sent replaces every node and connection with new ones, which a
      // running workflow can't follow, so it goes only when the canvas changed it.
      const graphChanged = !isSameGraph(startingGraph, { nodes, edges });

      await updateWorkflowMutation.mutateAsync({
        id: workflowId,
        ...workflowValues,
        scheduleUnit: workflowValues.scheduleUnit as
          TimeUnit | null | undefined,
        ...(graphChanged && {
          nodes: transformedNodes,
          edges: transformedEdges,
        }),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
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
      submitButtonText={copy.saveWorkflow}
      showActionsAtTop={true}
      initialNodes={startingGraph.nodes}
      initialEdges={startingGraph.edges}
      workflowId={workflowId}
    />
  );
}
