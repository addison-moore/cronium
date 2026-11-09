"use client";

import React, {
  useEffect,
  useId,
  useState,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { Separator } from "@cronium/ui";
import { Spinner } from "@cronium/ui";
import { ConfirmationDialog } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { trpcErrorMessage } from "@/trpc/shared";
import {
  Search,
  Zap,
  MessageSquare,
  Database,
  Mail,
  Globe,
  Users,
  FileText,
  AlertCircle,
  Play,
  SearchCheck,
  TestTube,
  Info,
  X,
} from "lucide-react";
import { useToast } from "@cronium/ui";
import { type Tool } from "@/shared/schema";
import {
  type ActionTestRun,
  type ShownResult,
  type ToolAction,
  type ToolPlugin,
  ToolPluginRegistry,
} from "@/tools/types/tool-plugin";
import { useToolPlugins } from "@/tools/use-tool-plugins";
import ActionParameterForm from "./ActionParameterForm";
import RunResult from "./RunResult";
import { cn } from "@/lib/utils";
import { SlackMessagePreview, EmailPreview } from "@/tools/previews";
import Link from "next/link";

// Tool Action Configuration Interface
export interface ToolActionConfig {
  toolType: string;
  actionId: string;
  toolId: number;
  parameters: Record<string, unknown>;
  outputMapping?: Record<string, string>;
}

interface ToolActionSectionProps {
  value: ToolActionConfig | null;
  onChange: (config: ToolActionConfig | null) => void;
  // False while the form this is part of is out of sight, as EventForm's `active`.
  active?: boolean;
  availableTools: Tool[];
  /** Whether the credentials are still loading: `availableTools` is empty until then. */
  isLoadingTools: boolean;
  /** Whether they couldn't be loaded at all, which leaves `availableTools` empty too. */
  toolsLoadFailed: boolean;
  onRetryTools: () => void;
}

// Default fallback icons for categories (used if plugin doesn't provide categoryIcon)
const DEFAULT_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  communication: <MessageSquare className="h-4 w-4" />,
  productivity: <FileText className="h-4 w-4" />,
  data: <Database className="h-4 w-4" />,
  development: <Globe className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  team: <Users className="h-4 w-4" />,
};

// Default fallback colors for action types (used if action doesn't provide actionTypeColor)
const DEFAULT_ACTION_TYPE_COLORS: Record<string, string> = {
  message: "bg-info text-info-foreground",
  create: "bg-success text-success-foreground",
  update: "bg-warning text-warning-foreground",
  delete: "bg-destructive text-destructive-foreground",
  query: "bg-purple-500 text-white",
};

// Helper function to get category icon from plugin or fallback
const getCategoryIcon = (category: string): React.ReactNode => {
  // Try to get from a plugin that has this category. Most of them only name an icon, in
  // a string, and React would print that beside the category.
  const pluginIcon = ToolPluginRegistry.getByCategory(category)
    .map((plugin) => plugin.categoryIcon)
    .find((icon) => icon && typeof icon !== "string");
  if (pluginIcon) return pluginIcon;
  // Fallback to default icon
  const categoryLower = category.toLowerCase();
  return DEFAULT_CATEGORY_ICONS[categoryLower] ?? <Zap className="h-4 w-4" />;
};

// Helper function to get action type color from action or fallback
const getActionTypeColor = (action: ToolAction): string => {
  if (action.actionTypeColor) {
    return action.actionTypeColor;
  }
  return (
    DEFAULT_ACTION_TYPE_COLORS[action.actionType] ?? "bg-gray-500 text-white"
  );
};

// What the button does comes from what the action declares, because `isTest` only stops
// an action that reads it. Most really run: a Slack message posts, a delete deletes.
const runButtonLabel = (action: ToolAction): string =>
  action.testRun.kind === "simulated" ? "Simulate" : `${action.name} Now`;

/**
 * What a press asks the server for. A simulation and a check reach the action as
 * `isTest`, and the server refuses either for an action that doesn't declare it.
 */
type RunMode = "simulate" | "check" | "run";

// The main button, beside any check.
const mainRunMode = (action: ToolAction): RunMode =>
  action.testRun.kind === "simulated" ? "simulate" : "run";

// A run that changes nothing needs no question: a simulation contacts nothing, and a read
// can't write.
const asksBeforeRunning = ({ kind }: ActionTestRun): boolean =>
  kind === "sends" || kind === "spends" || kind === "writes";

const RUN_SUCCEEDED_TITLE: Record<ActionTestRun["kind"], string> = {
  simulated: "Simulated",
  reads: "Done",
  sends: "Sent",
  spends: "Done",
  writes: "Done",
};

const runFailedTitle = ({ action, mode }: PressedRun): string => {
  if (mode === "check") {
    return `${action.testRun.check?.label ?? "Check"} failed`;
  }
  return mode === "simulate" ? "Simulation failed" : `${action.name} failed`;
};

const firstTemplateValue = (value: unknown): string | undefined => {
  if (typeof value === "string") return /\{\{[^{}]+\}\}/.exec(value)?.[0];
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      const found = firstTemplateValue(nested);
      if (found) return found;
    }
  }
  return undefined;
};

// A scheduled run fills these in, and this one doesn't, so a real run from the form sends
// them with the braces. A simulation sends nothing, so there's nothing to say.
const templateValueNote = (
  action: ToolAction,
  parameters: Record<string, unknown>,
): string | undefined => {
  if (action.testRun.kind === "simulated") return undefined;
  const value = firstTemplateValue(parameters);
  return value
    ? `Template values such as ${value} aren't filled in here: they go as written.`
    : undefined;
};

// A press of the run button, or of the check beside it. The answer is about this, and
// another credential or action can be chosen while it runs.
interface PressedRun {
  action: ToolAction;
  /** Which was asked for: the check, a simulation or the real run. */
  mode: RunMode;
  credential: Tool;
  parameters: Record<string, unknown>;
  /** False once another credential or action is chosen, so its result isn't shown. */
  stillChosen: boolean;
}

// A run that came back with something to show, and what it ran with.
interface ShownRun {
  toolId: number;
  actionId: string;
  actionName: string;
  credentialName: string;
  parameters: Record<string, unknown>;
  summary: string;
  shown: ShownResult;
}

// What a stored config's tool and action are called. A row can name ones no plugin has
// now, or leave the tool out: only the form writes whole ones, and the API takes any JSON.
const storedConfigNames = (
  config: Partial<ToolActionConfig>,
  plugins: ToolPlugin[],
): { tool: string; action: string | undefined } => {
  const toolType = config.toolType?.toUpperCase();
  const plugin = plugins.find((p) => p.id.toUpperCase() === toolType);
  return {
    tool: plugin?.name ?? config.toolType ?? "an unknown tool",
    action:
      plugin?.actions?.find((a) => a.id === config.actionId)?.name ??
      config.actionId,
  };
};

export default function ToolActionSection({
  value,
  onChange,
  active = true,
  availableTools,
  isLoadingTools,
  toolsLoadFailed,
  onRetryTools,
}: ToolActionSectionProps) {
  const { toast } = useToast();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedToolType, setSelectedToolType] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<ToolPlugin | null>(null);
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [askingToRun, setAskingToRun] = useState(false);
  const runExplanationId = useId();
  const checkExplanationId = useId();
  const runNoteId = useId();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [showTemplateAlert, setShowTemplateAlert] = useState(false);

  // Get all plugins
  const {
    plugins: allPlugins,
    status: pluginsStatus,
    retry: retryPlugins,
  } = useToolPlugins();

  // Fetch templates for selected tool and action
  const { data: templatesData } =
    trpc.toolActionTemplates.getByToolAction.useQuery(
      {
        toolType: selectedPlugin?.id ?? "",
        actionId: selectedAction?.id ?? "",
      },
      {
        enabled: active && !!selectedPlugin && !!selectedAction,
      },
    );

  const availableTemplates = templatesData ?? [];

  // Group available tools by plugin type
  const toolsByType = useMemo(() => {
    const grouped: Record<string, Tool[]> = {};
    availableTools.forEach((tool) => {
      const type = tool.type.toLowerCase();
      grouped[type] ??= [];
      grouped[type].push(tool);
    });
    return grouped;
  }, [availableTools]);

  // Get unique tool types from available tools
  const availableToolTypes = useMemo(() => {
    const types = new Set<string>();
    availableTools.forEach((tool) => {
      const plugin = allPlugins.find(
        (p) => p.id.toUpperCase() === tool.type.toUpperCase(),
      );
      if (plugin) {
        types.add(plugin.id);
      }
    });
    return Array.from(types);
  }, [availableTools, allPlugins]);

  // Filter tool types based on search and category
  const filteredToolTypes = useMemo(() => {
    let types = availableToolTypes;

    // Filter by search query
    if (searchQuery) {
      types = types.filter((type) => {
        const plugin = allPlugins.find((p) => p.id === type);
        return (
          plugin?.name.toLowerCase().includes(searchQuery.toLowerCase()) ??
          type.toLowerCase().includes(searchQuery.toLowerCase())
        );
      });
    }

    // Filter by category
    if (selectedCategory) {
      types = types.filter((type) => {
        const plugin = allPlugins.find((p) => p.id === type);
        return plugin?.category === selectedCategory;
      });
    }

    return types;
  }, [availableToolTypes, searchQuery, selectedCategory, allPlugins]);

  // Get categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    allPlugins.forEach((plugin) => {
      if (plugin.category && availableToolTypes.includes(plugin.id)) {
        cats.add(plugin.category);
      }
    });
    return Array.from(cats).sort();
  }, [allPlugins, availableToolTypes]);

  // Get tools for selected type
  const toolsForSelectedType = useMemo(() => {
    if (!selectedToolType) return [];
    return toolsByType[selectedToolType.toLowerCase()] ?? [];
  }, [selectedToolType, toolsByType]);

  // Initialize from value. A layout effect, so the frame after the loading state is the
  // event's settings: with a passive one the browser can paint the tool picker first.
  useLayoutEffect(() => {
    if (value?.toolId && value?.actionId) {
      const tool = availableTools.find((t) => t.id === value.toolId);
      if (tool) {
        const plugin = allPlugins.find(
          (p) => p.id.toUpperCase() === tool.type.toUpperCase(),
        );
        if (plugin) {
          setSelectedToolType(plugin.id);
          setSelectedTool(tool);
          setSelectedPlugin(plugin);

          const action = plugin.actions?.find((a) => a.id === value.actionId);
          if (action) {
            setSelectedAction(action);
            setParameters(value.parameters || {});
          }
        }
      }
    }
  }, [value, availableTools, allPlugins]);

  // Handle tool type selection
  const handleToolTypeSelect = (type: string) => {
    const plugin = allPlugins.find((p) => p.id === type);
    if (!plugin) return;

    setSelectedToolType(type);
    setSelectedPlugin(plugin);

    // Auto-select first available credential if only one exists
    const tools = toolsByType[type.toLowerCase()] ?? [];
    if (tools.length === 1 && tools[0]) {
      setSelectedTool(tools[0]);
    } else {
      setSelectedTool(null);
    }

    setSelectedAction(null);
    setParameters({});
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);
    onChange(null);
  };

  // Handle credential selection
  const handleCredentialSelect = (toolId: string) => {
    const tool = availableTools.find((t) => t.id === parseInt(toolId));
    if (tool) {
      setSelectedTool(tool);

      // Saved with the event, so it has to reach the form like any other setting.
      if (selectedPlugin && selectedAction) {
        onChange({
          toolType: selectedPlugin.id,
          toolId: tool.id,
          actionId: selectedAction.id,
          parameters,
        });
      }
    }
  };

  // Handle action selection
  const handleActionSelect = (actionId: string) => {
    if (!selectedPlugin) return;

    const action = selectedPlugin.actions?.find((a) => a.id === actionId);
    if (!action) return;

    setSelectedAction(action);
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);

    // Initialize with default parameters
    const defaultParams = action.testData?.() ?? {};
    setParameters(defaultParams);

    // Update configuration
    if (selectedTool && selectedPlugin) {
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: action.id,
        parameters: defaultParams,
      });
    }
  };

  // Handle template selection
  const handleTemplateChange = (templateId: string) => {
    if (templateId === "custom") {
      setSelectedTemplateId(null);
      setShowTemplateAlert(false);
      return;
    }

    const template = availableTemplates.find(
      (t) => t.id === parseInt(templateId),
    );
    if (template && selectedTool && selectedPlugin && selectedAction) {
      setSelectedTemplateId(template.id);
      const templateParams = template.parameters as Record<string, unknown>;
      setParameters(templateParams);
      setShowTemplateAlert(true);

      // Update configuration with template parameters
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: selectedAction.id,
        parameters: templateParams,
      });

      // Hide alert after 3 seconds
      setTimeout(() => setShowTemplateAlert(false), 3000);
    }
  };

  // Handle parameter changes
  const handleParametersChange = (newParams: Record<string, unknown>) => {
    setParameters(newParams);

    if (selectedTool && selectedPlugin && selectedAction) {
      onChange({
        toolType: selectedPlugin.id,
        toolId: selectedTool.id,
        actionId: selectedAction.id,
        parameters: newParams,
      });
    }
  };

  const pressedRun = useRef<PressedRun | null>(null);
  const [lastRun, setLastRun] = useState<ShownRun | null>(null);

  // A result is about the credential and action it ran with, so it goes when either
  // changes, by a choice here or through the event's settings, and one still on its way
  // won't show.
  useEffect(() => {
    setLastRun(null);
    if (pressedRun.current) pressedRun.current.stillChosen = false;
  }, [selectedTool?.id, selectedAction?.id]);

  const runActionMutation = trpc.tools.executeAction.useMutation({
    onSuccess: (answer) => {
      const run = pressedRun.current;
      if (!run) return;
      const { action } = run;
      if (!answer.success) {
        toast({
          title: runFailedTitle(run),
          description: answer.error,
          variant: "destructive",
        });
        return;
      }
      // Go by what the server says ran. One that didn't know the check ran it for real.
      const check = answer.checked ? action.testRun.check : undefined;
      const summary = check
        ? check.succeeded(answer.result)
        : action.testRun.succeeded(answer.result);
      toast({
        title: check ? "Checked" : RUN_SUCCEEDED_TITLE[action.testRun.kind],
        description: summary,
      });
      // Only a read or a prompt has something to show: a simulation's result is made up,
      // a check's is all in its toast, and a send or a write comes back with little more
      // than the count the toast gave.
      const { shows } = action.testRun;
      if (shows && !answer.simulated && !answer.checked && run.stillChosen) {
        setLastRun({
          toolId: run.credential.id,
          actionId: action.id,
          actionName: action.name,
          credentialName: run.credential.name,
          parameters: run.parameters,
          summary,
          shown: shows(answer.result),
        });
      }
    },
    onError: (error) => {
      const run = pressedRun.current;
      if (!run) return;
      const message = trpcErrorMessage(error, "The server gave no reason.");
      // The server only says no before running anything. With no answer, or a broken one,
      // nobody here can tell, and a proxy can give up on a run that goes on without it.
      // A simulation or a check changes nothing either way.
      const refused = (error.data?.httpStatus ?? 500) < 500;
      const mayHaveRun =
        !refused && run.mode === "run" && asksBeforeRunning(run.action.testRun);
      toast({
        title: runFailedTitle(run),
        description: mayHaveRun ? `${message} It may still have run.` : message,
        variant: "destructive",
      });
    },
  });

  const runAction = (mode: RunMode) => {
    if (!selectedTool || !selectedAction) return;

    pressedRun.current = {
      action: selectedAction,
      mode,
      credential: selectedTool,
      parameters,
      stillChosen: true,
    };
    // Whatever this run comes back with, the last one's result isn't it. A check shows
    // nothing there, so a result it didn't replace, such as a paid answer, stays.
    if (mode !== "check") setLastRun(null);
    runActionMutation.mutate({
      toolId: selectedTool.id,
      actionId: selectedAction.id,
      parameters,
      mode,
      // A server from before `mode` goes by this alone.
      isTest: mode !== "run",
    });
  };

  const handleRunPressed = () => {
    if (!selectedAction) return;
    if (asksBeforeRunning(selectedAction.testRun)) {
      setAskingToRun(true);
    } else {
      runAction(mainRunMode(selectedAction));
    }
  };

  // Which button's run is going, for its spinner.
  const runningMode = runActionMutation.isPending
    ? runActionMutation.variables?.mode
    : undefined;

  const runNote = selectedAction
    ? templateValueNote(selectedAction, parameters)
    : undefined;

  // Never one about another credential or action, even in the render before the effect
  // above clears it.
  const shownRun =
    lastRun &&
    lastRun.toolId === selectedTool?.id &&
    lastRun.actionId === selectedAction?.id
      ? lastRun
      : null;
  const shownRunIsStale = useMemo(
    () =>
      !!shownRun &&
      JSON.stringify(shownRun.parameters) !== JSON.stringify(parameters),
    [shownRun, parameters],
  );

  // Clear selection
  const handleClearSelection = () => {
    setSelectedToolType(null);
    setSelectedTool(null);
    setSelectedPlugin(null);
    setSelectedAction(null);
    setParameters({});
    setSelectedTemplateId(null);
    setShowTemplateAlert(false);
    onChange(null);
  };

  // Render tool type card
  const renderToolTypeCard = (type: string) => {
    const plugin = allPlugins.find((p) => p.id === type);
    if (!plugin) return null;

    const Icon = plugin.icon;
    const isSelected = selectedToolType === type;
    const toolCount = toolsByType[type.toLowerCase()]?.length ?? 0;

    return (
      <div
        key={type}
        className={cn(
          "border-border bg-tertiary-bg cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md",
          isSelected
            ? "border-primary bg-primary/5 ring-primary ring-2 ring-offset-2"
            : "hover:border-primary/50",
        )}
        onClick={() => handleToolTypeSelect(type)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "rounded-lg p-2",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-medium">{plugin.name}</h4>
              <p className="text-muted-foreground text-sm">
                {toolCount} credential{toolCount !== 1 ? "s" : ""} configured
              </p>
            </div>
          </div>
          {plugin.actions && (
            <Badge variant="secondary" className="text-xs">
              {plugin.actions.length} action
              {plugin.actions.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  // Render action preview
  const renderActionPreview = () => {
    if (!selectedPlugin || !selectedAction || !parameters) {
      return null;
    }

    // Slack preview
    if (
      selectedPlugin.id === "slack" &&
      selectedAction.id === "slack-send-message"
    ) {
      return (
        <SlackMessagePreview
          {...(typeof parameters.channel === "string" && {
            channel: parameters.channel,
          })}
          message={typeof parameters.text === "string" ? parameters.text : ""}
          {...(typeof parameters.username === "string" && {
            username: parameters.username,
          })}
          {...(typeof parameters.icon_emoji === "string" && {
            iconEmoji: parameters.icon_emoji,
          })}
          {...(typeof parameters.icon_url === "string" && {
            iconUrl: parameters.icon_url,
          })}
          {...(Array.isArray(parameters.blocks) && {
            blocks: parameters.blocks as Array<{
              type?: string;
              text?: { text?: string };
            }>,
          })}
          {...(Array.isArray(parameters.attachments) && {
            attachments: parameters.attachments as Array<{
              title?: string;
              text?: string;
            }>,
          })}
        />
      );
    }

    // Email preview
    if (selectedPlugin.id === "email" && selectedAction.id === "send-email") {
      const emailProps: React.ComponentProps<typeof EmailPreview> = {
        to: typeof parameters.to === "string" ? parameters.to : "",
        subject:
          typeof parameters.subject === "string" ? parameters.subject : "",
        body: typeof parameters.body === "string" ? parameters.body : "",
      };

      if (parameters.cc) emailProps.cc = parameters.cc as string;
      if (parameters.bcc) emailProps.bcc = parameters.bcc as string;
      if (parameters.priority)
        emailProps.priority = parameters.priority as "low" | "normal" | "high";
      if (parameters.isHtml !== undefined)
        emailProps.isHtml = parameters.isHtml as boolean;
      if (Array.isArray(parameters.attachments)) {
        emailProps.attachments = parameters.attachments.filter(
          (a): a is string => typeof a === "string",
        );
      }

      return <EmailPreview {...emailProps} />;
    }

    // Discord preview (similar to Slack)
    if (
      selectedPlugin.id === "discord" &&
      selectedAction.id === "discord-send-message"
    ) {
      return (
        <SlackMessagePreview
          title="Discord Message Preview"
          message={
            typeof parameters.content === "string" ? parameters.content : ""
          }
          username={
            typeof parameters.username === "string"
              ? parameters.username
              : "Cronium Bot"
          }
          {...(typeof parameters.avatar_url === "string" && {
            iconUrl: parameters.avatar_url,
          })}
        />
      );
    }

    return null;
  };

  const title = (
    <CardTitle className="flex items-center gap-2">
      <Zap className="h-5 w-5" />
      Tool Action Configuration
    </CardTitle>
  );

  // Nothing below can be right until both have answered: it would say that no tools
  // match, or that no credentials are configured, about an event that has both.
  if (pluginsStatus === "failed" || toolsLoadFailed) {
    return (
      <Card>
        <CardHeader>{title}</CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-3">
              <p>
                Couldn&apos;t load{" "}
                {pluginsStatus === "failed"
                  ? "the tool list"
                  : "your tool credentials"}
                .{" "}
                {value
                  ? "This event's tool settings can't be shown or changed until that works, and saving keeps them as they are."
                  : "A tool action can't be set up until that works."}{" "}
                Check your connection and try again, or reload the page.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (pluginsStatus === "failed") retryPlugins();
                  if (toolsLoadFailed) onRetryTools();
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (pluginsStatus === "loading" || isLoadingTools) {
    return (
      <Card>
        <CardHeader>{title}</CardHeader>
        <CardContent>
          <div role="status" className="flex items-center justify-center py-8">
            <Spinner size="lg" />
            <span className="ml-2">Loading tools...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // What's stored has to show below. When its credential or action can't, the form still
  // holds the config and a save sends it back, so say so: it's settings nobody can see
  // otherwise. The credentials have answered by now, so one not in the list is gone.
  const storedTool = availableTools.find((tool) => tool.id === value?.toolId);
  const storedPlugin = allPlugins.find(
    (plugin) => plugin.id.toUpperCase() === storedTool?.type.toUpperCase(),
  );
  const storedActionShows = storedPlugin?.actions?.some(
    (action) => action.id === value?.actionId,
  );
  const storedNames =
    !!value?.toolId &&
    !!value.actionId &&
    !storedActionShows &&
    storedConfigNames(value, allPlugins);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          {title}
          {selectedToolType && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 h-4 w-4" />
              Clear Selection
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {storedNames && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p>
                {storedTool
                  ? "This event's action isn't available."
                  : "This event's credential is gone, so its runs will fail."}
              </p>
              <p>
                It&apos;s set to run <strong>{storedNames.action}</strong> on{" "}
                <strong>{storedNames.tool}</strong>. Saving keeps that as it is,
                until you choose a replacement below.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Tool selection section */}
        {!selectedToolType ? (
          <div className="space-y-4">
            {/* Search and filters */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search tools..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!selectedCategory ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                >
                  All
                </Button>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    type="button"
                    variant={selectedCategory === cat ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(cat)}
                    className="flex items-center gap-1"
                  >
                    {getCategoryIcon(cat)}
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* No tools message */}
            {availableTools.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No tool credentials configured. Configure tool credentials to
                  start using Tool Actions.
                  <Button variant="link" asChild className="px-1">
                    <Link href="/dashboard/settings#tools">
                      Configure Tools
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Tools grid */}
            {filteredToolTypes.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredToolTypes.map(renderToolTypeCard)}
              </div>
            )}

            {/* No results */}
            {availableTools.length > 0 && filteredToolTypes.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-muted-foreground">
                  No tools match your search criteria
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Configuration section - appears after tool selection */
          <div className="space-y-6">
            {/* Selected tool header */}
            {selectedPlugin && (
              <div className="bg-muted/50 flex items-center gap-3 rounded-lg p-4">
                <selectedPlugin.icon className="text-primary h-8 w-8" />
                <div className="flex-1">
                  <h3 className="font-semibold">{selectedPlugin.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {selectedPlugin.description}
                  </p>
                </div>
              </div>
            )}

            <Separator />

            {/* Credential and Action selection - side by side on large screens */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Credential selection */}
              <div className="space-y-2">
                <Label htmlFor="credential-select">Select Credential</Label>
                <Select
                  value={selectedTool?.id.toString() ?? ""}
                  onValueChange={handleCredentialSelect}
                >
                  <SelectTrigger id="credential-select">
                    <SelectValue placeholder="Choose a credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {toolsForSelectedType.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id.toString()}>
                        <div className="flex items-center gap-2">
                          {/* Minimal status indicator */}
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              tool.isActive
                                ? "bg-success"
                                : "bg-muted-foreground/40",
                            )}
                          />
                          <span>{tool.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {toolsForSelectedType.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    No credentials available for this tool.
                    <Button
                      variant="link"
                      asChild
                      className="h-auto p-0 text-sm"
                    >
                      <Link href="/dashboard/settings#tools">
                        Add credential
                      </Link>
                    </Button>
                  </p>
                )}
              </div>

              {/* Action selection */}
              {selectedTool && selectedPlugin && (
                <div className="space-y-2">
                  <Label htmlFor="action-select">Select Action</Label>
                  <Select
                    value={selectedAction?.id ?? ""}
                    onValueChange={handleActionSelect}
                  >
                    <SelectTrigger id="action-select">
                      <SelectValue placeholder="Choose an action" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPlugin.actions?.map((action) => (
                        <SelectItem key={action.id} value={action.id}>
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-medium">{action.name}</span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "ml-2 text-xs",
                                getActionTypeColor(action),
                              )}
                            >
                              {action.actionType}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Continue with remaining content after action selection */}
            {selectedTool && selectedPlugin && selectedAction && (
              <>
                {/* Template Selection */}
                {availableTemplates.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="template-select">
                      Use Template (Optional)
                    </Label>
                    <Select
                      value={selectedTemplateId?.toString() ?? "custom"}
                      onValueChange={handleTemplateChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a template or configure manually..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">
                          <div className="flex items-center gap-2">
                            <X className="h-4 w-4" />
                            <span>Configure Manually</span>
                          </div>
                        </SelectItem>
                        {availableTemplates.map((template) => (
                          <SelectItem
                            key={template.id}
                            value={template.id.toString()}
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              <span>{template.name}</span>
                              {template.isSystemTemplate && (
                                <Badge variant="outline" className="ml-2">
                                  System
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedTemplateId && (
                      <div className="text-muted-foreground text-sm">
                        {
                          availableTemplates.find(
                            (t) => t.id === selectedTemplateId,
                          )?.description
                        }
                      </div>
                    )}
                  </div>
                )}

                {/* Template Applied Alert */}
                {showTemplateAlert && (
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                      Template parameters have been applied. You can customize
                      them below.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Action parameters */}
                <Separator />

                <div className="space-y-4">
                  <div className="space-y-2">
                    {/* The buttons name the action, which can be too long to fit beside this. */}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <Label>Configure Parameters</Label>
                      <div className="ml-auto flex flex-wrap justify-end gap-2">
                        {selectedAction.testRun.check && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => runAction("check")}
                            disabled={runActionMutation.isPending}
                            aria-describedby={
                              runNote
                                ? `${checkExplanationId} ${runNoteId}`
                                : checkExplanationId
                            }
                            className="flex items-center gap-2"
                          >
                            {runningMode === "check" ? (
                              <Spinner size="sm" />
                            ) : (
                              <SearchCheck className="h-4 w-4" />
                            )}
                            {selectedAction.testRun.check.label}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRunPressed}
                          disabled={runActionMutation.isPending}
                          aria-describedby={
                            runNote
                              ? `${runExplanationId} ${runNoteId}`
                              : runExplanationId
                          }
                          className="flex items-center gap-2"
                        >
                          {runningMode !== undefined &&
                          runningMode !== "check" ? (
                            <Spinner size="sm" />
                          ) : selectedAction.testRun.kind === "simulated" ? (
                            <TestTube className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          {runButtonLabel(selectedAction)}
                        </Button>
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {selectedAction.testRun.check && (
                        <p
                          id={checkExplanationId}
                          className="text-muted-foreground"
                        >
                          {selectedAction.testRun.check.explains}
                        </p>
                      )}
                      <div
                        className={
                          asksBeforeRunning(selectedAction.testRun)
                            ? "text-warning-text"
                            : "text-muted-foreground"
                        }
                      >
                        {/* Beside a check, the line names the button it's about. */}
                        <p id={runExplanationId}>
                          {selectedAction.testRun.check
                            ? `${runButtonLabel(selectedAction)} ${selectedAction.testRun.check.runDoes}.`
                            : selectedAction.testRun.explains}
                        </p>
                        {runNote && <p id={runNoteId}>{runNote}</p>}
                      </div>
                    </div>
                  </div>

                  {shownRun && (
                    <RunResult
                      actionName={shownRun.actionName}
                      credentialName={shownRun.credentialName}
                      summary={shownRun.summary}
                      shown={shownRun.shown}
                      stale={shownRunIsStale}
                      onDismiss={() => setLastRun(null)}
                    />
                  )}

                  {/* Portaled out of the form, so its buttons can't submit it. */}
                  <ConfirmationDialog
                    open={askingToRun}
                    onOpenChange={setAskingToRun}
                    title={`${selectedAction.name} now?`}
                    description={[
                      selectedAction.testRun.explains,
                      `It uses the credential ${selectedTool.name}.`,
                      runNote,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    confirmText={selectedAction.name}
                    confirmVariant={
                      selectedAction.testRun.kind === "writes"
                        ? "destructive"
                        : "default"
                    }
                    onConfirm={() => runAction("run")}
                  />

                  <ActionParameterForm
                    action={selectedAction}
                    value={parameters}
                    onChange={handleParametersChange}
                    isTest={false}
                  />
                </div>

                {/* Live Preview */}
                {renderActionPreview()}
              </>
            )}
          </div>
        )}

        {/* Help text */}
        {!selectedToolType && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Tool Actions allow you to integrate with external services without
              writing code. Select a tool to get started.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
