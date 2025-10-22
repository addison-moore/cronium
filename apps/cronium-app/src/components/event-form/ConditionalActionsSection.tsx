"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { ComboBox } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { MonacoEditor } from "@cronium/ui";
import {
  Trash2,
  Plus,
  Code,
  MessageSquare,
  Edit,
  Mail,
  Info,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cronium/ui";
import { ConditionalActionType } from "@/shared/schema";
import { ToolPluginRegistry } from "@/tools/plugins";
import { trpc } from "@/lib/trpc";
import { useToast } from "@cronium/ui";
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
    emailAddresses?: string | undefined;
    emailSubject?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  failEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailAddresses?: string | undefined;
    emailSubject?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  alwaysEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailAddresses?: string | undefined;
    targetEventId?: number | undefined;
    toolId?: number | undefined;
    message?: string | undefined;
  }>;
  conditionEvents?: Array<{
    id: number;
    type: ConditionalActionType;
    value?: string | undefined;
    emailAddresses?: string | undefined;
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
    return allTools.filter((tool) => tool.type === selectedToolType);
  }, [selectedToolType, allTools]);

  // All available message types based on tools with conditional actions
  const availableToolTypes = useMemo(() => {
    const conditionalActions = ToolPluginRegistry.getConditionalActions();
    // Store as uppercase for consistency with database
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

  // Get the conditional action configuration for a tool type
  const getConditionalActionConfig = useCallback((toolType: string) => {
    try {
      // Always convert to lowercase when accessing plugins
      const action = ToolPluginRegistry.getConditionalActionForTool(
        toolType.toLowerCase(),
      );
      return action;
    } catch {
      return null;
    }
  }, []);

  // Handle credential creation with stable callback
  const handleCredentialSubmit = useCallback(
    async (data: { name: string; credentials: Record<string, unknown> }) => {
      try {
        await createToolMutation.mutateAsync({
          name: data.name,
          type: selectedToolType!.toUpperCase(), // Store as uppercase in database
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

        // Get the conditional action configuration to know parameter mapping
        const conditionalConfig = getConditionalActionConfig(
          template.toolType,
        )?.conditionalActionConfig;
        if (conditionalConfig) {
          const { parameterMapping } = conditionalConfig;

          // Set message field
          if (parameterMapping.message) {
            const messageValue = params[parameterMapping.message];
            setNewMessage(typeof messageValue === "string" ? messageValue : "");
          }

          // Set recipients field
          if (parameterMapping.recipients) {
            const recipientsValue = params[parameterMapping.recipients];
            setNewEmailAddresses(
              typeof recipientsValue === "string" ? recipientsValue : "",
            );
          }

          // Set subject field
          if (parameterMapping.subject) {
            const subjectValue = params[parameterMapping.subject];
            setNewEmailSubject(
              typeof subjectValue === "string" ? subjectValue : "",
            );
          }
        } else {
          // Fallback for tools without conditional action config
          // Try common field names
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
    },
    [userTemplates, systemTemplates, getConditionalActionConfig],
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

    // Helper function to get tool type from toolId
    const getToolTypeFromId = (toolId: number | undefined) => {
      if (!toolId || !toolsData?.tools) return undefined;
      const tool = toolsData.tools.find((t) => t.id === toolId);
      return tool?.type;
    };

    // Add success events
    if (eventData.successEvents) {
      eventData.successEvents.forEach((event) => {
        events.push({
          id: event.id,
          type: "ON_SUCCESS",
          action: event.type,
          emailAddresses: event.emailAddresses ?? event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          toolType: getToolTypeFromId(event.toolId),
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
          emailAddresses: event.emailAddresses ?? event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          toolType: getToolTypeFromId(event.toolId),
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
          emailAddresses: event.emailAddresses ?? event.value ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          toolType: getToolTypeFromId(event.toolId),
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
          emailAddresses: event.emailAddresses ?? event.value ?? "",
          emailSubject: event.emailSubject ?? "",
          targetEventId: event.targetEventId ?? undefined,
          toolId: event.toolId ?? undefined,
          toolType: getToolTypeFromId(event.toolId),
          message: event.message ?? "",
        });
      });
    }

    setConditionalActions(events);
    setIsInitialized(true);
    // Don't notify parent on initial load to prevent loops
  }, [eventData, eventId, toolsData?.tools]);

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

    if (newEventAction === ConditionalActionType.SEND_MESSAGE && !newToolId) {
      toast({
        title: "Error",
        description: "Please select a credential for message actions",
        variant: "destructive",
      });
      return;
    }

    // Use plugin validation if available
    if (
      newEventAction === ConditionalActionType.SEND_MESSAGE &&
      selectedToolType
    ) {
      const conditionalConfig =
        getConditionalActionConfig(selectedToolType)?.conditionalActionConfig;
      if (conditionalConfig?.validate) {
        // Build parameters object based on parameter mapping
        const params: Record<string, unknown> = {};
        if (conditionalConfig.parameterMapping.recipients) {
          params[conditionalConfig.parameterMapping.recipients] =
            newEmailAddresses;
        }
        if (conditionalConfig.parameterMapping.message) {
          params[conditionalConfig.parameterMapping.message] = newMessage;
        }
        if (conditionalConfig.parameterMapping.subject) {
          params[conditionalConfig.parameterMapping.subject] = newEmailSubject;
        }

        const validation = conditionalConfig.validate(params);
        if (!validation.isValid && validation.errors?.length) {
          toast({
            title: "Validation Error",
            description: validation.errors.join(", "),
            variant: "destructive",
          });
          return;
        }
      } else if (!newMessage.trim()) {
        // Fallback validation if plugin doesn't provide one
        toast({
          title: "Error",
          description: "Message content is required",
          variant: "destructive",
        });
        return;
      }
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
    getConditionalActionConfig,
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

      // For SEND_MESSAGE actions, ensure toolType is set
      if (
        action.action === ConditionalActionType.SEND_MESSAGE &&
        action.toolId
      ) {
        // Get the tool type from the toolId if not already set
        const tool = allTools.find((t) => t.id === action.toolId);
        const toolType = action.toolType ?? tool?.type ?? null;
        setSelectedToolType(toolType);
      } else {
        setSelectedToolType(action.toolType ?? null);
      }

      setNewEventType(action.type);
      setNewEventAction(action.action);
      setNewEmailAddresses(action.emailAddresses ?? "");
      setNewEmailSubject(action.emailSubject ?? "");
      setNewTargetEventId(action.targetEventId ?? null);
      setNewToolId(action.toolId ?? null);
      setNewMessage(action.message ?? "");
      setIsEditing(true);
      setEditingIndex(index);
    },
    [conditionalActions, allTools],
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

  const getConditionalActionStatus = useCallback((type: string) => {
    // Map conditional action types to appropriate status types for StatusBadge
    if (type === "ON_SUCCESS") {
      return "success";
    } else if (type === "ON_FAILURE") {
      return "failure";
    } else if (type === "ON_CONDITION") {
      return "info"; // Purple/indigo coloring for condition
    } else {
      // ALWAYS type
      return "active"; // Green with different styling than success
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

    // Default fallback icon
    return <MessageSquare className="h-4 w-4" />;
  }, []);

  const getToolTypeName = useCallback((toolType: string) => {
    try {
      const plugin = ToolPluginRegistry.get(toolType.toLowerCase());
      if (plugin?.name) {
        return plugin.name;
      }
    } catch {
      console.warn(`Plugin not found for tool type: ${toolType}`);
    }

    // Fallback to the tool type itself
    return toolType;
  }, []);

  // Check if the conditional action has a specific parameter
  const hasActionParameter = useCallback(
    (toolType: string, paramName: string) => {
      const action = getConditionalActionConfig(toolType);
      if (!action) return false;

      return action.parameters.some((param) => param.name === paramName);
    },
    [getConditionalActionConfig],
  );

  // Get the language mode for the message editor
  const getMessageEditorLanguage = useCallback(
    (toolType: string) => {
      const action = getConditionalActionConfig(toolType);
      if (!action) return "text";

      // Check if any parameter expects JSON format
      const hasJsonParam = action.parameters.some(
        (param) => param.type === "object" || param.type === "array",
      );

      return hasJsonParam ? "json" : "html";
    },
    [getConditionalActionConfig],
  );

  // Get help text for message field
  const getMessageHelpText = useCallback(
    (toolType: string) => {
      const action = getConditionalActionConfig(toolType);
      if (!action)
        return "This message will be sent using the selected communication tool";

      // Check for specific parameter help text
      const messageParam = action.parameters.find(
        (param) => param.name === "message" || param.name === "body",
      );

      if (messageParam?.description) {
        return messageParam.description;
      }

      // Return generic help text based on editor language
      const language = getMessageEditorLanguage(toolType);
      if (language === "json") {
        return "Use JSON format for advanced message formatting";
      } else if (hasActionParameter(toolType, "body")) {
        return "This will be the body content of your message";
      }

      return "This message will be sent using the selected communication tool";
    },
    [getConditionalActionConfig, getMessageEditorLanguage, hasActionParameter],
  );

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
                        selectedToolType?.toLowerCase() === "email" &&
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
                      {selectedToolType?.toLowerCase() === "email" &&
                        systemSmtpEnabled && (
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
                            (selectedToolType?.toLowerCase() === "email" &&
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

              {/* Dynamic fields based on conditional action configuration */}
              {selectedToolType &&
                (() => {
                  const conditionalConfig =
                    getConditionalActionConfig(
                      selectedToolType,
                    )?.conditionalActionConfig;
                  if (!conditionalConfig) return null;

                  const { parameterMapping, displayConfig } = conditionalConfig;
                  const showRecipients = parameterMapping.recipients;
                  const showSubject =
                    parameterMapping.subject && displayConfig?.showSubject;

                  return (
                    <div className="space-y-4">
                      {showRecipients && (
                        <div className="space-y-2">
                          <Label htmlFor="recipients">
                            {displayConfig?.recipientLabel ?? "Recipients"}
                          </Label>
                          <Input
                            id="recipients"
                            value={newEmailAddresses}
                            onChange={(e) =>
                              setNewEmailAddresses(e.target.value)
                            }
                            placeholder={
                              selectedToolType?.toLowerCase() === "email"
                                ? "user1@example.com, user2@example.com"
                                : selectedToolType?.toLowerCase() === "slack"
                                  ? "#channel or @user"
                                  : "Enter recipients..."
                            }
                          />
                          <p className="text-muted-foreground text-xs">
                            {selectedToolType?.toLowerCase() === "email"
                              ? "Enter multiple email addresses separated by commas"
                              : selectedToolType?.toLowerCase() === "slack"
                                ? "Enter channel name or user handle"
                                : "Enter recipient information"}
                          </p>
                        </div>
                      )}
                      {showSubject && (
                        <div className="space-y-2">
                          <Label htmlFor="subject">Subject</Label>
                          <Input
                            id="subject"
                            value={newEmailSubject}
                            onChange={(e) => setNewEmailSubject(e.target.value)}
                            placeholder="Enter subject..."
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Message Content */}
              {selectedToolType &&
                (() => {
                  const conditionalConfig =
                    getConditionalActionConfig(
                      selectedToolType,
                    )?.conditionalActionConfig;
                  if (!conditionalConfig) return null;

                  const { parameterMapping, displayConfig } = conditionalConfig;
                  const messageParamName = parameterMapping.message;
                  if (!messageParamName) return null;

                  return (
                    <div className="space-y-2">
                      <Label htmlFor="messageContent">
                        {displayConfig?.messageLabel ?? "Message"}
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
                        language={getMessageEditorLanguage(selectedToolType)}
                        height="200px"
                        editorSettings={editorSettings}
                        className="border-0"
                      />
                      <p className="text-muted-foreground text-xs">
                        {getMessageHelpText(selectedToolType)}
                      </p>
                    </div>
                  );
                })()}
            </div>
          )}

          {newEventAction === ConditionalActionType.SCRIPT && (
            <div className="space-y-2">
              <Label htmlFor="targetEvent">Target Event</Label>
              <ComboBox
                options={availableEvents
                  .filter((event) => event.id !== eventId) // Don't allow self-reference
                  .map((event) => ({
                    label: event.description
                      ? `${event.name} - ${event.description}`
                      : event.name,
                    value: event.id.toString(),
                  }))}
                value={newTargetEventId?.toString() ?? ""}
                onChange={(value) =>
                  setNewTargetEventId(value ? parseInt(value) : null)
                }
                placeholder="Search and select an event to run..."
                emptyMessage="No events found. Create an event first."
                className="w-full"
                maxDisplayItems={7}
              />
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
                  (!selectedToolType || !newToolId))
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
                  <StatusBadge
                    status={getConditionalActionStatus(action.type)}
                    label={
                      action.type === "ON_SUCCESS"
                        ? "On Success"
                        : action.type === "ON_FAILURE"
                          ? "On Failure"
                          : action.type === "ON_CONDITION"
                            ? "On Condition"
                            : "Always"
                    }
                    size="sm"
                  />
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
