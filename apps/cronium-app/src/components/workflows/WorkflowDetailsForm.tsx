"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
} from "@/shared/schema";
import { trpc } from "@/lib/trpc";
import {
  type WorkflowDetailsFormData,
  type WorkflowEdge,
  type WorkflowNode,
  applyCronSchedulingToggle,
  applyServerOverrideToggle,
  buildWorkflowUpdatePayload,
  workflowDetailsSchema,
  workflowToFormValues,
} from "./lib/workflow-details";

interface WorkflowDetailsFormProps {
  workflow: Workflow;
  workflowNodes: WorkflowNode[];
  workflowEdges: WorkflowEdge[];
  onUpdate: (workflow: Workflow) => void;
}

export default function WorkflowDetailsForm({
  workflow,
  workflowNodes,
  workflowEdges,
  onUpdate,
}: WorkflowDetailsFormProps) {
  const { toast } = useToast();
  const [tagInput, setTagInput] = useState("");

  // Single source of truth: react-hook-form, seeded from the workflow so the
  // first paint already shows the stored trigger/schedule (a parallel local
  // state mirror previously rendered every workflow as "Manual" until a field
  // changed, and silently dropped trigger/schedule edits on save).
  const form = useForm<WorkflowDetailsFormData>({
    resolver: zodResolver(workflowDetailsSchema),
    defaultValues: workflowToFormValues(workflow),
  });

  // Re-render on any change so the conditional sections (schedule, override)
  // track the live form values.
  const formValues = form.watch();

  /** Write a helper-computed partial back into the form (dirty-tracked). */
  const applyValues = (next: WorkflowDetailsFormData) => {
    for (const [key, value] of Object.entries(next) as [
      keyof WorkflowDetailsFormData,
      WorkflowDetailsFormData[keyof WorkflowDetailsFormData],
    ][]) {
      if (form.getValues(key) !== value) {
        form.setValue(key, value, { shouldDirty: true });
      }
    }
  };

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
          nextRunAt: updatedWorkflow.nextRunAt ?? null,
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
          // The plaintext key is only present on create/rotate; reads omit it.
          webhookKey: updatedWorkflow.webhookKey ?? null,
          webhookKeyHash: null,
          runLocation: updatedWorkflow.runLocation,
          source: updatedWorkflow.source,
        });
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

  // Re-seed when the workflow prop changes (e.g. after a successful save the
  // parent passes the updated workflow back down).
  useEffect(() => {
    form.reset(workflowToFormValues(workflow));
  }, [workflow, form]);

  const onSubmit = async (data: WorkflowDetailsFormData) => {
    try {
      const updateData = buildWorkflowUpdatePayload(
        workflow.id,
        data,
        workflowNodes,
        workflowEdges,
      );

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
                value={formValues.triggerType}
                onValueChange={(value: WorkflowTriggerType) =>
                  form.setValue("triggerType", value, { shouldDirty: true })
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
            {formValues.triggerType === WorkflowTriggerType.SCHEDULE && (
              <Card className="bg-muted p-4">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="useCronScheduling"
                      checked={formValues.useCronScheduling}
                      onCheckedChange={(checked) =>
                        applyValues(
                          applyCronSchedulingToggle(form.getValues(), checked),
                        )
                      }
                    />
                    <Label htmlFor="useCronScheduling">
                      Use Cron Expression
                    </Label>
                  </div>

                  {formValues.useCronScheduling ? (
                    <div className="space-y-2">
                      <Label htmlFor="customSchedule">Cron Expression</Label>
                      <Input
                        id="customSchedule"
                        placeholder="0 0 * * *"
                        value={formValues.customSchedule}
                        onChange={(e) =>
                          form.setValue("customSchedule", e.target.value, {
                            shouldDirty: true,
                          })
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
                          value={String(formValues.scheduleNumber ?? "")}
                          onChange={(e) =>
                            form.setValue(
                              "scheduleNumber",
                              e.target.value ? parseInt(e.target.value) : null,
                              { shouldDirty: true },
                            )
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scheduleUnit">Unit</Label>
                        <Select
                          value={String(formValues.scheduleUnit ?? "")}
                          onValueChange={(value) =>
                            form.setValue("scheduleUnit", value, {
                              shouldDirty: true,
                            })
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
              {formValues.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {formValues.tags.map((tag, index) => (
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
                  checked={formValues.overrideEventServers}
                  onCheckedChange={(checked) =>
                    applyValues(
                      applyServerOverrideToggle(form.getValues(), checked),
                    )
                  }
                />
                <Label htmlFor="overrideEventServers">
                  Override Event Server Settings
                </Label>
              </div>
              {formValues.overrideEventServers && (
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
