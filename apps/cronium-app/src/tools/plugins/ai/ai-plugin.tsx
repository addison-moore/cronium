"use client";

import React from "react";
import { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Edit, Trash2, AlertTriangle, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { TestConnectionButton } from "@/tools/components/TestConnectionButton";
import { trpc } from "@/lib/trpc";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  DEFAULT_AI_MODEL,
  FALLBACK_AI_MODELS,
  type AiModelOption,
  type AiProviderId,
} from "@/shared/ai-providers";
import { AiIcon } from "./ai-icon";
import { aiActions } from "./actions";
import { aiCredentialsSchema, type AiCredentials } from "./schemas";

// Form schema: apiKey is optional here so editing an existing connection (whose
// key is blanked in API responses) doesn't force re-entry — the server restores
// the stored secret before validating aiCredentialsSchema on save.
const aiFormSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    provider: z.enum(AI_PROVIDER_IDS),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    defaultModel: z.string().optional(),
  })
  .refine((data) => data.provider !== "custom" || !!data.baseUrl?.trim(), {
    message: "Base URL is required for an OpenAI-compatible provider",
    path: ["baseUrl"],
  });
type AiFormData = z.infer<typeof aiFormSchema>;

const PROVIDER_KEY_PLACEHOLDER: Record<AiProviderId, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
  gemini: "AIza...",
  custom: "API key for the endpoint",
};

function parseCreds(raw: unknown): Partial<AiCredentials> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Partial<AiCredentials>;
    } catch {
      return {};
    }
  }
  return (raw as Partial<AiCredentials>) ?? {};
}

function AiCredentialForm({ tool, onSubmit, onCancel }: CredentialFormProps) {
  const existing = tool ? parseCreds(tool.credentials) : {};
  const form = useForm<AiFormData>({
    resolver: zodResolver(aiFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          provider: existing.provider ?? "openai",
          apiKey: existing.apiKey ?? "",
          baseUrl: existing.baseUrl ?? "",
          defaultModel: existing.defaultModel ?? "",
        }
      : {
          name: "",
          provider: "openai",
          apiKey: "",
          baseUrl: "",
          defaultModel: "",
        },
  });

  const provider = form.watch("provider");
  const apiKey = form.watch("apiKey") ?? "";
  const baseUrl = form.watch("baseUrl") ?? "";

  const [models, setModels] = React.useState<AiModelOption[]>(
    FALLBACK_AI_MODELS[provider],
  );
  const [modelSource, setModelSource] = React.useState<"provider" | "fallback">(
    "fallback",
  );
  const [modelError, setModelError] = React.useState<string | undefined>();

  const listModels = trpc.ai.listModels.useMutation({
    onSuccess: (result) => {
      setModels(result.data.models);
      setModelSource(result.data.source);
      setModelError(result.data.error);
    },
  });
  const listModelsRef = React.useRef(listModels);
  listModelsRef.current = listModels;

  const loadModels = React.useCallback(
    (forProvider: AiProviderId, key: string, url: string) => {
      listModelsRef.current.mutate({
        provider: forProvider,
        apiKey: key || undefined,
        baseUrl: forProvider === "custom" ? url || undefined : undefined,
      });
    },
    [],
  );

  const handleProviderChange = (
    value: string,
    onChange: (value: AiProviderId) => void,
  ) => {
    const next = value as AiProviderId;
    onChange(next);
    setModels(FALLBACK_AI_MODELS[next]);
    setModelSource("fallback");
    setModelError(undefined);
    form.setValue("defaultModel", DEFAULT_AI_MODEL[next]);
  };

  const selectedModel = form.watch("defaultModel") ?? "";
  const modelOptions = React.useMemo(() => {
    if (selectedModel && !models.some((m) => m.id === selectedModel)) {
      return [{ id: selectedModel, name: selectedModel }, ...models];
    }
    return models;
  }, [models, selectedModel]);
  const useManualModel = provider === "custom" && models.length === 0;

  const handleSubmit = async (data: AiFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Connect an LLM provider to run AI steps in events and workflows. Your
          key is encrypted at rest and never leaves the server.
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Connection Name</Label>
        <Input
          id="name"
          placeholder="My OpenAI key"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="provider">Provider</Label>
        <Controller
          control={form.control}
          name="provider"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => handleProviderChange(v, field.onChange)}
            >
              <SelectTrigger id="provider">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {provider === "custom" && (
        <div>
          <Label htmlFor="baseUrl">API Base URL</Label>
          <Input
            id="baseUrl"
            type="url"
            placeholder="https://api.groq.com/openai/v1"
            {...form.register("baseUrl")}
          />
          {form.formState.errors.baseUrl && (
            <p className="text-destructive mt-1 text-sm">
              {form.formState.errors.baseUrl.message}
            </p>
          )}
          <p className="text-muted-foreground mt-1 text-xs">
            Any OpenAI-compatible endpoint (Groq, Together, OpenRouter, Ollama,
            vLLM, ...).
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          type="password"
          placeholder={
            tool
              ? "•••••••• (leave blank to keep)"
              : PROVIDER_KEY_PLACEHOLDER[provider]
          }
          {...form.register("apiKey")}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="defaultModel">Default Model</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={listModels.isPending}
            onClick={() => loadModels(provider, apiKey, baseUrl)}
          >
            <RefreshCw
              className={`h-3 w-3 ${listModels.isPending ? "animate-spin" : ""}`}
            />
            Refresh models
          </Button>
        </div>
        <Controller
          control={form.control}
          name="defaultModel"
          render={({ field }) =>
            useManualModel ? (
              <Input
                id="defaultModel"
                placeholder="e.g. qwen3-32b, llama-3.3-70b"
                value={field.value ?? ""}
                onChange={field.onChange}
              />
            ) : (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="defaultModel">
                  <SelectValue placeholder="Select a default model" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        />
        {modelError ? (
          <p className="text-warning-text mt-1 text-sm">
            Couldn&apos;t fetch the live model list — showing common models.
            Provider error: {modelError}
          </p>
        ) : (
          modelSource === "fallback" &&
          !useManualModel && (
            <p className="text-muted-foreground mt-1 text-xs">
              Common models shown. Enter your key and refresh to load the models
              your account can use. An action can also override this per step.
            </p>
          )
        )}
      </div>

      <TestConnectionButton
        type="ai"
        toolId={tool?.id}
        getCredentials={() => {
          const { name: _name, ...creds } = form.getValues();
          return creds;
        }}
      />

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{tool ? "Update" : "Create"}</Button>
      </div>
    </form>
  );
}

function AiCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const providerLabel = (id?: string) =>
    AI_PROVIDERS.find((p) => p.id === id)?.label ?? id ?? "unknown";

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const creds = parseCreds(tool.credentials);
        return (
          <div
            key={tool.id}
            className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h4 className="font-medium">{tool.name}</h4>
                <StatusBadge status={tool.isActive ? "active" : "offline"} />
                <ToolHealthBadge toolId={tool.id} />
              </div>
              <div className="text-muted-foreground text-sm">
                <span className="font-mono text-xs">
                  {providerLabel(creds.provider)}
                  {creds.defaultModel ? ` · ${creds.defaultModel}` : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(tool)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tool.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}

      {tools.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No AI Connections</CardTitle>
            <CardDescription>
              Connect an LLM provider to add AI steps to events and workflows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Review or summarize upstream data with an LLM</li>
              <li>Return structured JSON for downstream steps to branch on</li>
              <li>
                Reference upstream output with {"{{cronium.input.*}}"} in the
                prompt
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const AiPlugin: ToolPlugin = {
  id: "ai",
  name: "AI (LLM)",
  description: "Prompt an LLM from events and workflows (any provider)",
  icon: AiIcon,
  category: "AI",
  categoryIcon: "Sparkles",

  schema: aiCredentialsSchema,
  defaultValues: {
    provider: "openai",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
  },

  CredentialForm: AiCredentialForm,
  CredentialDisplay: AiCredentialDisplay,

  actions: Object.values(aiActions),
  getActionById: (id: string) => aiActions[id],
  getActionsByType: (type: string) =>
    Object.values(aiActions).filter((action) => action.actionType === type),

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = aiCredentialsSchema.safeParse(credentials);
    return result.success
      ? { isValid: true }
      : {
          isValid: false,
          error: result.error.issues[0]?.message ?? "Invalid credentials",
        };
  },

  async test(
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    const { testConnection } = await import("./connection-test");
    const result = await testConnection(credentials);
    return { success: result.success, message: result.message };
  },
};
