/**
 * Template Processing Service for Cronium
 *
 * Provides consistent Handlebars-style templating across all message types (HTML, JSON, plain text)
 * with safe variable access and cronium runtime helper integration.
 */

import Handlebars from "handlebars";

export interface TemplateContext {
  event: {
    id: number;
    name: string;
    status: "success" | "failure" | "timeout" | "partial" | "unknown";
    duration?: number;
    executionTime?: string;
    server?: string;
    output?: string;
    error?: string;
  };
  variables: Record<string, unknown>;
  input: Record<string, unknown>;
  conditions: Record<string, boolean>;
}

export class TemplateProcessor {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
    this.configureSettings();
  }

  /**
   * Register custom Handlebars helpers for enhanced templating
   */
  private registerHelpers() {
    // Helper for safe property access with optional chaining
    this.handlebars.registerHelper(
      "get",
      function (obj: unknown, path: string, fallback = "") {
        const keys = path.split(".");
        let current: unknown = obj;

        for (const key of keys) {
          if (current == null || typeof current !== "object") {
            return fallback as string;
          }
          current = (current as Record<string, unknown>)[key];
        }

        return (current ?? fallback) as string;
      },
    );

    // Helper for conditional rendering
    this.handlebars.registerHelper(
      "ifEquals",
      function (
        this: unknown,
        arg1: unknown,
        arg2: unknown,
        options: Handlebars.HelperOptions,
      ) {
        return arg1 === arg2 ? options.fn(this) : options.inverse(this);
      },
    );

    // Helper for formatting duration
    this.handlebars.registerHelper("formatDuration", function (ms: number) {
      if (
        ms === null ||
        ms === undefined ||
        typeof ms !== "number" ||
        isNaN(ms)
      ) {
        return "Less than 1 second";
      }

      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
      return `${(ms / 3600000).toFixed(1)}h`;
    });

    // Helper for formatting timestamps
    this.handlebars.registerHelper("formatTime", function (timestamp: string) {
      if (!timestamp) return "Unknown";

      try {
        const date = new Date(timestamp);
        return date.toLocaleString();
      } catch {
        return timestamp;
      }
    });

    // Helper for JSON stringification (useful for debugging)
    this.handlebars.registerHelper("json", function (obj: unknown) {
      return new Handlebars.SafeString(JSON.stringify(obj, null, 2));
    });
  }

  /**
   * Configure Handlebars settings for security and compatibility
   */
  private configureSettings() {
    // Disable prototype pollution protection for our controlled environment
    this.handlebars.registerHelper(
      "lookup",
      function (obj: unknown, field: string) {
        if (obj && typeof obj === "object") {
          return (obj as Record<string, unknown>)[field];
        }
        return undefined;
      },
    );
  }

  /**
   * Process a template with the provided context
   */
  processTemplate(template: string, context: TemplateContext): string {
    try {
      // Create cronium namespace for template access
      const templateData = {
        cronium: {
          event: context.event,
          getVariables: context.variables,
          input: context.input,
          getCondition: context.conditions,
        },
      };

      const compiledTemplate = this.handlebars.compile(template);
      return compiledTemplate(templateData);
    } catch (error) {
      console.error("Template processing error:", error);
      // Return original template with error notice for debugging
      return `[Template Error: ${error instanceof Error ? error.message : "Unknown error"}]\n\n${template}`;
    }
  }

  /**
   * Process a template specifically for JSON output
   * Ensures proper JSON escaping and formatting
   */
  processJsonTemplate(template: string, context: TemplateContext): string {
    const processed = this.processTemplate(template, context);

    try {
      // Validate that the result is valid JSON
      JSON.parse(processed);
      return processed;
    } catch (error) {
      console.error("JSON template validation error:", error);
      // Return a safe JSON error response
      return JSON.stringify(
        {
          error: "Template processing resulted in invalid JSON",
          original: template,
          processed: processed,
        },
        null,
        2,
      );
    }
  }

  /**
   * Process a template specifically for HTML output
   * Ensures proper HTML escaping by default
   */
  processHtmlTemplate(template: string, context: TemplateContext): string {
    return this.processTemplate(template, context);
  }

  /**
   * Get template variables from execution context
   */
  static createTemplateContext(
    event: {
      id: number;
      name: string;
      status?: string;
      duration?: number;
      executionTime?: string;
      server?: string;
      output?: string;
      error?: string;
    },
    variables: Record<string, unknown> = {},
    input: Record<string, unknown> = {},
    conditions: Record<string, boolean> = {},
  ): TemplateContext {
    return {
      event: {
        id: event.id,
        name: event.name,
        status: (event.status ??
          "unknown") as TemplateContext["event"]["status"],
        ...(event.duration !== undefined && { duration: event.duration }),
        ...(event.executionTime !== undefined && {
          executionTime: event.executionTime,
        }),
        ...(event.server !== undefined && { server: event.server }),
        ...(event.output !== undefined && { output: event.output }),
        ...(event.error !== undefined && { error: event.error }),
      },
      variables,
      input,
      conditions,
    };
  }

  /**
   * Validate template syntax without processing
   */
  validateTemplate(template: string): { isValid: boolean; error?: string } {
    try {
      this.handlebars.compile(template);
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error:
          error instanceof Error ? error.message : "Unknown template error",
      };
    }
  }

  /**
   * Extract variable references from a template
   */
  extractVariables(template: string): string[] {
    const variables = new Set<string>();
    const regex = /\{\{cronium\.(\w+(?:\.\w+)*)\}\}/g;
    let match;

    while ((match = regex.exec(template)) !== null) {
      if (match[1]) {
        variables.add(match[1]);
      }
    }

    return Array.from(variables);
  }
}

// Export singleton instance
export const templateProcessor = new TemplateProcessor();

// Export helper for creating contexts
export const createTemplateContext = (
  event: Parameters<typeof TemplateProcessor.createTemplateContext>[0],
  variables?: Parameters<typeof TemplateProcessor.createTemplateContext>[1],
  input?: Parameters<typeof TemplateProcessor.createTemplateContext>[2],
  conditions?: Parameters<typeof TemplateProcessor.createTemplateContext>[3],
) =>
  TemplateProcessor.createTemplateContext(event, variables, input, conditions);
