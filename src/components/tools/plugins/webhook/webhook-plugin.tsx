import {
  type ToolPlugin,
  type ToolAction,
  type ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { z } from "zod";
import { Link } from "lucide-react";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Webhook credential schema
const WebhookCredentialsSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .object({
      type: z.enum(["none", "basic", "bearer"]),
      credentials: z.record(z.string()),
    })
    .optional(),
});

// Send webhook action
const sendWebhookSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
  body: z.any().optional(),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
});

const sendWebhookAction: ToolAction = {
  id: "webhook.send",
  name: "Send Webhook",
  description: "Send an HTTP request to a webhook URL",
  category: "Integration",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: sendWebhookSchema,
  parameters: zodToParameters(sendWebhookSchema),
  outputSchema: z.object({
    status: z.number(),
    statusText: z.string(),
    data: z.any(),
    headers: z.record(z.string()),
  }),
  execute: async (credentials, parameters, context: ExecutionContext) => {
    const creds = WebhookCredentialsSchema.parse(credentials);
    const {
      method,
      body,
      headers: paramHeaders,
      queryParams,
    } = parameters as {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
      queryParams?: Record<string, string>;
    };

    context.logger.info(`Sending ${method} request to webhook`);

    // Build URL with query params
    let url = creds.url;
    if (queryParams) {
      const params = new URLSearchParams(queryParams);
      url += `?${params.toString()}`;
    }

    // Merge headers
    const allHeaders: Record<string, string> = {
      ...creds.headers,
      ...(paramHeaders ?? {}),
    };

    // Add auth header if needed
    if (creds.auth?.type === "bearer" && creds.auth.credentials?.token) {
      allHeaders.Authorization = `Bearer ${creds.auth.credentials.token}`;
    }

    // Make request
    const response = await fetch(url, {
      method,
      headers: allHeaders,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    const responseData: unknown = await response
      .json()
      .catch(() => response.text());

    return {
      status: response.status,
      statusText: response.statusText,
      data: responseData,
      headers: Object.fromEntries(response.headers.entries()),
    };
  },
};

// Component placeholders
const WebhookCredentialForm = () => {
  return <div>Webhook credential form not implemented</div>;
};

const WebhookCredentialDisplay = () => {
  return <div>Webhook credential display not implemented</div>;
};

// Webhook plugin definition
export const WebhookPlugin: ToolPlugin = {
  id: "webhook",
  name: "Webhook",
  description: "Send HTTP requests to any webhook URL",
  icon: Link,
  category: "Integration",
  schema: WebhookCredentialsSchema,
  defaultValues: {
    url: "",
  },

  // Components
  CredentialForm: WebhookCredentialForm,
  CredentialDisplay: WebhookCredentialDisplay,

  // Tool Actions
  actions: [sendWebhookAction],
  getActionById: (id: string) =>
    [sendWebhookAction].find((action) => action.id === id),
  getActionsByType: (type) =>
    [sendWebhookAction].filter((action) => action.actionType === type),

  test: async (credentials: Record<string, unknown>) => {
    try {
      const creds = WebhookCredentialsSchema.parse(credentials);
      const response = await fetch(creds.url, { method: "HEAD" });

      return {
        success: response.ok,
        message: response.ok
          ? "Connection successful"
          : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  },
};
