"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import { Label } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@cronium/ui";
import { useToast } from "@cronium/ui";
import { Clock, Globe, User, CheckCircle } from "lucide-react";
import {
  type Workflow,
  WorkflowTriggerType,
  EventStatus,
  TimeUnit,
  ConnectionType,
} from "@/shared/schema";
import { trpc } from "@/lib/trpc";

interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: Record<string, unknown>;
}

interface WorkflowDetailsFormProps {
  workflow: Workflow;
  workflowNodes: WorkflowNode[];
  workflowEdges: WorkflowEdge[];
  onUpdate: (workflow: Workflow) => void;
}

// Define the form schema with proper validation
const workflowDetailsSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    description: z.string().max(500, "Description is too long").optional(),
    triggerType: z.nativeEnum(WorkflowTriggerType),
    status: z.nativeEnum(EventStatus),
    tags: z.array(z.string()),
    customSchedule: z.string().optional(),
    // Use z.any() for fields causing type issues, then refine them with superRefine
    scheduleNumber: z.any(),
    scheduleUnit: z.any(),
    useCronScheduling: z.boolean(),
    overrideEventServers: z.boolean(),
    overrideServerIds: z.array(z.number()),
    shared: z.boolean(),
  })
  .superRefine((data, ctx) => {
    // Validate scheduleNumber if it's not null or undefined
    if (data.scheduleNumber !== null && data.scheduleNumber !== undefined) {
      const num = Number(data.scheduleNumber);
      if (isNaN(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Schedule number must be at least 1",
          path: ["scheduleNumber"],
        });
      }
    }

    // Validate scheduleUnit if it's not null or undefined
    if (data.scheduleUnit !== null && data.scheduleUnit !== undefined) {
      const validUnits = Object.values(TimeUnit);
      if (!validUnits.includes(data.scheduleUnit as TimeUnit)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid time unit",
          path: ["scheduleUnit"],
        });
      }
    }
  });

type WorkflowDetailsFormData = z.infer<typeof workflowDetailsSchema>;

export default function WorkflowDetailsForm({
  workflow,
  workflowNodes,
  workflowEdges,
  onUpdate,
}: WorkflowDetailsFormProps) {
  const { toast } = useToast();
  const [tagInput, setTagInput] = useState("");
  const [formData, setFormData] = useState<WorkflowDetailsFormData>({
    name: "",
    description: "",
    triggerType: WorkflowTriggerType.MANUAL,
    status: EventStatus.DRAFT,
    tags: [],
    customSchedule: "",
    scheduleNumber: null,
    scheduleUnit: null,
    useCronScheduling: false,
    overrideEventServers: false,
    overrideServerIds: [],
    shared: false,
  });

  const form = useForm<WorkflowDetailsFormData>({
    resolver: zodResolver(workflowDetailsSchema),
    defaultValues: {
      name: "",
      description: "",
      triggerType: WorkflowTriggerType.MANUAL,
      status: EventStatus.DRAFT,
      tags: [],
      customSchedule: "",
      scheduleNumber: null,
      scheduleUnit: null,
      useCronScheduling: false,
      overrideEventServers: false,
      overrideServerIds: [],
      shared: false,
    },
  });

  // tRPC mutation for updating workflow
  const updateWorkflowMutation = trpc.workflows.update.useMutation({
    onSuccess: (updatedWorkflow) => {
      if (updatedWorkflow) {
        // Pass only the base workflow properties to onUpdate
        onUpdate({
          id: updatedWorkflow.id,
          name: updatedWorkflow.name,
          description: updatedWorkflow.description,
          triggerType: updatedWorkflow.triggerType,
          status: updatedWorkflow.status,
          tags: updatedWorkflow.tags,
          customSchedule: updatedWorkflow.customSchedule,
          scheduleNumber: updatedWorkflow.scheduleNumber,
          scheduleUnit: updatedWorkflow.scheduleUnit,
          overrideEventServers: updatedWorkflow.overrideEventServers,
          overrideServerIds: updatedWorkflow.overrideServerIds,
          shared: updatedWorkflow.shared,
          createdAt: updatedWorkflow.createdAt,
          updatedAt: updatedWorkflow.updatedAt,
          userId: updatedWorkflow.userId,
          webhookKey: updatedWorkflow.webhookKey,
          runLocation: updatedWorkflow.runLocation,
        } as Workflow);
        toast({
          title: "Success",
          description: "Workflow updated successfully",
        });
      }
    },
    onError: (error) => {
      console.error("Error updating workflow:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update workflow",
        variant: "destructive",
      });
    },
  });

  // Initialize form data from workflow
  useEffect(() => {
    form.reset({
      name: workflow.name ?? "",
      description: workflow.description ?? "",
      triggerType: workflow.triggerType ?? WorkflowTriggerType.MANUAL,
      status: workflow.status ?? EventStatus.DRAFT,
      tags: Array.isArray(workflow.tags) ? workflow.tags : [],
      customSchedule: workflow.customSchedule ?? "",
      scheduleNumber: workflow.scheduleNumber ?? null,
      scheduleUnit: workflow.scheduleUnit ?? null,
      useCronScheduling: !!workflow.customSchedule,
      overrideEventServers: workflow.overrideEventServers ?? false,
      overrideServerIds: Array.isArray(workflow.overrideServerIds)
        ? workflow.overrideServerIds
        : [],
      shared: workflow.shared ?? false,
    });
  }, [workflow, form]);

  // Keep formData in sync with form values
  useEffect(() => {
    const subscription = form.watch((value) => {
      setFormData(value as WorkflowDetailsFormData);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const onSubmit = async (data: WorkflowDetailsFormData) => {
    try {
      const updateData = {
        id: workflow.id,
        ...data,
        nodes: workflowNodes.map((node) => ({
          ...node,
          type: "eventNode" as const,
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
        })),
        edges: workflowEdges.map((edge) => ({
          ...edge,
          type: "connectionEdge" as const,
          animated: true,
          data: {
            // Always provide both type and connectionType
            type:
              (edge.data?.type as ConnectionType | undefined) ??
              (edge.data?.connectionType as ConnectionType | undefined) ??
              ConnectionType.ALWAYS,
            connectionType:
              (edge.data?.connectionType as ConnectionType | undefined) ??
              (edge.data?.type as ConnectionType | undefined) ??
              ConnectionType.ALWAYS,
          },
        })),
      };

      await updateWorkflowMutation.mutateAsync(updateData);
    } catch {
      // Error handled by mutation onError
    }
  };

  const addTag = () => {
    const currentTags = form.getValues("tags");
    if (tagInput.trim() && !currentTags.includes(tagInput.trim())) {
      form.setValue("tags", [...currentTags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    const currentTags = form.getValues("tags");
    form.setValue(
      "tags",
      currentTags.filter((tag) => tag !== tagToRemove),
    );
  };

  const handleTagInputKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Workflow Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter workflow name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={EventStatus.DRAFT}>
                          <div className="flex items-center">
                            <Clock className="mr-2 h-4 w-4" />
                            Draft
                          </div>
                        </SelectItem>
                        <SelectItem value={EventStatus.ACTIVE}>
                          <div className="flex items-center">
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Active
                          </div>
                        </SelectItem>
                        <SelectItem value={EventStatus.PAUSED}>
                          <div className="flex items-center">
                            <Clock className="mr-2 h-4 w-4" />
                            Paused
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter workflow description"
                      {...field}
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Type</Label>
              <Select
                value={formData.triggerType}
                onValueChange={(value: WorkflowTriggerType) =>
                  setFormData((prev) => ({ ...prev, triggerType: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select trigger type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WorkflowTriggerType.MANUAL}>
                    <div className="flex items-center">
                      <User className="mr-2 h-4 w-4" />
                      Manual
                    </div>
                  </SelectItem>
                  <SelectItem value={WorkflowTriggerType.SCHEDULE}>
                    <div className="flex items-center">
                      <Clock className="mr-2 h-4 w-4" />
                      Scheduled
                    </div>
                  </SelectItem>
                  <SelectItem value={WorkflowTriggerType.WEBHOOK}>
                    <div className="flex items-center">
                      <Globe className="mr-2 h-4 w-4" />
                      Webhook
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Schedule Settings */}
            {formData.triggerType === WorkflowTriggerType.SCHEDULE && (
              <Card className="bg-muted p-4">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="useCronScheduling"
                      checked={formData.useCronScheduling}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          useCronScheduling: !!checked,
                          customSchedule: checked ? prev.customSchedule : "",
                          scheduleNumber: checked
                            ? null
                            : (prev.scheduleNumber as number | null),
                          scheduleUnit: checked
                            ? null
                            : (prev.scheduleUnit as TimeUnit | null),
                        }))
                      }
                    />
                    <Label htmlFor="useCronScheduling">
                      Use Cron Expression
                    </Label>
                  </div>

                  {formData.useCronScheduling ? (
                    <div className="space-y-2">
                      <Label htmlFor="customSchedule">Cron Expression</Label>
                      <Input
                        id="customSchedule"
                        placeholder="0 0 * * *"
                        value={formData.customSchedule}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            customSchedule: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="scheduleNumber">Every</Label>
                        <Input
                          id="scheduleNumber"
                          type="number"
                          min="1"
                          placeholder="1"
                          value={String(formData.scheduleNumber ?? "")}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              scheduleNumber: e.target.value
                                ? parseInt(e.target.value)
                                : null,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scheduleUnit">Unit</Label>
                        <Select
                          value={String(formData.scheduleUnit ?? "")}
                          onValueChange={(value) =>
                            setFormData((prev) => ({
                              ...prev,
                              scheduleUnit: value as TimeUnit,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={TimeUnit.MINUTES}>
                              Minute(s)
                            </SelectItem>
                            <SelectItem value={TimeUnit.HOURS}>
                              Hour(s)
                            </SelectItem>
                            <SelectItem value={TimeUnit.DAYS}>
                              Day(s)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex space-x-2">
                <Input
                  placeholder="Add tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={handleTagInputKeyPress}
                />
                <Button type="button" onClick={addTag} variant="outline">
                  Add
                </Button>
              </div>
              {formData.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {formData.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="bg-secondary text-secondary-foreground inline-flex items-center rounded-full px-2 py-1 text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-secondary-foreground hover:text-foreground ml-1"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Server Override */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="overrideEventServers"
                  checked={formData.overrideEventServers}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({
                      ...prev,
                      overrideEventServers: checked,
                      overrideServerIds: checked ? prev.overrideServerIds : [],
                    }))
                  }
                />
                <Label htmlFor="overrideEventServers">
                  Override Event Server Settings
                </Label>
              </div>
              {formData.overrideEventServers && (
                <div className="space-y-2">
                  <Label>Server Override Settings</Label>
                  <p className="text-muted-foreground text-sm">
                    Select specific servers to run workflow events on,
                    overriding individual event server settings.
                  </p>
                  {/* Server selection would go here - would need servers query */}
                </div>
              )}
            </div>

            {/* Sharing */}
            <FormField
              control={form.control}
              name="shared"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-y-0 space-x-3">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Make workflow publicly shareable</FormLabel>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-4">
          <Button
            type="submit"
            disabled={
              updateWorkflowMutation.isPending || form.formState.isSubmitting
            }
            className="px-8"
          >
            {updateWorkflowMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
