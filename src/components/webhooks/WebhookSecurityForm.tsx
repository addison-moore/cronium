"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Shield,
  Key,
  Clock,
  Globe,
  AlertTriangle,
  CheckCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@/server/api/root";

const securityFormSchema = z.object({
  enableIpWhitelist: z.boolean(),
  allowedIps: z.array(z.string()),
  enableRateLimit: z.boolean(),
  rateLimitPerMinute: z.number().int().min(1).max(1000),
  enableAuth: z.boolean(),
  authType: z.enum(["bearer", "basic", "custom_header"]),
  authToken: z.string().optional(),
  customAuthHeader: z.string().optional(),
  enableSignatureVerification: z.boolean(),
  signatureSecret: z.string().optional(),
  signatureHeader: z.string(),
});

type SecurityFormData = z.infer<typeof securityFormSchema>;

// Define the webhook type based on the mock data structure
interface Webhook {
  id: number;
  userId: string;
  workflowId: number;
  key: string;
  url: string;
  description?: string;
  isActive: boolean;
  allowedMethods: string[];
  allowedIps?: string[];
  rateLimitPerMinute: number;
  requireAuth: boolean;
  authToken?: string | null;
  customHeaders?: Record<string, string>;
  responseFormat?: "json" | "text" | "xml";
  createdAt: Date;
  updatedAt: Date;
  triggerCount: number;
  lastTriggeredAt?: Date | null;
}

interface WebhookSecurityFormProps {
  webhook: Webhook;
  onSave: () => void;
  onCancel: () => void;
}

export function WebhookSecurityForm({
  webhook,
  onSave,
  onCancel,
}: WebhookSecurityFormProps) {
  const { toast } = useToast();
  const [newIpInput, setNewIpInput] = React.useState("");

  const form = useForm<SecurityFormData>({
    resolver: zodResolver(securityFormSchema),
    defaultValues: {
      enableIpWhitelist: !!(
        webhook.allowedIps && webhook.allowedIps.length > 0
      ),
      allowedIps: webhook.allowedIps ?? [],
      enableRateLimit: webhook.rateLimitPerMinute > 0,
      rateLimitPerMinute: webhook.rateLimitPerMinute ?? 60,
      enableAuth: webhook.requireAuth ?? false,
      authType: "bearer" as const,
      authToken: webhook.authToken ?? "",
      customAuthHeader: "",
      enableSignatureVerification: false,
      signatureSecret: "",
      signatureHeader: "X-Webhook-Signature",
    },
  });

  const configureSecurityMutation = trpc.webhooks.configureSecurity.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Security Updated",
          description:
            "Webhook security settings have been updated successfully",
        });
        onSave();
      },
      onError: (error: TRPCClientErrorLike<AppRouter>) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update security settings",
          variant: "destructive",
        });
      },
    },
  );

  const watchedIpWhitelist = form.watch("enableIpWhitelist");
  const watchedAuth = form.watch("enableAuth");
  const watchedAuthType = form.watch("authType");
  const watchedSignature = form.watch("enableSignatureVerification");
  const watchedAllowedIps = form.watch("allowedIps");

  const addIpAddress = () => {
    if (!newIpInput.trim()) return;

    // Basic IP validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[\w\d\.-]+$/;
    if (!ipRegex.test(newIpInput.trim())) {
      toast({
        title: "Invalid IP",
        description: "Please enter a valid IP address or CIDR block",
        variant: "destructive",
      });
      return;
    }

    const currentIps = form.getValues("allowedIps") ?? [];
    if (currentIps.includes(newIpInput.trim())) {
      toast({
        title: "Duplicate IP",
        description: "This IP address is already in the whitelist",
        variant: "destructive",
      });
      return;
    }

    form.setValue("allowedIps", [...currentIps, newIpInput.trim()]);
    setNewIpInput("");
  };

  const removeIpAddress = (ip: string) => {
    const currentIps = form.getValues("allowedIps") ?? [];
    form.setValue(
      "allowedIps",
      currentIps.filter((i) => i !== ip),
    );
  };

  const generateRandomSecret = () => {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    form.setValue("signatureSecret", secret);
  };

  const handleSubmit = async (data: SecurityFormData) => {
    try {
      await configureSecurityMutation.mutateAsync({
        key: webhook.key,
        ...data,
        allowedIps: data.enableIpWhitelist ? data.allowedIps : undefined,
        rateLimitPerMinute: data.enableRateLimit ? data.rateLimitPerMinute : 0,
        authToken: data.enableAuth ? data.authToken : undefined,
        signatureSecret: data.enableSignatureVerification
          ? data.signatureSecret
          : undefined,
      });
    } catch (error) {
      // Error handled by mutation
      console.error("Security configuration failed:", error);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      {/* IP Whitelist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            IP Address Whitelist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={watchedIpWhitelist ?? false}
              onCheckedChange={(checked) =>
                form.setValue("enableIpWhitelist", checked)
              }
            />
            <Label>Enable IP whitelist</Label>
          </div>

          {watchedIpWhitelist && (
            <div className="space-y-4">
              <div className="flex space-x-2">
                <Input
                  placeholder="192.168.1.0/24 or 203.0.113.1"
                  value={newIpInput}
                  onChange={(e) => setNewIpInput(e.target.value)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && (e.preventDefault(), addIpAddress())
                  }
                />
                <Button type="button" onClick={addIpAddress}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {(watchedAllowedIps ?? []).length > 0 && (
                <div className="space-y-2">
                  <Label>Allowed IP Addresses</Label>
                  <div className="space-y-2">
                    {(watchedAllowedIps ?? []).map((ip, index) => (
                      <div
                        key={index}
                        className="border-border flex items-center justify-between rounded border p-2"
                      >
                        <code className="text-sm">{ip}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIpAddress(ip)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-muted-foreground text-xs">
                Only requests from these IP addresses will be accepted. Supports
                individual IPs and CIDR notation (e.g., 192.168.1.0/24).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rate Limiting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Rate Limiting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={form.watch("enableRateLimit") ?? false}
              onCheckedChange={(checked) =>
                form.setValue("enableRateLimit", checked)
              }
            />
            <Label>Enable rate limiting</Label>
          </div>

          {form.watch("enableRateLimit") && (
            <div className="space-y-2">
              <Label htmlFor="rateLimitPerMinute">Requests per minute</Label>
              <Input
                id="rateLimitPerMinute"
                type="number"
                min="1"
                max="1000"
                {...form.register("rateLimitPerMinute", {
                  valueAsNumber: true,
                })}
              />
              <p className="text-muted-foreground text-xs">
                Maximum number of requests allowed per minute from a single IP
                address
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Authentication */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={watchedAuth ?? false}
              onCheckedChange={(checked) =>
                form.setValue("enableAuth", checked)
              }
            />
            <Label>Require authentication</Label>
          </div>

          {watchedAuth && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Authentication Type</Label>
                <Select
                  value={watchedAuthType ?? "bearer"}
                  onValueChange={(value: string) => {
                    if (
                      value === "bearer" ||
                      value === "basic" ||
                      value === "custom_header"
                    ) {
                      form.setValue("authType", value);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="basic">Basic Auth</SelectItem>
                    <SelectItem value="custom_header">Custom Header</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {watchedAuthType === "bearer" && (
                <div className="space-y-2">
                  <Label htmlFor="authToken">Bearer Token</Label>
                  <Input
                    id="authToken"
                    type="password"
                    placeholder="your-secret-token"
                    {...form.register("authToken")}
                  />
                  <p className="text-muted-foreground text-xs">
                    Include this token in the Authorization header: Bearer{" "}
                    {form.watch("authToken") ?? "your-token"}
                  </p>
                </div>
              )}

              {watchedAuthType === "custom_header" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="customAuthHeader">Header Name</Label>
                    <Input
                      id="customAuthHeader"
                      placeholder="X-API-Key"
                      {...form.register("customAuthHeader")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="authToken">Header Value</Label>
                    <Input
                      id="authToken"
                      type="password"
                      placeholder="your-secret-value"
                      {...form.register("authToken")}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature Verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Signature Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={watchedSignature ?? false}
              onCheckedChange={(checked) =>
                form.setValue("enableSignatureVerification", checked)
              }
            />
            <Label>Enable signature verification</Label>
          </div>

          {watchedSignature && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signatureHeader">Signature Header</Label>
                <Input
                  id="signatureHeader"
                  placeholder="X-Webhook-Signature"
                  {...form.register("signatureHeader")}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="signatureSecret">Secret Key</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateRandomSecret}
                  >
                    Generate Random
                  </Button>
                </div>
                <Input
                  id="signatureSecret"
                  type="password"
                  placeholder="your-secret-key"
                  {...form.register("signatureSecret")}
                />
                <p className="text-muted-foreground text-xs">
                  Used to generate HMAC-SHA256 signatures for payload
                  verification
                </p>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                <div className="flex items-start space-x-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium">
                      Signature Verification Enabled
                    </p>
                    <p>
                      Webhooks will include a signature in the{" "}
                      {form.watch("signatureHeader")} header. Verify the
                      signature using HMAC-SHA256 with your secret key.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Security Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center space-x-2">
              {watchedIpWhitelist ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm">
                IP Whitelist:{" "}
                {watchedIpWhitelist
                  ? `${(watchedAllowedIps ?? []).length} IPs`
                  : "Disabled"}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {form.watch("enableRateLimit") ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm">
                Rate Limit:{" "}
                {form.watch("enableRateLimit")
                  ? `${form.watch("rateLimitPerMinute")}/min`
                  : "Disabled"}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {watchedAuth ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm">
                Authentication: {watchedAuth ? watchedAuthType : "Disabled"}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {watchedSignature ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm">
                Signature: {watchedSignature ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={configureSecurityMutation.isPending}>
          {configureSecurityMutation.isPending
            ? "Saving..."
            : "Save Security Settings"}
        </Button>
      </div>
    </form>
  );
}
