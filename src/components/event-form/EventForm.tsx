"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  getDefaultScriptContent,
  getDefaultHttpRequest,
} from "@/lib/scriptTemplates";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { TagsInput } from "@/components/ui/tags-input";
import AIScriptAssistant from "@/components/dashboard/AIScriptAssistant";
import ConditionalActionsSection from "./ConditionalActionsSection";
import EditorSettingsModal, {
  type EditorSettings,
} from "./EditorSettingsModal";
import { Eye, EyeOff, Trash2, Settings } from "lucide-react";

import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
} from "@/shared/schema";

interface EventFormProps {
  initialScript?: any;
  initialData?: any;
  isEditing?: boolean;
  eventId?: number;
  onSuccess?: (eventId?: number) => void;
}

export default function EventForm({
  initialScript,
  initialData,
  isEditing = false,
  eventId,
  onSuccess,
}: EventFormProps) {
  // Use initialData if provided, otherwise use initialScript
  const eventData = initialData || initialScript;
  const { toast } = useToast();
  const t = useTranslations("Events");

  // Track form state
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Form fields state
  const [name, setName] = useState(eventData?.name || "");
  const [description, setDescription] = useState(eventData?.description || "");
  const [shared, setShared] = useState(eventData?.shared === true);
  const [type, setType] = useState(eventData?.type || EventType.PYTHON);
  const [content, setContent] = useState(
    eventData?.content || getDefaultScriptContent(EventType.PYTHON),
  );
  const [status, setStatus] = useState(eventData?.status || EventStatus.DRAFT);
  const [triggerType, setTriggerType] = useState(
    eventData?.triggerType || EventTriggerType.MANUAL,
  );
  const [scheduleNumber, setScheduleNumber] = useState(
    eventData?.scheduleNumber || 5,
  );
  const [scheduleDisplayValue, setScheduleDisplayValue] = useState(
    (eventData?.scheduleNumber || 5).toString(),
  );
  const [scheduleUnit, setScheduleUnit] = useState(
    eventData?.scheduleUnit || TimeUnit.MINUTES,
  );
  const [startTime, setStartTime] = useState(
    eventData?.startTime
      ? new Date(eventData.startTime).toISOString().slice(0, 16)
      : "",
  );
  const [useCronScheduling, setUseCronScheduling] = useState(
    eventData?.customSchedule ? true : false,
  );
  const [customSchedule, setCustomSchedule] = useState(
    eventData?.customSchedule || "",
  );
  const [timeoutValue, setTimeoutValue] = useState(
    eventData?.timeoutValue || 30,
  );
  const [timeoutDisplayValue, setTimeoutDisplayValue] = useState(
    (eventData?.timeoutValue || 30).toString(),
  );
  const [timeoutUnit, setTimeoutUnit] = useState(
    eventData?.timeoutUnit || TimeUnit.SECONDS,
  );
  const [runLocation, setRunLocation] = useState(
    eventData?.runLocation || RunLocation.LOCAL,
  );
  const [serverId] = useState(eventData?.serverId || null);
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>(
    eventData?.servers?.map((server: any) => server.id) || [],
  );
  const [retries, setRetries] = useState(eventData?.retries || 0);
  const [retriesDisplayValue, setRetriesDisplayValue] = useState(
    (eventData?.retries || 0).toString(),
  );
  const [maxExecutions, setMaxExecutions] = useState(
    eventData?.maxExecutions || 0,
  );
  const [maxExecutionsDisplayValue, setMaxExecutionsDisplayValue] = useState(
    (eventData?.maxExecutions || 0).toString(),
  );
  const [resetCounterOnActive, setResetCounterOnActive] = useState(
    eventData?.resetCounterOnActive === true,
  );
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    eventData?.envVars || [],
  );
  const [tags, setTags] = useState<string[]>(eventData?.tags || []);
  const [conditionalActions, setConditionalActions] = useState<any[]>([]);
  const [passwordVisibility, setPasswordVisibility] = useState<
    Record<number, boolean>
  >({});

  // Fetch available servers using tRPC
  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100, offset: 0 },
    { staleTime: 60000 },
  );
  const servers = serversData?.servers || [];

  // Fetch available events for conditional events using tRPC
  const { data: eventsData } = trpc.events.getAll.useQuery(
    { limit: 1000, offset: 0 },
    { staleTime: 30000 },
  );
  const availableEvents = eventsData?.events || [];

  // tRPC mutations
  const createEventMutation = trpc.events.create.useMutation();
  const updateEventMutation = trpc.events.update.useMutation();

  // Derived state
  const isHttpRequest = type === EventType.HTTP_REQUEST;
  const isRemote = runLocation === RunLocation.REMOTE;

  // HTTP request data state (only used for HTTP_REQUEST type)
  const [httpRequest, setHttpRequest] = useState(
    eventData?.httpRequest
      ? JSON.parse(eventData.httpRequest)
      : getDefaultHttpRequest(),
  );

  // Toggle password visibility for environment variables
  const togglePasswordVisibility = (index: number) => {
    setPasswordVisibility((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Update script content when type changes
  useEffect(() => {
    if (!eventData?.content || eventData?.type !== type) {
      setContent(getDefaultScriptContent(type));
    }
  }, [type, eventData?.type, eventData?.content]);

  // Form submission logic
  const submitForm = useCallback(async () => {
    if (isSubmitting) return; // Prevent double submission

    setIsSubmitting(true);

    try {
      // Build conditional events array from the managed state
      const conditionalActionsForSubmission = conditionalActions.map(
        (action) => ({
          type: action.type,
          action: action.action,
          details: {
            emailAddresses: action.emailAddresses || "",
            emailSubject: action.emailSubject || "",
            targetEventId: action.targetEventId || null,
            toolId: action.toolId || null,
            message: action.message || "",
          },
        }),
      );

      // Prepare form data
      const formData = {
        name,
        description,
        shared,
        type,
        content: isHttpRequest ? "" : content, // Clear content for HTTP requests
        status,
        triggerType,
        scheduleNumber:
          triggerType === EventTriggerType.SCHEDULE
            ? Number(scheduleNumber)
            : 1,
        scheduleUnit:
          triggerType === EventTriggerType.SCHEDULE
            ? scheduleUnit
            : TimeUnit.MINUTES,
        customSchedule:
          triggerType === EventTriggerType.SCHEDULE && useCronScheduling
            ? customSchedule
            : "",
        startTime:
          triggerType === EventTriggerType.SCHEDULE && startTime
            ? new Date(startTime).toISOString()
            : null,
        timeoutValue: Number(timeoutValue),
        timeoutUnit,
        runLocation,
        serverId: isRemote ? Number(serverId) || null : null, // Keep for backward compatibility
        selectedServerIds: isRemote ? selectedServerIds : [], // New multi-server support
        retries: Number(retries),
        maxExecutions: Number(maxExecutions),
        resetCounterOnActive: resetCounterOnActive === true,
        // Include HTTP request data if needed
        ...(isHttpRequest && {
          httpRequest: JSON.stringify(httpRequest),
        }),
        // Include environment variables
        envVars,
        // Include tags
        tags,
        // Include conditional events
        conditionalActions: conditionalActionsForSubmission,
      };

      const result =
        isEditing && (eventData?.id || eventId)
          ? await updateEventMutation.mutateAsync({
              id: eventData?.id || eventId!,
              ...formData,
            })
          : await createEventMutation.mutateAsync(formData);

      // Show success message
      toast({
        title: isEditing ? "Event Updated" : "Event Created",
        description: `Successfully ${isEditing ? "updated" : "created"} "${name}"`,
        variant: "success",
      });

      // Handle success callback or redirect
      if (onSuccess) {
        onSuccess(result.id || eventData?.id || eventId);
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? "update" : "create"} event. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    conditionalActions,
    name,
    description,
    shared,
    type,
    content,
    isHttpRequest,
    status,
    triggerType,
    scheduleNumber,
    scheduleUnit,
    useCronScheduling,
    customSchedule,
    startTime,
    timeoutValue,
    timeoutUnit,
    runLocation,
    serverId,
    selectedServerIds,
    isRemote,
    retries,
    maxExecutions,
    resetCounterOnActive,
    httpRequest,
    envVars,
    tags,
    isEditing,
    eventData?.id,
    eventId,
    toast,
    onSuccess,
  ]);

  // Load user editor settings using tRPC
  const { data: editorSettingsData } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    { staleTime: 300000 }, // 5 minutes
  );

  // Update editor settings when data is available
  useEffect(() => {
    if (editorSettingsData) {
      setEditorSettings(editorSettingsData);
    }
  }, [editorSettingsData]);

  // Keyboard shortcut for saving (Ctrl/Cmd + S)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+S (Windows/Linux) or Cmd+S (macOS)
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault(); // Prevent browser's default save action
        submitForm(); // Trigger form submission
      }
    };

    // Add event listener to document
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup function to remove event listener
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [submitForm]);

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await submitForm();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("basicInformation")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="name">{t("Fields.Name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Placeholders.EventName")}
              required
            />
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("Fields.Description")}</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Fields.DescriptionPlaceholder")}
            />
          </div>

          {/* Grid layout for Tags, Status, Event Type, and Trigger Method on large screens */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Tags Field */}
            <div className="space-y-2">
              <Label htmlFor="tags">{t("Fields.Tags")}</Label>
              <TagsInput
                value={tags}
                onChange={setTags}
                placeholder={t("Fields.TagsPlaceholder")}
                maxTags={10}
              />
            </div>

            {/* Status Field */}
            <div className="space-y-2">
              <Label htmlFor="status">{t("Status.Label")}</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value)}
              >
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
            </div>

            {/* Script Type Field */}
            <div className="space-y-2">
              <Label htmlFor="type">{t("Fields.Type")}</Label>
              <Select value={type} onValueChange={(value) => setType(value)}>
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
                </SelectContent>
              </Select>
            </div>

            {/* Trigger Type Field */}
            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Method</Label>
              <Select
                value={triggerType}
                onValueChange={(value) => setTriggerType(value)}
              >
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
            </div>
          </div>

          {/* Shared Field - moved below description as requested */}
          <div className="flex items-center space-x-2">
            <Switch id="shared" checked={shared} onCheckedChange={setShared} />
            <Label htmlFor="shared" className="cursor-pointer">
              {t("Fields.Shared")}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Script Content Section */}
      {!isHttpRequest && (
        <>
          {/* AI Script Assistant */}
          <AIScriptAssistant
            onApplyCode={(code) => setContent(code)}
            scriptType={type}
            currentCode={content}
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
                    onClick={() => setContent("")}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MonacoEditor
                value={content}
                onChange={(value) => setContent(value)}
                language={
                  type === EventType.PYTHON
                    ? "python"
                    : type === EventType.BASH
                      ? "shell"
                      : "javascript"
                }
                height="400px"
                editorSettings={editorSettings}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* HTTP Request Section */}
      {isHttpRequest && (
        <Card>
          <CardHeader>
            <CardTitle>HTTP Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* HTTP Method */}
            <div className="space-y-2">
              <Label htmlFor="httpMethod">HTTP Method</Label>
              <Select
                value={httpRequest.method}
                onValueChange={(value) =>
                  setHttpRequest({ ...httpRequest, method: value })
                }
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
            </div>

            {/* URL */}
            <div className="space-y-2">
              <Label htmlFor="httpUrl">{t("httpUrl")}</Label>
              <Input
                id="httpUrl"
                value={httpRequest.url}
                onChange={(e) =>
                  setHttpRequest({ ...httpRequest, url: e.target.value })
                }
                placeholder="https://api.example.com/data"
              />
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <Label>{t("httpHeaders")}</Label>
              <div className="space-y-2">
                {httpRequest.headers.map((header: any, index: number) => (
                  <div key={index} className="flex space-x-2">
                    <Input
                      value={header.key}
                      onChange={(e) => {
                        const updatedHeaders = [...httpRequest.headers];
                        updatedHeaders[index] = {
                          ...updatedHeaders[index],
                          key: e.target.value,
                        };
                        setHttpRequest({
                          ...httpRequest,
                          headers: updatedHeaders,
                        });
                      }}
                      placeholder={t("headerName")}
                      className="flex-1"
                    />
                    <Input
                      value={header.value}
                      onChange={(e) => {
                        const updatedHeaders = [...httpRequest.headers];
                        updatedHeaders[index] = {
                          ...updatedHeaders[index],
                          value: e.target.value,
                        };
                        setHttpRequest({
                          ...httpRequest,
                          headers: updatedHeaders,
                        });
                      }}
                      placeholder={t("headerValue")}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => {
                        const updatedHeaders = httpRequest.headers.filter(
                          (_: any, i: number) => i !== index,
                        );
                        setHttpRequest({
                          ...httpRequest,
                          headers: updatedHeaders,
                        });
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
                    setHttpRequest({
                      ...httpRequest,
                      headers: [...httpRequest.headers, { key: "", value: "" }],
                    });
                  }}
                >
                  {t("addHeader")}
                </Button>
              </div>
            </div>

            {/* Body (only for certain methods) */}
            {(httpRequest.method === "POST" ||
              httpRequest.method === "PUT" ||
              httpRequest.method === "PATCH") && (
              <div className="space-y-2">
                <Label htmlFor="httpBody">{t("httpBody")}</Label>
                <MonacoEditor
                  value={httpRequest.body}
                  onChange={(value) =>
                    setHttpRequest({ ...httpRequest, body: value })
                  }
                  language="json"
                  height="250px"
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
          {envVars.map((envVar, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`envKey-${index}`}>{t("Fields.Key")}</Label>
                <Input
                  id={`envKey-${index}`}
                  value={envVar.key}
                  onChange={(e) => {
                    const updatedEnvVars = [...envVars];
                    if (updatedEnvVars[index]) {
                      updatedEnvVars[index].key = e.target.value;
                      setEnvVars(updatedEnvVars);
                    }
                  }}
                  placeholder={t("Fields.KeyPlaceholder")}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`envValue-${index}`}>{t("Fields.Value")}</Label>
                <div className="relative">
                  <Input
                    id={`envValue-${index}`}
                    type={passwordVisibility[index] ? "text" : "password"}
                    value={envVar.value}
                    onChange={(e) => {
                      const updatedEnvVars = [...envVars];
                      if (updatedEnvVars[index]) {
                        updatedEnvVars[index].value = e.target.value;
                        setEnvVars(updatedEnvVars);
                      }
                    }}
                    placeholder={t("Fields.ValuePlaceholder")}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground absolute top-0 right-0 h-10 w-10"
                    onClick={() => togglePasswordVisibility(index)}
                  >
                    {passwordVisibility[index] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    <span className="sr-only">
                      {passwordVisibility[index]
                        ? "Hide password"
                        : "Show password"}
                    </span>
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => {
                  const updatedEnvVars = envVars.filter((_, i) => i !== index);
                  setEnvVars(updatedEnvVars);
                  // Clean up password visibility state for removed items
                  const newPasswordVisibility = { ...passwordVisibility };
                  delete newPasswordVisibility[index];
                  // Shift indices down for remaining items
                  const shiftedVisibility: Record<number, boolean> = {};
                  Object.entries(newPasswordVisibility).forEach(
                    ([key, value]) => {
                      const keyIndex = parseInt(key);
                      if (keyIndex > index) {
                        shiftedVisibility[keyIndex - 1] = value;
                      } else if (keyIndex < index) {
                        shiftedVisibility[keyIndex] = value;
                      }
                    },
                  );
                  setPasswordVisibility(shiftedVisibility);
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
              setEnvVars([...envVars, { key: "", value: "" }]);
            }}
          >
            {t("Fields.AddVariable")}
          </Button>

          <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>🔒 {t("Fields.Security")}:</strong>{" "}
              {t("Fields.SecurityNote")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Section - Only show for scheduled events */}
      {triggerType === EventTriggerType.SCHEDULE && (
        <Card>
          <CardHeader>
            <CardTitle>{t("ScheduleSettings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Start Time (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time (Optional)</Label>
              <Input
                id="startTime"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
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
                  Enable advanced cron syntax for precise scheduling. When
                  enabled, only the cron expression will be used.
                </p>
              </div>
              <Switch
                id="useCronScheduling"
                checked={useCronScheduling}
                onCheckedChange={(checked) => {
                  setUseCronScheduling(checked);
                  if (checked) {
                    // Clear standard scheduling when switching to cron
                    setScheduleNumber(1);
                    setScheduleUnit(TimeUnit.MINUTES);
                  } else {
                    // Clear cron when switching to standard
                    setCustomSchedule("");
                  }
                }}
              />
            </div>

            {/* Standard Scheduling (when cron is disabled) */}
            {!useCronScheduling && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduleNumber">
                    {t("Fields.ScheduleInterval")}
                  </Label>
                  <Input
                    id="scheduleNumber"
                    type="number"
                    min={1}
                    value={scheduleDisplayValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      setScheduleDisplayValue(value);
                      if (value === "") {
                        setScheduleNumber(1);
                      } else {
                        const numValue = parseInt(value);
                        setScheduleNumber(isNaN(numValue) ? 1 : numValue);
                      }
                    }}
                    onBlur={() => {
                      if (scheduleDisplayValue === "" || scheduleNumber < 1) {
                        setScheduleDisplayValue("1");
                        setScheduleNumber(1);
                      }
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheduleUnit">
                    {t("Fields.IntervalUnit")}
                  </Label>
                  <Select
                    value={scheduleUnit}
                    onValueChange={(value) => setScheduleUnit(value)}
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
                </div>
              </div>
            )}

            {/* Cron Expression (when cron is enabled) */}
            {useCronScheduling && (
              <div className="space-y-2">
                <Label htmlFor="customSchedule">Cron Expression</Label>
                <Input
                  id="customSchedule"
                  value={customSchedule}
                  onChange={(e) => setCustomSchedule(e.target.value)}
                  placeholder="0 */5 * * * (every 5 minutes)"
                />
                <p className="text-muted-foreground text-sm">
                  Use standard cron syntax. Examples: "0 */5 * * *" (every 5
                  minutes), "0 0 * * *" (daily at midnight), "0 0 * * 1" (weekly
                  on Monday)
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
            <Select
              value={runLocation}
              onValueChange={(value) => setRunLocation(value)}
            >
              <SelectTrigger id="runLocation">
                <SelectValue placeholder={t("Placeholders.SelectLocation")} />
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
          </div>

          {/* Server Selection (only shown for remote scripts) */}
          {isRemote && (
            <div className="space-y-4">
              <Label>{t("Fields.Servers") || "Servers"}</Label>
              <div className="border-border max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                {servers.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {t("Fields.NoServersAvailable") ||
                      "No servers available. Please add a server first."}
                  </p>
                ) : (
                  servers.map((server: any) => (
                    <div
                      key={server.id}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`server-${server.id}`}
                        checked={selectedServerIds.includes(server.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedServerIds([
                              ...selectedServerIds,
                              server.id,
                            ]);
                          } else {
                            setSelectedServerIds(
                              selectedServerIds.filter(
                                (id) => id !== server.id,
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
                  ))
                )}
              </div>
              {selectedServerIds.length === 0 && isRemote && (
                <p className="text-sm text-red-500">
                  {t("Fields.SelectAtLeastOneServer") ||
                    "Please select at least one server for remote execution."}
                </p>
              )}
            </div>
          )}

          {/* Timeout Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="timeoutValue">{t("Fields.Timeout")}</Label>
              <Input
                id="timeoutValue"
                type="number"
                min={1}
                value={timeoutDisplayValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setTimeoutDisplayValue(value);
                  if (value === "") {
                    setTimeoutValue(30);
                  } else {
                    const numValue = parseInt(value);
                    setTimeoutValue(isNaN(numValue) ? 30 : numValue);
                  }
                }}
                onBlur={() => {
                  if (timeoutDisplayValue === "" || timeoutValue < 1) {
                    setTimeoutDisplayValue("30");
                    setTimeoutValue(30);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeoutUnit">{t("Fields.TimeoutUnit")}</Label>
              <Select
                value={timeoutUnit}
                onValueChange={(value) => setTimeoutUnit(value)}
              >
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
            </div>
          </div>

          {/* Retries */}
          <div className="space-y-2">
            <Label htmlFor="retries">{t("Fields.Retries")}</Label>
            <Input
              id="retries"
              type="number"
              min={0}
              max={10}
              value={retriesDisplayValue}
              onChange={(e) => {
                const value = e.target.value;
                setRetriesDisplayValue(value);
                if (value === "") {
                  setRetries(0);
                } else {
                  const numValue = parseInt(value);
                  setRetries(
                    isNaN(numValue) ? 0 : Math.max(0, Math.min(10, numValue)),
                  );
                }
              }}
              onBlur={() => {
                if (retriesDisplayValue === "") {
                  setRetriesDisplayValue("0");
                  setRetries(0);
                }
              }}
            />
          </div>

          {/* Max Executions */}
          <div className="space-y-2">
            <Label htmlFor="maxExecutions">{t("Fields.MaxExecutions")}</Label>
            <Input
              id="maxExecutions"
              type="number"
              min={0}
              value={maxExecutionsDisplayValue}
              onChange={(e) => {
                const value = e.target.value;
                setMaxExecutionsDisplayValue(value);
                if (value === "") {
                  setMaxExecutions(0);
                } else {
                  const numValue = parseInt(value);
                  setMaxExecutions(isNaN(numValue) ? 0 : Math.max(0, numValue));
                }
              }}
              onBlur={() => {
                if (maxExecutionsDisplayValue === "") {
                  setMaxExecutionsDisplayValue("0");
                  setMaxExecutions(0);
                }
              }}
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
            <Switch
              id="resetCounterOnActive"
              checked={resetCounterOnActive}
              onCheckedChange={setResetCounterOnActive}
            />
          </div>
        </CardContent>
      </Card>

      {/* Conditional Actions Section */}
      <ConditionalActionsSection
        eventData={eventData}
        availableEvents={availableEvents || []}
        {...(eventId !== undefined ? { eventId } : {})}
        onConditionalActionsChange={setConditionalActions}
      />

      {/* Form Actions */}
      <div className="flex justify-end space-x-4">
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
