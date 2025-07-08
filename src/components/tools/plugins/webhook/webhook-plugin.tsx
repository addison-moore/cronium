import { ToolPlugin, ToolAction } from "@/components/tools/types/tool-plugin";
import { z } from "zod";
import { ToolType } from "@/shared/schema";
import { Link } from "lucide-react";

// Webhook credential schema
const WebhookCredentialsSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .object({
      type: z.enum(["none", "basic", "bearer"]),
      credentials: z.any().optional(),
    })
    .optional(),
});

// Send webhook action
const sendWebhookAction: ToolAction = {
  id: "webhook.send",
  name: "Send Webhook",
  description: "Send an HTTP request to a webhook URL",
  actionType: "message",
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
    body: z.any().optional(),
    headers: z.record(z.string()).optional(),
    queryParams: z.record(z.string()).optional(),
  }),
  outputSchema: z.object({
    status: z.number(),
    statusText: z.string(),
    data: z.any(),
    headers: z.record(z.string()),
  }),
  execute: async (credentials, parameters, context) => {
    const creds = WebhookCredentialsSchema.parse(credentials);
    const { method, body, headers: paramHeaders, queryParams } = parameters;

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
      ...paramHeaders,
    };

    // Add auth header if needed
    if (creds.auth?.type === "bearer" && creds.auth.credentials?.token) {
      allHeaders["Authorization"] = `Bearer ${creds.auth.credentials.token}`;
    }

    // Make request
    const response = await fetch(url, {
      method,
      headers: allHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseData = await response.json().catch(() => response.text());

    return {
      status: response.status,
      statusText: response.statusText,
      data: responseData,
      headers: Object.fromEntries(response.headers.entries()),
    };
  },
};

// Webhook plugin definition
export const WebhookPlugin: ToolPlugin = {
  id: "webhook",
  name: "Webhook",
  description: "Send HTTP requests to any webhook URL",
  toolType: ToolType.WEBHOOK,
  icon: Link,
  credentialSchema: WebhookCredentialsSchema,
  actions: [sendWebhookAction],
  testConnection: async (credentials) => {
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
  healthCheck: async (credentials) => {
    try {
      const startTime = Date.now();
      const result = await WebhookPlugin.testConnection!(credentials);
      const latency = Date.now() - startTime;

      return {
        status: result.success ? "healthy" : "failing",
        message: result.message,
        details: { latency },
      };
    } catch (error) {
      return {
        status: "failing",
        message: error instanceof Error ? error.message : "Health check failed",
      };
    }
  },
  renderConfig: () => {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Webhook URL</label>
          <input
            type="url"
            name="url"
            className="w-full rounded-md border px-3 py-2"
            placeholder="https://example.com/webhook"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Headers (JSON)
          </label>
          <textarea
            name="headers"
            className="w-full rounded-md border px-3 py-2"
            placeholder='{"X-Custom-Header": "value"}'
            rows={3}
          />
        </div>
      </div>
    );
  },
};
