"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";

const webhookFormSchema = z.object({
  workflowId: z.number().int().positive(),
  key: z.string().min(1, "Key is required"),
  description: z.string().optional(),
  isActive: z.boolean(),
  allowedMethods: z.array(z.enum(["GET", "POST", "PUT", "PATCH"])),
  rateLimitPerMinute: z.number().int().min(1).max(1000),
  requireAuth: z.boolean(),
  authToken: z.string().optional(),
  responseFormat: z.enum(["json", "text", "xml"]),
});

type WebhookFormData = z.infer<typeof webhookFormSchema>;

// Define webhook interface based on the router's mock data structure
interface Webhook {
  id: number;
  userId: string;
  workflowId: number;
  key: string;
  url?: string;
  description?: string | null;
  isActive: boolean;
  allowedMethods: ("GET" | "POST" | "PUT" | "PATCH")[];
  allowedIps?: string[];
  rateLimitPerMinute: number;
  requireAuth: boolean;
  authToken?: string | null;
  customHeaders?: Record<string, string>;
  responseFormat: "json" | "text" | "xml";
  triggerCount?: number;
  lastTriggered?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookFormProps {
  webhook?: Webhook;
  workflowId?: number;
  onSubmit: (data: WebhookFormData) => void;
  onCancel: () => void;
}

const HTTP_METHODS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
];

const RESPONSE_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "text", label: "Plain Text" },
  { value: "xml", label: "XML" },
];

export function WebhookForm({
  webhook,
  workflowId,
  onSubmit,
  onCancel,
}: WebhookFormProps) {
  const { toast } = useToast();
  const [, setGeneratedKey] = React.useState<string>("");
  const [previewUrl, setPreviewUrl] = React.useState<string>("");

  const form = useForm<WebhookFormData>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: webhook
      ? {
          workflowId: webhook.workflowId,
          key: webhook.key,
          description: webhook.description ?? "",
          isActive: webhook.isActive,
          allowedMethods: webhook.allowedMethods,
          rateLimitPerMinute: webhook.rateLimitPerMinute,
          requireAuth: webhook.requireAuth,
          authToken: webhook.authToken ?? "",
          responseFormat: webhook.responseFormat,
        }
      : {
          workflowId: workflowId ?? 0,
          key: "",
          description: "",
          isActive: true,
          allowedMethods: ["POST"],
          rateLimitPerMinute: 60,
          requireAuth: false,
          authToken: "",
          responseFormat: "json",
        },
  });

  const generateKeyMutation = trpc.webhooks.generateUrl.useMutation({
    onSuccess: (result) => {
      setGeneratedKey(result.key);
      form.setValue("key", result.key);
      setPreviewUrl(result.url);
      toast({
        title: "Key Generated",
        description: "A new webhook key has been generated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate webhook key",
        variant: "destructive",
      });
    },
  });

  const watchedKey = form.watch("key");
  const watchedMethods = form.watch("allowedMethods");
  const watchedRequireAuth = form.watch("requireAuth");

  // Update preview URL when key changes
  React.useEffect(() => {
    if (watchedKey) {
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      setPreviewUrl(`${baseUrl}/api/workflows/webhook/${watchedKey}`);
    }
  }, [watchedKey]);

  const generateRandomKey = () => {
    if (workflowId) {
      generateKeyMutation.mutate({ workflowId });
    } else {
      // Generate a simple random key if no workflow ID
      const randomKey = `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setGeneratedKey(randomKey);
      form.setValue("key", randomKey);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  const toggleMethod = (method: string) => {
    const currentMethods = watchedMethods;
    const typedMethod = method as "GET" | "POST" | "PUT" | "PATCH";
    const updatedMethods = currentMethods.includes(typedMethod)
      ? currentMethods.filter((m) => m !== method)
      : [...currentMethods, typedMethod];

    form.setValue("allowedMethods", updatedMethods);
  };

  const handleSubmit = (data: WebhookFormData) => {
    if (!data.key) {
      toast({
        title: "Validation Error",
        description: "Webhook key is required",
        variant: "destructive",
      });
      return;
    }

    if (data.allowedMethods.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one HTTP method must be allowed",
        variant: "destructive",
      });
      return;
    }

    if (data.requireAuth && !data.authToken) {
      toast({
        title: "Validation Error",
        description: "Auth token is required when authentication is enabled",
        variant: "destructive",
      });
      return;
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      {/* Basic Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Basic Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Webhook Key</Label>
            <div className="flex space-x-2">
              <Input
                id="key"
                placeholder="my-webhook-key"
                {...form.register("key")}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={generateRandomKey}
                disabled={generateKeyMutation.isPending}
              >
                {generateKeyMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              A unique identifier for your webhook. Use only letters, numbers,
              hyphens, and underscores.
            </p>
          </div>

          {previewUrl && (
            <div className="space-y-2">
              <Label>Webhook URL Preview</Label>
              <div className="bg-muted flex items-center space-x-2 rounded-lg p-3">
                <code className="flex-1 text-sm">{previewUrl}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(previewUrl, "Webhook URL")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe what this webhook is used for..."
              {...form.register("description")}
              rows={3}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={form.watch("isActive")}
              onCheckedChange={(checked) => form.setValue("isActive", checked)}
            />
            <Label htmlFor="isActive">Active</Label>
          </div>
        </CardContent>
      </Card>

      {/* HTTP Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">HTTP Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Allowed HTTP Methods</Label>
            <div className="flex flex-wrap gap-2">
              {HTTP_METHODS.map((method) => (
                <Button
                  key={method.value}
                  type="button"
                  variant={
                    watchedMethods.includes(
                      method.value as "GET" | "POST" | "PUT" | "PATCH",
                    )
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => toggleMethod(method.value)}
                >
                  {method.label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Select which HTTP methods are allowed for this webhook
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="responseFormat">Response Format</Label>
            <Select
              value={form.watch("responseFormat")}
              onValueChange={(value) =>
                form.setValue(
                  "responseFormat",
                  value as "json" | "text" | "xml",
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESPONSE_FORMATS.map((format) => (
                  <SelectItem key={format.value} value={format.value}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rateLimitPerMinute">
              Rate Limit (requests per minute)
            </Label>
            <Input
              id="rateLimitPerMinute"
              type="number"
              min="1"
              max="1000"
              {...form.register("rateLimitPerMinute", { valueAsNumber: true })}
            />
            <p className="text-muted-foreground text-xs">
              Maximum number of requests allowed per minute
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Security Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="requireAuth"
              checked={watchedRequireAuth}
              onCheckedChange={(checked) =>
                form.setValue("requireAuth", checked)
              }
            />
            <Label htmlFor="requireAuth">Require Authentication</Label>
          </div>

          {watchedRequireAuth && (
            <div className="space-y-2">
              <Label htmlFor="authToken">Authentication Token</Label>
              <Input
                id="authToken"
                type="password"
                placeholder="Bearer token for authentication"
                {...form.register("authToken")}
              />
              <div className="flex items-start space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-medium">Authentication Required</p>
                  <p>
                    Include this token in the Authorization header:
                    <code className="ml-1 rounded bg-amber-100 px-1 dark:bg-amber-900">
                      Bearer {form.watch("authToken") ?? "your-token"}
                    </code>
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {webhook ? "Update Webhook" : "Create Webhook"}
        </Button>
      </div>
    </form>
  );
}
