import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { storage } from "@/server/storage";
import { env } from "../env.mjs";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_KEY_SETTING,
  DEFAULT_AI_MODEL,
  FALLBACK_AI_MODELS,
  type AiModelOption,
  type AiProviderId,
} from "@/shared/ai-providers";

// Reasoning models (GPT-5.x etc.) spend completion tokens on reasoning before
// emitting text, so leave generous headroom beyond the expected script length.
const MAX_OUTPUT_TOKENS = 8000;

export interface AiConfig {
  provider: AiProviderId;
  model: string;
  apiKey: string | undefined;
  baseUrl: string | undefined;
}

function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

// Resolve the configured provider, model, and credentials from system settings.
// For OpenAI, the OPENAI_API_KEY env var takes precedence over the admin-entered key.
export async function getAiConfig(): Promise<AiConfig> {
  const providerSetting = await storage.getSetting("aiProvider");
  const provider: AiProviderId =
    providerSetting?.value && isAiProviderId(providerSetting.value)
      ? providerSetting.value
      : "openai";

  const modelSetting = await storage.getSetting("aiModel");
  const model = modelSetting?.value ?? DEFAULT_AI_MODEL[provider];

  const keySetting = await storage.getSetting(
    AI_PROVIDER_KEY_SETTING[provider],
  );
  let apiKey = keySetting?.value ?? undefined;
  if (provider === "openai") {
    apiKey = env.OPENAI_API_KEY ?? apiKey;
  }

  let baseUrl: string | undefined;
  if (provider === "custom") {
    const baseUrlSetting = await storage.getSetting("customAiBaseUrl");
    baseUrl = baseUrlSetting?.value ?? undefined;
  }

  return { provider, model, apiKey, baseUrl };
}

// Whether the configured provider has everything it needs to serve requests.
export async function isAiConfigured(): Promise<boolean> {
  const config = await getAiConfig();
  if (!config.apiKey) return false;
  if (config.provider === "custom" && (!config.baseUrl || !config.model)) {
    return false;
  }
  return true;
}

// Per-language reference for the Cronium runtime helpers so generated scripts
// can participate in workflows. Names and calling conventions must match the
// SDKs in apps/runtime/runtime-helpers/ — do not invent additional helpers.
const CRONIUM_HELPERS_NODEJS = `A global \`cronium\` object is automatically available (no require or import needed):
- await cronium.input() — JSON input for this run: the output of the previous workflow step, or the trigger payload. Returns null when there is none.
- await cronium.output(data) — set this run's output (any JSON-serializable value); it becomes the next connected workflow step's input.
- await cronium.getVariable(key) — read a persistent variable (returns null if unset).
- await cronium.setVariable(key, value) — write a persistent variable. Variables persist across runs and are shared across the user's events and workflows.
- await cronium.setCondition(boolean) — set the condition evaluated by conditional workflow connections (true takes the "condition true" branch).
- await cronium.event() — metadata about the running event (id, name, type, etc.).
Wrap the script body in an async IIFE — (async () => { ... })(); — and always \`await\` cronium calls. Do not use top-level await.
Extra helpers available only when the event runs in a Cronium container (not on remote servers): cronium.executeToolAction(tool, action, config), cronium.sendEmail({to, subject, body}), cronium.sendSlackMessage({channel, text}), cronium.sendDiscordMessage({channelId, content}).
On events that run on remote servers over SSH, only input, output, getVariable, setVariable, and event are available — setCondition and the extra helpers are not.`;

const CRONIUM_HELPERS_PYTHON = `The \`cronium\` module is automatically available (no import needed) with synchronous, snake_case functions:
- cronium.input() — JSON input for this run: the output of the previous workflow step, or the trigger payload. Returns None when there is none.
- cronium.output(data) — set this run's output (any JSON-serializable value); it becomes the next connected workflow step's input.
- cronium.get_variable(key) — read a persistent variable (returns None if unset).
- cronium.set_variable(key, value) — write a persistent variable. Variables persist across runs and are shared across the user's events and workflows.
- cronium.set_condition(bool) — set the condition evaluated by conditional workflow connections (True takes the "condition true" branch).
- cronium.event() — metadata dict about the running event (id, name, type, etc.).
Extra helpers available only when the event runs in a Cronium container (not on remote servers): cronium.execute_tool_action(tool, action, config), cronium.send_email(to, subject, body), cronium.send_slack_message(channel, text), cronium.send_discord_message(channel_id, content).
On events that run on remote servers over SSH, only input, output, get_variable, set_variable, and event are available — set_condition and the extra helpers are not.`;

const CRONIUM_HELPERS_BASH = `Cronium helper shell functions are automatically available (already sourced, no setup needed):
- cronium_input — echoes this run's JSON input: the output of the previous workflow step, or the trigger payload. Usage: input=$(cronium_input)
- cronium_output <data> — set this run's output; pass a JSON string (plain strings are auto-wrapped). It becomes the next connected workflow step's input.
- cronium_get_variable <key> — echoes a persistent variable's value (empty if unset).
- cronium_set_variable <key> <value> — write a persistent variable. Variables persist across runs and are shared across the user's events and workflows.
- cronium_set_condition <true|false> — set the condition evaluated by conditional workflow connections (true takes the "condition true" branch).
- cronium_event — echoes event metadata JSON; cronium_event_field <field> extracts one field.
Extra helpers available only when the event runs in a Cronium container (not on remote servers): cronium_execute_tool_action <tool> <action> <config_json>, cronium_send_email, cronium_send_slack_message, cronium_send_discord_message, cronium_variable_exists, cronium_increment_variable.
On events that run on remote servers over SSH, only cronium_input, cronium_output, cronium_get_variable, cronium_set_variable, and cronium_event are available — cronium_set_condition and the extra helpers are not.`;

export function buildPrompts(
  prompt: string,
  scriptType: string,
  currentCode?: string,
): { systemPrompt: string; userPrompt: string } {
  let systemPrompt = `You are an expert programmer that writes clean, efficient, and well-documented code.
You write scripts for Cronium, a self-hosted automation platform where scripts run as scheduled events, standalone or chained into workflows. Generate code based on the user's request.`;

  // Add script type-specific instructions and the runtime helper reference
  switch (scriptType) {
    case "NODEJS":
      systemPrompt += `\nWrite JavaScript code using Node.js. Include error handling.\n\n${CRONIUM_HELPERS_NODEJS}`;
      break;
    case "PYTHON":
      systemPrompt += `\nWrite Python code that follows PEP 8 guidelines. Include error handling.\n\n${CRONIUM_HELPERS_PYTHON}`;
      break;
    case "BASH":
      systemPrompt += `\nWrite Bash script with proper error handling. Add comments where appropriate.\n\n${CRONIUM_HELPERS_BASH}`;
      break;
    default:
      systemPrompt += `\nWrite code in the appropriate language for the task.`;
  }

  if (
    scriptType === "NODEJS" ||
    scriptType === "PYTHON" ||
    scriptType === "BASH"
  ) {
    systemPrompt += `

Use the cronium helpers when the task involves passing data between workflow steps (input/output), persisting state between runs (variables), or steering conditional workflow branches (condition). Skip them when the task doesn't need them — a script that neither reads input nor produces output for other steps should not call them. A script exits successfully with exit code 0; a non-zero exit (or uncaught error) marks the run failed. Only use the cronium helpers documented above — do not invent others.`;
  }

  // Add modification instruction if existing code is provided
  const userPrompt = currentCode
    ? `${prompt}\n\nHere is my current code:\n\`\`\`\n${currentCode}\n\`\`\``
    : prompt;

  return { systemPrompt, userPrompt };
}

async function generateWithOpenAI(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  // Newer OpenAI reasoning models reject `temperature` and `max_tokens`, so
  // stick to parameters accepted across the whole model range.
  const response = await openai.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  });

  return response.choices[0]?.message.content ?? "";
}

async function generateWithAnthropic(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: config.apiKey });

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI provider declined to generate this content");
  }

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function generateWithGemini(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const gemini = new GoogleGenAI({ apiKey: config.apiKey ?? "" });

  const response = await gemini.models.generateContent({
    model: config.model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  return response.text ?? "";
}

// Function to generate code based on a prompt and script type
export async function generateScriptCode(
  prompt: string,
  scriptType: string,
  currentCode?: string,
) {
  const config = await getAiConfig();
  if (!config.apiKey) {
    throw new Error("AI provider API key not configured");
  }

  const { systemPrompt, userPrompt } = buildPrompts(
    prompt,
    scriptType,
    currentCode,
  );

  try {
    let content: string;
    switch (config.provider) {
      case "anthropic":
        content = await generateWithAnthropic(config, systemPrompt, userPrompt);
        break;
      case "gemini":
        content = await generateWithGemini(config, systemPrompt, userPrompt);
        break;
      case "openai":
      case "custom":
        content = await generateWithOpenAI(config, systemPrompt, userPrompt);
        break;
    }

    // Extract code from response if it's wrapped in markdown code blocks
    const codeBlockRegex = /```(?:\w+)?\s*\n([\s\S]+?)\n```/;
    const match = codeBlockRegex.exec(content);

    // If code block is found, return just the code inside it
    if (match?.[1]) {
      return match[1].trim();
    }

    // Otherwise return the whole content (it might be code without markdown formatting)
    return content.trim();
  } catch (error: unknown) {
    console.error(
      `Error generating code with ${config.provider} (${config.model}):`,
      error,
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to generate code: ${message}`);
  }
}

// Models that show up in OpenAI's /v1/models list but can't serve chat completions.
const OPENAI_NON_CHAT_PATTERN =
  /(embedding|tts|whisper|audio|realtime|image|dall-e|moderation|transcribe|search|instruct|davinci|babbage|codex)/i;

async function listOpenAIModels(
  apiKey: string,
  baseUrl?: string,
  filterChatModels = true,
): Promise<AiModelOption[]> {
  const openai = new OpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });

  const models: AiModelOption[] = [];
  for await (const model of openai.models.list()) {
    if (
      filterChatModels &&
      (OPENAI_NON_CHAT_PATTERN.test(model.id) ||
        !/^(gpt-|o\d|chatgpt-)/.test(model.id))
    ) {
      continue;
    }
    models.push({ id: model.id, name: model.id });
  }
  // Newest families first (gpt-5 above gpt-4, larger versions above smaller)
  return models.sort((a, b) =>
    b.id.localeCompare(a.id, "en", { numeric: true }),
  );
}

async function listAnthropicModels(apiKey: string): Promise<AiModelOption[]> {
  const anthropic = new Anthropic({ apiKey });
  const models: AiModelOption[] = [];
  for await (const model of anthropic.models.list()) {
    models.push({ id: model.id, name: model.display_name });
  }
  return models;
}

async function listGeminiModels(apiKey: string): Promise<AiModelOption[]> {
  const gemini = new GoogleGenAI({ apiKey });
  const models: AiModelOption[] = [];
  const pager = await gemini.models.list();
  for await (const model of pager) {
    if (!model.name) continue;
    const actions = model.supportedActions ?? [];
    if (actions.length > 0 && !actions.includes("generateContent")) continue;
    const id = model.name.replace(/^models\//, "");
    models.push({ id, name: model.displayName ?? id });
  }
  return models;
}

export interface ListModelsResult {
  models: AiModelOption[];
  source: "provider" | "fallback";
  // Set when the provider fetch was attempted and failed (bad key, network,
  // ...), so the admin UI can tell the user why it's showing a fallback list.
  error: string | undefined;
}

// Query the provider's models API so the admin UI only offers models the
// provider actually serves. Falls back to a curated static list when the
// provider can't be reached (e.g. no key entered yet).
export async function listAvailableModels(
  provider: AiProviderId,
  apiKey?: string,
  baseUrl?: string,
): Promise<ListModelsResult> {
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    const keySetting = await storage.getSetting(
      AI_PROVIDER_KEY_SETTING[provider],
    );
    resolvedKey = keySetting?.value ?? undefined;
    if (provider === "openai") {
      resolvedKey = env.OPENAI_API_KEY ?? resolvedKey;
    }
  }
  let resolvedBaseUrl = baseUrl;
  if (provider === "custom" && !resolvedBaseUrl) {
    const baseUrlSetting = await storage.getSetting("customAiBaseUrl");
    resolvedBaseUrl = baseUrlSetting?.value ?? undefined;
  }

  let fetchError: string | undefined;
  if (resolvedKey && (provider !== "custom" || resolvedBaseUrl)) {
    try {
      let models: AiModelOption[];
      switch (provider) {
        case "anthropic":
          models = await listAnthropicModels(resolvedKey);
          break;
        case "gemini":
          models = await listGeminiModels(resolvedKey);
          break;
        case "openai":
          models = await listOpenAIModels(resolvedKey);
          break;
        case "custom":
          models = await listOpenAIModels(resolvedKey, resolvedBaseUrl, false);
          break;
      }
      if (models.length > 0) {
        return { models, source: "provider", error: undefined };
      }
    } catch (error) {
      console.error(`Failed to list models from ${provider}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      fetchError = message.slice(0, 300);
    }
  }

  return {
    models: FALLBACK_AI_MODELS[provider],
    source: "fallback",
    error: fetchError,
  };
}
