"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { Clock, Globe, User, CheckCircle, ServerIcon } from "lucide-react";
import {
  type Workflow,
  WorkflowTriggerType,
  EventStatus,
  TimeUnit,
} from "@/shared/schema";
import { trpc } from "@/lib/trpc";

interface WorkflowDetailsFormProps {
  workflow: Workflow;
  workflowNodes: any[];
  workflowEdges: any[];
  onUpdate: (workflow: Workflow) => void;
}

// Define the form schema with proper validation
const workflowDetailsSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(500, "Description is too long").optional(),
  triggerType: z.nativeEnum(WorkflowTriggerType),
  status: z.nativeEnum(EventStatus),
  tags: z.array(z.string()),
  customSchedule: z.string().optional(),
  scheduleNumber: z.number().min(1).nullable(),
  scheduleUnit: z.nativeEnum(TimeUnit).nullable(),
  useCronScheduling: z.boolean(),
  overrideEventServers: z.boolean(),
  overrideServerIds: z.array(z.number()),
  shared: z.boolean(),
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
      onUpdate(updatedWorkflow);
      toast({
        title: "Success",
        description: "Workflow updated successfully",
      });
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
      name: workflow.name || "",
      description: workflow.description || "",
      triggerType: workflow.triggerType || WorkflowTriggerType.MANUAL,
      status: workflow.status || EventStatus.DRAFT,
      tags: Array.isArray(workflow.tags) ? workflow.tags : [],
      customSchedule: workflow.customSchedule || "",
      scheduleNumber: workflow.scheduleNumber || null,
      scheduleUnit: workflow.scheduleUnit || null,
      useCronScheduling: !!workflow.customSchedule,
      overrideEventServers: workflow.overrideEventServers || false,
      overrideServerIds: Array.isArray(workflow.overrideServerIds)
        ? workflow.overrideServerIds
        : [],
      shared: workflow.shared || false,
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
        nodes: workflowNodes,
        edges: workflowEdges,
      };

      await updateWorkflowMutation.mutateAsync(updateData);
    } catch (error) {
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
                          scheduleNumber: checked ? null : prev.scheduleNumber,
                          scheduleUnit: checked ? null : prev.scheduleUnit,
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
                          value={formData.scheduleNumber || ""}
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
                          value={formData.scheduleUnit || ""}
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
