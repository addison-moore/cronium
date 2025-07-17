"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MonacoEditor } from "@/components/ui/monaco-editor-lazy";
import {
  Trash2,
  Plus,
  Code,
  MessageSquare,
  Edit,
  Mail,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConditionalActionType, type ToolType } from "@/shared/schema";
import { ToolPluginRegistry } from "@/components/tools/plugins";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";
import { QUERY_OPTIONS } from "@/trpc/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface EditorSettings {
  fontSize: number;
  theme: string;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

interface ConditionalAction {
  id?: number | undefined;
  type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
  action: ConditionalActionType;
  emailAddresses?: string | undefined;
  emailSubject?: string | undefined;
  targetEventId?: number | null | undefined;
  toolId?: number | undefined;
  toolType?: string | undefined;
  message?: string | undefined;
}

export interface EventData {
  successEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailSubject?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  failEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailSubject?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  alwaysEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  conditionEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailSubject?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
}

interface AvailableEvent {
  id: number;
  name: string;
  description?: string | null;
  type?: string;
}

interface ConditionalActionsSectionProps {
  eventData?: EventData;
  availableEvents: AvailableEvent[];
  eventId?: number;
  onConditionalActionsChange: (events: ConditionalAction[]) => void;
}

export default function ConditionalActionsSection({
  eventData,
  availableEvents,
  eventId,
  onConditionalActionsChange,
}: ConditionalActionsSectionProps) {
  const { toast } = useToast();
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "";

  const [conditionalActions, setConditionalActions] = useState<
    ConditionalAction[]
  >([]);
  const [newEventType, setNewEventType] = useState<
    "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION"
  >("ON_SUCCESS");
  const [newEventAction, setNewEventAction] = useState<ConditionalActionType>(
    ConditionalActionType.SEND_MESSAGE,
  );
  const [newEmailAddresses, setNewEmailAddresses] = useState("");
  const [newEmailSubject, setNewEmailSubject] = useState("");
  const [newTargetEventId, setNewTargetEventId] = useState<number | null>(null);
  const [newToolId, setNewToolId] = useState<number | string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [selectedToolType, setSelectedToolType] = useState<string | null>(null);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [systemSmtpEnabled, setSystemSmtpEnabled] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    fontSize: 14,
    theme: "vs-dark",
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  });

  // Edit mode state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Flag to prevent initial callback trigger
  const [isInitialized, setIsInitialized] = useState(false);

  // tRPC queries with optimized settings to prevent unnecessary re-fetches
  const { data: toolsData, refetch: refetchTools } = trpc.tools.getAll.useQuery(
    {
      limit: 1000,
      offset: 0,
    },
    QUERY_OPTIONS.static,
  );

  // Get the conditional action ID for the selected tool type
  const conditionalActionId = useMemo(() => {
    if (!selectedToolType) return null;
    const action = ToolPluginRegistry.getConditionalActionForTool(
      selectedToolType.toLowerCase(),
    );
    return action?.id ?? null;
  }, [selectedToolType]);

  const { data: templatesData } =
    trpc.toolActionTemplates.getByToolAction.useQuery(
      {
        toolType: selectedToolType ?? "",
        actionId: conditionalActionId ?? "",
      },
      {
        enabled: !!selectedToolType && !!conditionalActionId,
        ...QUERY_OPTIONS.static,
      },
    );

  const { data: systemSettings } = trpc.admin.getSystemSettings.useQuery(
    undefined,
    QUERY_OPTIONS.static,
  );

  const { data: editorSettingsData } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    QUERY_OPTIONS.static,
  );

  const createToolMutation = trpc.tools.create.useMutation({
    onSuccess: (newTool) => {
      setNewToolId(newTool.id);
      setShowCredentialModal(false);
      void refetchTools();
      toast({
        title: "Success",
        description: "Tool credential created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create tool credential",
        variant: "destructive",
      });
    },
  });

  // Memoized computed values to prevent unnecessary re-calculations
  const allTools = useMemo(() => {
    // Get all tools that have conditional actions
    const conditionalActions = ToolPluginRegistry.getConditionalActions();
    const toolTypesWithConditionalActions = new Set(
      conditionalActions.map((ca) => ca.tool.id.toUpperCase()),
    );

    return (
      toolsData?.tools?.filter((tool) =>
        toolTypesWithConditionalActions.has(tool.type),
      ) ?? []
    );
  }, [toolsData?.tools]);

  const templates = useMemo(() => {
    return templatesData ?? [];
  }, [templatesData]);

  // Separate user and system templates
  const { userTemplates, systemTemplates } = useMemo(() => {
    const userTemplates = templates.filter(
      (template) => !template.isSystemTemplate,
    );
    const systemTemplates = templates.filter(
      (template) => template.isSystemTemplate,
    );
    return { userTemplates, systemTemplates };
  }, [templates]);

  const credentialsForSelectedTool = useMemo(() => {
    if (!selectedToolType || allTools.length === 0) {
      return [];
    }
    return allTools.filter(
      (tool) => tool.type === (selectedToolType as ToolType),
    );
  }, [selectedToolType, allTools]);

  // All available message types based on tools with conditional actions
  const availableToolTypes = useMemo(() => {
    const conditionalActions = ToolPluginRegistry.getConditionalActions();
    return [
      ...new Set(conditionalActions.map((ca) => ca.tool.id.toUpperCase())),
    ];
  }, []);

  // Stable callback for parent communication using useRef pattern
  const onConditionalActionsChangeRef = useRef(onConditionalActionsChange);
  onConditionalActionsChangeRef.current = onConditionalActionsChange;

  const notifyParentOfChanges = useCallback(
    (events: ConditionalAction[]) => {
      if (isInitialized) {
        onConditionalActionsChangeRef.current?.(events);
      }
    },
    [isInitialized],
  );

  // Handle credential creation with stable callback
  const handleCredentialSubmit = useCallback(
    async (data: { name: string; credentials: Record<string, unknown> }) => {
      try {
        await createToolMutation.mutateAsync({
          name: data.name,
          type: selectedToolType as ToolType,
          credentials: data.credentials,
        });
      } catch {
        // Error handled by mutation onError
      }
    },
    [createToolMutation, selectedToolType],
  );

  // Handle template selection with stable callback
  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      if (!templateId || templateId === "none") {
        setSelectedTemplate("");
        return;
      }

      // Find template in both user and system templates
      const allTemplates = [...userTemplates, ...systemTemplates];
      const template = allTemplates.find((t) => t.id.toString() === templateId);
      if (template?.parameters) {
        setSelectedTemplate(templateId);

        // Extract content based on the action's parameter structure
        const params = template.parameters as Record<string, unknown>;

        // Get the action to know which field contains the message
        const action = ToolPluginRegistry.getActionById(template.actionId);
        if (action) {
          // For Discord and Slack, use 'content' or 'text' field
          if (template.toolType === "DISCORD") {
            const content = params.content;
            setNewMessage(typeof content === "string" ? content : "");
          } else if (template.toolType === "SLACK") {
            const text = params.text;
            const content = params.content;
            const message =
              typeof text === "string"
                ? text
                : typeof content === "string"
                  ? content
                  : "";
            setNewMessage(message);
          } else if (template.toolType === "EMAIL") {
            const body = params.body;
            const subject = params.subject;
            const to = params.to;
            setNewMessage(typeof body === "string" ? body : "");
            setNewEmailSubject(typeof subject === "string" ? subject : "");
            setNewEmailAddresses(typeof to === "string" ? to : "");
          } else {
            // For other tools, try common field names
            const message = params.message;
            const content = params.content;
            const text = params.text;
            const body = params.body;
            const finalMessage =
              typeof message === "string"
                ? message
                : typeof content === "string"
                  ? content
                  : typeof text === "string"
                    ? text
                    : typeof body === "string"
                      ? body
                      : "";
            setNewMessage(finalMessage);
          }
        }
      }
    },
    [userTemplates, systemTemplates],
  );

  // Update system SMTP settings when data loads
  useEffect(() => {
    if (systemSettings) {
      const smtpEnabled = systemSettings.data.smtpEnabled === "true";
      setSystemSmtpEnabled(smtpEnabled);
    }
  }, [systemSettings]);

  // Update editor settings when data loads
  useEffect(() => {
    if (editorSettingsData?.data) {
      setEditorSettings({
        fontSize: editorSettingsData.data.fontSize ?? 14,
        theme: editorSettingsData.data.theme ?? "vs-dark",
        wordWrap: editorSettingsData.data.wordWrap !== false,
        minimap: editorSettingsData.data.minimap !== true,
        lineNumbers: editorSettingsData.data.lineNumbers !== false,
      });
    }
  }, [editorSettingsData]);

  // Reset template selection when message type changes
  useEffect(() => {
    setSelectedTemplate("");
  }, [selectedToolType]);

  // Load existing conditional actions ONCE when component mounts or eventData/eventId changes
  useEffect(() => {
    if (!eventData) {
      setConditionalActions([]);
      setIsInitialized(true);
      return;
    }

    const events: ConditionalAction[] = [];

    // Add success events
    if (eventData.successEvents) {
      eventData.successEvents.forEach((event) => {
        events.push({
          id: event.id,
          type: "ON_SUCCESS",
          action: event.type,
          emailAddresses: event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          message: event.message ?? "",
        });
      });
    }

    // Add failure events
    if (eventData.failEvents) {
      eventData.failEvents.forEach((event) => {
        events.push({
          id: event.id,
          type: "ON_FAILURE",
          action: event.type,
          emailAddresses: event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          message: event.message ?? "",
        });
      });
    }

    // Add always events
    if (eventData.alwaysEvents) {
      eventData.alwaysEvents.forEach((event) => {
        events.push({
          id: event.id,
          type: "ALWAYS",
          action: event.type,
          emailAddresses: event.value ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          message: event.message ?? "",
        });
      });
    }

    // Add condition events
    if (eventData.conditionEvents) {
      eventData.conditionEvents.forEach((event) => {
        events.push({
          id: event.id,
          type: "ON_CONDITION",
          action: event.type,
          emailAddresses: event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          message: event.message ?? "",
        });
      });
    }

    setConditionalActions(events);
    setIsInitialized(true);
    // Don't notify parent on initial load to prevent loops
  }, [eventData, eventId]);

  // Stable action handlers using useCallback
  const addConditionalAction = useCallback(() => {
    if (newEventAction === ConditionalActionType.SCRIPT && !newTargetEventId) {
      toast({
        title: "Error",
        description: "Target event is required for script actions",
        variant: "destructive",
      });
      return;
    }

    if (
      newEventAction === ConditionalActionType.SEND_MESSAGE &&
      (!newToolId || !newMessage.trim())
    ) {
      toast({
        title: "Error",
        description: "Tool and message are required for message actions",
        variant: "destructive",
      });
      return;
    }

    const newAction: ConditionalAction = {
      type: newEventType,
      action: newEventAction,
      emailAddresses: newEmailAddresses,
      emailSubject: newEmailSubject,
      targetEventId: newTargetEventId ?? null,
      toolId:
        typeof newToolId === "string"
          ? parseInt(newToolId)
          : (newToolId ?? undefined),
      toolType: selectedToolType ?? undefined,
      message: newMessage,
    };

    let updatedActions;
    if (isEditing && editingIndex !== null) {
      updatedActions = [...conditionalActions];
      updatedActions[editingIndex] = newAction;
      setIsEditing(false);
      setEditingIndex(null);
    } else {
      updatedActions = [...conditionalActions, newAction];
    }

    setConditionalActions(updatedActions);
    notifyParentOfChanges(updatedActions);

    // Reset form
    setNewEventType("ON_SUCCESS");
    setNewEventAction(ConditionalActionType.SEND_MESSAGE);
    setNewEmailAddresses("");
    setNewEmailSubject("");
    setNewTargetEventId(null);
    setNewToolId(null);
    setNewMessage("");
    setSelectedToolType(null);
    setSelectedTemplate("");
  }, [
    newEventAction,
    newTargetEventId,
    newToolId,
    newMessage,
    newEventType,
    newEmailAddresses,
    newEmailSubject,
    selectedToolType,
    isEditing,
    editingIndex,
    conditionalActions,
    notifyParentOfChanges,
    toast,
  ]);

  const removeConditionalAction = useCallback(
    (index: number) => {
      const updatedActions = conditionalActions.filter((_, i) => i !== index);
      setConditionalActions(updatedActions);
      notifyParentOfChanges(updatedActions);
    },
    [conditionalActions, notifyParentOfChanges],
  );

  const editConditionalAction = useCallback(
    (index: number) => {
      const action = conditionalActions[index];
      if (!action) return;

      setNewEventType(action.type);
      setNewEventAction(action.action);
      setNewEmailAddresses(action.emailAddresses ?? "");
      setNewEmailSubject(action.emailSubject ?? "");
      setNewTargetEventId(action.targetEventId ?? null);
      setNewToolId(action.toolId ?? null);
      setNewMessage(action.message ?? "");
      setSelectedToolType(action.toolType ?? null);
      setIsEditing(true);
      setEditingIndex(index);
    },
    [conditionalActions],
  );

  // Helper functions with stable references
  const getActionIcon = useCallback((action: ConditionalActionType) => {
    if (action === ConditionalActionType.SEND_MESSAGE) {
      return <MessageSquare className="h-4 w-4" />;
    } else {
      return <Code className="h-4 w-4" />;
    }
  }, []);

  const getActionLabel = useCallback((action: ConditionalActionType) => {
    switch (action) {
      case ConditionalActionType.SCRIPT:
        return "Run Another Event";
      case ConditionalActionType.SEND_MESSAGE:
        return "Send Message";
      default:
        return "Unknown";
    }
  }, []);

  const getTypeColor = useCallback((type: string) => {
    if (type === "ON_SUCCESS") {
      return "bg-green-100 text-green-800";
    } else if (type === "ON_FAILURE") {
      return "bg-red-100 text-red-800";
    } else if (type === "ON_CONDITION") {
      return "bg-purple-100 text-purple-800";
    } else {
      return "bg-blue-100 text-blue-800";
    }
  }, []);

  const getToolName = useCallback(
    (toolId: number) => {
      const tool = allTools.find((t) => t.id === toolId);
      return tool ? tool.name : `Tool ${toolId}`;
    },
    [allTools],
  );

  const getToolTypeIcon = useCallback((toolType: string) => {
    try {
      const plugin = ToolPluginRegistry.get(toolType.toLowerCase());
      if (plugin?.icon) {
        const IconComponent = plugin.icon;
        return <IconComponent className="h-4 w-4" />;
      }
    } catch {
      console.warn(`Plugin not found for message type: ${toolType}`);
    }

    // Fallback icons if plugin not found
    switch (toolType) {
      case "EMAIL":
        return <Mail className="h-4 w-4" />;
      case "SLACK":
        return <MessageSquare className="h-4 w-4" />;
      case "DISCORD":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  }, []);

  const getToolTypeName = useCallback((toolType: string) => {
    switch (toolType) {
      case "EMAIL":
        return "Email";
      case "SLACK":
        return "Slack";
      case "DISCORD":
        return "Discord";
      default:
        return toolType;
    }
  }, []);

  const getTargetEventName = useCallback(
    (targetEventId: number) => {
      const event = availableEvents.find((e) => e.id === targetEventId);
      return event ? event.name : `Event ${targetEventId}`;
    },
    [availableEvents],
  );

  const renderCredentialModal = useCallback(() => {
    if (!selectedToolType || !showCredentialModal) return null;

    try {
      const plugin = ToolPluginRegistry.get(selectedToolType.toLowerCase());
      if (plugin?.CredentialForm) {
        const CredentialForm = plugin.CredentialForm;
        return (
          <Dialog
            open={showCredentialModal}
            onOpenChange={setShowCredentialModal}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  Add {getToolTypeName(selectedToolType)} Credential
                </DialogTitle>
              </DialogHeader>
              <CredentialForm
                tool={null}
                onSubmit={handleCredentialSubmit}
                onCancel={() => setShowCredentialModal(false)}
              />
            </DialogContent>
          </Dialog>
        );
      }
    } catch (error) {
      console.error(
        `Failed to load credential form for ${selectedToolType}:`,
        error,
      );
    }

    return (
      <Dialog open={showCredentialModal} onOpenChange={setShowCredentialModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Add {getToolTypeName(selectedToolType)} Credential
            </DialogTitle>
          </DialogHeader>
          <div>Credential form is not available for this message type.</div>
        </DialogContent>
      </Dialog>
    );
  }, [
    selectedToolType,
    showCredentialModal,
    handleCredentialSubmit,
    getToolTypeName,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conditional Actions</CardTitle>
        <p className="text-muted-foreground text-sm">
          Configure actions to perform when this event succeeds or fails
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add New Conditional Action */}
        <div className="border-border space-y-4 rounded-lg border p-4">
          <Label className="text-sm font-medium">
            {isEditing ? "Edit Action" : "Add New Action"}
          </Label>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="eventType">Trigger</Label>
              <Select
                value={newEventType}
                onValueChange={(
                  value:
                    | "ON_SUCCESS"
                    | "ON_FAILURE"
                    | "ALWAYS"
                    | "ON_CONDITION",
                ) => setNewEventType(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ON_SUCCESS">On Success</SelectItem>
                  <SelectItem value="ON_FAILURE">On Failure</SelectItem>
                  <SelectItem value="ALWAYS">Always</SelectItem>
                  <SelectItem value="ON_CONDITION">On Condition</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventAction">Action Type</Label>
              <Select
                value={newEventAction}
                onValueChange={(value: ConditionalActionType) =>
                  setNewEventAction(value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConditionalActionType.SEND_MESSAGE}>
                    Send Message
                  </SelectItem>
                  <SelectItem value={ConditionalActionType.SCRIPT}>
                    Run Another Event
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {newEventAction === ConditionalActionType.SEND_MESSAGE && (
            <div className="space-y-4">
              {/* Tool Type and Credential Selection - Side by Side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Message Type Selection */}
                <div className="space-y-2">
                  <Label htmlFor="toolTypeSelection">Message Type</Label>
                  <Select
                    value={selectedToolType ?? ""}
                    onValueChange={(value) => {
                      setSelectedToolType(value || null);
                      setNewToolId(null); // Reset credential selection when message type changes
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a message type" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToolTypes.map((toolType) => (
                        <SelectItem key={toolType} value={toolType}>
                          <div className="flex items-center gap-2">
                            {getToolTypeIcon(toolType)}
                            {getToolTypeName(toolType)}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Credential Selection */}
                <div className="space-y-2">
                  <Label htmlFor="credentialSelection">Credential</Label>
                  <Select
                    disabled={!selectedToolType}
                    value={(() => {
                      if (
                        selectedToolType === "EMAIL" &&
                        systemSmtpEnabled &&
                        newToolId === null
                      ) {
                        return "system";
                      }
                      return newToolId?.toString() ?? "";
                    })()}
                    onValueChange={(value) => {
                      if (value === "add_new") {
                        setShowCredentialModal(true);
                      } else if (value === "system") {
                        setNewToolId(null); // Use null to indicate system SMTP
                      } else {
                        if (!value) {
                          setNewToolId(null);
                          return;
                        }
                        const parsedId = parseInt(value, 10);
                        if (isNaN(parsedId)) {
                          console.error(`Invalid tool ID: ${value}`);
                          return;
                        }
                        setNewToolId(parsedId);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !selectedToolType
                            ? "Select message type first"
                            : credentialsForSelectedTool.length === 0
                              ? "No credentials available"
                              : "Select a credential"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {/* System SMTP option for EMAIL tools when enabled */}
                      {selectedToolType === "EMAIL" && systemSmtpEnabled && (
                        <>
                          <SelectItem value="system">
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              System SMTP Settings
                            </div>
                          </SelectItem>
                          {credentialsForSelectedTool.length > 0 && (
                            <div className="border-border my-1 border-t" />
                          )}
                        </>
                      )}

                      {/* User credentials */}
                      {credentialsForSelectedTool.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id.toString()}>
                          <div className="flex items-center gap-2">
                            {getToolTypeIcon(tool.type)}
                            {tool.name}
                          </div>
                        </SelectItem>
                      ))}

                      {/* Add new credential option */}
                      {selectedToolType && (
                        <>
                          {(credentialsForSelectedTool.length > 0 ||
                            (selectedToolType === "EMAIL" &&
                              systemSmtpEnabled)) && (
                            <div className="border-border my-1 border-t" />
                          )}
                          <SelectItem value="add_new">
                            <div className="flex items-center gap-2">
                              <Plus className="h-4 w-4" />
                              Add Credential
                            </div>
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Templates Dropdown */}
              {selectedToolType &&
                (userTemplates.length > 0 || systemTemplates.length > 0) && (
                  <div className="space-y-2">
                    <Label htmlFor="templateSelection">Template</Label>
                    <Select
                      value={selectedTemplate}
                      onValueChange={handleTemplateSelect}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a template (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-muted-foreground">
                            No template
                          </span>
                        </SelectItem>

                        {/* User Templates First */}
                        {userTemplates.length > 0 && (
                          <>
                            {userTemplates.map((template) => (
                              <SelectItem
                                key={template.id}
                                value={template.id.toString()}
                              >
                                <div className="flex items-center gap-2">
                                  {getToolTypeIcon(selectedToolType ?? "")}
                                  {template.name}
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}

                        {/* Separator between user and system templates */}
                        {userTemplates.length > 0 &&
                          systemTemplates.length > 0 && (
                            <div className="border-border my-1 border-t" />
                          )}

                        {/* System Templates */}
                        {systemTemplates.length > 0 && (
                          <>
                            {systemTemplates.map((template) => (
                              <SelectItem
                                key={template.id}
                                value={template.id.toString()}
                              >
                                <div className="flex items-center gap-2">
                                  {getToolTypeIcon(selectedToolType ?? "")}
                                  {template.name}
                                  <Badge
                                    variant="outline"
                                    className="ml-auto text-xs"
                                  >
                                    System
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      Select a saved template to populate the message content.{" "}
                      <Link
                        href={`/${locale}/dashboard/tools?tab=templates`}
                        className="text-primary hover:underline"
                      >
                        Manage templates
                      </Link>
                    </p>
                  </div>
                )}

              {/* Email-specific fields */}
              {selectedToolType === "EMAIL" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="emailRecipients">Recipients</Label>
                    <Input
                      id="emailRecipients"
                      value={newEmailAddresses}
                      onChange={(e) => setNewEmailAddresses(e.target.value)}
                      placeholder="user1@example.com, user2@example.com"
                    />
                    <p className="text-muted-foreground text-xs">
                      Enter multiple email addresses separated by commas
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emailSubject">Subject</Label>
                    <Input
                      id="emailSubject"
                      value={newEmailSubject}
                      onChange={(e) => setNewEmailSubject(e.target.value)}
                      placeholder="Enter email subject..."
                    />
                  </div>
                </div>
              )}

              {/* Message Content */}
              {selectedToolType && (
                <div className="space-y-2">
                  <Label htmlFor="messageContent">
                    {selectedToolType === "EMAIL" ? "Message Body" : "Message"}
                  </Label>
                  <MonacoEditor
                    value={newMessage}
                    onChange={(value) => {
                      setNewMessage(value);
                      // Clear template selection if user manually edits message
                      if (
                        selectedTemplate &&
                        value !==
                          (
                            ([...userTemplates, ...systemTemplates].find(
                              (t) => t.id.toString() === selectedTemplate,
                            )?.parameters as Record<string, unknown>) ?? {}
                          )?.message
                      ) {
                        setSelectedTemplate("");
                      }
                    }}
                    language={
                      selectedToolType === "SLACK" ||
                      selectedToolType === "DISCORD"
                        ? "json"
                        : "html"
                    }
                    height="200px"
                    editorSettings={editorSettings}
                    className="border-0"
                  />
                  <p className="text-muted-foreground text-xs">
                    {selectedToolType === "EMAIL"
                      ? "This will be the body content of your email"
                      : selectedToolType === "SLACK"
                        ? "Use JSON format for Slack message blocks and attachments"
                        : selectedToolType === "DISCORD"
                          ? "Use JSON format for Discord embeds and message components"
                          : "This message will be sent using the selected communication tool"}
                  </p>
                </div>
              )}
            </div>
          )}

          {newEventAction === ConditionalActionType.SCRIPT && (
            <div className="space-y-2">
              <Label htmlFor="targetEvent">Target Event</Label>
              <Select
                value={newTargetEventId?.toString() ?? ""}
                onValueChange={(value) =>
                  setNewTargetEventId(value ? parseInt(value) : null)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select event to run" />
                </SelectTrigger>
                <SelectContent>
                  {availableEvents
                    .filter((event) => event.id !== eventId) // Don't allow self-reference
                    .map((event) => (
                      <SelectItem key={event.id} value={event.id.toString()}>
                        {event.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {eventId && (
                <p className="text-muted-foreground text-sm">
                  <Info className="mr-1 inline-block h-3 w-3" />
                  Events cannot trigger themselves to prevent infinite loops.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={addConditionalAction}
              disabled={
                (newEventAction === ConditionalActionType.SCRIPT &&
                  !newTargetEventId) ||
                (newEventAction === ConditionalActionType.SEND_MESSAGE &&
                  (!selectedToolType || !newMessage))
              }
              className="flex-1"
            >
              <Plus className="mr-2 h-4 w-4" />
              {isEditing ? "Update Action" : "Add Action"}
            </Button>
            {isEditing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // Reset form fields
                  setNewEventType("ON_SUCCESS");
                  setNewEventAction(ConditionalActionType.SEND_MESSAGE);
                  setNewEmailAddresses("");
                  setNewEmailSubject("");
                  setNewTargetEventId(null);
                  setNewToolId(null);
                  setNewMessage("");
                  setSelectedToolType(null);
                  setSelectedTemplate("");
                  // Clear edit mode
                  setEditingIndex(null);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Existing Conditional Actions */}
        {conditionalActions.length > 0 && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Configured Actions</Label>
              <p className="text-muted-foreground mt-1 text-xs">
                These actions will be triggered automatically when the event
                succeeds or fails
              </p>
            </div>
            {conditionalActions.map((action, index) => (
              <div
                key={index}
                className="border-border bg-muted/50 flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center space-x-3">
                  <Badge className={getTypeColor(action.type)}>
                    {action.type === "ON_SUCCESS"
                      ? "Success"
                      : action.type === "ON_FAILURE"
                        ? "Failure"
                        : action.type === "ON_CONDITION"
                          ? "Condition"
                          : "Always"}
                  </Badge>
                  <div className="flex items-center space-x-2">
                    {getActionIcon(action.action)}
                    <span className="font-medium">
                      {getActionLabel(action.action)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {action.action === ConditionalActionType.SCRIPT &&
                      action.targetEventId && (
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          → {getTargetEventName(action.targetEventId)}
                        </span>
                      )}
                    {action.action === ConditionalActionType.SEND_MESSAGE && (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-purple-600 dark:text-purple-400">
                          →{" "}
                          {action.toolId
                            ? getToolName(action.toolId)
                            : action.toolType
                              ? `${getToolTypeName(action.toolType)} (No credential selected)`
                              : "Message"}
                        </span>
                        {action.message && (
                          <span className="max-w-xs truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs dark:bg-gray-800">
                            "{action.message}"
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => editConditionalAction(index)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeConditionalAction(index)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>ℹ️ Note:</strong> Conditional events allow you to
            automatically respond to event outcomes. Email notifications require
            SMTP settings to be configured in system settings.
          </p>
        </div>
      </CardContent>

      {/* Credential Creation Modal */}
      {renderCredentialModal()}
    </Card>
  );
}
