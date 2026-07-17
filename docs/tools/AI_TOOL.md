# AI Tool

The **AI tool** lets an event or workflow step prompt an LLM and pass its reply
to the next step. It is provider-agnostic and uses **per-user connections** —
each user brings their own key.

## Connections (credentials)

Add an AI connection on the **Tools** page. A connection stores:

- **Provider** — `openai`, `anthropic` (Claude), `gemini`, or `custom` (any
  OpenAI-compatible endpoint: Groq, Together, OpenRouter, Ollama, vLLM, …).
- **API key** — encrypted at rest (`tool_credentials`), never returned to the
  browser after saving.
- **Base URL** — required for `custom` providers; ignored otherwise.
- **Default model** — used when an action doesn't override it. Use
  **Refresh models** to load the live model list for your key.

This is separate from the system-wide **AI Assistant** settings (Admin →
AI Assistant), which power dev-time script generation only.

## The Prompt action (`ai-prompt`)

Parameters (schema-driven form):

| Field            | Notes                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| `userPrompt`     | The prompt. Template with `{{cronium.input.*}}` to reference upstream data.         |
| `systemPrompt`   | Optional role/behavior instructions.                                                |
| `model`          | Optional per-action override of the connection's default model.                     |
| `temperature`    | Optional 0–2. Some reasoning models reject it — leave blank if so.                  |
| `maxTokens`      | Optional output cap (default 4000, ceiling 32000).                                  |
| `responseFormat` | `text` (default) or `json`.                                                         |
| `jsonSchema`     | Optional (json only). A JSON example/schema added to the prompt to steer the shape. |

## Output (Unified I/O)

The action sets `producesOutput: true`, so its result becomes the next step's
`cronium.input()`:

- **text mode** → `{ text, model, provider, usage, finishReason }`. Downstream
  reads `{{cronium.input.text}}`.
- **json mode** → the parsed object at the top level, with model/usage metadata
  under `_ai`. Downstream reads `{{cronium.input.<field>}}`. Non-object JSON
  (arrays/scalars) is wrapped under `result`.

The result rides the same Unified I/O byte cap (`MAX_UNIFIED_IO_OUTPUT_BYTES`,
5 MB) as any other step output; oversized replies fail the step.

## Example workflow

`SQL (Run Query) → AI (Prompt) → Slack (Send Message)`:

1. SQL emits `{ columns, rows, rowCount }`.
2. AI prompt: `Review these rows and flag anomalies: {{cronium.input.rows}}` →
   emits `{ text, ... }`.
3. Slack message body: `{{cronium.input.text}}`.

## Notes

- Upstream step output is interpolated into the prompt by design — treat the
  model's input as it would any user-influenced data.
- LLM calls honor the event's Timeout (the request is aborted) and the per-tool
  rate limits / quotas applied to every tool action.
