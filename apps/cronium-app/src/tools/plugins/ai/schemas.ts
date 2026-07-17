import { z } from "zod";
import { AI_PROVIDER_IDS } from "@/shared/ai-providers";

/**
 * Per-user AI connection credentials. Unlike the system-wide AI settings (which
 * power the dev-time script assistant), each user configures their own
 * connection here — provider + key + optional base URL + a default model — so
 * an AI tool action can be fully LLM-agnostic and bring-your-own-key.
 *
 * `apiKey` is named to match the secret-redaction pattern
 * (lib/tools/credential-redaction.ts): it is blanked in API responses, and a
 * blank submit on edit keeps the stored value.
 */
export const aiCredentialsSchema = z
  .object({
    provider: z.enum(AI_PROVIDER_IDS),
    apiKey: z.string().min(1, "API key is required"),
    // Required for the OpenAI-compatible "custom" provider (Ollama, Groq,
    // Together, OpenRouter, vLLM, ...); ignored by the first-party providers.
    baseUrl: z
      .string()
      .url("Base URL must be a valid URL")
      .optional()
      .or(z.literal("")),
    // Model used when an action doesn't override it.
    defaultModel: z.string().optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.provider === "custom" && !val.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: "Base URL is required for an OpenAI-compatible provider",
      });
    }
  });

export type AiCredentials = z.infer<typeof aiCredentialsSchema>;

// ---- Action input schema --------------------------------------------------

// Output token bounds. Kept modest by default — the result rides the Unified I/O
// channel (job.result jsonb, capped at MAX_UNIFIED_IO_OUTPUT_BYTES) to the next
// step, not a bulk transfer.
export const DEFAULT_MAX_TOKENS = 4000;
export const MAX_TOKENS_CEILING = 32000;

export const aiPromptSchema = z.object({
  // `prompt` in the field name triggers the multiline editor in the generic
  // action form (see ActionParameterForm). Template-able with {{cronium.*}}.
  userPrompt: z
    .string()
    .min(1, "Prompt is required")
    .describe(
      "The prompt sent to the model. Reference upstream workflow data with " +
        "{{cronium.input.*}} — e.g. `Review these rows and flag anomalies: " +
        "{{cronium.input.rows}}`.",
    ),
  systemPrompt: z
    .string()
    .optional()
    .describe(
      "Optional. System instructions that set the model's role/behavior, " +
        "e.g. `You are a data reviewer. Be concise.`",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Optional. Model id to use (e.g. gpt-5.6-terra, claude-opus-4-8). " +
        "Defaults to the connection's default model.",
    ),
  temperature: z.coerce
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe(
      "Optional. Sampling temperature 0–2 (higher = more varied). Some " +
        "reasoning models reject this — leave blank if the request errors.",
    ),
  maxTokens: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_TOKENS_CEILING)
    .optional()
    .describe(
      `Optional. Max output tokens (default ${DEFAULT_MAX_TOKENS}, ceiling ${MAX_TOKENS_CEILING}).`,
    ),
  responseFormat: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "text returns the model's reply as { text }. json parses the reply as " +
        "JSON so downstream steps read typed fields via {{cronium.input.*}}.",
    ),
  // `jsonSchema` in the field name (and "JSON" in the description) triggers the
  // Monaco JSON editor in the generic action form.
  jsonSchema: z
    .string()
    .optional()
    .describe(
      "Optional (json format only). A JSON example or JSON Schema describing " +
        "the shape you want back; it's added to the prompt to steer the model.",
    ),
});

export type AiPromptParams = z.infer<typeof aiPromptSchema>;
