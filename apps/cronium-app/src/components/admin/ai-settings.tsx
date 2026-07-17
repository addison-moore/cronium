"use client";
import React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Sparkles, Save, RefreshCw } from "lucide-react";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { SettingsSection } from "./settings-section";
import { trpc } from "@/lib/trpc";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  DEFAULT_AI_MODEL,
  FALLBACK_AI_MODELS,
  type AiModelOption,
  type AiProviderId,
} from "@/shared/ai-providers";

const copy = {
  title: "AI Settings",
  description: "Configure AI-assisted script generation features",
  enableAi: "Enable AI features",
  provider: "AI Provider",
  model: "AI Model",
  refreshModels: "Refresh models",
  baseUrl: "API Base URL",
  save: "Save",
  fallbackNote:
    "Couldn't fetch the live model list from the provider — showing common models. Enter a valid API key and refresh to see the models your account can use.",
  customHelp:
    "Any OpenAI-compatible endpoint (Groq, Together, Fireworks, OpenRouter, Ollama, vLLM, ...) for open models like Kimi, Qwen, or Llama.",
} as const;

const PROVIDER_KEY_FIELD = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  custom: "customAiApiKey",
} as const;

const PROVIDER_KEY_LABEL: Record<AiProviderId, string> = {
  openai: "OpenAI API Key",
  anthropic: "Anthropic API Key",
  gemini: "Google AI API Key",
  custom: "API Key",
};

const PROVIDER_KEY_PLACEHOLDER: Record<AiProviderId, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
  gemini: "AIza...",
  custom: "API key for the endpoint",
};

const aiSettingsSchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    aiProvider: z.enum(AI_PROVIDER_IDS).optional(),
    aiModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    customAiApiKey: z.string().optional(),
    customAiBaseUrl: z.string().optional(),
  })
  .refine(
    (data) => {
      // If AI is enabled, the active provider needs a model and an API key
      if (data.aiEnabled) {
        const provider = data.aiProvider ?? "openai";
        const apiKey = data[PROVIDER_KEY_FIELD[provider]];
        if (!data.aiModel || !apiKey) return false;
        if (provider === "custom" && !data.customAiBaseUrl) return false;
      }
      return true;
    },
    {
      message:
        "A model and API key (and base URL for custom endpoints) are required when AI is enabled",
      path: ["aiEnabled"],
    },
  );

interface SystemSettings {
  aiEnabled?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  customAiApiKey?: string;
  customAiBaseUrl?: string;
}

interface AiSettingsProps {
  settings: SystemSettings;
  onSave: (data: z.infer<typeof aiSettingsSchema>) => Promise<void>;
}

function formDefaults(settings: SystemSettings) {
  return {
    aiEnabled: settings.aiEnabled ?? false,
    aiProvider: settings.aiProvider ?? "openai",
    aiModel: settings.aiModel ?? "",
    openaiApiKey: settings.openaiApiKey ?? "",
    anthropicApiKey: settings.anthropicApiKey ?? "",
    geminiApiKey: settings.geminiApiKey ?? "",
    customAiApiKey: settings.customAiApiKey ?? "",
    customAiBaseUrl: settings.customAiBaseUrl ?? "",
  };
}

export function AiSettings({ settings, onSave }: AiSettingsProps) {
  const form = useForm<z.infer<typeof aiSettingsSchema>>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: formDefaults(settings),
  });

  // Update form when settings change
  React.useEffect(() => {
    form.reset(formDefaults(settings));
  }, [settings, form]);

  const provider = form.watch("aiProvider") ?? "openai";
  const apiKey = form.watch(PROVIDER_KEY_FIELD[provider]) ?? "";
  const baseUrl = form.watch("customAiBaseUrl") ?? "";

  const [models, setModels] = React.useState<AiModelOption[]>(
    FALLBACK_AI_MODELS[provider],
  );
  const [modelSource, setModelSource] = React.useState<"provider" | "fallback">(
    "fallback",
  );

  const listModels = trpc.admin.listAiModels.useMutation({
    onSuccess: (result) => {
      setModels(result.data.models);
      setModelSource(result.data.source);
    },
  });
  // Keep a stable reference so the provider-change effect doesn't refire on
  // every render (useMutation returns a new object each render).
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

  // Refresh the model list when the provider changes (uses the saved key on
  // the server when the form key is empty).
  React.useEffect(() => {
    setModels(FALLBACK_AI_MODELS[provider]);
    setModelSource("fallback");
    loadModels(provider, apiKey, baseUrl);
  }, [provider, loadModels]);

  const handleProviderChange = (
    value: string,
    onChange: (value: AiProviderId) => void,
  ) => {
    const next = value as AiProviderId;
    onChange(next);
    // Reset the model to the saved one (same provider) or the provider default
    const savedProvider = settings.aiProvider ?? "openai";
    form.setValue(
      "aiModel",
      next === savedProvider
        ? (settings.aiModel ?? DEFAULT_AI_MODEL[next])
        : DEFAULT_AI_MODEL[next],
    );
  };

  const selectedModel = form.watch("aiModel") ?? "";
  const modelOptions = React.useMemo(() => {
    // Keep the currently-selected model choosable even if the fetched list
    // doesn't contain it (e.g. saved before a provider switch-back).
    if (selectedModel && !models.some((m) => m.id === selectedModel)) {
      return [{ id: selectedModel, name: selectedModel }, ...models];
    }
    return models;
  }, [models, selectedModel]);

  const useManualModelInput = provider === "custom" && models.length === 0;

  return (
    <SettingsSection
      title={copy.title}
      description={copy.description}
      icon={Sparkles}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="flex items-center space-x-2">
          <Controller
            name="aiEnabled"
            control={form.control}
            render={({ field }) => (
              <Switch
                id="aiEnabled"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Label htmlFor="aiEnabled">{copy.enableAi}</Label>
        </div>

        {form.watch("aiEnabled") && (
          <div className="space-y-4">
            <Controller
              name="aiProvider"
              control={form.control}
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="aiProvider">{copy.provider}</Label>
                  <Select
                    value={field.value ?? "openai"}
                    onValueChange={(value) =>
                      handleProviderChange(value, field.onChange)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select AI provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {provider === "custom" && (
                    <p className="text-muted-foreground text-sm">
                      {copy.customHelp}
                    </p>
                  )}
                </div>
              )}
            />

            {provider === "custom" && (
              <Controller
                name="customAiBaseUrl"
                control={form.control}
                render={({ field, fieldState }) => (
                  <div className="space-y-2">
                    <Label htmlFor="customAiBaseUrl">{copy.baseUrl}</Label>
                    <Input
                      id="customAiBaseUrl"
                      type="url"
                      placeholder="https://api.groq.com/openai/v1"
                      aria-describedby={
                        fieldState.error ? "customAiBaseUrl-error" : undefined
                      }
                      {...field}
                    />
                    {fieldState.error && (
                      <p
                        id="customAiBaseUrl-error"
                        className="text-sm text-red-600"
                      >
                        {fieldState.error.message}
                      </p>
                    )}
                  </div>
                )}
              />
            )}

            <Controller
              key={PROVIDER_KEY_FIELD[provider]}
              name={PROVIDER_KEY_FIELD[provider]}
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="space-y-2">
                  <Label htmlFor={PROVIDER_KEY_FIELD[provider]}>
                    {PROVIDER_KEY_LABEL[provider]}
                  </Label>
                  <Input
                    id={PROVIDER_KEY_FIELD[provider]}
                    type="password"
                    placeholder={PROVIDER_KEY_PLACEHOLDER[provider]}
                    aria-describedby={
                      fieldState.error
                        ? `${PROVIDER_KEY_FIELD[provider]}-error`
                        : undefined
                    }
                    {...field}
                    value={field.value ?? ""}
                  />
                  {fieldState.error && (
                    <p
                      id={`${PROVIDER_KEY_FIELD[provider]}-error`}
                      className="text-sm text-red-600"
                    >
                      {fieldState.error.message}
                    </p>
                  )}
                </div>
              )}
            />

            <Controller
              name="aiModel"
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="aiModel">{copy.model}</Label>
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
                      {copy.refreshModels}
                    </Button>
                  </div>
                  {useManualModelInput ? (
                    <Input
                      id="aiModel"
                      placeholder="e.g. moonshotai/kimi-k2-instruct, qwen3-32b, llama-3.3-70b"
                      {...field}
                      value={field.value ?? ""}
                    />
                  ) : (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      aria-describedby={
                        fieldState.error ? "aiModel-error" : undefined
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select AI model" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {modelSource === "fallback" && !useManualModelInput && (
                    <p className="text-muted-foreground text-sm">
                      {copy.fallbackNote}
                    </p>
                  )}
                  {fieldState.error && (
                    <p id="aiModel-error" className="text-sm text-red-600">
                      {fieldState.error.message}
                    </p>
                  )}
                </div>
              )}
            />
          </div>
        )}

        <Button type="submit" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {copy.save}
        </Button>
      </form>
    </SettingsSection>
  );
}
