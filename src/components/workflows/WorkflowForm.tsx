"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Calendar, Globe, Hand, GitFork } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TagsInput } from "@/components/ui/tags-input";
import type { UseFormReturn } from "react-hook-form";
import { EventStatus, WorkflowTriggerType } from "@/shared/schema";
import type { EventType, RunLocation } from "@/shared/schema";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas";
import type { Node, Edge } from "@xyflow/react";
import { trpc } from "@/lib/trpc";

export interface WorkflowFormValues {
  name: string;
  description?: string;
  tags?: string[];
  triggerType: WorkflowTriggerType;
  runLocation: RunLocation;
  status: EventStatus;
  scheduleNumber?: number | null;
  scheduleUnit?: string | null;
  customSchedule?: string | null;
  useCronScheduling: boolean;
  shared: boolean;
  overrideEventServers: boolean;
  overrideServerIds: number[];
}

export interface EventItem {
  id: number;
  name: string;
  type: EventType;
}

interface WorkflowFormProps {
  form: UseFormReturn<WorkflowFormValues>;
  onSubmit: (
    values: WorkflowFormValues,
    nodes: Node[],
    edges: Edge[],
  ) => Promise<void>;
  isLoading: boolean;
  submitButtonText: string;
  cancelButtonText?: string;
  onCancel?: () => void;
  showActionsAtTop?: boolean;
  // Optional initial data for editing workflows
  initialNodes?: Node[];
  initialEdges?: Edge[];
  workflowId?: number;
}

export default function WorkflowForm({
  form,
  onSubmit,
  isLoading,
  submitButtonText,
  cancelButtonText = "Cancel",
  onCancel,
  showActionsAtTop = false,
  initialNodes = [],
  initialEdges = [],
}: WorkflowFormProps) {
  // Internal state management
  const [workflowNodes, setWorkflowNodes] = useState<Node[]>(initialNodes);
  const [workflowEdges, setWorkflowEdges] = useState<Edge[]>(initialEdges);
  const [activeTab, setActiveTab] = useState("details");

  // tRPC queries
  const {
    data: eventsData,
    isLoading: loadingEvents,
    error: eventsError,
    refetch: refetchEvents,
  } = trpc.events.getAll.useQuery({
    limit: 1000,
    offset: 0,
    search: "",
    status: undefined,
  });

  const { data: serversData, error: serversError } =
    trpc.servers.getAll.useQuery({
      limit: 1000,
      offset: 0,
      search: "",
      online: undefined,
    });

  // Transform tRPC data
  const events: EventItem[] = useMemo(() => {
    if (!eventsData?.events) return [];
    return eventsData.events.map((event) => ({
      id: event.id,
      name: event.name,
      type: event.type,
    }));
  }, [eventsData]);

  const servers = useMemo(() => {
    return serversData?.servers ?? [];
  }, [serversData]);

  // Update events function to refresh workflow nodes when events change
  const updateEvents = useCallback(async () => {
    try {
      console.log("Updating events...");
      await refetchEvents();
    } catch (error) {
      console.error("Error fetching events:", error);
      toast({
        title: "Error",
        description: "Failed to load events. Please try again.",
        variant: "destructive",
      });
    }
  }, [refetchEvents]);

  const handleCanvasChange = useCallback((nodes: Node[], edges: Edge[]) => {
    console.log("Canvas data updated:", { nodes, edges });
    setWorkflowNodes(nodes);
    setWorkflowEdges(edges);
  }, []);

  const handleSubmit = async (values: WorkflowFormValues) => {
    try {
      await onSubmit(values, workflowNodes, workflowEdges);
    } catch (error) {
      console.error("Error submitting workflow:", error);
      toast({
        title: "Error",
        description: "Failed to save workflow. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle errors from tRPC queries
  useEffect(() => {
    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      toast({
        title: "Error",
        description: "Failed to load events. Please try again.",
        variant: "destructive",
      });
    }
  }, [eventsError]);

  useEffect(() => {
    if (serversError) {
      console.error("Error fetching servers:", serversError);
      toast({
        title: "Error",
        description: "Failed to load servers. Please try again.",
        variant: "destructive",
      });
    }
  }, [serversError]);

  const triggerTypeOptions = [
    {
      value: WorkflowTriggerType.MANUAL,
      label: "Manual",
      description: "Triggered manually by users",
      icon: <Hand className="h-4 w-4" />,
    },
    {
      value: WorkflowTriggerType.SCHEDULE,
      label: "Scheduled",
      description: "Triggered on a schedule",
      icon: <Calendar className="h-4 w-4" />,
    },
    {
      value: WorkflowTriggerType.WEBHOOK,
      label: "Webhook",
      description: "Triggered by external HTTP requests",
      icon: <Globe className="h-4 w-4" />,
    },
  ];

  const renderActionButtons = () => (
    <div className="flex justify-end space-x-4">
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelButtonText}
        </Button>
      )}
      <Button
        type="submit"
        disabled={isLoading || loadingEvents}
        className="min-w-[120px]"
      >
        {isLoading ? "Creating..." : submitButtonText}
      </Button>
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        {showActionsAtTop && renderActionButtons()}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <Tab value="details" label="Details" />
            <Tab value="workflow" label="Workflow" />
          </TabsList>

          <TabsContent value="details" className="space-y-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>
                  Configure the basic details of your workflow
                </CardDescription>
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
                              Draft
                            </SelectItem>
                            <SelectItem value={EventStatus.ACTIVE}>
                              Active
                            </SelectItem>
                            <SelectItem value={EventStatus.PAUSED}>
                              Paused
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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <FormControl>
                        <TagsInput
                          value={field.value ?? []}
                          onChange={field.onChange}
                          placeholder="Add tags"
                        />
                      </FormControl>
                      <FormDescription>
                        Add tags to organize and categorize your workflow
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Trigger Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Trigger Configuration</CardTitle>
                <CardDescription>
                  Configure how this workflow should be triggered
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="triggerType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trigger Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select trigger type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {triggerTypeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex items-center space-x-2">
                                {option.icon}
                                <div>
                                  <div className="font-medium">
                                    {option.label}
                                  </div>
                                  <div className="text-muted-foreground text-sm">
                                    {option.description}
                                  </div>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Schedule Configuration */}
                {form.watch("triggerType") === WorkflowTriggerType.SCHEDULE && (
                  <Card className="bg-muted p-4">
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="useCronScheduling"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Use Cron Expression
                              </FormLabel>
                              <FormDescription>
                                Use cron syntax for advanced scheduling
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {form.watch("useCronScheduling") ? (
                        <FormField
                          control={form.control}
                          name="customSchedule"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Cron Expression</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="0 0 * * *"
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormDescription>
                                Enter a valid cron expression (e.g., "0 0 * * *"
                                for daily at midnight)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="scheduleNumber"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Every</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="1"
                                    placeholder="1"
                                    {...field}
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value
                                          ? parseInt(e.target.value)
                                          : null,
                                      )
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="scheduleUnit"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Unit</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value ?? ""}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select unit" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="minute">
                                      Minute(s)
                                    </SelectItem>
                                    <SelectItem value="hour">
                                      Hour(s)
                                    </SelectItem>
                                    <SelectItem value="day">Day(s)</SelectItem>
                                    <SelectItem value="week">
                                      Week(s)
                                    </SelectItem>
                                    <SelectItem value="month">
                                      Month(s)
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </Card>
                )}
              </CardContent>
            </Card>

            {/* Advanced Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>
                  Configure advanced workflow settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="shared"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Make workflow publicly shareable
                        </FormLabel>
                        <FormDescription>
                          Allow others to view and copy this workflow
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="overrideEventServers"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Override Event Server Settings
                        </FormLabel>
                        <FormDescription>
                          Use specific servers for all events in this workflow
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch("overrideEventServers") && (
                  <FormField
                    control={form.control}
                    name="overrideServerIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Override Servers</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(value) => {
                              const currentIds = field.value || [];
                              const serverId = parseInt(value);
                              if (!currentIds.includes(serverId)) {
                                field.onChange([...currentIds, serverId]);
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select servers" />
                            </SelectTrigger>
                            <SelectContent>
                              {servers.map((server) => (
                                <SelectItem
                                  key={server.id}
                                  value={server.id.toString()}
                                >
                                  {server.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          Selected servers will be used instead of individual
                          event server settings
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workflow" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <GitFork className="h-5 w-5" />
                  <span>Workflow Designer</span>
                </CardTitle>
                <CardDescription>
                  Design your workflow by connecting events together
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingEvents ? (
                  <div className="flex h-64 items-center justify-center">
                    <div className="text-muted-foreground">
                      Loading events...
                    </div>
                  </div>
                ) : (
                  <WorkflowCanvas
                    availableEvents={events}
                    initialNodes={workflowNodes}
                    initialEdges={workflowEdges}
                    onChange={(nodes, edges) =>
                      handleCanvasChange(nodes, edges)
                    }
                    updateEvents={updateEvents}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {!showActionsAtTop && renderActionButtons()}
      </form>
    </Form>
  );
}
