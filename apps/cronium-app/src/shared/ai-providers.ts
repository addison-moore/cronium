// AI provider catalog shared between the admin UI and the server.

export const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "gemini", label: "Google Gemini" },
  { id: "custom", label: "OpenAI-compatible (Kimi, Qwen, Llama, ...)" },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id) as [
  AiProviderId,
  ...AiProviderId[],
];

export interface AiModelOption {
  id: string;
  name: string;
}

// Used when the provider's model-list API can't be reached (no key entered yet,
// network error). The live list fetched from the provider is always preferred.
export const FALLBACK_AI_MODELS: Record<AiProviderId, AiModelOption[]> = {
  openai: [
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5-nano", name: "GPT-5 Nano" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
  ],
  anthropic: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
  custom: [],
};

export const DEFAULT_AI_MODEL: Record<AiProviderId, string> = {
  openai: "gpt-5.1",
  anthropic: "claude-opus-4-8",
  gemini: "gemini-2.5-flash",
  custom: "",
};

// Which system-settings key holds the API key for each provider.
export const AI_PROVIDER_KEY_SETTING: Record<AiProviderId, string> = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  custom: "customAiApiKey",
};
