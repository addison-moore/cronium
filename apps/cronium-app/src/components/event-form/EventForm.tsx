"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import { getDefaultScriptContent } from "@/lib/scriptTemplates";
import { MonacoEditor } from "@cronium/ui";
import { TagsInput } from "@cronium/ui";
import AIScriptAssistant from "@/components/dashboard/AIScriptAssistant-lazy";
import ToolActionSection from "./ToolActionSection";
import EditorSettingsModal, {
  type EditorSettings,
} from "./EditorSettingsModal";
import { Eye, EyeOff, Trash2, Settings, Lock } from "lucide-react";
import { isToolActionsUIEnabled } from "@/lib/featureFlags";
import { parseToolActionConfig } from "@/lib/tools/tool-action-config";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  CatchupPolicy,
  OverlapPolicy,
  type Tool,
} from "@/shared/schema";
import type { ToolActionConfig } from "./ToolActionSection";
import type { ServerData } from "@/components/event-list/types";
import { eventFormSchema, type EventFormData } from "./lib/event-form-schema";
import {
  buildEventFormDefaults,
  buildTimezoneOptions,
  extractServerIds,
  parseInitialEnvVars,
  parseInitialTags,
  type EventFormInitialData,
} from "./lib/event-form-defaults";
import { buildEventPayload, isScriptEventType } from "./lib/event-payload";

const eventsCopy = {
  basicInformation: "Basic Information",
  Fields: {
    Name: "Event Name",
    Description: "Description",
    DescriptionPlaceholder: "Describe what this event does",
    Tags: "Tags",
    TagsPlaceholder: "Add tags to organize your events...",
    Shared: "Make this event shared with all users",
    Type: "Event Type",
    TypeHTTPRequest: "HTTP Request",
    Content: "Script Content",
    EnvironmentVariables: "Environment Variables",
    Key: "Key",
    KeyPlaceholder: "EXAMPLE_API_KEY",
    Value: "Value",
    ValuePlaceholder: "your_secret_value",
    AddVariable: "Add Variable",
    Security: "Security",
    SecurityNote:
      "Environment variables are securely encrypted on your device.",
    ScheduleInterval: "Interval",
    IntervalUnit: "Interval Unit",
    RunLocations: {
      Label: "Execution Location",
      Local: "Local (Cronium host)",
      Help: "Select where this event runs — locally, on remote servers, or both.",
      Groups: "Groups",
      AtLeastOne: "Select at least one execution location",
    },
    Servers: "Servers",
    NoServersAvailable: "No servers available",
    Timeout: "Timeout (seconds)",
    TimeoutUnit: "Timeout Unit",
    Retries: "Retries on Failure",
    MaxExecutions: "Max Executions",
    MaxExecutionsHelp: "Set to 0 for unlimited executions",
    ResetCounterOnActive: "Reset Counter on Activation",
    ResetCounterHelp:
      "Reset the execution counter whenever the event is activated",
  },
  Status: {
    Label: "Status",
    Placeholder: "Select status",
    Active: "Active",
    Paused: "Paused",
    Draft: "Draft",
  },
  Placeholders: {
    EventName: "My Event",
    SelectType: "Select event type",
    SelectLocation: "Select execution location",
  },
  Languages: {
    Python: "Python",
    Bash: "Bash",
    Node: "Node.js",
  },
  ScheduleSettings: "Schedule Settings",
  ExecutionSettings: "Execution Settings",
  Seconds: "Seconds",
  Minutes: "Minutes",
  Hours: "Hours",
  DaysPlural: "Days",
  httpUrl: "Request URL",
  httpHeaders: "Headers",
  headerName: "Header Name",
  headerValue: "Header Value",
  addHeader: "Add Header",
  httpBody: "Request Body",
  httpBodyDescription:
    "Provide the JSON payload that will be sent with this request.",
  Cancel: "Cancel",
  Updating: "Updating...",
  Creating: "Creating...",
  UpdateEvent: "Update Event",
  CreateEvent: "Create Event",
} as const;

// Layout types for different contexts
type EventFormLayout = "page" | "modal" | "embedded";

export interface EventFormProps {
  initialData?: EventFormInitialData;
  isEditing?: boolean;
  eventId?: number;
  onSuccess?: (eventId?: number) => void;
  // Layout prop for different contexts
  layout?: EventFormLayout;
  // Optional callbacks for modal/embedded contexts
  onCancel?: () => void;
  // Control visibility of header/footer
  showHeader?: boolean;
  showFooter?: boolean;
}

export default function EventForm({
  initialData,
  isEditing = false,
  eventId,
  onSuccess,
  layout = "page",
  onCancel,
  showHeader: _showHeader = true,
  showFooter = true,
}: EventFormProps) {
  const { toast } = useToast();

  // Editor settings state
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    fontSize: 14,
    theme: "vs-dark",
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  });
  const [isEditorSettingsModalOpen, setIsEditorSettingsModalOpen] =
    useState(false);
  const [passwordVisibility, setPasswordVisibility] = useState<
    Record<number, boolean>
  >({});

  // Initialize form with React Hook Form
  const form = useForm<EventFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    resolver: zodResolver(eventFormSchema) as any,
    defaultValues: buildEventFormDefaults(initialData),
  });

  const {
    watch,
    setValue,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  // Watch form values
  const type = watch("type");
  const triggerType = watch("triggerType");
  const useCronScheduling = watch("useCronScheduling");
  const watchedCron = watch("customSchedule");
  const watchedTimezone = watch("timezone");

  // Live cron validation + next-fire preview (debounced by react-query keying)
  const cronPreview = trpc.events.validateCron.useQuery(
    { expression: watchedCron ?? "", timezone: watchedTimezone || "UTC" },
    { enabled: useCronScheduling && !!watchedCron, retry: false },
  );

  const timezoneOptions = buildTimezoneOptions();

  // Derived state
  const isScriptType = isScriptEventType(type);
  const isHttpRequest = type === EventType.HTTP_REQUEST;
  const isToolAction = type === EventType.TOOL_ACTION;
  const isScheduled = triggerType === EventTriggerType.SCHEDULE;

  // Fetch available servers
  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100, offset: 0 },
    QUERY_OPTIONS.dynamic,
  );
  const servers = (serversData?.servers ?? []) as ServerData[];

  // Fetch server groups (quick-select in the execution location picker)
  const { data: serverGroupsData } = trpc.servers.getGroups.useQuery(
    undefined,
    QUERY_OPTIONS.dynamic,
  );
  const serverGroups = serverGroupsData?.groups ?? [];

  // Fetch available tools
  const { data: toolsData } = trpc.tools.getAll.useQuery(
    {},
    QUERY_OPTIONS.dynamic,
  );
  const availableTools = (toolsData?.tools ?? []) as unknown as Tool[];

  // tRPC mutations
  const createEventMutation = trpc.events.create.useMutation();
  const updateEventMutation = trpc.events.update.useMutation();

  // Load user editor settings
  const { data: editorSettingsData } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    QUERY_OPTIONS.static,
  );

  // Update editor settings when data is available
  useEffect(() => {
    if (editorSettingsData?.data) {
      setEditorSettings(editorSettingsData.data);
    }
  }, [editorSettingsData]);

  // Form submission handler will be defined below
  const onSubmitRef = useRef<((data: EventFormData) => Promise<void>) | null>(
    null,
  );

  // Keyboard shortcut support (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (onSubmitRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          void form.handleSubmit(onSubmitRef.current as any)();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [form]);

  // Initialize form data from initialData
  useEffect(() => {
    if (initialData) {
      // Parse and set tool action config. Stored value may be an object (newer
      // events) or a (double-)encoded JSON string (older events); handle both.
      if (initialData.toolActionConfig) {
        const config = parseToolActionConfig(initialData.toolActionConfig);
        if (config) {
          setValue("toolActionConfig", config as ToolActionConfig);
        } else {
          console.error(
            "Failed to parse tool action config:",
            initialData.toolActionConfig,
          );
        }
      }

      // Parse and set tags
      const tags = parseInitialTags(initialData.tags);
      if (tags) {
        setValue("tags", tags);
      }

      // Parse and set env vars
      const envVars = parseInitialEnvVars(initialData.environmentVariables);
      if (envVars) {
        setValue("envVars", envVars);
      }

      // Parse HTTP request data
      if (isHttpRequest && initialData.httpMethod) {
        setValue("httpMethod", initialData.httpMethod);
        setValue("httpUrl", initialData.httpUrl ?? "");
        setValue(
          "httpHeaders",
          (initialData.httpHeaders as Array<{ key: string; value: string }>) ??
            [],
        );
        setValue("httpBody", initialData.httpBody ?? "");
      }

      // Set server IDs
      if (initialData.servers && Array.isArray(initialData.servers)) {
        setValue("selectedServerIds", extractServerIds(initialData.servers));
      }
    }
  }, [initialData, setValue, isHttpRequest]);

  // Update content when type changes
  useEffect(() => {
    if (!initialData?.content || initialData?.type !== type) {
      if (isScriptType) {
        setValue("content", getDefaultScriptContent(type));
      }
    }
  }, [type, initialData, isScriptType, setValue]);

  // Force local execution for Tool Actions
  useEffect(() => {
    if (type === EventType.TOOL_ACTION) {
      setValue("runLocation", RunLocation.LOCAL);
      setValue("runOnLocal", true);
      setValue("selectedServerIds", []);
    }
  }, [type, setValue]);

  // Toggle password visibility
  const togglePasswordVisibility = (index: number) => {
    setPasswordVisibility((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Form submission
  const onSubmit = useCallback(
    async (data: EventFormData) => {
      try {
        // Prepare form data for submission (pure construction in
        // lib/event-payload.ts: strips form-only fields, derives run
        // location, and normalizes schedule/content fields).
        const formData = buildEventPayload(data);

        let resultId: number | undefined;

        if (isEditing && eventId) {
          const result = await updateEventMutation.mutateAsync({
            id: eventId,
            ...formData,
          });
          resultId = result?.id;
        } else {
          const result = await createEventMutation.mutateAsync(formData);
          resultId = result?.id;
        }

        toast({
          title: isEditing ? "Event Updated" : "Event Created",
          description: `Successfully ${isEditing ? "updated" : "created"} "${data.name}"`,
          variant: "success",
        });

        if (onSuccess) {
          onSuccess(resultId);
        }
      } catch (error) {
        console.error("Error submitting form:", error);

        // Extract error message from tRPC error
        let errorMessage = `Failed to ${isEditing ? "update" : "create"} event. Please try again.`;

        if (error && typeof error === "object" && "message" in error) {
          errorMessage = error.message as string;
        }

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    },
    [
      isEditing,
      eventId,
      createEventMutation,
      updateEventMutation,
      toast,
      onSuccess,
    ],
  );

  // Update ref after onSubmit is defined
  onSubmitRef.current = onSubmit;

  // Layout-specific styles
  const formClassName =
    layout === "modal"
      ? "space-y-4"
      : layout === "embedded"
        ? "space-y-4"
        : "space-y-6";

  const contentClassName =
    layout === "modal"
      ? "max-h-[60vh] space-y-4 overflow-y-auto px-1"
      : layout === "embedded"
        ? ""
        : "";

  const formContent = (
    <>
      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>{eventsCopy.basicInformation}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="name">{eventsCopy.Fields.Name}</Label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="name"
                  placeholder={eventsCopy.Placeholders.EventName}
                  aria-invalid={!!errors.name}
                />
              )}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <Label htmlFor="description">{eventsCopy.Fields.Description}</Label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="description"
                  placeholder={eventsCopy.Fields.DescriptionPlaceholder}
                />
              )}
            />
          </div>

          {/* Grid layout for other fields */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Tags Field */}
            <div className="space-y-2">
              <Label htmlFor="tags">{eventsCopy.Fields.Tags}</Label>
              <Controller
                name="tags"
                control={control}
                render={({ field }) => (
                  <TagsInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={eventsCopy.Fields.TagsPlaceholder}
                    maxTags={10}
                  />
                )}
              />
            </div>

            {/* Status Field */}
            <div className="space-y-2">
              <Label htmlFor="status">{eventsCopy.Status.Label}</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status">
                      <SelectValue
                        placeholder={eventsCopy.Status.Placeholder}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EventStatus.ACTIVE}>
                        {eventsCopy.Status.Active}
                      </SelectItem>
                      <SelectItem value={EventStatus.PAUSED}>
                        {eventsCopy.Status.Paused}
                      </SelectItem>
                      <SelectItem value={EventStatus.DRAFT}>
                        {eventsCopy.Status.Draft}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Event Type Field */}
            <div className="space-y-2">
              <Label htmlFor="type">{eventsCopy.Fields.Type}</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="type">
                      <SelectValue
                        placeholder={eventsCopy.Placeholders.SelectType}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EventType.PYTHON}>
                        {eventsCopy.Languages.Python}
                      </SelectItem>
                      <SelectItem value={EventType.BASH}>
                        {eventsCopy.Languages.Bash}
                      </SelectItem>
                      <SelectItem value={EventType.NODEJS}>
                        {eventsCopy.Languages.Node}
                      </SelectItem>
                      <SelectItem value={EventType.HTTP_REQUEST}>
                        {eventsCopy.Fields.TypeHTTPRequest}
                      </SelectItem>
                      {isToolActionsUIEnabled() && (
                        <SelectItem value={EventType.TOOL_ACTION}>
                          Tool Action
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Trigger Type Field */}
            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Method</Label>
              <Controller
                name="triggerType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="triggerType">
                      <SelectValue placeholder="Select trigger method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EventTriggerType.MANUAL}>
                        Manual - Run when triggered manually
                      </SelectItem>
                      <SelectItem value={EventTriggerType.SCHEDULE}>
                        Scheduled - Run automatically on a schedule
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* Shared Field */}
          <div className="flex items-center space-x-2">
            <Controller
              name="shared"
              control={control}
              render={({ field }) => (
                <Switch
                  id="shared"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="shared" className="cursor-pointer">
              {eventsCopy.Fields.Shared}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Tool Action Section - Show this INSTEAD of script content for Tool Actions */}
      {isToolAction && isToolActionsUIEnabled() && (
        <Controller
          name="toolActionConfig"
          control={control}
          render={({ field }) => (
            <ToolActionSection
              value={field.value ?? null}
              onChange={field.onChange}
              availableTools={availableTools}
            />
          )}
        />
      )}

      {/* Script Content Section - Only show for script types */}
      {isScriptType && (
        <>
          <AIScriptAssistant
            onApplyCode={(code) => setValue("content", code)}
            scriptType={type}
            currentCode={watch("content") ?? ""}
          />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{eventsCopy.Fields.Content}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditorSettingsModalOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setValue("content", "")}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Controller
                name="content"
                control={control}
                render={({ field }) => (
                  <MonacoEditor
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    language={
                      type === EventType.PYTHON
                        ? "python"
                        : type === EventType.BASH
                          ? "bash"
                          : "javascript"
                    }
                    height="400px"
                    editorSettings={editorSettings}
                  />
                )}
              />
              {errors.content && (
                <p className="text-destructive mt-2 text-sm">
                  {errors.content.message}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* HTTP Request Section - Only show for HTTP_REQUEST type */}
      {isHttpRequest && (
        <Card>
          <CardHeader>
            <CardTitle>HTTP Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* HTTP Method */}
            <div className="space-y-2">
              <Label htmlFor="httpMethod">HTTP Method</Label>
              <Controller
                name="httpMethod"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="httpMethod">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* URL */}
            <div className="space-y-2">
              <Label htmlFor="httpUrl">{eventsCopy.httpUrl}</Label>
              <Controller
                name="httpUrl"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="httpUrl"
                    placeholder="https://api.example.com/data"
                  />
                )}
              />
              {errors.httpUrl && (
                <p className="text-destructive text-sm">
                  {errors.httpUrl.message}
                </p>
              )}
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <Label>{eventsCopy.httpHeaders}</Label>
              <Controller
                name="httpHeaders"
                control={control}
                render={({ field }) => {
                  const headers = field.value ?? [];
                  return (
                    <div className="space-y-2">
                      {headers.map((header, index) => (
                        <div key={index} className="flex space-x-2">
                          <Input
                            value={header.key}
                            onChange={(e) => {
                              const updatedHeaders = [...headers];
                              updatedHeaders[index] = {
                                ...header,
                                key: e.target.value,
                              };
                              field.onChange(updatedHeaders);
                            }}
                            placeholder={eventsCopy.headerName}
                            className="flex-1"
                          />
                          <Input
                            value={header.value}
                            onChange={(e) => {
                              const updatedHeaders = [...headers];
                              updatedHeaders[index] = {
                                ...header,
                                value: e.target.value,
                              };
                              field.onChange(updatedHeaders);
                            }}
                            placeholder={eventsCopy.headerValue}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            onClick={() => {
                              const updatedHeaders = headers.filter(
                                (_, i) => i !== index,
                              );
                              field.onChange(updatedHeaders);
                            }}
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          field.onChange([...headers, { key: "", value: "" }]);
                        }}
                      >
                        {eventsCopy.addHeader}
                      </Button>
                    </div>
                  );
                }}
              />
            </div>

            {/* Body */}
            {["POST", "PUT", "PATCH"].includes(watch("httpMethod") ?? "") && (
              <div className="space-y-2">
                <Label htmlFor="httpBody">{eventsCopy.httpBody}</Label>
                <Controller
                  name="httpBody"
                  control={control}
                  render={({ field }) => (
                    <MonacoEditor
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      language="json"
                      height="250px"
                    />
                  )}
                />
                <p className="text-sm text-gray-500">
                  {eventsCopy.httpBodyDescription}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Environment Variables Section */}
      <Card>
        <CardHeader>
          <CardTitle>{eventsCopy.Fields.EnvironmentVariables}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            name="envVars"
            control={control}
            render={({ field }) => {
              const envVars = field.value;
              return (
                <>
                  {envVars.map((envVar, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label htmlFor={`envKey-${index}`}>
                          {eventsCopy.Fields.Key}
                        </Label>
                        <Input
                          id={`envKey-${index}`}
                          value={envVar.key}
                          onChange={(e) => {
                            const updatedEnvVars = [...envVars];
                            updatedEnvVars[index] = {
                              ...envVar,
                              key: e.target.value,
                            };
                            field.onChange(updatedEnvVars);
                          }}
                          placeholder={eventsCopy.Fields.KeyPlaceholder}
                        />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor={`envValue-${index}`}>
                          {eventsCopy.Fields.Value}
                        </Label>
                        <div className="relative">
                          <Input
                            id={`envValue-${index}`}
                            type={
                              passwordVisibility[index] ? "text" : "password"
                            }
                            value={envVar.value}
                            onChange={(e) => {
                              const updatedEnvVars = [...envVars];
                              updatedEnvVars[index] = {
                                ...envVar,
                                value: e.target.value,
                              };
                              field.onChange(updatedEnvVars);
                            }}
                            placeholder={eventsCopy.Fields.ValuePlaceholder}
                            className="pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-0 right-0 h-10 w-10"
                            onClick={() => togglePasswordVisibility(index)}
                          >
                            {passwordVisibility[index] ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => {
                          const updatedEnvVars = envVars.filter(
                            (_, i) => i !== index,
                          );
                          field.onChange(updatedEnvVars);
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      field.onChange([...envVars, { key: "", value: "" }]);
                    }}
                  >
                    {eventsCopy.Fields.AddVariable}
                  </Button>
                </>
              );
            }}
          />

          <div className="bg-info/10 rounded-md p-3">
            <p className="text-info-text text-sm">
              <Lock className="mr-1 inline h-3.5 w-3.5" />
              <strong>{eventsCopy.Fields.Security}:</strong>{" "}
              {eventsCopy.Fields.SecurityNote}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Section - Only show for scheduled events */}
      {isScheduled && (
        <Card>
          <CardHeader>
            <CardTitle>{eventsCopy.ScheduleSettings}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Start Time */}
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time (Optional)</Label>
              <Controller
                name="startTime"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="startTime"
                    type="datetime-local"
                    value={field.value ?? ""}
                  />
                )}
              />
              <p className="text-muted-foreground text-sm">
                If specified, the event will start running from this time. Leave
                empty to start immediately.
              </p>
            </div>

            {/* Cron Scheduling Toggle */}
            <div className="border-border flex items-center justify-between space-y-1 rounded-lg border p-4">
              <div>
                <Label htmlFor="useCronScheduling" className="font-medium">
                  Use Cron Scheduling
                </Label>
                <p className="text-muted-foreground text-sm">
                  Enable advanced cron syntax for precise scheduling.
                </p>
              </div>
              <Controller
                name="useCronScheduling"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="useCronScheduling"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            {/* Standard Scheduling */}
            {!useCronScheduling && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduleNumber">
                    {eventsCopy.Fields.ScheduleInterval}
                  </Label>
                  <Controller
                    name="scheduleNumber"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        id="scheduleNumber"
                        type="number"
                        min={1}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 1)
                        }
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheduleUnit">
                    {eventsCopy.Fields.IntervalUnit}
                  </Label>
                  <Controller
                    name="scheduleUnit"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id="scheduleUnit">
                          <SelectValue
                            placeholder={eventsCopy.Fields.IntervalUnit}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TimeUnit.SECONDS}>
                            {eventsCopy.Seconds}
                          </SelectItem>
                          <SelectItem value={TimeUnit.MINUTES}>
                            {eventsCopy.Minutes}
                          </SelectItem>
                          <SelectItem value={TimeUnit.HOURS}>
                            {eventsCopy.Hours}
                          </SelectItem>
                          <SelectItem value={TimeUnit.DAYS}>
                            {eventsCopy.DaysPlural}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            )}

            {/* Cron Expression */}
            {useCronScheduling && (
              <div className="space-y-2">
                <Label htmlFor="customSchedule">Cron Expression</Label>
                <Controller
                  name="customSchedule"
                  control={control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id="customSchedule"
                      placeholder="0 */5 * * * (every 5 minutes)"
                    />
                  )}
                />
                <p className="text-muted-foreground text-sm">
                  Use standard cron syntax. Examples: "0 */5 * * *" (every 5
                  minutes), "0 0 * * *" (daily at midnight)
                </p>
                {watchedCron &&
                  cronPreview.data &&
                  (cronPreview.data.valid ? (
                    <div className="text-muted-foreground text-xs">
                      Next runs ({watchedTimezone || "UTC"}):{" "}
                      {cronPreview.data.next
                        .slice(0, 3)
                        .map((iso) =>
                          new Date(iso).toLocaleString(undefined, {
                            timeZone: watchedTimezone || "UTC",
                          }),
                        )
                        .join("; ")}
                    </div>
                  ) : (
                    <div className="text-destructive text-xs">
                      Invalid cron expression
                      {cronPreview.data.error
                        ? `: ${cronPreview.data.error}`
                        : ""}
                    </div>
                  ))}
              </div>
            )}

            {/* Durable-scheduler options */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Controller
                  name="timezone"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="timezone">
                        <SelectValue placeholder="UTC" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {timezoneOptions.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-muted-foreground text-xs">
                  Cron schedules fire in this timezone.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger id="priority">
                        <SelectValue placeholder="Normal" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Low</SelectItem>
                        <SelectItem value="1">Normal</SelectItem>
                        <SelectItem value="2">High</SelectItem>
                        <SelectItem value="3">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-muted-foreground text-xs">
                  Higher-priority jobs are picked up first.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="catchupPolicy">Missed runs</Label>
                <Controller
                  name="catchupPolicy"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="catchupPolicy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CatchupPolicy.SKIP}>
                          Skip (record only)
                        </SelectItem>
                        <SelectItem value={CatchupPolicy.RUN_ONCE}>
                          Run once on recovery
                        </SelectItem>
                        <SelectItem value={CatchupPolicy.RUN_ALL}>
                          Run each missed tick
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-muted-foreground text-xs">
                  What happens to runs missed while Cronium was down.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="overlapPolicy">Overlapping runs</Label>
                <Controller
                  name="overlapPolicy"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="overlapPolicy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={OverlapPolicy.ALLOW}>
                          Allow concurrent runs
                        </SelectItem>
                        <SelectItem value={OverlapPolicy.SKIP}>
                          Skip while previous is running
                        </SelectItem>
                        <SelectItem value={OverlapPolicy.QUEUE}>
                          Queue one behind the running run
                        </SelectItem>
                        <SelectItem value={OverlapPolicy.CANCEL_PREVIOUS}>
                          Cancel the previous run
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-muted-foreground text-xs">
                  What a due run does when the previous one is still active.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{eventsCopy.ExecutionSettings}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Execution Location: local host, remote servers, or both */}
          <div className="space-y-2">
            <Label>{eventsCopy.Fields.RunLocations.Label}</Label>
            {isToolAction ? (
              <p className="text-muted-foreground text-sm">
                Tool Actions can only run on the local server.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  {eventsCopy.Fields.RunLocations.Help}
                </p>
                <Controller
                  name="selectedServerIds"
                  control={control}
                  render={({ field }) => {
                    const selected = field.value ?? [];
                    const toggleGroup = (groupServerIds: number[]) => {
                      const memberIds = groupServerIds.filter((id) =>
                        servers.some((server) => server.id === id),
                      );
                      if (memberIds.length === 0) return;
                      const allSelected = memberIds.every((id) =>
                        selected.includes(id),
                      );
                      field.onChange(
                        allSelected
                          ? selected.filter((id) => !memberIds.includes(id))
                          : Array.from(new Set([...selected, ...memberIds])),
                      );
                    };

                    return (
                      <div className="border-border max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
                        {/* Local host */}
                        <div className="flex items-center space-x-2">
                          <Controller
                            name="runOnLocal"
                            control={control}
                            render={({ field: localField }) => (
                              <Checkbox
                                id="location-local"
                                checked={localField.value}
                                onCheckedChange={(checked) =>
                                  localField.onChange(checked === true)
                                }
                              />
                            )}
                          />
                          <Label
                            htmlFor="location-local"
                            className="cursor-pointer text-sm font-normal"
                          >
                            {eventsCopy.Fields.RunLocations.Local}
                          </Label>
                        </div>

                        {/* Group quick-select */}
                        {serverGroups.length > 0 && servers.length > 0 && (
                          <div className="border-border flex flex-wrap items-center gap-2 border-t pt-2">
                            <span className="text-muted-foreground text-xs">
                              {eventsCopy.Fields.RunLocations.Groups}:
                            </span>
                            {serverGroups.map((group) => {
                              const memberIds = group.serverIds.filter((id) =>
                                servers.some((server) => server.id === id),
                              );
                              const allSelected =
                                memberIds.length > 0 &&
                                memberIds.every((id) => selected.includes(id));
                              return (
                                <Button
                                  key={group.id}
                                  type="button"
                                  size="sm"
                                  variant={allSelected ? "default" : "outline"}
                                  className="h-6 px-2 text-xs"
                                  disabled={memberIds.length === 0}
                                  onClick={() => toggleGroup(group.serverIds)}
                                  title={
                                    allSelected
                                      ? `Remove all servers in ${group.name}`
                                      : `Add all servers in ${group.name}`
                                  }
                                >
                                  {group.name} ({memberIds.length})
                                </Button>
                              );
                            })}
                          </div>
                        )}

                        {/* Servers */}
                        {servers.length === 0 ? (
                          <p className="border-border border-t pt-2 text-sm text-gray-500">
                            {eventsCopy.Fields.NoServersAvailable ||
                              "No servers available. Please add a server first."}
                          </p>
                        ) : (
                          <div className="border-border space-y-2 border-t pt-2">
                            {servers.map((server) => (
                              <div
                                key={server.id}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`server-${server.id}`}
                                  checked={selected.includes(server.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...selected, server.id]);
                                    } else {
                                      field.onChange(
                                        selected.filter(
                                          (id: number) => id !== server.id,
                                        ),
                                      );
                                    }
                                  }}
                                />
                                <Label
                                  htmlFor={`server-${server.id}`}
                                  className="cursor-pointer text-sm font-normal"
                                >
                                  {server.name} ({server.address})
                                </Label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {errors.selectedServerIds && (
                  <p className="text-destructive text-sm">
                    {errors.selectedServerIds.message}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Timeout Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="timeoutValue">{eventsCopy.Fields.Timeout}</Label>
              <Controller
                name="timeoutValue"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="timeoutValue"
                    type="number"
                    min={1}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 30)
                    }
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeoutUnit">
                {eventsCopy.Fields.TimeoutUnit}
              </Label>
              <Controller
                name="timeoutUnit"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="timeoutUnit">
                      <SelectValue
                        placeholder={eventsCopy.Fields.TimeoutUnit}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TimeUnit.SECONDS}>
                        {eventsCopy.Seconds}
                      </SelectItem>
                      <SelectItem value={TimeUnit.MINUTES}>
                        {eventsCopy.Minutes}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* Retries */}
          <div className="space-y-2">
            <Label htmlFor="retries">{eventsCopy.Fields.Retries}</Label>
            <Controller
              name="retries"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="retries"
                  type="number"
                  min={0}
                  max={10}
                  onChange={(e) =>
                    field.onChange(parseInt(e.target.value) || 0)
                  }
                />
              )}
            />
          </div>

          {/* Max Executions */}
          <div className="space-y-2">
            <Label htmlFor="maxExecutions">
              {eventsCopy.Fields.MaxExecutions}
            </Label>
            <Controller
              name="maxExecutions"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="maxExecutions"
                  type="number"
                  min={0}
                  onChange={(e) =>
                    field.onChange(parseInt(e.target.value) || 0)
                  }
                />
              )}
            />
            <p className="text-muted-foreground text-sm">
              {eventsCopy.Fields.MaxExecutionsHelp}
            </p>
          </div>

          {/* Reset Counter on Active */}
          <div className="flex items-center justify-between space-y-1">
            <div>
              <Label htmlFor="resetCounterOnActive" className="font-medium">
                {eventsCopy.Fields.ResetCounterOnActive}
              </Label>
              <p className="text-muted-foreground text-sm">
                {eventsCopy.Fields.ResetCounterHelp}
              </p>
            </div>
            <Controller
              name="resetCounterOnActive"
              control={control}
              render={({ field }) => (
                <Switch
                  id="resetCounterOnActive"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );

  return (
    <form
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      onSubmit={handleSubmit(onSubmit as any)}
      className={formClassName}
    >
      {contentClassName ? (
        <div className={contentClassName}>{formContent}</div>
      ) : (
        formContent
      )}

      {/* Form Actions */}
      {showFooter && (
        <div
          className={`flex ${onCancel ? "justify-between" : "justify-end"} space-x-4 ${layout === "modal" ? "bg-popover border-border sticky bottom-0 border-t pt-4" : ""}`}
        >
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {eventsCopy.Cancel}
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isEditing
                ? eventsCopy.Updating
                : eventsCopy.Creating
              : isEditing
                ? eventsCopy.UpdateEvent
                : eventsCopy.CreateEvent}
          </Button>
        </div>
      )}

      {/* Editor Settings Modal */}
      <EditorSettingsModal
        isOpen={isEditorSettingsModalOpen}
        onClose={() => setIsEditorSettingsModalOpen(false)}
        onSettingsChange={setEditorSettings}
        currentSettings={editorSettings}
      />
    </form>
  );
}
