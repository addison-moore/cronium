import { type LucideIcon } from "lucide-react";
import { type z } from "zod";
import { type Tool } from "@/shared/schema";

// Base interface for all tool plugins
export interface ToolPlugin {
  // Plugin metadata
  id: string;
  name: string;
  description: string;
  icon: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  category: string;

  // Plugin configuration
  schema: z.ZodSchema<unknown>;
  defaultValues: Record<string, unknown>;

  // Plugin components
  CredentialForm: React.ComponentType<CredentialFormProps>;
  CredentialDisplay: React.ComponentType<CredentialDisplayProps>;
  TemplateManager?: React.ComponentType<TemplateManagerProps>;

  // Plugin actions
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

// Props for credential form component
export interface CredentialFormProps {
  tool?: Tool | null;
  onSubmit: (data: {
    name: string;
    credentials: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
}

// Props for credential display component
export interface CredentialDisplayProps {
  tools: Tool[];
  onEdit: (tool: Tool) => void;
  onDelete: (id: number) => void;
  onTest?: (tool: Tool) => void;
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

  static unregister(id: string) {
    this.plugins.delete(id);
  }

  static clear() {
    this.plugins.clear();
  }
}
