import { type LucideIcon } from "lucide-react";
import { type z } from "zod";
import { type Tool } from "@/shared/schema";
import { type ParameterEncoding } from "@/lib/tool-action-template-processor";

// Tool Action Types
export type ActionType = "create" | "update" | "search" | "delete";
export type DevelopmentMode = "visual" | "code";

// Parameter definition for actions
export interface ActionParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

// Features configuration for actions
export interface ActionFeatures {
  realTime?: boolean;
  batchSupport?: boolean;
  webhookSupport?: boolean;
}

/**
 * What the button on the event form does with an action. The form sends `isTest`, but
 * only an action whose code reads it stops short of the real thing, so each one has to
 * say which it is. The form goes by this to decide what the button says, whether to ask
 * first, and what the toast says. `src/tools/__tests__/test-run.test.ts` checks it against
 * what each action really does. Build one with the helpers in `@/tools/utils/test-run`.
 */
export interface ActionTestRun {
  /**
   * - `simulated`: stops at `isTest`, before contacting anything.
   * - `reads`: really runs, and can't change anything.
   * - `sends`: really delivers something to someone.
   * - `spends`: really calls a service that may charge for it.
   * - `writes`: really changes data, for good.
   */
  kind: "simulated" | "reads" | "sends" | "spends" | "writes";
  /**
   * Said beside the button, and again when asking first. With a check, the lines beside
   * the buttons come from it, and this is only said when asking.
   */
  explains: string;
  /** What the toast says after a run that worked, from what the action returned. */
  succeeded: (result: unknown) => string;
  /**
   * What the action does instead when `isTest` is set, for one whose real run does
   * something: it reaches the same service with the same credential and parameters, and
   * stops before anything changes or goes out. The form offers it beside the real run,
   * and the server only asks for one from an action that declares it.
   */
  check?: ActionCheck;
}

/** A check of an action, offered beside its real run. Build it with `checkFirst`. */
export interface ActionCheck {
  /** Its button, which says what it checks, such as `Count Matches`. */
  label: string;
  /** Said beside the buttons, first, starting with `label`. */
  explains: string;
  /** What the real run does, finishing "<its button> ...", said after `explains`. */
  runDoes: string;
  /** What the toast says after a check that worked: what it showed, then what it didn't. */
  succeeded: (result: unknown) => string;
}

// Tool Action Interface
export interface ToolAction {
  id: string;
  name: string;
  description: string;
  category: string;
  actionType: ActionType;
  actionTypeColor?: string; // Tailwind color classes for action type badge (e.g., "bg-blue-500 text-white")

  // Development mode support
  developmentMode: DevelopmentMode;

  // Schemas for validation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodSchema<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: z.ZodSchema<any>;

  // When true, this action's result is emitted as the event's Unified I/O output
  // (job.result.scriptOutput), so a workflow's next step receives it via
  // cronium.input(). Set on read/fetch actions (e.g. SQL query, search); leave
  // false/undefined on send/write actions so they don't pollute the data channel.
  producesOutput?: boolean;

  // How template values are encoded for each parameter, for an action that puts one
  // somewhere other than a plain value (HTML, message markup). Defaults to verbatim.
  templateEncoding?: ParameterEncoding;

  // Execution
  execute: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credentials: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any,
    context: ExecutionContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;

  // Testing support
  testRun: ActionTestRun;
  testData?: () => Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validate?: (params: any) => { isValid: boolean; errors?: string[] };

  // UI configuration
  formConfig?: VisualFormConfig;
  helpText?: string;
  examples?: ActionExample[];

  // Additional properties for UI
  requiresCredentials?: boolean;
  parameters: ActionParameter[];
  features?: ActionFeatures;
  helpUrl?: string;
}

// Execution Context
export interface ExecutionContext {
  variables: VariableManager;
  logger: Logger;
  onProgress?: (progress: { step: string; percentage: number }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPartialResult?: (result: any) => void;
  isTest?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockData?: any;
  // The event's configured execution timeout in milliseconds (from the event's
  // Timeout setting). Actions that make bounded external calls (e.g. the SQL
  // tool's statement timeout) should honor this; the executor also enforces it
  // as an overall cap on execute().
  timeoutMs?: number;
}

// Supporting Interfaces
export interface VisualFormConfig {
  fields: FormFieldConfig[];
}

export interface FormFieldConfig {
  name: string;
  type:
    "text" | "number" | "select" | "textarea" | "boolean" | "array" | "object";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface ActionExample {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: Record<string, any>;
}

export interface VariableManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (key: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (key: string, value: any) => void;
}

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

// Credentials configuration for tools
export interface ToolCredentials {
  configured?: boolean;
  [key: string]: unknown;
}

// Base interface for all tool plugins
export interface ToolPlugin {
  // Plugin metadata
  id: string;
  name: string;
  description: string;
  icon: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  category: string;
  categoryIcon?: React.ReactNode; // Icon to display for the category (e.g., <MessageSquare />)
  docsUrl?: string;

  // Plugin configuration
  schema: z.ZodSchema<unknown>;
  defaultValues: Record<string, unknown>;

  // Plugin components
  CredentialForm: React.ComponentType<CredentialFormProps>;
  CredentialDisplay: React.ComponentType<CredentialDisplayProps>;
  TemplateManager?: React.ComponentType<TemplateManagerProps>;

  // Tool Actions (new)
  actions: ToolAction[];
  getActionById: (id: string) => ToolAction | undefined;
  getActionsByType: (type: ActionType) => ToolAction[];

  // OAuth requirement: when set, the server injects a fresh access token as
  // credentials.oauthToken before executing actions (metadata only)
  requiresOAuth?: {
    providerId: "google" | "microsoft" | "slack";
    scope: string;
  };

  // Credentials
  credentials?: ToolCredentials;

  // Plugin actions (legacy - maintained for compatibility)
  validate?: (
    credentials: Record<string, unknown>,
  ) => Promise<{ isValid: boolean; error?: string }>;
  test?: (
    credentials: Record<string, unknown>,
  ) => Promise<{ success: boolean; message: string }>;
  send?: (
    credentials: Record<string, unknown>,
    data: unknown,
  ) => Promise<{ success: boolean; message?: string }>;
}

// A version of the Tool type with credentials parsed into an object
export type ToolWithParsedCredentials = Omit<Tool, "credentials"> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentials: Record<string, any>;
};

// Props for credential form component
export interface CredentialFormProps {
  tool?: ToolWithParsedCredentials | null;
  onSubmit: (data: {
    name: string;
    credentials: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
}

// Props for credential display component
export interface CredentialDisplayProps {
  tools: ToolWithParsedCredentials[];
  onEdit: (tool: ToolWithParsedCredentials) => void;
  onDelete: (id: number) => void;
  onTest?: (tool: ToolWithParsedCredentials) => void;
}

// Props for template manager component
export interface TemplateManagerProps {
  toolType: string;
  onAddTemplate: () => void;
  onEditTemplate?: (templateId: number) => void;
  onDeleteTemplate?: (templateId: number) => void;
}

// Store registry on global to persist across hot reloads and serverless invocations
declare global {
  var __toolPluginRegistry: Map<string, ToolPlugin> | undefined;
}

// Get or create the global plugin registry
function getGlobalPluginRegistry(): Map<string, ToolPlugin> {
  if (!global.__toolPluginRegistry) {
    console.log("[ToolPluginRegistry] Creating new global plugin registry");
    global.__toolPluginRegistry = new Map<string, ToolPlugin>();
  }
  return global.__toolPluginRegistry;
}

// Registry for tool plugins
export class ToolPluginRegistry {
  private static get plugins(): Map<string, ToolPlugin> {
    return getGlobalPluginRegistry();
  }

  static register(plugin: ToolPlugin) {
    this.plugins.set(plugin.id, plugin);
  }

  static get(id: string): ToolPlugin | undefined {
    return this.plugins.get(id);
  }

  static getAll(): ToolPlugin[] {
    return Array.from(this.plugins.values());
  }

  static getByCategory(category: string): ToolPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.category === category,
    );
  }

  // New action-related methods
  static getAllActions(): ToolAction[] {
    return Array.from(this.plugins.values()).flatMap(
      (plugin) => plugin.actions || [],
    );
  }

  static getActionsByType(actionType: ActionType): ToolAction[] {
    return this.getAllActions().filter(
      (action) => action.actionType === actionType,
    );
  }

  static getActionById(actionId: string): ToolAction | undefined {
    for (const plugin of this.plugins.values()) {
      const action = plugin.getActionById?.(actionId);
      if (action) return action;
    }
    return undefined;
  }

  static unregister(id: string) {
    this.plugins.delete(id);
  }

  static clear() {
    this.plugins.clear();
  }
}
