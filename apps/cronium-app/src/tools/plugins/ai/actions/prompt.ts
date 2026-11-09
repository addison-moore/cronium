import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
  ShownResult,
} from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { counted, spendRun } from "@/tools/utils/test-run";
import {
  aiCredentialsSchema,
  aiPromptSchema,
  DEFAULT_MAX_TOKENS,
} from "../schemas";
import type { AiConfig } from "@/lib/ai";
import { DEFAULT_AI_MODEL } from "@/shared/ai-providers";
import { MAX_UNIFIED_IO_OUTPUT_BYTES, toMb } from "@/lib/unified-io/limits";

// First trimmed, non-empty value — treats "" (e.g. a blank default-model
// field) as "not set" so it falls through, which ?? would not do for "".
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// Strip a leading/trailing markdown code fence (```json ... ```) that models
// often wrap JSON in, then parse. Throws with a snippet on invalid JSON.
function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = fence.exec(text);
  if (match?.[1] !== undefined) {
    text = match[1].trim();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(
      `The model did not return valid JSON. First 200 chars: ${snippet}`,
    );
  }
}

// How each provider says the model stopped at its token limit: OpenAI and OpenAI-compatible
// endpoints, Anthropic, Gemini.
const STOPPED_AT_TOKEN_LIMIT = new Set(["length", "max_tokens", "MAX_TOKENS"]);

interface AnswerDetails {
  model?: unknown;
  usage?: { inputTokens?: unknown; outputTokens?: unknown } | undefined;
  finishReason?: unknown;
}

/**
 * What the event form shows of an answer: its text, or in JSON mode what the next step
 * gets without the `_ai` details, and which model answered. An answer cut off at the
 * token limit can end mid-sentence and still read as whole, so that's said.
 */
function answerShown(result: unknown): ShownResult {
  const output =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  const json = "_ai" in output;
  const { _ai, ...fields } = output;
  const details = (json ? _ai : output) as AnswerDetails | undefined;
  const model =
    typeof details?.model === "string" && details.model
      ? details.model
      : undefined;
  const { inputTokens, outputTokens } = details?.usage ?? {};
  const tokens = [
    typeof inputTokens === "number"
      ? `${counted(inputTokens, "token")} in`
      : undefined,
    typeof outputTokens === "number"
      ? `${counted(outputTokens, "token")} out`
      : undefined,
  ].filter((part) => part !== undefined);
  const stopped =
    typeof details?.finishReason === "string" &&
    STOPPED_AT_TOKEN_LIMIT.has(details.finishReason);

  return {
    type: "text",
    format: json ? "json" : "prose",
    text: json
      ? JSON.stringify(fields, null, 2)
      : typeof output.text === "string"
        ? output.text
        : "",
    ...(model
      ? {
          about:
            `Answered by ${model}` +
            (tokens.length > 0 ? `, using ${tokens.join(" and ")}.` : "."),
        }
      : {}),
    ...(stopped
      ? { warning: "It stopped at Max Tokens, so the answer may be cut short." }
      : {}),
  };
}

export const promptAction: ToolAction = {
  id: "ai-prompt",
  name: "Prompt LLM",
  description:
    "Send a prompt to an LLM and pass its response to the next workflow step " +
    "via cronium.input(). Provider-agnostic (OpenAI, Anthropic, Gemini, or an " +
    "OpenAI-compatible endpoint) — set by the chosen AI connection.",
  category: "AI",
  actionType: "create",
  actionTypeColor: "purple",
  developmentMode: "visual",
  testRun: spendRun(
    "sends the prompt to the model, and your provider may charge for it",
    "The model answered.",
    answerShown,
  ),
  inputSchema: aiPromptSchema,
  parameters: safeZodToParameters(aiPromptSchema),
  outputSchema: z.record(z.string(), z.unknown()),
  // The model's reply flows into Unified I/O so the next event's
  // cronium.input() receives it.
  producesOutput: true,
  helpText:
    "Reference upstream data in the prompt with {{cronium.input.*}} (e.g. " +
    "`Summarize: {{cronium.input.rows}}`). In text mode the next step reads " +
    "{{cronium.input.text}}; in json mode the parsed fields are top-level, so " +
    "the next step reads {{cronium.input.<field>}} (model/usage metadata is " +
    "under {{cronium.input._ai}}).",
  examples: [
    {
      name: "Review rows and alert",
      description: "AI reviews SQL output; a downstream Slack step posts it",
      input: {
        userPrompt:
          "Review these order rows and flag anything unusual in one paragraph: {{cronium.input.rows}}",
      },
      output: {
        text: "Order #5 has a refund larger than the original charge…",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
    },
  ],

  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const { logger } = context;
    try {
      const creds = aiCredentialsSchema.parse(credentials);
      const parsed = aiPromptSchema.parse(params);

      const model =
        firstNonEmpty(parsed.model, creds.defaultModel) ??
        DEFAULT_AI_MODEL[creds.provider];
      if (!model) {
        return {
          success: false,
          error:
            "No model set. Choose a model on this action or a default model " +
            "on the AI connection.",
        };
      }

      const config: AiConfig = {
        provider: creds.provider,
        model,
        apiKey: creds.apiKey,
        baseUrl: firstNonEmpty(creds.baseUrl),
      };

      // In JSON mode, append any user-provided schema/example so the model
      // targets the requested shape.
      let systemPrompt = parsed.systemPrompt;
      if (parsed.responseFormat === "json" && parsed.jsonSchema?.trim()) {
        const shape = `The JSON must match this shape:\n${parsed.jsonSchema.trim()}`;
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${shape}` : shape;
      }

      const signal =
        context.timeoutMs && context.timeoutMs > 0
          ? AbortSignal.timeout(context.timeoutMs)
          : undefined;

      // Lazy-loaded so enumerating tools (which imports the registry) doesn't
      // pull the AI layer's storage/env dependency chain at module load.
      const { generateText } = await import("@/lib/ai");
      const result = await generateText(config, {
        ...(systemPrompt ? { systemPrompt } : {}),
        userPrompt: parsed.userPrompt,
        ...(parsed.temperature !== undefined
          ? { temperature: parsed.temperature }
          : {}),
        maxTokens: parsed.maxTokens ?? DEFAULT_MAX_TOKENS,
        responseFormat: parsed.responseFormat,
        ...(signal ? { signal } : {}),
      });

      const meta = {
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        finishReason: result.finishReason,
      };

      let output: Record<string, unknown>;
      if (parsed.responseFormat === "json") {
        const value = parseJsonLoose(result.text);
        // Keep a stable object shape so downstream templating always works.
        // Objects spread to the top level; arrays/scalars go under `result`.
        output =
          value !== null && typeof value === "object" && !Array.isArray(value)
            ? { ...(value as Record<string, unknown>), _ai: meta }
            : { result: value, _ai: meta };
      } else {
        output = { text: result.text, ...meta };
      }

      // The result rides the Unified I/O channel to the next step; keep it
      // within the shared byte cap rather than failing later in the executor.
      const bytes = Buffer.byteLength(JSON.stringify(output), "utf8");
      if (bytes > MAX_UNIFIED_IO_OUTPUT_BYTES) {
        return {
          success: false,
          error:
            `The model's response exceeds the ${toMb(MAX_UNIFIED_IO_OUTPUT_BYTES)} MB ` +
            `limit for data passed between steps. Lower Max Tokens or ask for a shorter answer.`,
        };
      }

      logger.info(
        `AI prompt completed with ${result.provider}/${result.model}` +
          (result.usage?.outputTokens
            ? ` (${result.usage.outputTokens} output tokens)`
            : ""),
      );

      return output;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown AI error";
      logger.error(`AI prompt failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
