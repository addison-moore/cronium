import { type LucideIcon } from "lucide-react";
import { type z } from "zod";
import { type Tool } from "@/shared/schema";

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
  testMode?: boolean;
  realTime?: boolean;
  batchSupport?: boolean;
  webhookSupport?: boolean;
}

// Tool Action Interface
export interface ToolAction {
  id: string;
  name: string;
  description: string;
  category: string;
  actionType: ActionType;

  // Development mode support
  developmentMode: DevelopmentMode;

  // Schemas for validation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodSchema<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: z.ZodSchema<any>;

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

  // Flag to indicate if this action can be used as a conditional action
  isConditionalAction?: boolean;
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
}

// Supporting Interfaces
export interface VisualFormConfig {
  fields: FormFieldConfig[];
}

export interface FormFieldConfig {
  name: string;
  type:
    | "text"
    | "number"
    | "select"
    | "textarea"
    | "boolean"
    | "array"
    | "object";
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

// Registry for tool plugins
export class ToolPluginRegistry {
  private static plugins = new Map<string, ToolPlugin>();

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

  static getCategories(): string[] {
    const categories = new Set(
      Array.from(this.plugins.values()).map((plugin) => plugin.category),
    );
    return Array.from(categories).sort();
  }

  // New action-related methods
  static getAllActions(): ToolAction[] {
    return Array.from(this.plugins.values()).flatMap(
      (plugin) => plugin.actions || [],
    );
  }

  static getActionsByCategory(category: string): ToolAction[] {
    return this.getAllActions().filter(
      (action) => action.category === category,
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

  // Get all actions that can be used as conditional actions
  static getConditionalActions(): Array<{
    tool: ToolPlugin;
    action: ToolAction;
  }> {
    const conditionalActions: Array<{ tool: ToolPlugin; action: ToolAction }> =
      [];

    this.plugins.forEach((plugin) => {
      plugin.actions.forEach((action) => {
        if (action.isConditionalAction) {
          conditionalActions.push({ tool: plugin, action });
        }
      });
    });

    return conditionalActions;
  }

  // Get conditional action for a specific tool type
  static getConditionalActionForTool(toolType: string): ToolAction | undefined {
    const plugin = this.plugins.get(toolType.toLowerCase());
    if (!plugin) return undefined;

    return plugin.actions.find((action) => action.isConditionalAction);
  }

  // Check if a tool has any conditional actions
  static hasConditionalActions(toolType: string): boolean {
    const plugin = this.plugins.get(toolType.toLowerCase());
    if (!plugin) return false;

    return plugin.actions.some((action) => action.isConditionalAction);
  }

  static unregister(id: string) {
    this.plugins.delete(id);
  }

  static clear() {
    this.plugins.clear();
  }
}
