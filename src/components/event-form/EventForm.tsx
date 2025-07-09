"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import {
  getDefaultScriptContent,
  getDefaultHttpRequest,
} from "@/lib/scriptTemplates";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { TagsInput } from "@/components/ui/tags-input";
import AIScriptAssistant from "@/components/dashboard/AIScriptAssistant";
import ConditionalActionsSection, { type EventData } from "./ConditionalActionsSection";
import ToolActionSection from "./ToolActionSection";
import EditorSettingsModal, {
  type EditorSettings,
} from "./EditorSettingsModal";
import { Eye, EyeOff, Trash2, Settings } from "lucide-react";
import { isToolActionsUIEnabled } from "@/lib/featureFlags";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  type Event,
} from "@/shared/schema";
import type { ToolActionConfig } from "./ToolActionSection";

// Extended Event type that includes relation properties
interface EventFormInitialData extends Partial<Event> {
  environmentVariables?: Array<{ key: string; value: string }>;
  servers?: Array<{ id: number; name: string }>;
  // Conditional events
  successEvents?: Array<{
    id: number;
    type: string;
    value?: string;
    emailSubject?: string;
    targetEventId?: number;
    toolId?: number;
    message?: string;
  }>;
  failEvents?: Array<{
    id: number;
    type: string;
    value?: string;
    emailSubject?: string;
    targetEventId?: number;
    toolId?: number;
    message?: string;
  }>;
  alwaysEvents?: Array<{
    id: number;
    type: string;
    value?: string;
    targetEventId?: number;
    toolId?: number;
    message?: string;
  }>;
  conditionEvents?: Array<{
    id: number;
    type: string;
    value?: string;
    emailSubject?: string;
    targetEventId?: number;
    toolId?: number;
    message?: string;
  }>;
}

// Form schema using Zod
const eventFormSchema = z
  .object({
    name: z.string().min(1, "Event name is required"),
    description: z.string().optional(),
    shared: z.boolean().default(false),
    type: z.nativeEnum(EventType),
    content: z.string().optional(),
    status: z.nativeEnum(EventStatus),
    triggerType: z.nativeEnum(EventTriggerType),
    scheduleNumber: z.number().min(1).default(5),
    scheduleUnit: z.nativeEnum(TimeUnit).default(TimeUnit.MINUTES),
    startTime: z.string().optional().nullable(),
    useCronScheduling: z.boolean().default(false),
    customSchedule: z.string().optional(),
    timeoutValue: z.number().min(1).default(30),
    timeoutUnit: z.nativeEnum(TimeUnit).default(TimeUnit.SECONDS),
    runLocation: z.nativeEnum(RunLocation).default(RunLocation.LOCAL),
    selectedServerIds: z.array(z.number()).default([]),
    retries: z.number().min(0).max(10).default(0),
    maxExecutions: z.number().min(0).default(0),
    resetCounterOnActive: z.boolean().default(false),
    envVars: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().optional(),
    httpHeaders: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
    httpBody: z.string().optional(),
    // Tool Action specific field
    toolActionConfig: z.custom<ToolActionConfig>().optional().nullable(),
    // Conditional actions
    conditionalActions: z
      .array(
        z.object({
          type: z.string(),
          action: z.string(),
          emailAddresses: z.string().optional(),
          emailSubject: z.string().optional(),
          targetEventId: z.number().optional().nullable(),
          toolId: z.number().optional().nullable(),
          message: z.string().optional(),
        }),
      )
      .default([]),
  })
  .refine(
    (data) => {
      // Validate content is provided for script types
      if (
        [EventType.PYTHON, EventType.BASH, EventType.NODEJS].includes(data.type)
      ) {
        return data.content && data.content.trim().length > 0;
      }
      return true;
    },
    {
      message: "Script content is required",
      path: ["content"],
    },
  )
  .refine(
    (data) => {
      // Validate HTTP request fields
      if (data.type === EventType.HTTP_REQUEST) {
        return data.httpMethod && data.httpUrl;
      }
      return true;
    },
    {
      message: "HTTP method and URL are required",
      path: ["httpUrl"],
    },
  )
  .refine(
    (data) => {
      // Validate Tool Action config
      if (data.type === EventType.TOOL_ACTION) {
        return (
          data.toolActionConfig &&
          data.toolActionConfig.toolId &&
          data.toolActionConfig.actionId
        );
      }
      return true;
    },
    {
      message: "Tool and action selection is required",
      path: ["toolActionConfig"],
    },
  )
  .refine(
    (data) => {
      // Validate server selection for remote execution
      if (data.runLocation === RunLocation.REMOTE) {
        return data.selectedServerIds.length > 0;
      }
      return true;
    },
    {
      message: "Please select at least one server for remote execution",
      path: ["selectedServerIds"],
    },
  );

type EventFormData = z.infer<typeof eventFormSchema>;

// Layout types for different contexts
type EventFormLayout = 'page' | 'modal' | 'embedded';

interface EventFormProps {
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
  layout = 'page',
  onCancel,
  showHeader = true,
  showFooter = true,
}: EventFormProps) {
  const { toast } = useToast();
  const t = useTranslations("Events");

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
    resolver: zodResolver(eventFormSchema) as any,
    defaultValues: {
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      shared: initialData?.shared ?? false,
      type: initialData?.type ?? EventType.PYTHON,
      content:
        initialData?.content ?? getDefaultScriptContent(EventType.PYTHON),
      status: initialData?.status ?? EventStatus.DRAFT,
      triggerType: initialData?.triggerType ?? EventTriggerType.MANUAL,
      scheduleNumber: initialData?.scheduleNumber ?? 5,
      scheduleUnit: initialData?.scheduleUnit ?? TimeUnit.MINUTES,
      startTime: initialData?.startTime
        ? new Date(initialData.startTime).toISOString().slice(0, 16)
        : null,
      useCronScheduling: !!initialData?.customSchedule,
      customSchedule: initialData?.customSchedule ?? "",
      timeoutValue: initialData?.timeoutValue ?? 30,
      timeoutUnit: initialData?.timeoutUnit ?? TimeUnit.SECONDS,
      runLocation: initialData?.runLocation ?? RunLocation.LOCAL,
      selectedServerIds: [],
      retries: initialData?.retries ?? 0,
      maxExecutions: initialData?.maxExecutions ?? 0,
      resetCounterOnActive: initialData?.resetCounterOnActive ?? false,
      envVars: [],
      tags: [],
      toolActionConfig: null,
      conditionalActions: [],
    },
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
  const runLocation = watch("runLocation");
  const useCronScheduling = watch("useCronScheduling");

  // Derived state
  const isScriptType = [
    EventType.PYTHON,
    EventType.BASH,
    EventType.NODEJS,
  ].includes(type);
  const isHttpRequest = type === EventType.HTTP_REQUEST;
  const isToolAction = type === EventType.TOOL_ACTION;
  const isRemote = runLocation === RunLocation.REMOTE;
  const isScheduled = triggerType === EventTriggerType.SCHEDULE;

  // Fetch available servers
  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100, offset: 0 },
    QUERY_OPTIONS.dynamic,
  );
  const servers = serversData?.servers ?? [];

  // Fetch available tools
  const { data: toolsData } = trpc.tools.getAll.useQuery(
    {},
    QUERY_OPTIONS.dynamic,
  );
  const availableTools = (toolsData?.tools ?? []) as unknown as Tool[];

  // Fetch available events
  const { data: eventsData } = trpc.events.getAll.useQuery(
    { limit: 1000, offset: 0 },
    QUERY_OPTIONS.dynamic,
  );
  const availableEvents = eventsData?.events ?? [];

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
    if (editorSettingsData) {
      setEditorSettings(editorSettingsData);
    }
  }, [editorSettingsData]);

  // Form submission handler will be defined below
  const onSubmitRef = useRef<((data: EventFormData) => Promise<void>) | null>(null);

  // Keyboard shortcut support (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (onSubmitRef.current) {
          form.handleSubmit(onSubmitRef.current)();
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [form]);

  // Initialize form data from initialData
  useEffect(() => {
    if (initialData) {
      // Parse and set tool action config
      if (
        initialData.toolActionConfig &&
        typeof initialData.toolActionConfig === "string"
      ) {
        try {
          const config = JSON.parse(
            initialData.toolActionConfig,
          ) as ToolActionConfig;
          setValue("toolActionConfig", config);
        } catch (e) {
          console.error("Failed to parse tool action config:", e);
        }
      }

      // Parse and set tags
      if (initialData.tags) {
        if (typeof initialData.tags === "string") {
          try {
            const tags = JSON.parse(initialData.tags) as string[];
            setValue("tags", tags);
          } catch {
            setValue("tags", []);
          }
        } else if (Array.isArray(initialData.tags)) {
          setValue("tags", initialData.tags);
        }
      }

      // Parse and set env vars
      if (initialData.environmentVariables) {
        if (typeof initialData.environmentVariables === "string") {
          try {
            const envVars = JSON.parse(initialData.environmentVariables) as Array<{
              key: string;
              value: string;
            }>;
            setValue("envVars", envVars);
          } catch {
            setValue("envVars", []);
          }
        } else if (Array.isArray(initialData.environmentVariables)) {
          setValue("envVars", initialData.environmentVariables);
        }
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
        const serverIds = initialData.servers
          .map((server) => server.id)
          .filter((id): id is number => typeof id === "number");
        setValue("selectedServerIds", serverIds);
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

  // Toggle password visibility
  const togglePasswordVisibility = (index: number) => {
    setPasswordVisibility((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Form submission
  const onSubmit = useCallback(async (data: EventFormData) => {
    try {
      // Prepare form data for submission
      const formData = {
        ...data,
        content: isScriptType ? data.content : "",
        startTime: data.startTime
          ? new Date(data.startTime).toISOString()
          : null,
        customSchedule: data.useCronScheduling ? data.customSchedule : "",
        serverId: null, // Deprecated, using selectedServerIds
        toolActionConfig:
          isToolAction && data.toolActionConfig
            ? JSON.stringify(data.toolActionConfig)
            : undefined,
        envVars: JSON.stringify(data.envVars),
        tags: JSON.stringify(data.tags),
        conditionalEvents: JSON.stringify(
          data.conditionalActions.map((action) => ({
            type: action.type,
            action: action.action,
            details: {
              emailAddresses: action.emailAddresses ?? "",
              emailSubject: action.emailSubject ?? "",
              targetEventId: action.targetEventId ?? null,
              toolId: action.toolId ?? null,
              message: action.message ?? "",
            },
          })),
        ),
      };

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
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? "update" : "create"} event. Please try again.`,
        variant: "destructive",
      });
    }
  }, [isEditing, eventId, createEventMutation, updateEventMutation, toast, onSuccess, type, isScriptType, isHttpRequest, isToolAction]);

  // Update ref after onSubmit is defined
  onSubmitRef.current = onSubmit;

  // Layout-specific styles
  const formClassName = layout === 'modal' 
    ? "space-y-4" 
    : layout === 'embedded' 
    ? "space-y-4" 
    : "space-y-6";
    
  const contentClassName = layout === 'modal'
    ? "max-h-[60vh] overflow-y-auto px-1"
    : layout === 'embedded'
    ? ""
    : "";

  const formContent = (
    <>
      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("basicInformation")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="name">{t("Fields.Name")}</Label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="name"
                  placeholder={t("Placeholders.EventName")}
                  aria-invalid={!!errors.name}
                />
              )}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("Fields.Description")}</Label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="description"
                  placeholder={t("Fields.DescriptionPlaceholder")}
                />
              )}
            />
          </div>

          {/* Grid layout for other fields */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Tags Field */}
            <div className="space-y-2">
              <Label htmlFor="tags">{t("Fields.Tags")}</Label>
              <Controller
                name="tags"
                control={control}
                render={({ field }) => (
                  <TagsInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={t("Fields.TagsPlaceholder")}
                    maxTags={10}
                  />
                )}
              />
            </div>

            {/* Status Field */}
            <div className="space-y-2">
              <Label htmlFor="status">{t("Status.Label")}</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status">
                      <SelectValue placeholder={t("Status.Placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EventStatus.ACTIVE}>
                        {t("Status.Active")}
                      </SelectItem>
                      <SelectItem value={EventStatus.PAUSED}>
                        {t("Status.Paused")}
                      </SelectItem>
                      <SelectItem value={EventStatus.DRAFT}>
                        {t("Status.Draft")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Event Type Field */}
            <div className="space-y-2">
              <Label htmlFor="type">{t("Fields.Type")}</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder={t("Placeholders.SelectType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EventType.PYTHON}>
                        {t("Languages.Python")}
                      </SelectItem>
                      <SelectItem value={EventType.BASH}>
                        {t("Languages.Bash")}
                      </SelectItem>
                      <SelectItem value={EventType.NODEJS}>
                        {t("Languages.Node")}
                      </SelectItem>
                      <SelectItem value={EventType.HTTP_REQUEST}>
                        {t("Fields.TypeHTTPRequest")}
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
              {t("Fields.Shared")}
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
                <CardTitle>{t("Fields.Content")}</CardTitle>
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
                <p className="mt-2 text-sm text-red-500">
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
              <Label htmlFor="httpUrl">{t("httpUrl")}</Label>
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
                <p className="text-sm text-red-500">{errors.httpUrl.message}</p>
              )}
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <Label>{t("httpHeaders")}</Label>
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
                            placeholder={t("headerName")}
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
                            placeholder={t("headerValue")}
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
                        {t("addHeader")}
                      </Button>
                    </div>
                  );
                }}
              />
            </div>

            {/* Body */}
            {["POST", "PUT", "PATCH"].includes(watch("httpMethod") ?? "") && (
              <div className="space-y-2">
                <Label htmlFor="httpBody">{t("httpBody")}</Label>
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
                  {t("httpBodyDescription")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Environment Variables Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("Fields.EnvironmentVariables")}</CardTitle>
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
                          {t("Fields.Key")}
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
                          placeholder={t("Fields.KeyPlaceholder")}
                        />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor={`envValue-${index}`}>
                          {t("Fields.Value")}
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
                            placeholder={t("Fields.ValuePlaceholder")}
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
                    {t("Fields.AddVariable")}
                  </Button>
                </>
              );
            }}
          />

          <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>🔒 {t("Fields.Security")}:</strong>{" "}
              {t("Fields.SecurityNote")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Section - Only show for scheduled events */}
      {isScheduled && (
        <Card>
          <CardHeader>
            <CardTitle>{t("ScheduleSettings")}</CardTitle>
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
                    {t("Fields.ScheduleInterval")}
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
                    {t("Fields.IntervalUnit")}
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
                          <SelectValue placeholder={t("Fields.IntervalUnit")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TimeUnit.SECONDS}>
                            {t("Seconds")}
                          </SelectItem>
                          <SelectItem value={TimeUnit.MINUTES}>
                            {t("Minutes")}
                          </SelectItem>
                          <SelectItem value={TimeUnit.HOURS}>
                            {t("Hours")}
                          </SelectItem>
                          <SelectItem value={TimeUnit.DAYS}>
                            {t("DaysPlural")}
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Execution Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t("ExecutionSettings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Run Location */}
          <div className="space-y-2">
            <Label htmlFor="runLocation">
              {t("Fields.RunLocations.Label")}
            </Label>
            <Controller
              name="runLocation"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="runLocation">
                    <SelectValue
                      placeholder={t("Placeholders.SelectLocation")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RunLocation.LOCAL}>
                      {t("Fields.RunLocations.Local")}
                    </SelectItem>
                    <SelectItem value={RunLocation.REMOTE}>
                      {t("Fields.RunLocations.Remote")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Server Selection */}
          {isRemote && (
            <div className="space-y-4">
              <Label>{t("Fields.Servers") || "Servers"}</Label>
              <Controller
                name="selectedServerIds"
                control={control}
                render={({ field }) => (
                  <div className="border-border max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                    {servers.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        {t("Fields.NoServersAvailable") ||
                          "No servers available. Please add a server first."}
                      </p>
                    ) : (
                      servers.map((server) => (
                        <div
                          key={server.id}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={`server-${server.id}`}
                            checked={field.value.includes(server.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.onChange([...field.value, server.id]);
                              } else {
                                field.onChange(
                                  field.value.filter((id) => id !== server.id),
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
                      ))
                    )}
                  </div>
                )}
              />
              {errors.selectedServerIds && (
                <p className="text-sm text-red-500">
                  {errors.selectedServerIds.message}
                </p>
              )}
            </div>
          )}

          {/* Timeout Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="timeoutValue">{t("Fields.Timeout")}</Label>
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
              <Label htmlFor="timeoutUnit">{t("Fields.TimeoutUnit")}</Label>
              <Controller
                name="timeoutUnit"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="timeoutUnit">
                      <SelectValue placeholder={t("Fields.TimeoutUnit")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TimeUnit.SECONDS}>
                        {t("Seconds")}
                      </SelectItem>
                      <SelectItem value={TimeUnit.MINUTES}>
                        {t("Minutes")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* Retries */}
          <div className="space-y-2">
            <Label htmlFor="retries">{t("Fields.Retries")}</Label>
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
            <Label htmlFor="maxExecutions">{t("Fields.MaxExecutions")}</Label>
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
              {t("Fields.MaxExecutionsHelp")}
            </p>
          </div>

          {/* Reset Counter on Active */}
          <div className="flex items-center justify-between space-y-1">
            <div>
              <Label htmlFor="resetCounterOnActive" className="font-medium">
                {t("Fields.ResetCounterOnActive")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("Fields.ResetCounterHelp")}
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

      {/* Conditional Actions Section */}
      <ConditionalActionsSection
        eventData={initialData as EventData}
        availableEvents={availableEvents}
        eventId={eventId}
        onConditionalActionsChange={(actions) => {
          setValue("conditionalActions", actions);
        }}
      />

    </>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={formClassName}>
      {contentClassName ? (
        <div className={contentClassName}>{formContent}</div>
      ) : (
        formContent
      )}
      
      {/* Form Actions */}
      {showFooter && (
        <div className={`flex ${onCancel ? 'justify-between' : 'justify-end'} space-x-4 ${layout === 'modal' ? 'sticky bottom-0 bg-background pt-4 border-t' : ''}`}>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("Cancel")}
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isEditing
                ? t("Updating")
                : t("Creating")
              : isEditing
                ? t("UpdateEvent")
                : t("CreateEvent")}
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
