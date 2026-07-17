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
// Last refreshed 2026-07 from the providers' model documentation.
export const FALLBACK_AI_MODELS: Record<AiProviderId, AiModelOption[]> = {
  openai: [
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  ],
  anthropic: [
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  custom: [],
};

export const DEFAULT_AI_MODEL: Record<AiProviderId, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-opus-4-8",
  gemini: "gemini-3.5-flash",
  custom: "",
};

// Which system-settings key holds the API key for each provider.
export const AI_PROVIDER_KEY_SETTING: Record<AiProviderId, string> = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  custom: "customAiApiKey",
};
