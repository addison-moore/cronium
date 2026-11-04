/**
 * Template Processing Service for Cronium
 *
 * Provides consistent Handlebars-style templating across all message types (HTML, JSON, plain text)
 * with safe variable access and cronium runtime helper integration.
 */

import Handlebars from "handlebars";

/**
 * What a value gets encoded for, which depends on where the output is going.
 * Handlebars only knows HTML, and escaping everything for HTML corrupted any value
 * holding `=`, `&` or a quote: a base64 token in a header, a URL's query string, a
 * JSON body.
 *
 * - `html`: the output is HTML. Handlebars' own escaping.
 * - `text`: the value is used verbatim, as in a URL, a header or a bound parameter.
 * - `markup`: only `&`, `<` and `>` are encoded, which is what Slack and Teams
 *   decode in message text. It stops a value from becoming a mention or a link.
 */
export type TemplateEncoding = "html" | "text" | "markup";

// A JSON string literal, or a {{tag}} outside of one. Strings are matched first, so
// any tag this returns is in a bare position like `{"count": {{n}}}`.
const JSON_STRING_OR_BARE_TAG = /"(?:[^"\\]|\\.)*"|\{\{[^{}]*\}\}/g;

/** Whether a template is a JSON document once its tags are filled in. */
function isJsonTemplate(template: string): boolean {
  if (!/^\s*[{[]/.test(template)) return false;
  try {
    const doc: unknown = JSON.parse(
      template.replace(JSON_STRING_OR_BARE_TAG, (token) =>
        token.startsWith('"') ? token : "0",
      ),
    );
    return typeof doc === "object" && doc !== null;
  } catch {
    return false;
  }
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render only the tags of a JSON document, re-encoding each result as JSON. A value
 * holding a quote therefore cannot end its string and add fields to the document,
 * and everything between the tags stays exactly as the author wrote it.
 */
function renderJsonDocument(
  template: string,
  render: (source: string) => string,
): string {
  return template.replace(JSON_STRING_OR_BARE_TAG, (token) => {
    if (!token.includes("{{")) return token;
    if (token.startsWith('"')) {
      return JSON.stringify(render(JSON.parse(token) as string));
    }
    const rendered = render(token);
    return isJson(rendered) ? rendered : JSON.stringify(rendered);
  });
}

const encodeMarkup = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Copy a value for rendering. Objects and arrays stringify as JSON, because an
 * upstream step's rows reached their destination as "[object Object],[object
 * Object]" otherwise. A symbol key keeps this invisible to `lookup`, `each` and the
 * `json` helper.
 */
function prepareValue(
  value: unknown,
  encodeString: (value: string) => string,
): unknown {
  if (typeof value === "string") return encodeString(value);
  if (Array.isArray(value)) {
    return withJsonString(
      value.map((item) => prepareValue(item, encodeString)),
      value,
      encodeString,
    );
  }
  if (Object.prototype.toString.call(value) === "[object Object]") {
    return withJsonString(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          prepareValue(item, encodeString),
        ]),
      ),
      value,
      encodeString,
    );
  }
  return value;
}

function withJsonString<T extends object>(
  copy: T,
  original: unknown,
  encodeString: (value: string) => string,
): T {
  return Object.defineProperty(copy, Symbol.toPrimitive, {
    value: () => encodeString(JSON.stringify(original)),
  });
}

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
    // SECURITY: `field` is user-controlled (it comes from the template text,
    // which authors and, via variables, other tenants can influence). This
    // helper must NEVER index the prototype chain — do not "simplify" it by
    // removing the dangerous-key guard or the own-property check below, or a
    // template could read `__proto__`/`constructor`/`prototype` and enable
    // prototype-pollution/gadget access.
    const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    this.handlebars.registerHelper(
      "lookup",
      function (obj: unknown, field: string) {
        if (
          obj &&
          typeof obj === "object" &&
          typeof field === "string" &&
          !DANGEROUS_KEYS.has(field) &&
          Object.prototype.hasOwnProperty.call(obj, field)
        ) {
          return (obj as Record<string, unknown>)[field];
        }
        return undefined;
      },
    );
  }

  /**
   * Render a template for the given output. A template that does not compile or
   * throws in a helper throws here, so the job fails. Sending its error text on to
   * a recipient as if it were the message would hide the problem from the author.
   */
  processTemplate(
    template: string,
    context: TemplateContext,
    encoding: TemplateEncoding = "html",
  ): string {
    if (!template.includes("{{")) return template;

    const encodeString =
      encoding === "markup" ? encodeMarkup : (v: string) => v;
    const templateData = prepareValue(
      {
        cronium: {
          event: context.event,
          getVariables: context.variables,
          input: context.input,
          getCondition: context.conditions,
        },
      },
      encodeString,
    );
    // String(): a template that is one lone tag returns the value itself, not a
    // string, when escaping is off.
    const render = (source: string) =>
      String(
        this.handlebars.compile(source, { noEscape: encoding !== "html" })(
          templateData,
        ),
      );

    return isJsonTemplate(template)
      ? renderJsonDocument(template, render)
      : render(template);
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
